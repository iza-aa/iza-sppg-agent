import { describe, it, expect, beforeEach } from "vitest";
import { AICircuitBreaker } from "../src/core/ai/circuit-breaker.js";

describe("AICircuitBreaker Unit Tests", () => {
  let breaker: AICircuitBreaker;

  beforeEach(() => {
    // 3 threshold, 500ms cooldown, 1000ms window
    breaker = new AICircuitBreaker(3, 500, 1000);
  });

  it("should initially be closed", () => {
    expect(breaker.isOpen()).toBe(false);
    expect(breaker.getStatus().failures).toBe(0);
  });

  it("should open after 3 consecutive failures", () => {
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false);

    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false);

    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
    expect(breaker.getStatus().isOpen).toBe(true);
    expect(breaker.getStatus().remainingCooldownMs).toBeGreaterThan(0);
  });

  it("should reset immediately on success", () => {
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getStatus().failures).toBe(2);

    breaker.recordSuccess();
    expect(breaker.isOpen()).toBe(false);
    expect(breaker.getStatus().failures).toBe(0);
  });

  it("should automatically close after cooldown expires", async () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);

    // Wait for 550ms (> 500ms cooldown)
    await new Promise((resolve) => setTimeout(resolve, 550));

    expect(breaker.isOpen()).toBe(false);
    expect(breaker.getStatus().isOpen).toBe(false);
  });
});
