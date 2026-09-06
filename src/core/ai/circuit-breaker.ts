import { logger } from "../utils/logger.js";

export class AICircuitBreaker {
  private consecutiveFailures = 0;
  private lastFailureTime = 0;
  private readonly FAILURE_THRESHOLD: number;
  private readonly COOLDOWN_MS: number;
  private readonly RETRY_WINDOW_MS: number;

  constructor(
    failureThreshold = 3,
    cooldownMs = 5 * 60_000,
    retryWindowMs = 60_000
  ) {
    this.FAILURE_THRESHOLD = failureThreshold;
    this.COOLDOWN_MS = cooldownMs;
    this.RETRY_WINDOW_MS = retryWindowMs;
  }

  /**
   * Checks whether the circuit breaker is currently open (AI down).
   * If cooldown has passed, transitions to half-open / resets.
   */
  isOpen(): boolean {
    if (this.consecutiveFailures < this.FAILURE_THRESHOLD) {
      return false;
    }

    const elapsed = Date.now() - this.lastFailureTime;
    if (elapsed > this.COOLDOWN_MS) {
      logger.info(
        { elapsedMs: elapsed, cooldownMs: this.COOLDOWN_MS },
        "Circuit breaker cooldown elapsed, transitioning to half-open (closed)"
      );
      this.reset();
      return false;
    }

    return true;
  }

  /**
   * Records an AI failure event.
   */
  recordFailure(): void {
    const now = Date.now();
    // If the last failure was outside the retry window, reset the counter
    if (now - this.lastFailureTime > this.RETRY_WINDOW_MS && this.consecutiveFailures < this.FAILURE_THRESHOLD) {
      this.consecutiveFailures = 1;
    } else {
      this.consecutiveFailures++;
    }

    this.lastFailureTime = now;

    if (this.consecutiveFailures >= this.FAILURE_THRESHOLD) {
      logger.warn(
        {
          failures: this.consecutiveFailures,
          cooldownMinutes: this.COOLDOWN_MS / 60_000,
        },
        "🚨 AI Circuit Breaker OPEN: Multiple consecutive failures detected. Fast-failing to Layer 3 static fallback."
      );
    }
  }

  /**
   * Records an AI success event, closing the breaker immediately.
   */
  recordSuccess(): void {
    if (this.consecutiveFailures > 0) {
      logger.info({ previousFailures: this.consecutiveFailures }, "AI call succeeded, circuit breaker reset to normal");
    }
    this.reset();
  }

  /**
   * Manually resets the circuit breaker.
   */
  reset(): void {
    this.consecutiveFailures = 0;
    this.lastFailureTime = 0;
  }

  /**
   * Returns current health stats for telemetry or admin alerts.
   */
  getStatus(): { isOpen: boolean; failures: number; remainingCooldownMs: number } {
    const isCurrentlyOpen = this.isOpen();
    const remaining = isCurrentlyOpen
      ? Math.max(0, this.COOLDOWN_MS - (Date.now() - this.lastFailureTime))
      : 0;

    return {
      isOpen: isCurrentlyOpen,
      failures: this.consecutiveFailures,
      remainingCooldownMs: remaining,
    };
  }
}

export const aiCircuitBreaker = new AICircuitBreaker();
