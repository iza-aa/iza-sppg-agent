import dotenv from "dotenv";
import { z } from "zod";
import fs from "fs";
import path from "path";

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.string().default("info"),

  TELEGRAM_BOT_TOKEN_PATILA: z.string().min(1, "Bot token Patila required"),
  TELEGRAM_BOT_TOKEN_UNIT2: z.string().optional().default(""),
  TELEGRAM_BOT_TOKEN_UNIT3: z.string().optional().default(""),
  ALLOWED_TELEGRAM_USER_IDS: z.string().optional().default(""),

  GOOGLE_SERVICE_ACCOUNT_PATH: z.string().default("./service-account.json"),
  GOOGLE_SERVICE_ACCOUNT_BASE64: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_DRIVE_FOLDER_ID: z.string().min(1, "Google Drive root folder ID required"),

  GOOGLE_SHEET_ID_MASTER: z.string().min(1, "Master Sheet ID required"),
  GOOGLE_SHEET_ID_PATILA: z.string().min(1, "Patila Sheet ID required"),
  GOOGLE_SHEET_ID_UNIT2: z.string().optional().default(""),
  GOOGLE_SHEET_ID_UNIT3: z.string().optional().default(""),

  GEMINI_API_KEYS: z.string().min(1, "Gemini API keys required"),
  AGY_CLI_PATH: z.string().default("agy"),
  AGY_MODEL_HIGH: z.string().default("gemini-3.7-flash-high"),
  AGY_MODEL_LOW: z.string().default("gemini-3.7-flash-low"),

  SUPABASE_URL: z.string().url("Supabase URL must be valid URL"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "Supabase service role key required"),
});

export type AppEnv = z.infer<typeof EnvSchema>;

export function loadEnv(): AppEnv {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const errorDetails = result.error.format();
    console.error("❌ Environment validation error:", JSON.stringify(errorDetails, null, 2));
    throw new Error("Invalid application environment configuration");
  }

  const data = result.data;
  const resolvedPath = path.resolve(process.cwd(), data.GOOGLE_SERVICE_ACCOUNT_PATH);

  // Auto-materialize service-account.json from BASE64 or raw JSON if file does not exist
  if (!fs.existsSync(resolvedPath)) {
    if (data.GOOGLE_SERVICE_ACCOUNT_BASE64) {
      try {
        const decoded = Buffer.from(data.GOOGLE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf-8");
        fs.writeFileSync(resolvedPath, decoded, "utf-8");
      } catch (err) {
        console.error("Failed to decode GOOGLE_SERVICE_ACCOUNT_BASE64:", err);
      }
    } else if (data.GOOGLE_SERVICE_ACCOUNT_JSON) {
      try {
        fs.writeFileSync(resolvedPath, data.GOOGLE_SERVICE_ACCOUNT_JSON, "utf-8");
      } catch (err) {
        console.error("Failed to write GOOGLE_SERVICE_ACCOUNT_JSON:", err);
      }
    }
  }

  return data;
}

export const env = loadEnv();
