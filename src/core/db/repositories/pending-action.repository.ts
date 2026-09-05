import { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../../utils/logger.js";

export type PendingActionType = "SPPG_ORDER" | "SUPPLIER_EXPENSE";
export type PendingActionStatus = "PENDING" | "PROCESSING" | "SAVED" | "CANCELLED" | "EXPIRED";

export interface PendingActionRecord {
  id: string;
  sppg_id: string;
  telegram_user_id: number;
  telegram_chat_id: number;
  action_type: PendingActionType;
  payload: any;
  media_url?: string;
  status: PendingActionStatus;
  message_id?: number;
  expires_at: string;
}

export class PendingActionRepository {
  // In-memory fallback map (guarantees zero downtime even before SQL migration)
  private memoryStore = new Map<string, PendingActionRecord>();

  constructor(private supabase: SupabaseClient) {}

  async create(record: Omit<PendingActionRecord, "status" | "expires_at"> & { ttlMinutes?: number }): Promise<PendingActionRecord> {
    const expiresAt = new Date(Date.now() + (record.ttlMinutes || 10) * 60 * 1000).toISOString();

    const fullRecord: PendingActionRecord = {
      ...record,
      status: "PENDING",
      expires_at: expiresAt,
    };

    // Store in memory
    this.memoryStore.set(record.id, fullRecord);

    // Try persisting to Supabase
    try {
      await this.supabase.from("sppg_pending_actions").insert(fullRecord);
    } catch (err) {
      logger.debug({ err, id: record.id }, "Persisting draft to Supabase failed (using in-memory fallback)");
    }

    return fullRecord;
  }

  async getById(id: string): Promise<PendingActionRecord | null> {
    // 1. Check in-memory first
    const mem = this.memoryStore.get(id);
    if (mem) {
      if (new Date(mem.expires_at).getTime() < Date.now()) {
        mem.status = "EXPIRED";
      }
      return mem;
    }

    // 2. Query Supabase
    try {
      const { data, error } = await this.supabase
        .from("sppg_pending_actions")
        .select("*")
        .eq("id", id)
        .single();

      if (error || !data) return null;

      if (new Date(data.expires_at).getTime() < Date.now() && data.status === "PENDING") {
        data.status = "EXPIRED";
      }
      this.memoryStore.set(id, data);
      return data;
    } catch {
      return null;
    }
  }

  async acquireLock(id: string): Promise<boolean> {
    const record = await this.getById(id);
    if (!record || record.status !== "PENDING") {
      return false;
    }

    record.status = "PROCESSING";
    this.memoryStore.set(id, record);

    try {
      await this.supabase
        .from("sppg_pending_actions")
        .update({ status: "PROCESSING" })
        .eq("id", id)
        .eq("status", "PENDING");
    } catch (err) {
      logger.debug({ err }, "Database lock update fallback to memory");
    }

    return true;
  }

  async updateStatus(id: string, status: PendingActionStatus): Promise<void> {
    const record = await this.getById(id);
    if (record) {
      record.status = status;
      this.memoryStore.set(id, record);
    }

    try {
      await this.supabase
        .from("sppg_pending_actions")
        .update({ status, resolved_at: new Date().toISOString() })
        .eq("id", id);
    } catch (err) {
      logger.debug({ err }, "Database status update fallback to memory");
    }
  }

  async updatePayload(id: string, newPayload: any): Promise<void> {
    const record = await this.getById(id);
    if (record) {
      record.payload = newPayload;
      this.memoryStore.set(id, record);
    }

    try {
      await this.supabase
        .from("sppg_pending_actions")
        .update({ payload: newPayload })
        .eq("id", id);
    } catch (err) {
      logger.debug({ err }, "Database payload update fallback to memory");
    }
  }
}
