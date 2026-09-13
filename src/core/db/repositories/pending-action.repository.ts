import crypto from "crypto";
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

/**
 * Deterministically maps any client draft ID string into a valid RFC4122 UUID
 * for PostgreSQL UUID primary key compatibility.
 */
export function toDraftUuid(id: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return id;
  }
  const hash = crypto.createHash("md5").update(id).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export class PendingActionRepository {
  // In-memory fallback map (guarantees fast access and zero latency)
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

    // Persist to Supabase with valid UUID
    try {
      const { ttlMinutes, ...cleanRecord } = fullRecord as any;
      const dbRecord = {
        ...cleanRecord,
        id: toDraftUuid(record.id),
        payload: {
          ...(record.payload || {}),
          _client_draft_id: record.id,
        },
      };
      const { error } = await this.supabase.from("sppg_pending_actions").insert(dbRecord);
      if (error) {
        logger.warn({ error, id: record.id }, "Supabase pending draft insert warning");
      }
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

    // 2. Query Supabase using mapped UUID
    try {
      const uuid = toDraftUuid(id);
      const { data, error } = await this.supabase
        .from("sppg_pending_actions")
        .select("*")
        .eq("id", uuid)
        .single();

      if (error || !data) return null;

      if (new Date(data.expires_at).getTime() < Date.now() && data.status === "PENDING") {
        data.status = "EXPIRED";
      }

      const restoredRecord: PendingActionRecord = {
        ...data,
        id: data.payload?._client_draft_id || id,
      };

      this.memoryStore.set(id, restoredRecord);
      return restoredRecord;
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
      const uuid = toDraftUuid(id);
      await this.supabase
        .from("sppg_pending_actions")
        .update({ status: "PROCESSING" })
        .eq("id", uuid)
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
      const uuid = toDraftUuid(id);
      await this.supabase
        .from("sppg_pending_actions")
        .update({ status, resolved_at: new Date().toISOString() })
        .eq("id", uuid);
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
      const uuid = toDraftUuid(id);
      const payloadWithId = {
        ...(newPayload || {}),
        _client_draft_id: id,
      };
      await this.supabase
        .from("sppg_pending_actions")
        .update({ payload: payloadWithId })
        .eq("id", uuid);
    } catch (err) {
      logger.debug({ err }, "Database payload update fallback to memory");
    }
  }

  async getExpiredPending(sppgId?: string): Promise<PendingActionRecord[]> {
    const expired: PendingActionRecord[] = [];
    const now = Date.now();

    // 1. Check in-memory store
    for (const [, record] of this.memoryStore.entries()) {
      if (record.status === "PENDING" && new Date(record.expires_at).getTime() < now) {
        if (!sppgId || record.sppg_id === sppgId) {
          record.status = "EXPIRED";
          expired.push(record);
        }
      }
    }

    // 2. Query Supabase
    try {
      let query = this.supabase
        .from("sppg_pending_actions")
        .select("*")
        .eq("status", "PENDING")
        .lt("expires_at", new Date().toISOString());

      if (sppgId) {
        query = query.eq("sppg_id", sppgId);
      }

      const { data, error } = await query;
      if (!error && data) {
        for (const row of data) {
          const clientDraftId = row.payload?._client_draft_id || row.id;
          if (!expired.some((e) => e.id === clientDraftId)) {
            expired.push({
              ...row,
              id: clientDraftId,
              status: "EXPIRED",
            });
          }
        }
      }
    } catch (err) {
      logger.debug({ err }, "Could not query expired drafts from Supabase");
    }

    return expired;
  }
}
