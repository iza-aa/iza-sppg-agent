import { spawn, ChildProcess } from "child_process";
import readline from "readline";
import fs from "fs";
import path from "path";
import { env } from "../../config/env.js";
import { geminiKeyManager } from "./gemini-client.js";
import { aiCircuitBreaker } from "./circuit-breaker.js";
import { staticConversationalReply } from "./static-fallback.js";
import { logger } from "../utils/logger.js";

/**
 * High-performance Persistent In-Memory Agy Worker.
 * Keeps an 'agy' CLI process alive with --input-format=stream-json --output-format=stream-json.
 * Eliminates the 16-18s subprocess cold-start latency, running turns in memory in ~2s.
 */
export class AgyStreamWorker {
  private agyCliPath: string;
  private child: ChildProcess | null = null;
  private readlineInterface: readline.Interface | null = null;
  private isReady = false;
  private isStarting = false;
  private currentTurn: {
    resolve: (val: string) => void;
    reject: (err: any) => void;
    timeoutTimer: NodeJS.Timeout;
    startedAt: number;
  } | null = null;
  private turnQueue: Array<{
    prompt: string;
    timeoutMs: number;
    resolve: (val: string) => void;
    reject: (err: any) => void;
  }> = [];
  private turnCount = 0;
  private maxTurnsBeforeRecycle = 30;
  private model: string;

  constructor(cliPath: string, model: string = env.AGY_MODEL_LOW || "gemini-3.7-flash-low") {
    this.agyCliPath = cliPath;
    this.model = model;
  }

  public updateCliPath(newPath: string) {
    if (this.agyCliPath !== newPath) {
      this.agyCliPath = newPath;
      if (this.child) {
        this.cleanup();
      }
    }
  }

  public isAvailable(): boolean {
    return this.agyCliPath !== "agy" && fs.existsSync(this.agyCliPath);
  }

  public getStatus() {
    return {
      available: this.isAvailable(),
      ready: this.isReady,
      starting: this.isStarting,
      busy: this.currentTurn !== null,
      queueLength: this.turnQueue.length,
      turnCount: this.turnCount,
    };
  }

  public async start(): Promise<boolean> {
    if (!this.isAvailable()) {
      return false;
    }
    if (this.child && this.isReady) {
      return true;
    }
    if (this.isStarting) {
      return new Promise((resolve) => {
        const check = setInterval(() => {
          if (this.isReady) {
            clearInterval(check);
            resolve(true);
          } else if (!this.isStarting) {
            clearInterval(check);
            resolve(false);
          }
        }, 100);
      });
    }

    this.isStarting = true;
    return new Promise<boolean>((resolve) => {
      try {
        const homeDir = process.env.HOME || "/home/heizaaa";
        const extendedPath = `${process.env.PATH || ""}:/usr/local/bin:/usr/bin:/bin:${homeDir}/.local/bin:${homeDir}/.gemini/antigravity/bin:${homeDir}/.cargo/bin:${homeDir}/.npm-global/bin`;

        const args = [
          "--input-format=stream-json",
          "--output-format=stream-json",
          "-p=",
        ];
        if (this.model) {
          args.push(`--model=${this.model}`);
        }

        logger.info({ cli: this.agyCliPath, model: this.model }, "[AgyWorker] Spawning persistent warm stream worker...");

        this.child = spawn(this.agyCliPath, args, {
          env: {
            ...process.env,
            PATH: extendedPath,
          },
          stdio: ["pipe", "pipe", "pipe"],
        });

        this.readlineInterface = readline.createInterface({
          input: this.child.stdout!,
        });

        let initResolved = false;

        const initTimeout = setTimeout(() => {
          if (!initResolved) {
            initResolved = true;
            this.isStarting = false;
            logger.warn("[AgyWorker] Worker init timed out (30s)");
            resolve(false);
          }
        }, 30000);

        this.readlineInterface.on("line", (line) => {
          try {
            const data = JSON.parse(line.trim());
            if (data.event === "init") {
              this.isReady = true;
              this.isStarting = false;
              if (!initResolved) {
                initResolved = true;
                clearTimeout(initTimeout);
                logger.info(
                  { convId: data.conversation_id, model: data.init?.model || this.model },
                  "✅ [AgyWorker] Persistent warm stream worker is ready in RAM!"
                );
                resolve(true);
              }
            } else if (data.event === "result") {
              if (this.currentTurn) {
                clearTimeout(this.currentTurn.timeoutTimer);
                const elapsed = Date.now() - this.currentTurn.startedAt;
                logger.info({ elapsedMs: elapsed, turnCount: this.turnCount }, "⚡ [AgyWorker] Turn completed in memory");

                if (data.result?.status === "SUCCESS") {
                  this.currentTurn.resolve(data.result.response || "");
                } else if (data.result?.error) {
                  this.currentTurn.reject(new Error(data.result.error));
                } else {
                  this.currentTurn.resolve(data.result?.response || "");
                }

                this.currentTurn = null;
                this.turnCount++;

                if (this.turnCount >= this.maxTurnsBeforeRecycle) {
                  logger.info({ turnCount: this.turnCount }, "[AgyWorker] Recycling worker for fresh session context...");
                  this.recycle();
                } else {
                  this.processNextTurn();
                }
              }
            }
          } catch {
            // ignore non-json log lines
          }
        });

        this.child.stderr?.on("data", (chunk) => {
          const text = chunk.toString().trim();
          if (text) {
            logger.debug({ stderr: text }, "[AgyWorker] stderr");
          }
        });

        this.child.stdin?.on("error", (err) => {
          logger.warn({ err: err?.message || err }, "[AgyWorker] Child stdin error (broken pipe)");
        });

        this.child.on("error", (err) => {
          logger.error({ err }, "[AgyWorker] Child process error");
          this.cleanup();
          if (!initResolved) {
            initResolved = true;
            clearTimeout(initTimeout);
            resolve(false);
          }
        });

        this.child.on("exit", (code, signal) => {
          logger.warn({ code, signal }, "[AgyWorker] Child process exited");
          this.cleanup();
          if (!initResolved) {
            initResolved = true;
            clearTimeout(initTimeout);
            resolve(false);
          }
        });
      } catch (err) {
        this.isStarting = false;
        logger.error({ err }, "[AgyWorker] Failed to spawn agy child process");
        resolve(false);
      }
    });
  }

  public async sendTurn(prompt: string, timeoutMs = 25000): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error("agy CLI binary not available on this machine");
    }

    // If queue is backed up with multiple requests, reject so Layer 2 handles parallel load immediately
    if (this.turnQueue.length >= 2) {
      throw new Error("AgyWorker busy with multiple pending turns");
    }

    if (!this.child || !this.isReady) {
      const ok = await this.start();
      if (!ok) {
        throw new Error("Failed to start or connect to agy stream worker");
      }
    }

    return new Promise<string>((resolve, reject) => {
      this.turnQueue.push({ prompt, timeoutMs, resolve, reject });
      this.processNextTurn();
    });
  }

  private processNextTurn() {
    if (this.currentTurn || this.turnQueue.length === 0) {
      return;
    }
    if (!this.child || !this.isReady || !this.child.stdin?.writable) {
      return;
    }

    const item = this.turnQueue.shift()!;
    const timeoutTimer = setTimeout(() => {
      if (this.currentTurn) {
        logger.warn({ timeoutMs: item.timeoutMs }, "[AgyWorker] Turn timed out, rejecting and recycling worker");
        this.currentTurn.reject(new Error(`AgyWorker turn timed out after ${item.timeoutMs}ms`));
        this.currentTurn = null;
        this.recycle();
      }
    }, item.timeoutMs);

    this.currentTurn = {
      resolve: item.resolve,
      reject: item.reject,
      timeoutTimer,
      startedAt: Date.now(),
    };

    const payload = JSON.stringify({
      event: "user",
      message: { content: item.prompt },
    }) + "\n";

    try {
      this.child.stdin.write(payload);
    } catch (writeErr) {
      clearTimeout(timeoutTimer);
      this.currentTurn = null;
      item.reject(writeErr);
      this.recycle();
    }
  }

  public recycle() {
    this.cleanup();
    setTimeout(() => {
      if (this.isAvailable()) {
        this.start().then(() => {
          this.processNextTurn();
        });
      }
    }, 500);
  }

  public cleanup() {
    this.isReady = false;
    this.isStarting = false;
    if (this.currentTurn) {
      clearTimeout(this.currentTurn.timeoutTimer);
      this.currentTurn.reject(new Error("Worker cleaned up while turn was in flight"));
      this.currentTurn = null;
    }
    while (this.turnQueue.length > 0) {
      const item = this.turnQueue.shift()!;
      item.reject(new Error("Worker cleaned up while request was in queue"));
    }
    if (this.readlineInterface) {
      try { this.readlineInterface.close(); } catch {}
      this.readlineInterface = null;
    }
    if (this.child) {
      try {
        this.child.stdin?.end();
        this.child.kill("SIGTERM");
      } catch {}
      this.child = null;
    }
    this.turnCount = 0;
  }
}

export class AgyConnector {
  private agyCliPath: string;
  private streamWorker: AgyStreamWorker;

  constructor(cliPath: string = env.AGY_CLI_PATH || "agy") {
    this.agyCliPath = this.resolveAgyBinary(cliPath);
    this.streamWorker = new AgyStreamWorker(this.agyCliPath, env.AGY_MODEL_LOW || "gemini-3.7-flash-low");
  }

  /**
   * Pre-warms persistent in-memory stream worker during bot startup
   */
  public async warmUp(): Promise<boolean> {
    this.agyCliPath = this.resolveAgyBinary(this.agyCliPath);
    this.streamWorker.updateCliPath(this.agyCliPath);
    if (this.streamWorker.isAvailable()) {
      return await this.streamWorker.start();
    }
    return false;
  }

  /**
   * Shuts down persistent worker cleanly on supervisor shutdown
   */
  public shutdown() {
    this.streamWorker.cleanup();
  }

  private resolveAgyBinary(defaultPath: string): string {
    if (defaultPath !== "agy" && fs.existsSync(defaultPath)) {
      return defaultPath;
    }

    const homeDir = process.env.HOME || "/home/heizaaa";
    const candidatePaths = [
      defaultPath,
      "/usr/local/bin/agy",
      "/usr/bin/agy",
      path.join(homeDir, ".local", "bin", "agy"),
      path.join(homeDir, ".gemini", "antigravity", "bin", "agy"),
      path.join(homeDir, ".cargo", "bin", "agy"),
      path.join(homeDir, ".npm-global", "bin", "agy"),
    ];

    for (const p of candidatePaths) {
      if (p !== "agy" && fs.existsSync(p)) {
        return p;
      }
    }

    return defaultPath;
  }

  private cleanJsonResponse(rawText: string): string {
    let clean = rawText.trim();
    if (clean.startsWith("```json")) {
      clean = clean.slice(7);
    } else if (clean.startsWith("```")) {
      clean = clean.slice(3);
    }
    if (clean.endsWith("```")) {
      clean = clean.slice(0, -3);
    }
    clean = clean.trim();

    const firstBrace = clean.indexOf("{");
    const lastBrace = clean.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return clean.slice(firstBrace, lastBrace + 1);
    }

    return clean;
  }

  public safeParseJson<T = any>(rawText: string): T {
    const clean = this.cleanJsonResponse(rawText);

    try {
      return JSON.parse(clean);
    } catch {
      try {
        const sanitized = clean.replace(/[\u0000-\u001F]+/g, (match: string) => {
          if (match === "\n") return "\\n";
          if (match === "\r") return "\\r";
          if (match === "\t") return "\\t";
          return "";
        });
        return JSON.parse(sanitized);
      } catch (err) {
        logger.warn({ err }, "JSON parsing failed on raw output, attempting regex recovery");
        throw new Error("Could not parse JSON response from LLM");
      }
    }
  }

  /**
   * Executes structured JSON reasoning
   * Primary (Layer 1): Persistent Warm In-Memory Agy Stream Worker (~2s)
   * Emergency Fallback (Layer 2): Direct Gemini SDK with key rotation
   */
  async executeReasoning(systemPrompt: string, userMessage: string, isDeepAudit = false): Promise<any> {
    // 1. Check circuit breaker first
    if (aiCircuitBreaker.isOpen()) {
      logger.warn("Circuit breaker is OPEN. Skipping AI calls and failing fast.");
      throw new Error("AI Circuit breaker is open");
    }

    const fullPrompt = `${systemPrompt}\n\n=======================================================\nINPUT:\n"${userMessage}"\n=======================================================\n\nKembalikan HANYA format JSON valid tanpa kata pengantar.`;

    // Layer 1: Persistent In-Memory agy Stream Worker (Nomor 1 Primary)
    try {
      this.agyCliPath = this.resolveAgyBinary(this.agyCliPath);
      this.streamWorker.updateCliPath(this.agyCliPath);

      if (this.streamWorker.isAvailable()) {
        logger.info({ isDeepAudit }, "Executing reasoning via persistent warm agy stream worker (Layer 1)...");
        const rawOutput = await this.streamWorker.sendTurn(fullPrompt, isDeepAudit ? 45000 : 25000);
        const parsed = this.safeParseJson(rawOutput);
        aiCircuitBreaker.recordSuccess();
        return parsed;
      }
    } catch (workerErr: any) {
      logger.warn({ err: workerErr?.message || workerErr }, "Warm agy stream worker failed for reasoning, falling back to Gemini SDK (Layer 2)");
    }

    // Layer 2: Emergency Fallback to Direct Gemini SDK
    try {
      const sdkResult = await geminiKeyManager.executeWithFallback(async (genAI, modelName) => {
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: systemPrompt,
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1,
          },
        });

        const result = await model.generateContent(userMessage);
        const rawText = result.response.text();
        return this.safeParseJson(rawText);
      });

      aiCircuitBreaker.recordSuccess();
      return sdkResult;
    } catch (sdkErr: any) {
      logger.error({ err: sdkErr?.message || sdkErr }, "Both warm agy worker and Gemini SDK fallback failed for reasoning");
      aiCircuitBreaker.recordFailure();
      throw sdkErr;
    }
  }

  /**
   * Executes natural language conversational chat
   * Primary (Layer 1): Persistent Warm In-Memory Agy Stream Worker (~2s)
   * Emergency Fallback (Layer 2): Direct Gemini SDK with key rotation
   * Layer 3: Static Reply
   */
  async executeConversation(
    systemPrompt: string,
    userMessage: string,
    sppgUnitName = "SPPG Patila"
  ): Promise<string> {
    // 1. Check circuit breaker first
    if (aiCircuitBreaker.isOpen()) {
      logger.warn("Circuit breaker is OPEN. Returning static conversational fallback immediately.");
      return staticConversationalReply(sppgUnitName);
    }

    const fullPrompt = `${systemPrompt}\n\nPesan Pengguna:\n"${userMessage}"\n\nATURAN FORMATTING WAJIB: JANGAN PERNAH gunakan markdown heading ("###", "##", "#") atau bintang asterisk sebagai bullet (*). Gunakan tag HTML Telegram resmi (<b>bold</b>, <i>italic</i>, <code>code</code>) dan simbol "• " untuk bullet point agar pesan terbaca rapi.`;

    // Layer 1: Persistent In-Memory agy Stream Worker (Nomor 1 Primary)
    try {
      this.agyCliPath = this.resolveAgyBinary(this.agyCliPath);
      this.streamWorker.updateCliPath(this.agyCliPath);

      if (this.streamWorker.isAvailable()) {
        logger.info("Executing conversation via persistent warm agy stream worker (Layer 1)...");
        const rawResult = await this.streamWorker.sendTurn(fullPrompt, 25000);
        if (rawResult && rawResult.trim().length > 0) {
          aiCircuitBreaker.recordSuccess();
          return rawResult.trim();
        }
      }
    } catch (workerErr: any) {
      logger.warn({ err: workerErr?.message || workerErr }, "Warm agy stream worker failed for conversation, falling back to Gemini SDK (Layer 2)");
    }

    // Layer 2: Emergency Fallback to Direct Gemini SDK
    try {
      const sdkResult = await geminiKeyManager.executeWithFallback(async (genAI, modelName) => {
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: systemPrompt,
        });

        const result = await model.generateContent(userMessage);
        return result.response.text();
      });

      if (sdkResult && sdkResult.trim().length > 0) {
        aiCircuitBreaker.recordSuccess();
        return sdkResult.trim();
      }
    } catch (sdkErr: any) {
      logger.warn({ err: sdkErr?.message || sdkErr }, "Gemini SDK conversation fallback failed, falling back to static reply (Layer 3)");
      aiCircuitBreaker.recordFailure();
    }

    // Layer 3: Static Fallback (Always succeeds, never fails)
    return staticConversationalReply(sppgUnitName);
  }
}

export const agyConnector = new AgyConnector();
