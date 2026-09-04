import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.string().default("info"),

  TELEGRAM_BOT_TOKEN_PATILA: z.string().min(1, "Bot token Patila required"),
  TELEGRAM_BOT_TOKEN_UNIT2: z.string().optional().default(""),
  TELEGRAM_BOT_TOKEN_UNIT3: z.string().optional().default(""),
  ALLOWED_TELEGRAM_USER_IDS: z.string().optional().default(""),

  GOOGLE_SERVICE_ACCOUNT_PATH: z.string().default("./service-account.json"),
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
  return result.data;
}

export const env = loadEnv();
