import { SupabaseClient } from "@supabase/supabase-js";
import { env } from "../../../config/env.js";
import { logger } from "../../utils/logger.js";

export interface SppgUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  role: "super_admin" | "admin" | "member";
  status: "active" | "pending" | "blocked";
  sppg_assigned_id?: string;
}

export class UserRepository {
  private allowedIdsSet: Set<number> = new Set();

  constructor(private supabase: SupabaseClient) {
    if (env.ALLOWED_TELEGRAM_USER_IDS) {
      env.ALLOWED_TELEGRAM_USER_IDS.split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .forEach((numStr) => {
          const id = Number(numStr);
          if (!isNaN(id)) this.allowedIdsSet.add(id);
        });
    }
  }

  async isAllowed(telegramUserId: number): Promise<boolean> {
    // 1. If explicit env whitelist is set and user is inside, permit immediately
    if (this.allowedIdsSet.has(telegramUserId)) {
      return true;
    }

    // 2. If no whitelist defined in env, allow during setup
    if (this.allowedIdsSet.size === 0) {
      return true;
    }

    // 3. Check database table sppg_users
    try {
      const { data, error } = await this.supabase
        .from("sppg_users")
        .select("status")
        .eq("id", telegramUserId)
        .single();

      if (error || !data) return false;
      return data.status === "active";
    } catch (err) {
      logger.warn({ err, telegramUserId }, "Error checking user whitelist in database");
      return false;
    }
  }

  async upsertUser(user: Partial<SppgUser> & { id: number }): Promise<void> {
    try {
      await this.supabase.from("sppg_users").upsert({
        id: user.id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role || "member",
        status: user.status || "active",
        sppg_assigned_id: user.sppg_assigned_id || "sppg_patila",
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      logger.warn({ err }, "Could not upsert user to Supabase (continuing in-memory)");
    }
  }
}
