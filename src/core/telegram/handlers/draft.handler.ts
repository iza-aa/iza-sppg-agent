import { Context, InlineKeyboard } from "grammy";
import type { BotContext, UserInteractionState } from "../types/bot-context.js";
import { googleSheetsService } from "../../google/sheets.service.js";
import { mediaVaultService, mediaBufferCache } from "../../storage/media-vault.service.js";
import { logger } from "../../utils/logger.js";
import {
  renderSppgOrderDraftCard,
  renderSppgOrderItemsDetail,
  renderSupplierExpenseDraftCard,
  safeEditMessageText,
} from "../formatter.js";
import {
  buildDraftConfirmationKeyboard,
  buildBackToDraftKeyboard,
  buildEditSubmenuKeyboard,
  buildPaguSelectorKeyboard,
  buildPaguPromptKeyboard,
  buildPaguBrowseKeyboard,
  buildCancelInputKeyboard,
  buildMissingExpenseFieldsKeyboard,
  buildPaymentMethodPromptKeyboard,
  buildSupplierNamePromptKeyboard,
  buildOrderNoPromptKeyboard,
  buildPaymentMethodPickerKeyboard,
} from "../keyboards.js";

// Helper to cancel any previous pending draft message before replacing it with a new draft
export async function cancelPreviousActiveDraftIfAny(
  bCtx: BotContext,
  ctx: Context,
  chatId: number,
  state: UserInteractionState
): Promise<void> {
  if (state.activeDraftId && state.activeDraftMsgId) {
    mediaBufferCache.delete(state.activeDraftId);
    cancelDraftAutoExpiry(state.activeDraftId);
    const oldDraft = await bCtx.pendingRepo.getById(state.activeDraftId).catch(() => null);
    if (oldDraft && oldDraft.status === "PENDING") {
      await bCtx.pendingRepo.updateStatus(oldDraft.id, "CANCELLED").catch(() => {});
      await bCtx.updateActivityStatus(
        oldDraft.id,
        "KADALUWARSA",
        "Draf otomatis ditutup (Digantikan aktivitas baru)",
        "Mengirim berkas/perintah baru"
      ).catch(() => {});
      const cancelledCard = oldDraft.action_type === "SPPG_ORDER"
        ? renderSppgOrderDraftCard(oldDraft.payload, oldDraft.id, "CANCELLED")
        : renderSupplierExpenseDraftCard(oldDraft.payload, oldDraft.id, "CANCELLED", oldDraft.media_url);
      await ctx.api.editMessageText(chatId, state.activeDraftMsgId, cancelledCard, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [] },
        link_preview_options: { is_disabled: true },
      }).catch(() => {});
    }
  }
}

// Helper to determine the appropriate confirmation keyboard:
export function getDraftConfirmationReplyMarkup(
  draftId: string,
  actionType: "SPPG_ORDER" | "SUPPLIER_EXPENSE",
  payload: any,
  itemsCount?: number,
  hasMultiplePagu?: boolean
) {
  if (actionType === "SPPG_ORDER") {
    const isMissingOrderNo = !payload?.order_no || payload.order_no === "PO-AUTO" || payload.order_no === "-" || payload.order_no.trim() === "";
    const isMissingAmount = !payload?.total_amount || Number(payload.total_amount) <= 0;
    if (isMissingOrderNo) {
      return buildOrderNoPromptKeyboard(draftId);
    }
    if (isMissingAmount) {
      return new InlineKeyboard()
        .text("💰 Masukkan Total Pagu", `v:sub:nominal:${draftId}`)
        .row()
        .text("❌ Batalkan", `v:cancel:${draftId}`);
    }
    return buildDraftConfirmationKeyboard(draftId, actionType, itemsCount, hasMultiplePagu);
  }

  if (actionType === "SUPPLIER_EXPENSE") {
    // 1. If Pagu selection is required, prompt user immediately with PO choices
    if (
      payload?.paguSelectionRequired === true &&
      Array.isArray(payload?.paguCandidates) &&
      payload.paguCandidates.length > 0
    ) {
      return buildPaguPromptKeyboard(draftId, payload.paguCandidates);
    }

    // 2. Critical missing fields (Total Amount <= 0, empty items, missing payment, missing supplier)
    const isMissingAmount = !payload?.total_amount || Number(payload.total_amount) <= 0;
    const isMissingItems =
      !payload?.items ||
      payload.items.length === 0;
    const isMissingSupplier = !payload?.supplier_name || payload.supplier_name === "-" || payload.supplier_name.trim() === "";
    const isMissingPayment = !payload?.payment_method || payload.payment_method === "-" || payload.payment_method.trim() === "";

    if (isMissingAmount || isMissingItems || isMissingSupplier || isMissingPayment) {
      return buildMissingExpenseFieldsKeyboard(draftId, {
        isMissingAmount,
        isMissingItems,
        isMissingSupplier,
        isMissingPayment,
      });
    }

    return buildDraftConfirmationKeyboard(draftId, actionType, itemsCount, hasMultiplePagu);
  }

  return buildDraftConfirmationKeyboard(draftId, actionType, itemsCount, hasMultiplePagu);
}

// Helper to match and enrich receipt with active unfulfilled Pagu candidates
export async function enrichReceiptWithPaguContext(
  spreadsheetId: string,
  receipt: any
): Promise<boolean> {
  const firstItem = receipt?.items?.[0];
  try {
    // 1. If explicitly marked as Non-Pagu / Belanja Tambahan
    if (receipt.sppg_ref_no === "-") {
      receipt.paguSelectionRequired = false;
      receipt.paguContext = {
        sppg_ref_no: "-",
        order_date: "-",
        pagu_supplier: "-",
        item_name: firstItem?.item_name || "-",
        target_qty: 0,
        unit: firstItem?.unit || "",
        fulfilled_qty: 0,
        current_qty: firstItem?.qty || 0,
        remaining_qty: 0,
        candidates_count: 0,
      };
      return false;
    }

    // 2. Fetch available orders in this unit
    const orders = await googleSheetsService.getPaguOrders(spreadsheetId);

    // If unit has NO orders in Tab 02, default to Non-Pagu
    if (orders.length === 0) {
      receipt.sppg_ref_no = "-";
      receipt.paguSelectionRequired = false;
      return false;
    }

    // 3. Gather candidates across ALL items in the receipt (not just firstItem)
    const items: Array<{ item_name: string; qty: number; unit?: string }> = receipt?.items || [];
    const allCandidatesMap = new Map<string, any>();
    const poMatchCount = new Map<string, number>();

    for (const it of items) {
      if (!it.item_name) continue;
      const cands = await googleSheetsService.getPaguCandidatesForCommodity(
        spreadsheetId,
        it.item_name
      );
      for (const c of cands) {
        poMatchCount.set(c.sppg_ref_no, (poMatchCount.get(c.sppg_ref_no) || 0) + 1);
        if (!allCandidatesMap.has(c.sppg_ref_no)) {
          allCandidatesMap.set(c.sppg_ref_no, c);
        }
      }
    }

    const candidates = Array.from(allCandidatesMap.values());

    // 4. If the user explicitly picked and confirmed an existing PO order (paguSelectionRequired is false):
    const exactOrder = orders.find(
      (o) => o.orderNo.toLowerCase() === (receipt.sppg_ref_no || "").toLowerCase()
    );

    if (receipt.paguSelectionRequired === false && exactOrder) {
      const matched = candidates.find((c) => c.sppg_ref_no === exactOrder.orderNo) || {
        sppg_ref_no: exactOrder.orderNo,
        order_date: exactOrder.orderDate,
        supplier_name: exactOrder.notes || "-",
        item_name: firstItem?.item_name || "-",
        target_qty: 0,
        unit: firstItem?.unit || "",
        fulfilled_qty: 0,
        remaining_qty: 0,
      };
      receipt.sppg_ref_no = exactOrder.orderNo;
      receipt.paguContext = {
        sppg_ref_no: matched.sppg_ref_no,
        order_date: matched.order_date,
        pagu_supplier: matched.supplier_name,
        item_name: matched.item_name,
        target_qty: matched.target_qty,
        unit: matched.unit,
        fulfilled_qty: matched.fulfilled_qty,
        current_qty: firstItem?.qty || 0,
        remaining_qty: matched.remaining_qty,
        candidates_count: orders.length,
      };
      return true;
    }

    // 5. Fresh upload / unconfirmed PO:
    // ALWAYS require the user to choose the Pagu from available orders in Tab 02!
    receipt.sppg_ref_no = "";
    receipt.paguSelectionRequired = true;
    receipt.paguContext = undefined;

    // Populate all active orders sorted by match score priority
    const mappedOrders = orders.map((o) => {
      const cand = candidates.find((c) => c.sppg_ref_no === o.orderNo);
      const matchScore = poMatchCount.get(o.orderNo) || 0;
      return {
        sppg_ref_no: o.orderNo,
        order_date: o.orderDate,
        item_name: cand?.item_name || firstItem?.item_name || "Bahan Belanja",
        target_qty: cand?.target_qty || 0,
        unit: cand?.unit || firstItem?.unit || "unit",
        supplier_name: o.notes || "SPPG",
        remaining_qty: cand?.remaining_qty || 0,
        fulfilled_qty: cand?.fulfilled_qty || 0,
        match_score: matchScore,
      };
    });

    // Sort: highest match score first, then newest order date
    mappedOrders.sort((a, b) => {
      if ((b.match_score || 0) !== (a.match_score || 0)) {
        return (b.match_score || 0) - (a.match_score || 0);
      }
      return String(b.order_date || "").localeCompare(String(a.order_date || ""));
    });

    receipt.paguCandidates = mappedOrders;
    return true;
  } catch (err) {
    logger.warn({ err }, "Could not enrich receipt with Pagu context");
  }
  return false;
}

export async function handleExpiredOrMissingDraft(
  bCtx: BotContext,
  ctx: Context,
  draft?: any
): Promise<void> {
  const currentText = ctx.callbackQuery?.message?.text || ctx.callbackQuery?.message?.caption || "";
  const chatId = ctx.chat?.id;
  const msgId = ctx.callbackQuery?.message?.message_id;

  if (currentText) {
    let updatedCard: string;
    if (draft && draft.payload) {
      updatedCard = draft.action_type === "SPPG_ORDER"
        ? renderSppgOrderDraftCard(draft.payload, draft.id, draft.status === "CANCELLED" ? "CANCELLED" : "EXPIRED")
        : renderSupplierExpenseDraftCard(draft.payload, draft.id, draft.status === "CANCELLED" ? "CANCELLED" : "EXPIRED", draft.media_url);
    } else {
      const statusTitle = "⌛ <b>STATUS: DRAF KEDALUWARSA</b>\n\n<i>Sesi konfirmasi telah berakhir. Silakan kirim ulang dokumen atau buat transaksi baru.</i>";
      if (/STATUS:/i.test(currentText)) {
        updatedCard = currentText.replace(/([⏳⚠️❌✅⌛]?\s*STATUS:[\s\S]*$)/i, statusTitle);
      } else {
        updatedCard = `${currentText}\n\n------------------------------------------\n${statusTitle}`;
      }
    }

    await safeEditMessageText(ctx, updatedCard, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [] },
      link_preview_options: { is_disabled: true },
    }).catch(async () => {
      if (chatId && msgId) {
        await ctx.api.editMessageReplyMarkup(chatId, msgId, {
          reply_markup: { inline_keyboard: [] },
        }).catch(() => {});
      }
    });
  } else if (chatId && msgId) {
    await ctx.api.editMessageReplyMarkup(chatId, msgId, {
      reply_markup: { inline_keyboard: [] },
    }).catch(() => {});
  }

  if (ctx.from) {
    const state = bCtx.getState(ctx.from.id);
    state.activeDraftId = undefined;
    state.activeDraftMsgId = undefined;
    state.editingField = null;
    if (state.promptMsgId && chatId) {
      await ctx.api.deleteMessage(chatId, state.promptMsgId).catch(() => {});
      state.promptMsgId = undefined;
    }
  }

  if (draft?.id) {
    cancelDraftAutoExpiry(draft.id);
  }

  await ctx.answerCallbackQuery({
    text: "⚠️ Draf ini sudah tidak aktif atau kedaluwarsa.",
    show_alert: true,
  }).catch(() => {});
}

const activeDraftTimers = new Map<string, NodeJS.Timeout>();

export function cancelDraftAutoExpiry(draftId: string): void {
  const timer = activeDraftTimers.get(draftId);
  if (timer) {
    clearTimeout(timer);
    activeDraftTimers.delete(draftId);
  }
}

export async function executeDraftAutoExpiry(
  bCtx: BotContext,
  draftId: string,
  chatId: number,
  messageId?: number
): Promise<void> {
  cancelDraftAutoExpiry(draftId);

  const draft = await bCtx.pendingRepo.getById(draftId);
  if (!draft || draft.status === "SAVED" || draft.status === "CANCELLED" || draft.payload?._auto_expired) {
    return;
  }

  draft.payload = { ...(draft.payload || {}), _auto_expired: true };
  await bCtx.pendingRepo.updatePayload(draftId, draft.payload);
  await bCtx.pendingRepo.updateStatus(draftId, "EXPIRED");

  const targetMsgId = messageId || draft.payload?.message_id;
  if (targetMsgId) {
    const expiredCard =
      draft.action_type === "SPPG_ORDER"
        ? renderSppgOrderDraftCard(draft.payload, draftId, "EXPIRED")
        : renderSupplierExpenseDraftCard(draft.payload, draftId, "EXPIRED", draft.media_url);

    try {
      await bCtx.bot.api.editMessageText(chatId, targetMsgId, expiredCard, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [] },
        link_preview_options: { is_disabled: true },
      });
    } catch (err: any) {
      if (!err?.description?.includes("message is not modified")) {
        try {
          await bCtx.bot.api.editMessageCaption(chatId, targetMsgId, {
            caption: expiredCard,
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: [] },
          });
        } catch {
          await bCtx.bot.api.editMessageReplyMarkup(chatId, targetMsgId, {
            reply_markup: { inline_keyboard: [] },
          }).catch(() => {});
        }
      }
    }
  }

  if (draft.telegram_user_id) {
    const state = bCtx.getState(draft.telegram_user_id);
    if (state.activeDraftId === draftId) {
      state.activeDraftId = undefined;
      state.activeDraftMsgId = undefined;
      state.editingField = null;
      if (state.promptMsgId) {
        await bCtx.bot.api.deleteMessage(chatId, state.promptMsgId).catch(() => {});
        state.promptMsgId = undefined;
      }
    }
  }

  await bCtx.updateActivityStatus(
    draftId,
    "KEDALUWARSA",
    "Draf kedaluwarsa otomatis (Batas waktu 10 menit)",
    "Sistem Otomatis"
  ).catch(() => {});
}

export function scheduleDraftAutoExpiry(
  bCtx: BotContext,
  draftId: string,
  chatId: number,
  messageId: number,
  ttlMinutes: number = 10
): void {
  cancelDraftAutoExpiry(draftId);

  const delayMs = Math.max(1000, ttlMinutes * 60 * 1000);
  const timer = setTimeout(async () => {
    try {
      await executeDraftAutoExpiry(bCtx, draftId, chatId, messageId);
    } catch (err) {
      logger.warn({ err, draftId }, "Error executing auto-expiry for draft");
    } finally {
      activeDraftTimers.delete(draftId);
    }
  }, delayMs);

  timer.unref();
  activeDraftTimers.set(draftId, timer);
}

export async function sweepExpiredDrafts(bCtx: BotContext): Promise<void> {
  try {
    const expired = await bCtx.pendingRepo.getExpiredPending(bCtx.unitConfig.id);
    for (const draft of expired) {
      if (draft.telegram_chat_id && draft.payload?.message_id) {
        await executeDraftAutoExpiry(bCtx, draft.id, draft.telegram_chat_id, draft.payload.message_id);
      } else {
        await bCtx.pendingRepo.updateStatus(draft.id, "EXPIRED");
      }
    }
  } catch (err) {
    logger.debug({ err }, "Error sweeping expired drafts");
  }
}

export function registerDraftHandlers(bCtx: BotContext) {
  // Proactive startup sweep & recurring 60s sweeper
  sweepExpiredDrafts(bCtx).catch(() => {});
  const sweeper = setInterval(() => {
    sweepExpiredDrafts(bCtx).catch(() => {});
  }, 60 * 1000);
  sweeper.unref();

  // [✅ Ya, Simpan]
  bCtx.bot.callbackQuery(/^v:save:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await bCtx.pendingRepo.getById(draftId);

    if (!draft || draft.status !== "PENDING") {
      return handleExpiredOrMissingDraft(bCtx, ctx, draft);
    }

    if (draft.action_type === "SPPG_ORDER" && (await bCtx.isCallerMember(ctx.from?.id))) {
      await bCtx.pendingRepo.updateStatus(draftId, "CANCELLED");
      return ctx.answerCallbackQuery({
        text: "⛔ Akses Ditolak: Member hanya memiliki hak akses untuk input Pengeluaran Belanja Supplier.",
        show_alert: true,
      });
    }

    if (
      draft.action_type === "SPPG_ORDER" &&
      (!draft.payload?.order_no || draft.payload.order_no === "PO-AUTO" || draft.payload.order_no === "-" || draft.payload.order_no.trim() === "")
    ) {
      return ctx.answerCallbackQuery({
        text: "⚠️ Mohon lengkapi No Surat Pesanan (PO) terlebih dahulu!",
        show_alert: true,
      });
    }

    if (draft.action_type === "SUPPLIER_EXPENSE") {
      if (!draft.payload?.payment_method || draft.payload.payment_method.trim() === "" || draft.payload.payment_method === "-") {
        return ctx.answerCallbackQuery({
          text: "⚠️ Mohon tentukan metode pembayaran (Tunai atau Transfer) terlebih dahulu!",
          show_alert: true,
        });
      }
      if (!draft.payload?.supplier_name || draft.payload.supplier_name.trim() === "" || draft.payload.supplier_name === "Supplier Pasar") {
        return ctx.answerCallbackQuery({
          text: "⚠️ Mohon sebutkan nama toko / supplier belanja terlebih dahulu!",
          show_alert: true,
        });
      }
      if (!draft.payload?.total_amount || Number(draft.payload.total_amount) <= 0) {
        return ctx.answerCallbackQuery({
          text: "⚠️ Mohon masukkan total nominal belanja terlebih dahulu!",
          show_alert: true,
        });
      }
      const isMissingItems =
        !draft.payload?.items ||
        draft.payload.items.length === 0 ||
        draft.payload.items.every((it: any) => {
          const n = (it.item_name || "").trim().toLowerCase();
          return (
            !n ||
            n === "belanja bahan pangan" ||
            n === "bahan makanan" ||
            n === "bahan pangan" ||
            n === "barang" ||
            n === "bahan" ||
            n === "-"
          );
        });
      if (isMissingItems) {
        return ctx.answerCallbackQuery({
          text: "⚠️ Mohon lengkapi rincian barang belanjaan (nama bahan & kuantitas) terlebih dahulu!",
          show_alert: true,
        });
      }
    }

    if (
      draft.action_type === "SPPG_ORDER" &&
      (!draft.payload?.total_amount || Number(draft.payload.total_amount) <= 0)
    ) {
      return ctx.answerCallbackQuery({
        text: "⚠️ Mohon masukkan rincian bahan atau total pagu terlebih dahulu!",
        show_alert: true,
      });
    }

    if (
      draft.action_type === "SUPPLIER_EXPENSE" &&
      draft.payload?.paguSelectionRequired === true &&
      Array.isArray(draft.payload?.paguCandidates) &&
      draft.payload.paguCandidates.length > 1
    ) {
      return ctx.answerCallbackQuery({
        text: "⚠️ Mohon sentuh salah satu pilihan anggaran menu terlebih dahulu!",
        show_alert: true,
      });
    }

    const locked = await bCtx.pendingRepo.acquireLock(draftId);
    if (!locked) {
      return ctx.answerCallbackQuery({
        text: "⏳ Sedang diproses, mohon tunggu...",
        show_alert: false,
      });
    }

    await ctx.answerCallbackQuery({
      text: "⚡ Sedang menulis ke Google Sheets...",
      show_alert: false,
    });

    const currentText = ctx.callbackQuery.message?.text || "";
    const processingText = currentText.includes("STATUS:")
      ? currentText.replace(/STATUS:.*$/im, "STATUS: SEDANG MENYIMPAN KE GOOGLE SHEETS... ⏳")
      : (currentText ? currentText + "\n\n⏳ <b>STATUS: SEDANG MENYIMPAN KE GOOGLE SHEETS...</b>" : "⏳ Sedang menyimpan ke Google Sheets...");

    await safeEditMessageText(ctx, processingText, {
      reply_markup: undefined,
    });

    try {
      const callingUser = ctx.from ? await bCtx.userRepo.getUser(ctx.from.id) : null;
      const recorderName = callingUser?.first_name || ctx.from?.first_name || (ctx.from?.id === 7546537134 ? "Heizaaa" : "Petugas SPPG");

      // Lazy Upload: Upload file to Supabase Media Vault only upon confirmation
      let mediaUrl = draft.media_url || "";
      if (!mediaUrl) {
        const cached = mediaBufferCache.get(draftId);
        if (cached) {
          try {
            const now = new Date();
            const isPdf = cached.mimeType === "application/pdf" || cached.fileName.toLowerCase().endsWith(".pdf");
            const subFolderType = draft.action_type === "SPPG_ORDER"
              ? "01_Nota_Pesanan_SPPG"
              : (isPdf ? "03_Dokumen_PDF" : "02_Kwitansi_Supplier");
            const fileExt = isPdf ? ".pdf" : ".png";
            const fileName = `${now.toISOString().slice(0, 10)}_${Date.now().toString().slice(-4)}${fileExt}`;
            const uploadRes = await mediaVaultService.uploadReceipt(
              cached.buffer,
              fileName,
              bCtx.unitConfig.id,
              subFolderType
            );
            mediaUrl = uploadRes.webViewLink;
            draft.media_url = mediaUrl;
            mediaBufferCache.delete(draftId);
            logger.info({ draftId, mediaUrl }, "Successfully uploaded media from buffer cache on confirm");
          } catch (uploadErr) {
            logger.warn({ err: uploadErr, errMsg: (uploadErr as any)?.message }, "Failed lazy upload from buffer cache on confirm");
          }
        } else if (draft.payload?.telegram_file_id) {
          try {
            const file = await ctx.api.getFile(draft.payload.telegram_file_id);
            if (file.file_path) {
              const fileUrl = `https://api.telegram.org/file/bot${bCtx.unitConfig.token}/${file.file_path}`;
              const res = await fetch(fileUrl);
              const buffer = Buffer.from(await res.arrayBuffer());
              const now = new Date();
              const isPdf = draft.payload?.mime_type === "application/pdf" || (draft.payload?.file_name && String(draft.payload.file_name).toLowerCase().endsWith(".pdf"));
              const subFolderType = draft.action_type === "SPPG_ORDER"
                ? "01_Nota_Pesanan_SPPG"
                : (isPdf ? "03_Dokumen_PDF" : "02_Kwitansi_Supplier");
              const fileExt = isPdf ? ".pdf" : ".png";
              const fileName = `${now.toISOString().slice(0, 10)}_${Date.now().toString().slice(-4)}${fileExt}`;
              const uploadRes = await mediaVaultService.uploadReceipt(
                buffer,
                fileName,
                bCtx.unitConfig.id,
                subFolderType
              );
              mediaUrl = uploadRes.webViewLink;
              draft.media_url = mediaUrl;
            }
          } catch (uploadErr) {
            logger.warn({ err: uploadErr, errMsg: (uploadErr as any)?.message }, "Failed lazy upload from telegram on confirm");
          }
        }
      }

      if (draft.action_type === "SPPG_ORDER") {
        await googleSheetsService.recordSppgOrder(
          bCtx.unitConfig.spreadsheetId,
          draft.payload,
          draft.media_url || mediaUrl || "",
          draft.payload?.notes || "",
          recorderName
        );
      } else {
        const items = draft.payload?.items || [];
        const supplierGroups = new Map<string, any[]>();
        for (const it of items) {
          const sName = it.supplier_name?.trim() || it.supplier_target?.trim();
          if (sName) {
            if (!supplierGroups.has(sName)) {
              supplierGroups.set(sName, []);
            }
            supplierGroups.get(sName)!.push(it);
          }
        }

        if (supplierGroups.size > 1) {
          // Multi-supplier detected: split into individual transactions per supplier
          const batchTransactions: any[] = [];
          for (const [suppName, groupItems] of supplierGroups.entries()) {
            const groupTotal = groupItems.reduce(
              (acc: number, it: any) => acc + (Number(it.total_price) || (Number(it.qty) * Number(it.price))),
              0
            );
            batchTransactions.push({
              ...draft.payload,
              supplier_name: suppName,
              items: groupItems,
              total_amount: groupTotal,
              subtotal: groupTotal,
              driveLink: draft.media_url || mediaUrl || draft.payload?.driveLink || "",
            });
          }
          await googleSheetsService.recordSupplierExpenseBatch(
            bCtx.unitConfig.spreadsheetId,
            batchTransactions,
            recorderName,
            draft.payload?.notes || ""
          );
        } else {
          await googleSheetsService.recordSupplierExpense(
            bCtx.unitConfig.spreadsheetId,
            draft.payload,
            draft.media_url || mediaUrl || "",
            recorderName,
            draft.payload?.notes || ""
          );
        }
      }

      await bCtx.pendingRepo.updateStatus(draftId, "SAVED");
      cancelDraftAutoExpiry(draftId);

      (ctx as any)._activityLogged = true;

      const actionDesc = draft.action_type === "SPPG_ORDER"
        ? "Berkas diunggah ke Media Vault & Data disimpan ke Tab 02 (Pendapatan), Tab 03 (Rincian), Tab 06 (Margin)"
        : "Berkas diunggah ke Media Vault & Data disimpan ke Tab 04 (Pengeluaran), Tab 05 (Rincian), Tab 06 (Margin)";

      const userMsgDesc = "Klik [Ya, Simpan]";

      const updated = await bCtx.updateActivityStatus(draftId, "SUKSES", actionDesc, userMsgDesc);
      if (!updated) {
        await bCtx.logActivity(ctx, {
          mediaType: "Tombol",
          userMessage: userMsgDesc,
          systemAction: actionDesc,
          refId: draftId,
          status: "SUKSES",
        });
      }

      if (ctx.from) {
        const state = bCtx.getState(ctx.from.id);
        state.activeDraftId = undefined;
        state.activeDraftMsgId = undefined;
      }

      const successCard =
        draft.action_type === "SPPG_ORDER"
          ? renderSppgOrderDraftCard(draft.payload, draftId, "SAVED")
          : renderSupplierExpenseDraftCard(draft.payload, draftId, "SAVED", draft.media_url);

      await safeEditMessageText(ctx, successCard, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
    } catch (saveErr: any) {
      logger.error({ saveErr }, "Failed saving to Google Sheets, restoring draft status to PENDING");
      await bCtx.pendingRepo.updateStatus(draftId, "PENDING");
      await bCtx.logActivity(ctx, {
        mediaType: "Tombol",
        userMessage: "Klik [✅ Ya, Simpan]",
        systemAction: `Gagal Simpan: ${saveErr?.message || "Error"}`,
        status: "GAGAL",
      });
      const itemsCount = draft.action_type === "SPPG_ORDER" ? draft.payload?.items?.length || 0 : undefined;
      await safeEditMessageText(
        ctx,
        `❌ Gagal menyimpan ke Spreadsheet: ${saveErr?.message || saveErr}\n\nSilakan coba tekan tombol <b>Simpan</b> kembali.`,
        {
          parse_mode: "HTML",
          reply_markup: buildDraftConfirmationKeyboard(draftId, draft.action_type, itemsCount),
        }
      );
    }
  });

  // [🔍 Lihat Rincian Bahan]
  bCtx.bot.callbackQuery(/^v:viewitems:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await bCtx.pendingRepo.getById(draftId);
    if (!draft || draft.status !== "PENDING" || draft.action_type !== "SPPG_ORDER") {
      return handleExpiredOrMissingDraft(bCtx, ctx, draft);
    }

    await ctx.answerCallbackQuery();
    const detailText = renderSppgOrderItemsDetail(draft.payload);
    await safeEditMessageText(ctx, detailText, {
      parse_mode: "HTML",
      reply_markup: buildBackToDraftKeyboard(draftId),
    });
  });

  // [✏️ Koreksi Draf]
  bCtx.bot.callbackQuery(/^v:edit:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await bCtx.pendingRepo.getById(draftId);
    if (!draft || draft.status !== "PENDING") {
      return handleExpiredOrMissingDraft(bCtx, ctx, draft);
    }

    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({
      reply_markup: buildEditSubmenuKeyboard(draftId, draft.action_type),
    });
  });

  // [🔙 Kembali ke Draf]
  bCtx.bot.callbackQuery(/^v:sub:back:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await bCtx.pendingRepo.getById(draftId);
    if (!draft || draft.status !== "PENDING") {
      return handleExpiredOrMissingDraft(bCtx, ctx, draft);
    }

    const state = bCtx.getState(ctx.from.id);
    if (state.promptMsgId && ctx.chat) {
      await ctx.api.deleteMessage(ctx.chat.id, state.promptMsgId).catch(() => { });
      state.promptMsgId = undefined;
    }
    state.editingField = null;

    if (draft.action_type === "SPPG_ORDER" && draft.payload?.items?.length) {
      const computedTotal = draft.payload.items.reduce(
        (sum: number, it: any) => sum + (Number(it.qty) * Number(it.price) || Number(it.total_price) || 0),
        0
      );
      if (computedTotal > 0) {
        draft.payload.total_amount = computedTotal;
        await bCtx.pendingRepo.updatePayload(draftId, draft.payload);
      }
    }

    const itemsCount = draft.action_type === "SPPG_ORDER" ? draft.payload?.items?.length || 0 : undefined;
    const draftCard =
      draft.action_type === "SPPG_ORDER"
        ? renderSppgOrderDraftCard(draft.payload, draftId, draft.status)
        : renderSupplierExpenseDraftCard(draft.payload, draftId, draft.status, draft.media_url);

    await ctx.answerCallbackQuery();
    await safeEditMessageText(ctx, draftCard, {
      parse_mode: "HTML",
      reply_markup: getDraftConfirmationReplyMarkup(draftId, draft.action_type, draft.payload, itemsCount),
    });
  });

  // [🔄 Ubah Jenis Draf: Pendapatan <-> Belanja]
  bCtx.bot.callbackQuery(/^v:sub:switch_type:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await bCtx.pendingRepo.getById(draftId);
    if (!draft || draft.status !== "PENDING") {
      return handleExpiredOrMissingDraft(bCtx, ctx, draft);
    }

    if (!ctx.from) return;
    const state = bCtx.getState(ctx.from.id);
    if (state.promptMsgId && ctx.chat) {
      await ctx.api.deleteMessage(ctx.chat.id, state.promptMsgId).catch(() => {});
      state.promptMsgId = undefined;
    }
    state.editingField = null;

    let hasMultiplePagu = false;
    if (draft.action_type === "SPPG_ORDER") {
      // Switch SPPG_ORDER -> SUPPLIER_EXPENSE
      const p = draft.payload;
      const convertedPayload: any = {
        type: "expense",
        supplier_name: p.items?.find((it: any) => it.supplier_target && it.supplier_target !== "Lainnya")?.supplier_target || "Supplier Rekanan",
        receipt_no: p.order_no || "",
        date: p.order_date || new Date().toISOString().slice(0, 10),
        sppg_ref_no: p.order_no || "",
        items: (p.items || []).map((it: any) => ({
          item_name: it.item_name || "Bahan Belanja",
          qty: Number(it.qty) || 1,
          unit: it.unit || "unit",
          price: Number(it.price) || 0,
          total_price: Number(it.total_price) || (Number(it.qty) * Number(it.price)) || 0,
          supplier_name: it.supplier_target || "Supplier Rekanan",
        })),
        subtotal: Number(p.total_amount) || 0,
        discount: 0,
        tax: 0,
        total_amount: Number(p.total_amount) || 0,
        payment_method: "Cash",
      };

      hasMultiplePagu = await enrichReceiptWithPaguContext(bCtx.unitConfig.spreadsheetId, convertedPayload);

      draft.action_type = "SUPPLIER_EXPENSE";
      draft.payload = convertedPayload;

      await bCtx.pendingRepo.updateActionType(draftId, "SUPPLIER_EXPENSE");
      await bCtx.pendingRepo.updatePayload(draftId, convertedPayload);

      await ctx.answerCallbackQuery({
        text: "✅ Draf berhasil diubah menjadi Belanja Supplier!",
      });

      const draftCard = renderSupplierExpenseDraftCard(convertedPayload, draftId, draft.status, draft.media_url);
      await safeEditMessageText(ctx, draftCard, {
        parse_mode: "HTML",
        reply_markup: getDraftConfirmationReplyMarkup(draftId, "SUPPLIER_EXPENSE", convertedPayload, undefined, hasMultiplePagu),
      });
    } else {
      // Switch SUPPLIER_EXPENSE -> SPPG_ORDER
      if (await bCtx.isCallerMember(ctx.from.id)) {
        return ctx.answerCallbackQuery({
          text: "⛔ Akses Dibatasi: Staf Operasional hanya berwenang mencatat Belanja.",
          show_alert: true,
        });
      }

      const p = draft.payload;
      const convertedPayload: any = {
        type: "income",
        sppg_unit: bCtx.unitConfig.name,
        order_no: p.receipt_no || p.sppg_ref_no || "PO-AUTO",
        order_date: p.date || new Date().toISOString().slice(0, 10),
        arrival_date: p.date || new Date().toISOString().slice(0, 10),
        items: (p.items || []).map((it: any, idx: number) => ({
          no: idx + 1,
          item_name: it.item_name || "Bahan Makanan",
          qty: Number(it.qty) || 1,
          unit: it.unit || "KG",
          price: Number(it.price) || 0,
          total_price: Number(it.total_price) || (Number(it.qty) * Number(it.price)) || 0,
          supplier_target: it.supplier_name || "Lainnya",
        })),
        total_amount: Number(p.total_amount) || 0,
        signed_by: "Kepala SPPG",
      };

      draft.action_type = "SPPG_ORDER";
      draft.payload = convertedPayload;

      await bCtx.pendingRepo.updateActionType(draftId, "SPPG_ORDER");
      await bCtx.pendingRepo.updatePayload(draftId, convertedPayload);

      await ctx.answerCallbackQuery({
        text: "✅ Draf berhasil diubah menjadi Pendapatan PO!",
      });

      const itemsCount = convertedPayload.items?.length || 0;
      const draftCard = renderSppgOrderDraftCard(convertedPayload, draftId, draft.status);
      await safeEditMessageText(ctx, draftCard, {
        parse_mode: "HTML",
        reply_markup: getDraftConfirmationReplyMarkup(draftId, "SPPG_ORDER", convertedPayload, itemsCount),
      });
    }
  });

  // [❌ Batalkan Draf]
  bCtx.bot.callbackQuery(/^v:cancel:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    mediaBufferCache.delete(draftId);
    const draft = await bCtx.pendingRepo.getById(draftId);
    if (!draft || draft.status !== "PENDING") {
      return handleExpiredOrMissingDraft(bCtx, ctx, draft);
    }

    await bCtx.pendingRepo.updateStatus(draftId, "CANCELLED");
    cancelDraftAutoExpiry(draftId);
    await ctx.answerCallbackQuery({ text: "Draf berhasil dibatalkan." });

    (ctx as any)._activityLogged = true;

    const cancelAction = "Draf dibatalkan oleh pengguna (Berkas tidak disimpan)";
    const userMsgDesc = "Klik [Batalkan Draf]";
    const updated = await bCtx.updateActivityStatus(draftId, "DIBATALKAN", cancelAction, userMsgDesc);
    if (!updated) {
      await bCtx.logActivity(ctx, {
        mediaType: "Tombol",
        userMessage: userMsgDesc,
        systemAction: cancelAction,
        refId: draftId,
        status: "DIBATALKAN",
      });
    }

    if (ctx.from) {
      const state = bCtx.getState(ctx.from.id);
      state.activeDraftId = undefined;
      state.activeDraftMsgId = undefined;
    }

    const cancelCard =
      draft.action_type === "SPPG_ORDER"
        ? renderSppgOrderDraftCard(draft.payload, draftId, "CANCELLED")
        : renderSupplierExpenseDraftCard(draft.payload, draftId, "CANCELLED", draft.media_url);

    await safeEditMessageText(ctx, cancelCard, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  // [💰 Ganti Total Nominal]
  bCtx.bot.callbackQuery(/^v:sub:nominal:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await bCtx.pendingRepo.getById(draftId);
    if (!draft || draft.status !== "PENDING") {
      return handleExpiredOrMissingDraft(bCtx, ctx, draft);
    }
    if (draft.action_type === "SPPG_ORDER") {
      return ctx.answerCallbackQuery({
        text: "ℹ️ Total Pagu dihitung otomatis dari rincian bahan (Kuantitas × Harga).",
        show_alert: true,
      });
    }

    const state = bCtx.getState(ctx.from.id);
    state.activeDraftId = draftId;
    state.editingField = "nominal";

    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({
      reply_markup: buildCancelInputKeyboard(draftId),
    });

    const prompt = await ctx.reply(
      "Ketik <b>nominal baru</b> (contoh: <code>8900000</code> atau <code>8.900.000</code>):",
      { parse_mode: "HTML" }
    );
    state.promptMsgId = prompt.message_id;
  });

  // [📄 Ganti No PO (Khusus Pagu Induk)]
  bCtx.bot.callbackQuery(/^v:sub:orderno:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await bCtx.pendingRepo.getById(draftId);
    if (!draft || draft.status !== "PENDING") {
      return handleExpiredOrMissingDraft(bCtx, ctx, draft);
    }

    const state = bCtx.getState(ctx.from.id);
    state.activeDraftId = draftId;
    state.editingField = "orderno";

    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({
      reply_markup: buildCancelInputKeyboard(draftId),
    });

    const prompt = await ctx.reply(
      "Ketik <b>No Pesanan / PO baru</b> (contoh: <code>PO-2026/09/SPPG2-01</code>):",
      { parse_mode: "HTML" }
    );
    state.promptMsgId = prompt.message_id;
  });

  // [📅 Ganti Tanggal]
  bCtx.bot.callbackQuery(/^v:sub:date:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await bCtx.pendingRepo.getById(draftId);
    if (!draft || draft.status !== "PENDING") {
      return handleExpiredOrMissingDraft(bCtx, ctx, draft);
    }

    const state = bCtx.getState(ctx.from.id);
    state.activeDraftId = draftId;
    state.editingField = "date";

    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({
      reply_markup: buildCancelInputKeyboard(draftId),
    });

    const prompt = await ctx.reply(
      "Ketik <b>tanggal baru</b> (format YYYY-MM-DD, contoh: <code>2026-09-11</code>):",
      { parse_mode: "HTML" }
    );
    state.promptMsgId = prompt.message_id;
  });

  // [✍️ Ganti Penandatangan (Khusus Pagu Induk)]
  bCtx.bot.callbackQuery(/^v:sub:signer:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await bCtx.pendingRepo.getById(draftId);
    if (!draft || draft.status !== "PENDING") {
      return handleExpiredOrMissingDraft(bCtx, ctx, draft);
    }

    const state = bCtx.getState(ctx.from.id);
    state.activeDraftId = draftId;
    state.editingField = "signer";

    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({
      reply_markup: buildCancelInputKeyboard(draftId),
    });

    const prompt = await ctx.reply(
      "Ketik <b>nama penandatangan baru</b> (contoh: <i>Ka. SPPG</i> atau <i>Budi Santoso</i>):",
      { parse_mode: "HTML" }
    );
    state.promptMsgId = prompt.message_id;
  });

  // [🏪 Ganti Nama Toko/Unit]
  bCtx.bot.callbackQuery(/^v:sub:name:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await bCtx.pendingRepo.getById(draftId);
    if (!draft || draft.status !== "PENDING") {
      return handleExpiredOrMissingDraft(bCtx, ctx, draft);
    }

    const state = bCtx.getState(ctx.from.id);
    state.activeDraftId = draftId;
    state.editingField = "name";

    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({
      reply_markup: buildCancelInputKeyboard(draftId),
    });

    const promptText =
      draft.action_type === "SPPG_ORDER"
        ? "Ketik <b>nama unit baru</b> (contoh: <i>SPPG Buangin</i>):"
        : "Ketik <b>nama supplier atau unit baru</b> (contoh: <i>Hj Muliadi</i>):";

    const prompt = await ctx.reply(promptText, {
      parse_mode: "HTML",
    });
    state.promptMsgId = prompt.message_id;
  });

  // [📦 Masukkan / Ganti Barang Belanja & Qty]
  bCtx.bot.callbackQuery(/^v:sub:item:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await bCtx.pendingRepo.getById(draftId);
    if (!draft || draft.status !== "PENDING") {
      return handleExpiredOrMissingDraft(bCtx, ctx, draft);
    }

    const state = bCtx.getState(ctx.from.id);
    state.activeDraftId = draftId;
    state.editingField = "item";

    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({
      reply_markup: buildCancelInputKeyboard(draftId),
    });

    const prompt = await ctx.reply(
      "Ketik <b>rincian barang & kuantitas</b> (contoh: <code>telur ayam 20 rak</code> atau <code>telur ayam 20 rak 600rb</code>):",
      { parse_mode: "HTML" }
    );
    state.promptMsgId = prompt.message_id;
  });

  // [🔄 Pilih Alokasi Anggaran]
  bCtx.bot.callbackQuery(/^v:pagu_pick:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await bCtx.pendingRepo.getById(draftId);
    if (!draft || draft.status !== "PENDING") {
      return handleExpiredOrMissingDraft(bCtx, ctx, draft);
    }

    const orders = await googleSheetsService.getPaguOrders(bCtx.unitConfig.spreadsheetId);
    await ctx.answerCallbackQuery();
    if (orders.length === 0) {
      return ctx.reply("ℹ️ Belum ada Nota Pesanan SPPG (Pagu) yang terdaftar di Tab 02.", { parse_mode: "HTML" });
    }

    const candidates = orders.map((o) => ({
      sppg_ref_no: o.orderNo,
      order_date: o.orderDate,
      item_name: "Menu",
      remaining_qty: 0,
      unit: "",
      supplier_name: o.notes || "SPPG",
    }));

    await ctx.editMessageReplyMarkup({
      reply_markup: buildPaguSelectorKeyboard(draftId, candidates),
    });
  });

  // [📅 Set Alokasi Pagu Anggaran]
  bCtx.bot.callbackQuery(/^v:pagu_set:(.+):(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const targetPagu = ctx.match[2];
    const draft = await bCtx.pendingRepo.getById(draftId);
    if (!draft || draft.status !== "PENDING") {
      return handleExpiredOrMissingDraft(bCtx, ctx, draft);
    }

    draft.payload.sppg_ref_no = targetPagu;
    draft.payload.paguSelectionRequired = false;
    await enrichReceiptWithPaguContext(bCtx.unitConfig.spreadsheetId, draft.payload);

    await bCtx.pendingRepo.updatePayload(draftId, draft.payload);
    await ctx.answerCallbackQuery({
      text: targetPagu === "-" ? "Alokasi diset ke Belanja Tambahan (Non-Pagu)" : `Alokasi diset ke PO ${targetPagu}`
    });

    (ctx as any)._activityLogged = true;
    const paguLabel = targetPagu === "-" ? "Belanja Tambahan (Non-Pagu)" : `PO ${targetPagu}`;
    await bCtx.updateActivityStatus(
      draftId,
      "PENDING",
      `Alokasi disetel: ${paguLabel}`,
      `Pilih Alokasi: ${paguLabel}`
    ).catch(() => {});

    const cardText = renderSupplierExpenseDraftCard(draft.payload, draftId, "PENDING", draft.media_url);
    const hasMultiple = (draft.payload as any)?.paguContext?.candidates_count > 1;
    await safeEditMessageText(ctx, cardText, {
      parse_mode: "HTML",
      reply_markup: getDraftConfirmationReplyMarkup(draftId, draft.action_type, draft.payload, undefined, hasMultiple),
    });
  });

  // [📋 Bukan Di Atas - Tampilkan Semua PO]
  bCtx.bot.callbackQuery(/^v:pagu_browse:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await bCtx.pendingRepo.getById(draftId);
    if (!draft || draft.status !== "PENDING") {
      return handleExpiredOrMissingDraft(bCtx, ctx, draft);
    }
    await ctx.answerCallbackQuery();
    const allOrders = draft.payload?.paguCandidates || [];
    await ctx.editMessageReplyMarkup({
      reply_markup: buildPaguBrowseKeyboard(draftId, allOrders),
    });
  });

  // [🔙 Kembali ke Rekomendasi Prioritas]
  bCtx.bot.callbackQuery(/^v:pagu_back_rec:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await bCtx.pendingRepo.getById(draftId);
    if (!draft || draft.status !== "PENDING") {
      return handleExpiredOrMissingDraft(bCtx, ctx, draft);
    }
    await ctx.answerCallbackQuery();
    const candidates = draft.payload?.paguCandidates || [];
    await ctx.editMessageReplyMarkup({
      reply_markup: buildPaguPromptKeyboard(draftId, candidates),
    });
  });

  // [📄 Ganti No Pagu dari Submenu Koreksi]
  bCtx.bot.callbackQuery(/^v:sub:pagu:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await bCtx.pendingRepo.getById(draftId);
    if (!draft || draft.status !== "PENDING") {
      return handleExpiredOrMissingDraft(bCtx, ctx, draft);
    }

    const firstItem = draft.payload?.items?.[0];
    const candidates = firstItem?.item_name
      ? await googleSheetsService.getPaguCandidatesForCommodity(bCtx.unitConfig.spreadsheetId, firstItem.item_name)
      : [];

    await ctx.answerCallbackQuery();
    if (candidates.length > 0) {
      await ctx.editMessageReplyMarkup({
        reply_markup: buildPaguSelectorKeyboard(draftId, candidates),
      });
    } else {
      const state = bCtx.getState(ctx.from.id);
      state.activeDraftId = draftId;
      state.editingField = "pagu";

      await ctx.editMessageReplyMarkup({
        reply_markup: buildCancelInputKeyboard(draftId),
      });

      const prompt = await ctx.reply(
        "Ketik <b>No SPPG Anggaran</b> (contoh: <code>03/31/08/26</code> atau ketik <code>-</code> untuk belanja mandiri):",
        { parse_mode: "HTML" }
      );
      state.promptMsgId = prompt.message_id;
    }
  });

  // [💵 / 💳 Pilih Metode Pembayaran Draf]
  bCtx.bot.callbackQuery(/^v:draft:pay:(cash|transfer):(.+)$/, async (ctx) => {
    const payChoice = ctx.match[1];
    const draftId = ctx.match[2];
    const draft = await bCtx.pendingRepo.getById(draftId);
    if (!draft || draft.status !== "PENDING") {
      return handleExpiredOrMissingDraft(bCtx, ctx, draft);
    }

    const methodName = payChoice === "cash" ? "Tunai" : "Transfer";
    draft.payload.payment_method = methodName;
    await bCtx.pendingRepo.updatePayload(draftId, draft.payload);

    await ctx.answerCallbackQuery({
      text: `✅ Metode pembayaran diset ke: ${methodName}`,
    });

    (ctx as any)._activityLogged = true;
    await bCtx.updateActivityStatus(
      draftId,
      "PENDING",
      `Metode disetel ke ${methodName}`,
      `Pilih Metode: ${methodName}`
    ).catch(() => {});

    const cardText = renderSupplierExpenseDraftCard(draft.payload, draftId, "PENDING", draft.media_url);
    const hasMultiple = (draft.payload as any)?.paguContext?.candidates_count > 1;
    await safeEditMessageText(ctx, cardText, {
      parse_mode: "HTML",
      reply_markup: getDraftConfirmationReplyMarkup(draftId, draft.action_type, draft.payload, undefined, hasMultiple),
    });
  });

  // [💳 Ganti Metode Bayar dari Submenu Koreksi]
  bCtx.bot.callbackQuery(/^v:sub:method:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await bCtx.pendingRepo.getById(draftId);
    if (!draft || draft.status !== "PENDING") {
      return handleExpiredOrMissingDraft(bCtx, ctx, draft);
    }

    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({
      reply_markup: buildPaymentMethodPickerKeyboard(draftId),
    });
  });
}
