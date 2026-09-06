import { getSppgUnitById, getEnabledSppgUnits } from "./config/sppg.config.js";
import { createSppgBot } from "./core/telegram/bot-handler.js";
import { logger } from "./core/utils/logger.js";

// Process-level resilience guards: prevent entire worker crash on unhandled async rejections
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "🛡️ [Worker Process Guard] Intercepted unhandled Promise rejection");
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "🛡️ [Worker Process Guard] Intercepted uncaught exception");
});

async function main() {
  const unitId = process.env.SPPG_ID || process.argv[2];

  if (!unitId) {
    logger.error("No SPPG_ID provided. Please specify SPPG_ID environment variable or CLI argument.");
    process.exit(1);
  }

  const unitConfig = getSppgUnitById(unitId);

  if (!unitConfig) {
    logger.error(`SPPG Unit with ID "${unitId}" not found in configuration.`);
    process.exit(1);
  }

  if (!unitConfig.enabled || !unitConfig.token) {
    logger.warn(`SPPG Unit "${unitConfig.name}" (${unitConfig.id}) is disabled or missing bot token.`);
    process.exit(0);
  }

  logger.info(`🚀 Starting SPPG Micro-Worker for: ${unitConfig.name} (${unitConfig.id})...`);

  const bot = createSppgBot(unitConfig);

  // Global Grammy Error Handler
  bot.catch((err) => {
    logger.error(
      {
        message: err.message,
        ctx: err.ctx?.update?.update_id,
        error: err.error,
      },
      `[Worker ${unitConfig.id}] Uncaught bot error`
    );
  });

  // Graceful Shutdown
  const stopWorker = async (signal: string) => {
    logger.info(`Received ${signal}. Stopping worker for ${unitConfig.id}...`);
    try {
      await bot.stop();
      logger.info(`Worker for ${unitConfig.id} stopped cleanly.`);
      process.exit(0);
    } catch (e) {
      logger.error({ error: e }, `Error stopping bot for ${unitConfig.id}`);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => stopWorker("SIGINT"));
  process.on("SIGTERM", () => stopWorker("SIGTERM"));

  // Start Long Polling
  await bot.start({
    onStart: (botInfo) => {
      logger.info(`✅ [Worker ${unitConfig.id}] Bot active as @${botInfo.username} (ID: ${botInfo.id})`);
    },
    drop_pending_updates: true,
  });
}

main().catch((err) => {
  logger.error("Fatal error in SPPG Worker:", err);
  process.exit(1);
});
