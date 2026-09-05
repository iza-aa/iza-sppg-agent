import { getSupabaseClient } from "./supabase.js";
import { logger } from "../utils/logger.js";

let heartbeatInterval: NodeJS.Timeout | null = null;

export async function pingSupabaseHeartbeat(): Promise<boolean> {
  const supabase = getSupabaseClient();
  try {
    const { error } = await supabase
      .from("sppg_heartbeat")
      .upsert({ id: 1, last_ping: new Date().toISOString() });

    if (!error) {
      logger.debug("Supabase heartbeat ping successful (keep-warm)");
      return true;
    }
  } catch (err: any) {
    logger.debug({ err: err?.message }, "Heartbeat fallback ping via select");
  }

  // Fallback query if table not yet created
  try {
    const { data } = await supabase.from("sppg_users").select("count").limit(1);
    logger.debug({ data }, "Supabase fallback heartbeat query executed");
    return true;
  } catch {
    return false;
  }
}

export function startHeartbeatScheduler(intervalHours = 24): void {
  if (heartbeatInterval) return;

  // Initial ping immediately
  pingSupabaseHeartbeat();

  // Schedule every 24 hours
  heartbeatInterval = setInterval(() => {
    pingSupabaseHeartbeat();
  }, intervalHours * 60 * 60 * 1000);

  logger.info({ intervalHours }, "Started Supabase keep-warm heartbeat scheduler");
}

export function stopHeartbeatScheduler(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}
