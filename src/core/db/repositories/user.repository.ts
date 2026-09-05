import { SupabaseClient } from "@supabase/supabase-js";
import { env } from "../../../config/env.js";
import { logger } from "../../utils/logger.js";

export const PRIMARY_SUPER_ADMIN_ID = 7546537134;

export interface SppgUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  role: "super_admin" | "admin" | "member";
  status: "active" | "pending" | "blocked";
  sppg_assigned_id?: string;
}

export interface SppgInvite {
  code: string;
  name: string;
  role: "super_admin" | "admin" | "member";
  sppg_assigned_id: string;
  created_by: number;
  expires_at: string;
  claimed_by?: number;
  claimed_at?: string;
}

export class UserRepository {
  private allowedIdsSet: Set<number> = new Set([PRIMARY_SUPER_ADMIN_ID]);
  private superAdminIdsSet: Set<number> = new Set([PRIMARY_SUPER_ADMIN_ID]);
  private activeInvites = new Map<string, SppgInvite>();

  constructor(private supabase: SupabaseClient) {
    if (env.ALLOWED_TELEGRAM_USER_IDS) {
      env.ALLOWED_TELEGRAM_USER_IDS.split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .forEach((numStr) => {
          const id = Number(numStr);
          if (!isNaN(id)) {
            this.allowedIdsSet.add(id);
            this.superAdminIdsSet.add(id);
          }
        });
    }
  }

  async isAllowed(telegramUserId: number): Promise<boolean> {
    // 1. Primary super admin & env whitelist always allowed
    if (this.allowedIdsSet.has(telegramUserId)) {
      return true;
    }

    // 2. Check database table sppg_users
    try {
      const { data, error } = await this.supabase
        .from("sppg_users")
        .select("status")
        .eq("id", telegramUserId)
        .single();

      if (error || !data) return false;
      const isOk = data.status === "active";
      if (isOk) {
        this.allowedIdsSet.add(telegramUserId);
      }
      return isOk;
    } catch (err) {
      logger.warn({ err, telegramUserId }, "Error checking user whitelist in database");
      return false;
    }
  }

  async isSuperAdmin(telegramUserId: number): Promise<boolean> {
    if (this.superAdminIdsSet.has(telegramUserId)) {
      return true;
    }

    try {
      const { data } = await this.supabase
        .from("sppg_users")
        .select("role, status")
        .eq("id", telegramUserId)
        .single();

      if (data && data.status === "active" && data.role === "super_admin") {
        this.superAdminIdsSet.add(telegramUserId);
        return true;
      }
    } catch {}

    return false;
  }

  async isAdminOrSuperAdmin(telegramUserId: number): Promise<boolean> {
    if (await this.isSuperAdmin(telegramUserId)) return true;

    try {
      const { data } = await this.supabase
        .from("sppg_users")
        .select("role, status")
        .eq("id", telegramUserId)
        .single();

      return data?.status === "active" && (data.role === "admin" || data.role === "super_admin");
    } catch {
      return false;
    }
  }

  async getUser(telegramUserId: number): Promise<SppgUser | null> {
    if (telegramUserId === PRIMARY_SUPER_ADMIN_ID) {
      return {
        id: PRIMARY_SUPER_ADMIN_ID,
        username: "heizaa4",
        first_name: "Heizaaa",
        role: "super_admin",
        status: "active",
      };
    }

    try {
      const { data } = await this.supabase
        .from("sppg_users")
        .select("*")
        .eq("id", telegramUserId)
        .single();

      if (data) return data as SppgUser;
    } catch (err) {
      logger.debug({ err, telegramUserId }, "Error fetching user from database");
    }

    return null;
  }

  async upsertUser(user: Partial<SppgUser> & { id: number }): Promise<void> {
    this.allowedIdsSet.add(user.id);
    if (user.role === "super_admin") {
      this.superAdminIdsSet.add(user.id);
    }

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
      logger.warn({ err }, "Could not upsert user to Supabase (stored in memory cache)");
    }
  }

  async createInvite(params: {
    code: string;
    name: string;
    role: "super_admin" | "admin" | "member";
    sppg_assigned_id: string;
    created_by: number;
    ttlMinutes?: number;
  }): Promise<SppgInvite> {
    const expiresAt = new Date(Date.now() + (params.ttlMinutes || 15) * 60 * 1000).toISOString();
    const invite: SppgInvite = {
      code: params.code,
      name: params.name,
      role: params.role,
      sppg_assigned_id: params.sppg_assigned_id,
      created_by: params.created_by,
      expires_at: expiresAt,
    };

    // Store in memory
    this.activeInvites.set(invite.code, invite);

    // Try storing in Supabase
    try {
      await this.supabase.from("sppg_invites").upsert({
        code: invite.code,
        name: invite.name,
        role: invite.role,
        sppg_assigned_id: invite.sppg_assigned_id,
        created_by: invite.created_by,
        expires_at: invite.expires_at,
      });
    } catch (err) {
      logger.debug({ err, code: invite.code }, "Persisting invite to Supabase failed (using in-memory store)");
    }

    return invite;
  }

  async getInvite(code: string): Promise<SppgInvite | null> {
    // 1. Check in-memory
    const memInvite = this.activeInvites.get(code);
    if (memInvite) {
      return memInvite;
    }

    // 2. Check Supabase
    try {
      const { data } = await this.supabase
        .from("sppg_invites")
        .select("*")
        .eq("code", code)
        .is("claimed_by", null)
        .single();

      if (data) {
        return data as SppgInvite;
      }
    } catch (err) {
      logger.debug({ err, code }, "Error fetching invite from Supabase");
    }

    return null;
  }

  async claimInvite(
    code: string,
    telegramUser: { id: number; username?: string; first_name?: string; last_name?: string }
  ): Promise<{ user: SppgUser; invite: SppgInvite } | null> {
    const invite = await this.getInvite(code);
    if (!invite) return null;

    // Check expiration
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      this.activeInvites.delete(code);
      return null;
    }

    // Create / activate user
    const newUser: SppgUser = {
      id: telegramUser.id,
      username: telegramUser.username,
      first_name: telegramUser.first_name || invite.name,
      last_name: telegramUser.last_name,
      role: invite.role,
      status: "active",
      sppg_assigned_id: invite.sppg_assigned_id,
    };

    await this.upsertUser(newUser);

    // Mark claimed
    invite.claimed_by = telegramUser.id;
    invite.claimed_at = new Date().toISOString();
    this.activeInvites.delete(code);

    try {
      await this.supabase
        .from("sppg_invites")
        .update({ claimed_by: telegramUser.id, claimed_at: invite.claimed_at })
        .eq("code", code);
    } catch (err) {
      logger.debug({ err, code }, "Error updating claimed invite in Supabase");
    }

    return { user: newUser, invite };
  }
}
