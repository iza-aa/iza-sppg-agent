import { fork, ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getEnabledSppgUnits, SPPGUnitConfig } from "./config/sppg.config.js";
import { startHeartbeatScheduler, stopHeartbeatScheduler } from "./core/db/heartbeat.js";
import { logger } from "./core/utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isTs = __filename.endsWith(".ts");
const workerScript = path.resolve(__dirname, isTs ? "worker.ts" : "worker.js");

interface ManagedWorker {
  config: SPPGUnitConfig;
  process: ChildProcess | null;
  restarts: number;
  lastRestart: number;
}

const workers = new Map<string, ManagedWorker>();
let isShuttingDown = false;

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
    // Reset restart counter after stable run
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
  stopHeartbeatScheduler();

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
  logger.info("[Supervisor] All micro-workers terminated. Supervisor exiting cleanly.");
  process.exit(0);
}

async function main() {
  logger.info("=================================================");
  logger.info("  🍽️  MBG ASSISTANT - MASTER SUPERVISOR STARTING  ");
  logger.info("  Badan Gizi Nasional (BGN) Multi-Unit Bot System ");
  logger.info("=================================================");

  const enabledUnits = getEnabledSppgUnits();
  logger.info(`Found ${enabledUnits.length} enabled SPPG units.`);

  if (enabledUnits.length === 0) {
    logger.warn("⚠️ No enabled SPPG units found with valid tokens. Please check your .env configuration.");
    process.exit(0);
  }

  // 1. Spawn worker for each enabled unit
  for (const unit of enabledUnits) {
    spawnWorker(unit);
  }

  // 2. Start Supabase Keep-Warm Heartbeat (every 12 hours)
  startHeartbeatScheduler(12);

  // 3. Register Process Termination Signals
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error("[Supervisor] Fatal supervisor error:", err);
  process.exit(1);
});
