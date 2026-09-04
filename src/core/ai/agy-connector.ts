import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { env } from "../../config/env.js";
import { geminiKeyManager } from "./gemini-client.js";
import { logger } from "../utils/logger.js";

const execFileAsync = promisify(execFile);

export class AgyConnector {
  private agyCliPath: string;

  constructor(cliPath: string = env.AGY_CLI_PATH || "agy") {
    this.agyCliPath = this.resolveAgyBinary(cliPath);
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
        logger.info({ foundPath: p }, "Resolved agy CLI binary path");
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

  async executeReasoning(systemPrompt: string, userMessage: string, isDeepAudit = false): Promise<any> {
    const fullPrompt = `${systemPrompt}\n\n=======================================================\nINPUT:\n"${userMessage}"\n=======================================================\n\nKembalikan HANYA format JSON valid tanpa kata pengantar.`;

    const targetModel = isDeepAudit ? env.AGY_MODEL_HIGH : env.AGY_MODEL_LOW;

    // Try agy CLI first
    try {
      logger.info({ targetModel, isDeepAudit }, "Attempting reasoning via agy CLI...");
      const homeDir = process.env.HOME || "/home/heizaaa";
      const extendedPath = `${process.env.PATH || ""}:/usr/local/bin:/usr/bin:/bin:${homeDir}/.local/bin:${homeDir}/.gemini/antigravity/bin`;

      const args = ["-p", fullPrompt];
      if (targetModel) {
        args.push("--model", targetModel);
      }

      const { stdout } = await execFileAsync(this.agyCliPath, args, {
        timeout: isDeepAudit ? 60000 : 30000,
        env: {
          ...process.env,
          PATH: extendedPath,
        },
      });

      return this.safeParseJson(stdout);
    } catch (cliErr: any) {
      logger.warn({ err: cliErr?.message || cliErr }, "agy CLI unavailable or failed, falling back to Gemini SDK");
    }

    // Fallback to Gemini SDK
    return await geminiKeyManager.executeWithFallback(async (genAI, modelName) => {
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
  }
}

export const agyConnector = new AgyConnector();
