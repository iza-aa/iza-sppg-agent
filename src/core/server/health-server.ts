import http from "node:http";
import { logger } from "../utils/logger.js";

export interface HealthServerOptions {
  port?: number;
  mode?: string;
  getActiveUnits?: () => string[];
}

export function createHealthServer(options: HealthServerOptions = {}) {
  const port = options.port || parseInt(process.env.PORT || "8080", 10);
  const mode = options.mode || process.env.EXECUTION_MODE || "single";

  const server = http.createServer((req, res) => {
    const url = req.url?.split("?")[0] || "/";

    // 1. Keep-warm ping endpoint for Cron-job.org / UptimeRobot
    if (url === "/ping" || url === "/") {
      res.writeHead(200, {
        "Content-Type": "text/plain",
        "Cache-Control": "no-cache, no-store",
      });
      res.end("PONG");
      return;
    }

    // 2. Comprehensive Health & Real-time Memory Endpoint
    if (url === "/health" || url === "/api/health") {
      const mem = process.memoryUsage();
      const activeUnits = options.getActiveUnits ? options.getActiveUnits() : [];

      const payload = {
        status: "ok",
        service: "mbg-assistant",
        mode,
        active_units: activeUnits,
        uptime_seconds: Math.floor(process.uptime()),
        memory: {
          rss_mb: Math.round((mem.rss / (1024 * 1024)) * 100) / 100,
          heap_used_mb: Math.round((mem.heapUsed / (1024 * 1024)) * 100) / 100,
          heap_total_mb: Math.round((mem.heapTotal / (1024 * 1024)) * 100) / 100,
          external_mb: Math.round((mem.external / (1024 * 1024)) * 100) / 100,
        },
        timestamp: new Date().toISOString(),
      };

      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache, no-store",
      });
      res.end(JSON.stringify(payload, null, 2));
      return;
    }

    // 3. Fallback 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found", path: url }));
  });

  return {
    server,
    port,
    start: () =>
      new Promise<void>((resolve, reject) => {
        server.listen(port, () => {
          logger.info(`⚡ [HTTP Server] Health & Keep-Warm listener active on port ${port}`);
          resolve();
        });
        server.on("error", (err) => reject(err));
      }),
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          logger.info("[HTTP Server] Server closed cleanly.");
          resolve();
        });
      }),
  };
}
