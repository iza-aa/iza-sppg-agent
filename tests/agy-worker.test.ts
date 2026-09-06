import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgyStreamWorker, AgyConnector } from "../src/core/ai/agy-connector.js";

describe("AgyStreamWorker & AgyConnector Architecture", () => {
  let worker: AgyStreamWorker;

  beforeEach(() => {
    worker = new AgyStreamWorker("/invalid/path/to/agy", "gemini-3.7-flash-low");
  });

  afterEach(() => {
    worker.cleanup();
  });

  it("should report unavailable when binary does not exist on disk", () => {
    expect(worker.isAvailable()).toBe(false);
    expect(worker.getStatus().available).toBe(false);
    expect(worker.getStatus().ready).toBe(false);
  });

  it("should fail gracefully when sendTurn is called on an unavailable worker", async () => {
    await expect(worker.sendTurn("hello")).rejects.toThrow("agy CLI binary not available");
  });

  it("should reject excess requests when queue is congested", async () => {
    // artificially set queue length >= 2
    (worker as any).turnQueue = [
      { prompt: "p1", timeoutMs: 1000, resolve: () => {}, reject: () => {} },
      { prompt: "p2", timeoutMs: 1000, resolve: () => {}, reject: () => {} },
    ];
    // make it appear available
    vi.spyOn(worker, "isAvailable").mockReturnValue(true);

    await expect(worker.sendTurn("p3")).rejects.toThrow("AgyWorker busy with multiple pending turns");
  });

  it("should clean up resources cleanly on cleanup()", () => {
    (worker as any).isReady = true;
    worker.cleanup();
    expect(worker.getStatus().ready).toBe(false);
    expect(worker.getStatus().busy).toBe(false);
    expect(worker.getStatus().queueLength).toBe(0);
  });

  it("AgyConnector should have warmUp and shutdown methods", async () => {
    const connector = new AgyConnector();
    expect(typeof connector.warmUp).toBe("function");
    expect(typeof connector.shutdown).toBe("function");
    // warmUp on missing path returns false without throwing
    const result = await connector.warmUp();
    expect(typeof result).toBe("boolean");
    connector.shutdown();
  });
});
