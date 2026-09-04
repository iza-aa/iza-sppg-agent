import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../../config/env.js";
import { logger } from "../utils/logger.js";

export const AVAILABLE_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
];

export class GeminiKeyManager {
  private currentIndex = 0;
  private failedKeys = new Map<string, number>();
  private keys: string[];

  constructor(keyString: string) {
    this.keys = keyString
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    if (this.keys.length === 0) {
      throw new Error("No Gemini API keys provided in configuration");
    }
  }

  getActiveKey(): string {
    return this.keys[this.currentIndex];
  }

  markKeyFailed(key: string, reason: string): string {
    logger.warn({ key: key.slice(0, 8) + "...", reason }, "Gemini API key marked failed, rotating to next key");
    this.failedKeys.set(key, Date.now());
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
    return this.getActiveKey();
  }

  async executeWithFallback<T>(
    fn: (genAI: GoogleGenerativeAI, modelName: string) => Promise<T>
  ): Promise<T> {
    const models = AVAILABLE_MODELS;
    let lastError: any = null;

    for (const modelName of models) {
      for (let keyAttempt = 0; keyAttempt < this.keys.length; keyAttempt++) {
        const activeKey = this.getActiveKey();
        try {
          const genAI = new GoogleGenerativeAI(activeKey);
          return await fn(genAI, modelName);
        } catch (error: any) {
          lastError = error;
          const errorMsg = error?.message || String(error);

          logger.warn(
            { modelName, key: activeKey.slice(0, 8) + "...", error: errorMsg },
            "Gemini request failed, trying next key or fallback model"
          );

          this.markKeyFailed(activeKey, errorMsg);
        }
      }
    }

    logger.error({ lastError }, "All Gemini models and API keys in the pool failed");
    throw lastError || new Error("All Gemini models and API keys failed");
  }
}

export const geminiKeyManager = new GeminiKeyManager(env.GEMINI_API_KEYS);
