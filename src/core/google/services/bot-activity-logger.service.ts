import { logger } from "../../utils/logger.js";
import { getWibTimestamp, getWibTimeOnly } from "../../utils/date-time.js";
import { SHEET_NAMES } from "../recipes/constants.js";
import { SheetsClientProvider } from "./sheets-client.provider.js";

function stripEmotes(text: string): string {
  if (!text) return "";
  return text.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, "").trim();
}

export interface BotActivityLogEntry {
  timestamp?: string; // Format: "YYYY-MM-DD HH:mm:ss WIB"
  userId: string | number;
  userName: string;
  role?: string;
  mediaType: "Teks" | "Foto Nota" | "Voice Note" | "Tombol" | "Dokumen" | string;
  userMessage: string;
  systemAction: string;
  refId?: string;
  status?: "SUKSES" | "GAGAL" | "PENDING" | "DITOLAK" | "DIBATALKAN" | "KADALUWARSA" | string;
}

export class BotActivityLoggerService {
  private queue: Map<string, (string | number)[][]> = new Map();
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;

  constructor(private clientProvider: SheetsClientProvider) {}

  logActivity(spreadsheetId: string, entry: BotActivityLogEntry): void {
    if (!spreadsheetId) return;

    const timestamp = entry.timestamp || getWibTimestamp();
    const userId = String(entry.userId || "-");
    const userName = entry.userName || "Pengguna";
    const role = entry.role || "-";
    const mediaType = stripEmotes(entry.mediaType || "Teks");
    const userMessage = stripEmotes(entry.userMessage || "-").trim().substring(0, 1000);
    const systemAction = stripEmotes(entry.systemAction || "-").trim().substring(0, 1000);
    const refId = entry.refId || "-";
    const status = stripEmotes(entry.status || "SUKSES").toUpperCase();

    const row = [
      timestamp,
      userId,
      userName,
      role,
      mediaType,
      userMessage,
      systemAction,
      refId,
      status,
    ];

    if (!this.queue.has(spreadsheetId)) {
      this.queue.set(spreadsheetId, []);
    }
    this.queue.get(spreadsheetId)!.push(row);

    // If queue for this spreadsheet >= 5, flush immediately
    if (this.queue.get(spreadsheetId)!.length >= 5) {
      this.flush().catch(() => {});
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush().catch(() => {});
      }, 2000);
    }
  }

  async flush(): Promise<void> {
    if (this.isFlushing || this.queue.size === 0) return;
    this.isFlushing = true;

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const currentQueues = new Map(this.queue);
    this.queue.clear();

    for (const [spreadsheetId, rows] of currentQueues.entries()) {
      if (rows.length === 0) continue;
      try {
        await this.clientProvider.appendRowsSafely(spreadsheetId, SHEET_NAMES.LOG_AKTIVITAS, rows);
        logger.info({ spreadsheetId, count: rows.length, tab: SHEET_NAMES.LOG_AKTIVITAS }, "Bot activity logs flushed to sheet");
      } catch (err: any) {
        logger.warn({ err: err?.message || err, spreadsheetId, count: rows.length }, "Failed flushing bot activity logs to sheet");
      }
    }

    this.isFlushing = false;
  }

  /**
   * Performs an in-place status update on an existing log entry by matching refId.
   * Updates Column F (User Message Timeline), Column G (System Action Timeline),
   * and Column I (Status, emote-free) in-place without adding duplicate rows.
   */
  async updateActivityStatus(
    spreadsheetId: string,
    refId: string,
    newStatus: string,
    updatedAction?: string,
    newUserMessage?: string
  ): Promise<boolean> {
    if (!spreadsheetId || !refId || refId === "-") return false;

    // Flush any pending queue first so all previous rows are on the sheet
    await this.flush();

    try {
      const client = await this.clientProvider.getClient();
      // Read Columns F through H: F = User Message, G = System Action, H = Ref ID
      const res = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.LOG_AKTIVITAS}'!F:H`,
      });

      const values = res.data.values || [];
      let targetRow = -1;
      let existingUserMsg = "";
      let existingAction = "";

      for (let i = values.length - 1; i >= 1; i--) {
        if (values[i] && values[i][2] === refId) {
          targetRow = i + 1;
          existingUserMsg = values[i][0] || "";
          existingAction = values[i][1] || "";
          break;
        }
      }

      if (targetRow > 1) {
        const timeOnly = getWibTimeOnly();
        const cleanStatus = stripEmotes(newStatus).toUpperCase();

        const updates: { range: string; values: any[][] }[] = [
          {
            range: `'${SHEET_NAMES.LOG_AKTIVITAS}'!I${targetRow}`,
            values: [[cleanStatus]],
          },
        ];

        if (newUserMessage) {
          const cleanUserMsg = stripEmotes(newUserMessage);
          let baseMsg = existingUserMsg;
          if (baseMsg && !baseMsg.startsWith("[")) {
            baseMsg = `[${timeOnly}] ${baseMsg}`;
          }
          const chainedUserMsg = baseMsg
            ? `${baseMsg} -> [${timeOnly}] ${cleanUserMsg}`
            : `[${timeOnly}] ${cleanUserMsg}`;
          updates.push({
            range: `'${SHEET_NAMES.LOG_AKTIVITAS}'!F${targetRow}`,
            values: [[chainedUserMsg.substring(0, 2000)]],
          });
        }

        if (updatedAction) {
          const cleanAction = stripEmotes(updatedAction);
          let baseAction = existingAction;
          if (baseAction && !baseAction.startsWith("[")) {
            baseAction = `[${timeOnly}] ${baseAction}`;
          }
          const chainedAction = baseAction
            ? `${baseAction} -> [${timeOnly}] ${cleanAction}`
            : `[${timeOnly}] ${cleanAction}`;
          updates.push({
            range: `'${SHEET_NAMES.LOG_AKTIVITAS}'!G${targetRow}`,
            values: [[chainedAction.substring(0, 2000)]],
          });
        }

        await client.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: "USER_ENTERED",
            data: updates,
          },
        });

        logger.info({ spreadsheetId, refId, targetRow, cleanStatus }, "Updated activity log in-place with timeline chain");
        return true;
      }
    } catch (err: any) {
      logger.warn({ err: err?.message || err, spreadsheetId, refId }, "Failed in-place activity log update");
    }

    return false;
  }
}
