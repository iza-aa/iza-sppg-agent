import { describe, it, expect, afterAll, beforeAll } from "vitest";
import http from "node:http";
import { createHealthServer } from "../src/core/server/health-server.js";

function get(url: string): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body,
          });
        });
      })
      .on("error", reject);
  });
}

describe("HTTP Health & Keep-Warm Server", () => {
  const testPort = 18080;
  let healthServer: ReturnType<typeof createHealthServer>;

  beforeAll(async () => {
    healthServer = createHealthServer({
      port: testPort,
      mode: "single",
      getActiveUnits: () => ["sppg_patila", "sppg_unit2"],
    });
    await healthServer.start();
  });

  afterAll(async () => {
    await healthServer.stop();
  });

  it("should respond to /ping with 200 OK and PONG", async () => {
    const res = await get(`http://127.0.0.1:${testPort}/ping`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("PONG");
    expect(res.headers["content-type"]).toContain("text/plain");
  });

  it("should respond to / with 200 OK and PONG for root ping", async () => {
    const res = await get(`http://127.0.0.1:${testPort}/`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("PONG");
  });

  it("should respond to /health with valid JSON, mode, active units, and RAM usage", async () => {
    const res = await get(`http://127.0.0.1:${testPort}/health`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");

    const data = JSON.parse(res.body);
    expect(data.status).toBe("ok");
    expect(data.service).toBe("mbg-assistant");
    expect(data.mode).toBe("single");
    expect(data.active_units).toEqual(["sppg_patila", "sppg_unit2"]);
    expect(typeof data.uptime_seconds).toBe("number");
    expect(data.memory).toBeDefined();
    expect(typeof data.memory.rss_mb).toBe("number");
    expect(typeof data.memory.heap_used_mb).toBe("number");
    expect(data.memory.rss_mb).toBeGreaterThan(0);
  });

  it("should return 404 for unknown routes", async () => {
    const res = await get(`http://127.0.0.1:${testPort}/random-path`);
    expect(res.statusCode).toBe(404);
    const data = JSON.parse(res.body);
    expect(data.error).toBe("Not Found");
  });
});
