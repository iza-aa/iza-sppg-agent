import { fork, ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getEnabledSppgUnits, SPPGUnitConfig } from "./config/sppg.config.js";
import { startHeartbeatScheduler, stopHeartbeatScheduler } from "./core/db/heartbeat.js";
import { createHealthServer } from "./core/server/health-server.js";
import { createSppgBot } from "./core/telegram/bot-handler.js";
import { logger } from "./core/utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isTs = __filename.endsWith(".ts");
const workerScript = path.resolve(__dirname, isTs ? "worker.ts" : "worker.js");

// Execution Mode: "single" (default for low-RAM clouds like Render) or "fork" (multi-process for VPS)
const EXECUTION_MODE = (process.env.EXECUTION_MODE || "single").toLowerCase();

// Process-level resilience guards: prevent entire container crash on unhandled async rejections
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "🛡️ [Process Guard] Intercepted unhandled Promise rejection");
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "🛡️ [Process Guard] Intercepted uncaught exception");
});

interface ManagedWorker {
  config: SPPGUnitConfig;
  process: ChildProcess | null;
  restarts: number;
  lastRestart: number;
}

const workers = new Map<string, ManagedWorker>();
const activeBots: Array<{ id: string; name: string; bot: ReturnType<typeof createSppgBot> }> = [];
let isShuttingDown = false;
let healthServerInstance: ReturnType<typeof createHealthServer> | null = null;

function spawnWorker(unit: SPPGUnitConfig) {
  if (isShuttingDown) return;

  const now = Date.now();
  let managed = workers.get(unit.id);
  if (!managed) {
    managed = { config: unit, process: null, restarts: 0, lastRestart: now };
    workers.set(unit.id, managed);
  }

  // Crash loop backoff check
  if (now - managed.lastRestart < 5000) {
    managed.restarts++;
    if (managed.restarts > 5) {
      logger.error(
        `🚨 [Supervisor] Worker ${unit.id} has crashed ${managed.restarts} times in quick succession. Pausing restarts for 30s.`
      );
      setTimeout(() => {
        if (!isShuttingDown) {
          managed!.restarts = 0;
          spawnWorker(unit);
        }
      }, 30000);
      return;
    }
  } else {
    managed.restarts = 0;
  }

  managed.lastRestart = now;

  logger.info(`[Supervisor] Spawning micro-worker for ${unit.name} (${unit.id})...`);

  const child = fork(workerScript, [unit.id], {
    env: { ...process.env, SPPG_ID: unit.id },
    execArgv: process.execArgv,
    stdio: "inherit",
  });

  managed.process = child;

  child.on("exit", (code, signal) => {
    logger.warn(
      `[Supervisor] Micro-worker ${unit.id} exited (code: ${code}, signal: ${signal})`
    );
    managed!.process = null;

    if (!isShuttingDown) {
      const delayMs = Math.min(2000 * Math.max(1, managed!.restarts), 15000);
      logger.info(`[Supervisor] Restarting worker ${unit.id} in ${delayMs / 1000}s...`);
      setTimeout(() => {
        spawnWorker(unit);
      }, delayMs);
    }
  });

  child.on("error", (err) => {
    logger.error({ err }, `[Supervisor] Error in child worker process ${unit.id}`);
  });
}

async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`[Supervisor] Received ${signal}. Initiating graceful shutdown...`);

  // 1. Stop Supabase Heartbeat
  stopHeartbeatScheduler();

  // 2. Stop Health Server
  if (healthServerInstance) {
    await healthServerInstance.stop().catch((e) => logger.warn({ err: e }, "Error closing HTTP server"));
  }

  // 3. Stop Bots based on execution mode
  if (EXECUTION_MODE === "fork") {
    const killPromises: Promise<void>[] = [];

    for (const [id, worker] of workers.entries()) {
      if (worker.process && !worker.process.killed) {
        killPromises.push(
          new Promise<void>((resolve) => {
            logger.info(`[Supervisor] Sending SIGTERM to worker ${id}...`);
            worker.process?.kill("SIGTERM");
            const timeout = setTimeout(() => {
              if (worker.process && !worker.process.killed) {
                logger.warn(`[Supervisor] Worker ${id} did not exit gracefully. Forcing SIGKILL...`);
                worker.process.kill("SIGKILL");
              }
              resolve();
            }, 4000);

            worker.process?.once("exit", () => {
              clearTimeout(timeout);
              resolve();
            });
          })
        );
      }
    }

    await Promise.all(killPromises);
  } else {
    // Single-process mode: stop all Grammy bots
    const stopPromises = activeBots.map(async ({ id, bot }) => {
      try {
        logger.info(`[Supervisor] Stopping Grammy bot instance for ${id}...`);
        await bot.stop();
        logger.info(`[Supervisor] Bot ${id} stopped cleanly.`);
      } catch (e) {
        logger.warn({ err: e, id }, `Error stopping bot ${id}`);
      }
    });

    await Promise.all(stopPromises);
  }

  logger.info("[Supervisor] All services terminated. Supervisor exiting cleanly.");
  process.exit(0);
}

async function main() {
  logger.info("=================================================");
  logger.info("  🍽️  MBG ASSISTANT - MASTER SUPERVISOR STARTING  ");
  logger.info("  Badan Gizi Nasional (BGN) Multi-Unit Bot System ");
  logger.info(`  Execution Mode: [${EXECUTION_MODE.toUpperCase()}]`);
  logger.info("=================================================");

  const enabledUnits = getEnabledSppgUnits();
  logger.info(`Found ${enabledUnits.length} enabled SPPG units.`);

  // 1. Instant HTTP Health & Keep-Alive Server (starts immediately for Render/VPS port check)
  try {
    healthServerInstance = createHealthServer({
      mode: EXECUTION_MODE,
      getActiveUnits: () =>
        EXECUTION_MODE === "fork"
          ? Array.from(workers.keys())
          : activeBots.map((b) => b.id),
    });
    await healthServerInstance.start();
  } catch (httpErr) {
    logger.warn({ err: httpErr }, "⚠️ HTTP Health listener could not bind port, continuing bot operations without HTTP server");
  }

  if (enabledUnits.length === 0) {
    logger.warn("⚠️ No enabled SPPG units found with valid tokens. Please check your .env configuration.");
    return;
  }

  // 2. Initialize units according to EXECUTION_MODE
  if (EXECUTION_MODE === "fork") {
    logger.info("🔀 Running in multi-process mode (fork)...");
    for (const unit of enabledUnits) {
      spawnWorker(unit);
    }
  } else {
    logger.info("⚡ Running in single-process mode (low-RAM optimized, ~50MB baseline)...");
    for (const unit of enabledUnits) {
      logger.info(`[Single Mode] Initializing bot for ${unit.name} (${unit.id})...`);
      const bot = createSppgBot(unit);

      // Isolated error boundary per bot instance
      bot.catch((err) => {
        logger.error(
          {
            unit: unit.id,
            message: err.message,
            ctx: err.ctx?.update?.update_id,
            error: err.error,
          },
          `🚨 [Single Mode] Isolated error in bot ${unit.id}`
        );
      });

      activeBots.push({ id: unit.id, name: unit.name, bot });

      // Start long-polling concurrently
      bot
        .start({
          onStart: (botInfo) => {
            logger.info(`✅ [Single Mode] ${unit.name} active as @${botInfo.username} (ID: ${botInfo.id})`);
          },
          drop_pending_updates: true,
        })
        .catch((err) => {
          logger.error({ err, unit: unit.id }, `[Single Mode] Runner error for ${unit.id}`);
        });
    }
  }

  // 3. Start Supabase Keep-Warm Heartbeat (every 12 hours)
  startHeartbeatScheduler(12);

  // 4. Register Process Termination Signals
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "[Supervisor] Fatal supervisor error: " + (err?.stack || err));
  console.error("FATAL SUPERVISOR ERROR:", err);
  process.exit(1);
});
