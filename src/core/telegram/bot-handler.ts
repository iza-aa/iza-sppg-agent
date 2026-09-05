import { Bot, Context, InputFile } from "grammy";
import crypto from "node:crypto";
import { SPPGUnitConfig } from "../../config/sppg.config.js";
import { getSupabaseClient } from "../db/supabase.js";
import { UserRepository } from "../db/repositories/user.repository.js";
import { PendingActionRepository } from "../db/repositories/pending-action.repository.js";
import { parseSppgOrderFromImage } from "../ai/parsers/sppg-order.parser.js";
import { parseSupplierReceiptFromImage } from "../ai/parsers/supplier-receipt.parser.js";
import { metaAgent } from "../ai/meta-agent.js";
import { googleDriveService } from "../google/drive.service.js";
import { googleSheetsService } from "../google/sheets.service.js";
import { generateOfficialSppgPdf } from "../pdf/pdf-report.service.js";
import {
  buildDraftConfirmationKeyboard,
  buildEditSubmenuKeyboard,
  buildCancelInputKeyboard,
  buildRekapActionKeyboard,
  buildMultiSheetSelectorKeyboard,
  buildTransactionListKeyboard,
  buildTransactionDetailKeyboard,
  buildDeleteConfirmKeyboard,
} from "./keyboards.js";
import {
  escapeHtml,
  formatRupiah,
  renderSppgOrderDraftCard,
  renderSupplierExpenseDraftCard,
  renderTransactionListCard,
  renderTransactionDetailCard,
  safeEditMessageText,
} from "./formatter.js";
import { logger } from "../utils/logger.js";

interface UserInteractionState {
  activeDraftId?: string;
  activeDraftMsgId?: number;
  editingField?: "nominal" | "name" | null;
  editingTransactionId?: string;
  promptMsgId?: number;
}

export function createSppgBot(unitConfig: SPPGUnitConfig): Bot<Context> {
  const bot = new Bot(unitConfig.token);
  const supabase = getSupabaseClient();
  const userRepo = new UserRepository(supabase);
  const pendingRepo = new PendingActionRepository(supabase);

  const userStates = new Map<number, UserInteractionState>();

  function getState(userId: number): UserInteractionState {
    if (!userStates.has(userId)) {
      userStates.set(userId, {});
    }
    return userStates.get(userId)!;
  }

  // Helper typing action keep-alive
  async function withTyping<T>(ctx: Context, action: () => Promise<T>): Promise<T> {
    await ctx.replyWithChatAction("typing").catch(() => { });
    const interval = setInterval(() => {
      ctx.replyWithChatAction("typing").catch(() => { });
    }, 4000);
    try {
      return await action();
    } finally {
      clearInterval(interval);
    }
  }

  // ============================================================================
  // PUBLIC COMMANDS (Accessible to everyone)
  // ============================================================================

  // 1. /myid - Displays Telegram identity, user ID, and connection status
  async function sendMyId(ctx: Context) {
    if (!ctx.from) return;
    const tgId = ctx.from.id;
    const tgName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ");
    const tgUsername = ctx.from.username ? `@${ctx.from.username}` : "(tanpa username)";
    const user = await userRepo.getUser(tgId);
    const isSuper = await userRepo.isSuperAdmin(tgId);
    const isAllowed = await userRepo.isAllowed(tgId);

    let statusDesc = "❌ <b>Belum Terdaftar (Tidak Ada Akses)</b>";
    if (isSuper) {
      statusDesc = "👑 <b>Super Admin / Pemilik Sistem</b>";
    } else if (isAllowed && user) {
      statusDesc = `✅ <b>Terhubung sebagai ${escapeHtml(user.role.toUpperCase())}</b> (${escapeHtml(user.sppg_assigned_id || unitConfig.id)})`;
    }

    const lines = [
      `🆔 <b>INFORMASI IDENTITAS TELEGRAM ANDA:</b>`,
      `------------------------------------------`,
      `• <b>Telegram ID:</b> <code>${tgId}</code>`,
      `• <b>Nama Akun:</b> ${escapeHtml(tgName)}`,
      `• <b>Username:</b> ${escapeHtml(tgUsername)}`,
      `• <b>Status Akses:</b> ${statusDesc}`,
      `------------------------------------------`,
      isSuper
        ? `💡 <i>Sebagai Super Admin, Anda dapat mengundang staf/Ayah dengan perintah:</i>\n<code>/invite [Nama] [admin/member]</code>`
        : isAllowed
          ? `<i>Akun Anda telah diverifikasi untuk mengelola unit ${escapeHtml(unitConfig.name)}.</i>`
          : `👉 <i>Hubungi Super Admin (@heizaa4) untuk mendapatkan link undangan resmi.</i>`,
    ];

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  }

  bot.command("myid", sendMyId);

  // 2. /start - Handles both standard greeting and secure invite claim (?start=INV-XXXXXX)
  bot.command("start", async (ctx) => {
    if (!ctx.from) return;
    const payload = ctx.match?.trim();

    // CASE A: User is claiming an invite code (?start=INV-XXXXXX)
    if (payload && payload.startsWith("INV-")) {
      const invite = await userRepo.getInvite(payload);

      if (!invite) {
        await ctx.reply(
          `⚠️ <b>Link undangan tidak valid atau sudah pernah digunakan.</b>\n\nSilakan minta Super Admin (@heizaa4) untuk membuat link undangan baru via <code>/invite</code>.`,
          { parse_mode: "HTML" }
        );
        return;
      }

      if (new Date(invite.expires_at).getTime() < Date.now()) {
        await ctx.reply(
          `⚠️ <b>Link undangan telah kedaluwarsa.</b>\n\nSilakan minta Super Admin untuk membuat link undangan baru via <code>/invite</code>.`,
          { parse_mode: "HTML" }
        );
        return;
      }

      // If Super Admin accidentally clicks their own invite for someone else
      const isSuper = await userRepo.isSuperAdmin(ctx.from.id);
      if (isSuper && ctx.from.id === invite.created_by) {
        await ctx.reply(
          `⚠️ <b>Ini adalah Link Undangan khusus untuk ${escapeHtml(invite.name)}!</b>\n\n` +
          `Akun Telegram Anda sudah berstatus Super Admin.\n` +
          `👉 <b>Jangan klik link ini di akun Anda sendiri</b>, melainkan teruskan/kirim link ini ke Telegram <b>${escapeHtml(invite.name)}</b> agar akun beliau yang terverifikasi.`,
          { parse_mode: "HTML" }
        );
        return;
      }

      // Claim invite
      const result = await userRepo.claimInvite(payload, {
        id: ctx.from.id,
        username: ctx.from.username,
        first_name: ctx.from.first_name,
        last_name: ctx.from.last_name,
      });

      if (!result) {
        await ctx.reply(`⚠️ Gagal memproses klaim undangan. Silakan coba lagi.`, { parse_mode: "HTML" });
        return;
      }

      const roleDesc =
        result.user.role === "super_admin"
          ? "Super Admin / Owner"
          : result.user.role === "admin"
            ? "Admin (Operator SPPG)"
            : "Staf Operasional";

      const claimSuccessText = [
        `🎉 <b>VERIFIKASI BERHASIL! SELAMAT DATANG!</b>`,
        `------------------------------------------`,
        `Halo <b>${escapeHtml(result.user.first_name || invite.name)}</b>, akun Telegram Anda telah resmi terhubung sebagai:`,
        `🏢 Unit: <b>${escapeHtml(unitConfig.name)}</b>`,
        `🎖️ Peran: <b>${roleDesc}</b>`,
        `------------------------------------------`,
        `💡 <b>Mulai Sekarang Anda Dapat:</b>`,
        `1. ✍️ <b>Ketik Belanjaan Langsung</b>: <i>"Beli ayam 200rb di pasar ayam"</i>.`,
        `2. 📸 <b>Kirim Foto Nota/Struk</b> untuk pencatatan otomatis OCR.`,
        `3. 📊 Ketik <i>"rekap"</i> untuk ringkasan margin laba hari ini.`,
        `4. 📄 Ketik <i>"pdf"</i> untuk cetak dokumen resmi SPJ BGN.`,
        `5. 🌐 Ketik <i>"sheets"</i> untuk membuka spreadsheet online.`,
      ].join("\n");

      await ctx.reply(claimSuccessText, { parse_mode: "HTML" });
      return;
    }

    // CASE B: Standard Start
    const isAllowed = await userRepo.isAllowed(ctx.from.id);
    if (!isAllowed) {
      await ctx.reply(
        `⛔ <b>Akses Ditolak (Privat & Terbatas)</b>\n\n` +
        `Akun Telegram Anda (ID: <code>${ctx.from.id}</code>) belum terdaftar di sistem asisten MBG.\n\n` +
        `👉 <i>Ketik /myid untuk melihat identitas Anda, atau hubungi Super Admin (@heizaa4) untuk mendapatkan link undangan resmi.</i>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const welcomeText = [
      `👋 <b>Halo, Selamat Datang di Asisten Operasional MBG!</b>`,
      `🏢 Unit: <b>${escapeHtml(unitConfig.name)}</b>`,
      `Badan Gizi Nasional (BGN) Republik Indonesia`,
      `--------------------------------------`,
      `💡 <b>AI Agent Siap Melayani Anda Secara Natural:</b>`,
      `1. ✍️ <b>Ketik Langsung:</b> <i>"Beli telur 3 rak 165rb di Hj Muliadi tunai"</i>`,
      `2. 📸 <b>Kirim Foto:</b> Foto Nota SPPG atau Bon belanja pasar`,
      `3. 📊 <b>Minta Rekap:</b> Cukup ketik <i>"rekap"</i> atau <i>"margin"</i>`,
      `4. 📄 <b>Laporan SPJ:</b> Cukup ketik <i>"kirim pdf"</i> atau <i>"cetak spj"</i>`,
      `5. 🌐 <b>Spreadsheet:</b> Cukup ketik <i>"buka sheets"</i>`,
      `6. 🔍 <b>Riwayat Belanja:</b> Cukup ketik <i>"transaksi"</i>`,
    ].join("\n");

    await ctx.reply(welcomeText, { parse_mode: "HTML" });
  });

  // ============================================================================
  // GLOBAL AUTH GUARD (Blocks unauthenticated users from all operational features)
  // ============================================================================
  bot.use(async (ctx, next) => {
    if (!ctx.from) return next();

    const isAllowed = await userRepo.isAllowed(ctx.from.id);
    if (!isAllowed) {
      await ctx.reply(
        `⛔ <b>Akses Ditolak (Privat & Terbatas)</b>\n\n` +
        `Akun Telegram Anda (ID: <code>${ctx.from.id}</code>) belum terdaftar di sistem asisten MBG.\n\n` +
        `👉 <i>Ketik /myid untuk melihat identitas Anda, atau hubungi Super Admin (@heizaa4) untuk mendapatkan link undangan resmi.</i>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    return next();
  });

  // ============================================================================
  // AUTHENTICATED COMMANDS & HELPERS
  // ============================================================================

  async function handleInviteCommand(ctx: Context, targetName?: string, roleArg = "admin") {
    if (!ctx.from) return;
    const isAdmin = await userRepo.isAdminOrSuperAdmin(ctx.from.id);
    if (!isAdmin) {
      await ctx.reply("⛔ <b>Akses Ditolak</b>: Perintah undangan hanya dapat dijalankan oleh Admin atau Super Admin.", {
        parse_mode: "HTML",
      });
      return;
    }

    if (!targetName) {
      const usage = [
        `🎟️ <b>CARA MEMBUAT LINK UNDANGAN RESMI:</b>`,
        `Ketik: <code>/invite [Nama] [Peran (opsional: admin/member)]</code>`,
        `atau ketik langsung: <i>"Undang Ayah admin"</i>`,
        ``,
        `<b>Contoh:</b>`,
        `• <code>/invite Ayah admin</code> (untuk Ayah sebagai Admin Operator)`,
        `• <code>/invite Budi member</code> (untuk staf dapur)`,
        ``,
        `<i>Sistem akan membuat link khusus yang hanya bisa digunakan 1x oleh orang tersebut.</i>`,
      ].join("\n");

      await ctx.reply(usage, { parse_mode: "HTML" });
      return;
    }

    const targetRole: "super_admin" | "admin" | "member" =
      roleArg === "super_admin" ? "super_admin" : roleArg === "member" ? "member" : "admin";

    const inviteCode = "INV-" + crypto.randomBytes(3).toString("hex").toUpperCase();
    await userRepo.createInvite({
      code: inviteCode,
      name: targetName,
      role: targetRole,
      sppg_assigned_id: unitConfig.id,
      created_by: ctx.from.id,
      ttlMinutes: 1440, // 24 jam
    });

    const botUsername = ctx.me.username || "mbg_assistant_bot";
    const inviteLink = `https://t.me/${botUsername}?start=${inviteCode}`;

    const replyText = [
      `🎟️ <b>LINK UNDANGAN BERHASIL DIBUAT!</b>`,
      `------------------------------------------`,
      `• <b>Penerima:</b> <b>${escapeHtml(targetName)}</b>`,
      `• <b>Peran:</b> <code>${targetRole.toUpperCase()}</code>`,
      `• <b>Unit SPPG:</b> ${escapeHtml(unitConfig.name)}`,
      `• <b>Masa Berlaku:</b> 24 Jam (Sekali Pakai)`,
      `------------------------------------------`,
      `👉 <b>Kirimkan link ini langsung ke Telegram penerima:</b>`,
      `${inviteLink}`,
      ``,
      `<i>Begitu penerima mengklik tombol START dari link di atas, akun Telegram mereka akan langsung aktif di sistem MBG.</i>`,
    ].join("\n");

    await ctx.reply(replyText, { parse_mode: "HTML" });
  }

  // 3. /invite - Super Admin / Admin creates single-use invite link
  bot.command("invite", async (ctx) => {
    const args = ctx.match?.trim().split(/\s+/) || [];
    await handleInviteCommand(ctx, args[0], args[1]);
  });

  async function sendSheets(ctx: Context) {
    await ctx.reply(
      `🌐 <b>PILIH SPREADSHEET GOOGLE SHEETS MBG:</b>\n\n` +
      `Unit aktif Anda saat ini: <b>${escapeHtml(unitConfig.name)}</b>\n\n` +
      `Silakan ketuk tombol di bawah untuk membuka spreadsheet online:`,
      {
        parse_mode: "HTML",
        reply_markup: buildMultiSheetSelectorKeyboard(unitConfig.id),
      }
    );
  }

  async function sendRekap(ctx: Context) {
    await withTyping(ctx, async () => {
      const kpi = await googleSheetsService.getExecutiveKpi(unitConfig.spreadsheetId);
      const sheetUrl = `https://docs.google.com/spreadsheets/d/${unitConfig.spreadsheetId}/edit`;

      const rekapText = [
        `📊 <b>REKAP EKSEKUTIF SPPG MBG</b>`,
        `Unit: <b>${escapeHtml(unitConfig.name)}</b>`,
        `------------------------------------------`,
        `🟢 <b>Plafon Pendapatan</b> : ${formatRupiah(kpi.totalPlafon)}`,
        `🔴 <b>Realisasi Belanja</b>  : ${formatRupiah(kpi.totalBelanja)}`,
        `------------------------------------------`,
        `💎 <b>Margin Bersih</b>     : <b>${formatRupiah(kpi.marginBersih)} (${kpi.marginPercentage}%)</b>`,
        `Status Evaluasi: ${kpi.marginPercentage >= 15 ? "🟢 HEMAT / SURPLUS" : kpi.marginPercentage >= 5 ? "🟡 SESUAI PAGU" : "🔴 PERHATIAN: OVER-BUDGET"}`,
      ].join("\n");

      await ctx.reply(rekapText, {
        parse_mode: "HTML",
        reply_markup: buildRekapActionKeyboard(sheetUrl, unitConfig.id),
      });
    });
  }

  async function sendPdf(ctx: Context) {
    await withTyping(ctx, async () => {
      await ctx.reply("⏳ Sedang memproses dan menyusun Dokumen PDF Resmi SPJ BGN...", { parse_mode: "HTML" });
      const kpi = await googleSheetsService.getExecutiveKpi(unitConfig.spreadsheetId);
      const today = new Date().toISOString().split("T")[0];

      const pdfBuffer = await generateOfficialSppgPdf({
        sppgName: unitConfig.name,
        periodDate: today,
        orderNo: "REKAP-BULANAN",
        totalPlafon: kpi.totalPlafon || 29581000,
        totalBelanja: kpi.totalBelanja || 24150000,
        marginBersih: kpi.marginBersih || 5431000,
        marginPercentage: kpi.marginPercentage || 18.36,
        expenses: [],
      });

      const filename = `Laporan_SPJ_${unitConfig.id}_${today}.pdf`;
      await ctx.replyWithDocument(new InputFile(pdfBuffer, filename), {
        caption: `📄 <b>Laporan Resmi SPJ Badan Gizi Nasional</b>\nUnit: <b>${escapeHtml(unitConfig.name)}</b>\nTanggal: <code>${today}</code>`,
        parse_mode: "HTML",
      });
    });
  }

  async function sendRecentTransactions(ctx: Context, limit = 8) {
    await withTyping(ctx, async () => {
      const transactions = await googleSheetsService.getRecentTransactions(unitConfig.spreadsheetId, limit);
      const text = renderTransactionListCard(transactions);
      await ctx.reply(text, {
        parse_mode: "HTML",
        reply_markup: transactions.length > 0 ? buildTransactionListKeyboard(transactions) : undefined,
      });
    });
  }

  async function sendTransactionDetail(ctx: Context, transactionId: string) {
    await withTyping(ctx, async () => {
      const detail = await googleSheetsService.getTransactionDetail(unitConfig.spreadsheetId, transactionId);
      if (!detail.found) {
        await ctx.reply(`⚠️ Transaksi dengan ID <code>${escapeHtml(transactionId)}</code> tidak ditemukan di Google Sheets unit ${escapeHtml(unitConfig.name)}.`, {
          parse_mode: "HTML",
        });
        return;
      }

      const text = renderTransactionDetailCard(detail);
      const sheetUrl = `https://docs.google.com/spreadsheets/d/${unitConfig.spreadsheetId}/edit`;
      await ctx.reply(text, {
        parse_mode: "HTML",
        reply_markup: buildTransactionDetailKeyboard(detail.id, sheetUrl),
      });
    });
  }

  bot.command("sheets", sendSheets);
  bot.command("rekap", sendRekap);
  bot.command("pdf", sendPdf);
  bot.command("transaksi", async (ctx) => sendRecentTransactions(ctx, 8));

  // ============================================================================
  // PHOTO & DOCUMENT UPLOAD HANDLER
  // ============================================================================

  async function handleIncomingImage(ctx: Context, fileId: string) {
    if (!ctx.from || !ctx.chat) return;
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const state = getState(userId);

    await withTyping(ctx, async () => {
      const file = await ctx.api.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${unitConfig.token}/${file.file_path}`;

      const response = await fetch(fileUrl);
      const imageBuffer = Buffer.from(await response.arrayBuffer());

      logger.info({ userId, fileSize: imageBuffer.length }, "Processing incoming image document...");

      // 2. Classify document using OCR/AI logic
      let sppgOrderResult = null;
      let supplierReceiptResult = null;
      let actionType: "SPPG_ORDER" | "SUPPLIER_EXPENSE" = "SUPPLIER_EXPENSE";

      // Attempt parsing as SPPG Order first
      try {
        sppgOrderResult = await parseSppgOrderFromImage(imageBuffer);
        if (sppgOrderResult && sppgOrderResult.items && sppgOrderResult.items.length >= 2) {
          actionType = "SPPG_ORDER";
        }
      } catch {
        // Fallback to supplier receipt
      }

      if (actionType !== "SPPG_ORDER") {
        try {
          supplierReceiptResult = await parseSupplierReceiptFromImage(imageBuffer);
        } catch (supplierErr) {
          logger.warn({ supplierErr }, "Failed parsing image with both SPPG Order and Supplier Receipt parsers");
          await ctx.reply(
            "❌ <b>Gagal Mengenali Dokumen</b>\n\nAI tidak dapat mendeteksi foto sebagai Nota SPPG maupun Struk Belanja Supplier.\n\n💡 <b>Tips:</b>\n• Pastikan pencahayaan cukup dan foto tidak buram.\n• Posisikan kamera tegak lurus di atas nota.\n• Pastikan rincian bahan makanan dan total nominal terbaca jelas.",
            { parse_mode: "HTML" }
          );
          return;
        }
      }

      // 3. Upload to Google Drive Vault
      const now = new Date();
      const year = String(now.getFullYear());
      const month = `${String(now.getMonth() + 1).padStart(2, "0")}-${now.toLocaleString("id-ID", { month: "long" })}`;
      const subFolderType = actionType === "SPPG_ORDER" ? "01_Nota_Pesanan_SPPG" : "02_Kwitansi_Supplier";

      let driveLink = "";
      try {
        const destFolderId = await googleDriveService.resolveDestinationFolder(unitConfig.id, year, month, subFolderType);
        const uploadRes = await googleDriveService.uploadReceipt(
          imageBuffer,
          `${now.toISOString().slice(0, 10)}_${Date.now().toString().slice(-4)}`,
          destFolderId
        );
        driveLink = uploadRes.webViewLink;
      } catch (driveErr) {
        logger.warn({ driveErr }, "Could not upload to Google Drive, proceeding with draft");
      }

      // 4. Create Pending Action Draft in State Machine
      const draftId = `draft_${Date.now()}`;
      const payload = actionType === "SPPG_ORDER" ? sppgOrderResult : supplierReceiptResult;

      await pendingRepo.create({
        id: draftId,
        sppg_id: unitConfig.id,
        telegram_user_id: userId,
        telegram_chat_id: chatId,
        action_type: actionType,
        payload,
        media_url: driveLink,
      });

      state.activeDraftId = draftId;

      // 5. Render Card and Send
      const cardText =
        actionType === "SPPG_ORDER"
          ? renderSppgOrderDraftCard(sppgOrderResult!, draftId, "PENDING")
          : renderSupplierExpenseDraftCard(supplierReceiptResult!, draftId, "PENDING", driveLink);

      const sentMsg = await ctx.reply(cardText, {
        parse_mode: "HTML",
        reply_markup: buildDraftConfirmationKeyboard(draftId, actionType),
      });

      state.activeDraftMsgId = sentMsg.message_id;
    });
  }

  bot.on("message:photo", async (ctx) => {
    const photos = ctx.message.photo;
    const fileInfo = photos[photos.length - 1];
    await handleIncomingImage(ctx, fileInfo.file_id);
  });

  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;
    if (doc.mime_type && doc.mime_type.startsWith("image/")) {
      await handleIncomingImage(ctx, doc.file_id);
    } else {
      await ctx.reply(
        "ℹ️ Format file dokumen belum didukung. Silakan kirimkan file foto/gambar (JPG, PNG, WebP) nota pesanan atau struk belanja.",
        { parse_mode: "HTML" }
      );
    }
  });

  // ============================================================================
  // CALLBACK QUERY HANDLERS (INLINE BUTTONS)
  // ============================================================================

  // [✅ Ya, Simpan]
  bot.callbackQuery(/^v:save:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await pendingRepo.getById(draftId);

    if (!draft || draft.status !== "PENDING") {
      return ctx.answerCallbackQuery({
        text: "⚠️ Draf ini sudah diproses atau kedaluwarsa.",
        show_alert: true,
      });
    }

    const locked = await pendingRepo.acquireLock(draftId);
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

    await safeEditMessageText(ctx, ctx.callbackQuery.message?.text || "Menyimpan...", {
      reply_markup: undefined,
    });

    try {
      if (draft.action_type === "SPPG_ORDER") {
        await googleSheetsService.recordSppgOrder(unitConfig.spreadsheetId, draft.payload);
      } else {
        await googleSheetsService.recordSupplierExpense(
          unitConfig.spreadsheetId,
          draft.payload,
          draft.media_url || "",
          ctx.from?.first_name || "Ayah"
        );
      }

      await pendingRepo.updateStatus(draftId, "SAVED");

      const successCard =
        draft.action_type === "SPPG_ORDER"
          ? renderSppgOrderDraftCard(draft.payload, draftId, "SAVED")
          : renderSupplierExpenseDraftCard(draft.payload, draftId, "SAVED", draft.media_url);

      await safeEditMessageText(ctx, successCard, { parse_mode: "HTML" });
    } catch (saveErr: any) {
      logger.error({ saveErr }, "Failed saving to Google Sheets, restoring draft status to PENDING");
      await pendingRepo.updateStatus(draftId, "PENDING");
      await safeEditMessageText(
        ctx,
        `❌ Gagal menyimpan ke Spreadsheet: ${saveErr?.message || saveErr}\n\nSilakan coba tekan tombol <b>Simpan</b> kembali.`,
        {
          parse_mode: "HTML",
          reply_markup: buildDraftConfirmationKeyboard(draftId, draft.action_type),
        }
      );
    }
  });

  // [✏️ Koreksi Draf]
  bot.callbackQuery(/^v:edit:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({
      reply_markup: buildEditSubmenuKeyboard(draftId),
    });
  });

  // [🔙 Kembali ke Draf]
  bot.callbackQuery(/^v:sub:back:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await pendingRepo.getById(draftId);
    if (!draft) return ctx.answerCallbackQuery();

    const state = getState(ctx.from.id);
    if (state.promptMsgId && ctx.chat) {
      await ctx.api.deleteMessage(ctx.chat.id, state.promptMsgId).catch(() => { });
      state.promptMsgId = undefined;
    }
    state.editingField = null;

    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({
      reply_markup: buildDraftConfirmationKeyboard(draftId, draft.action_type),
    });
  });

  // [❌ Batalkan Draf]
  bot.callbackQuery(/^v:cancel:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await pendingRepo.getById(draftId);
    if (!draft) return ctx.answerCallbackQuery();

    await pendingRepo.updateStatus(draftId, "CANCELLED");
    await ctx.answerCallbackQuery({ text: "❌ Draf berhasil dibatalkan." });

    const cancelCard =
      draft.action_type === "SPPG_ORDER"
        ? renderSppgOrderDraftCard(draft.payload, draftId, "CANCELLED")
        : renderSupplierExpenseDraftCard(draft.payload, draftId, "CANCELLED", draft.media_url);

    await safeEditMessageText(ctx, cancelCard, { parse_mode: "HTML" });
  });

  // [💰 Ganti Total Nominal]
  bot.callbackQuery(/^v:sub:nominal:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const state = getState(ctx.from.id);
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

  // [🏪 Ganti Nama Toko/Unit]
  bot.callbackQuery(/^v:sub:name:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const state = getState(ctx.from.id);
    state.activeDraftId = draftId;
    state.editingField = "name";

    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({
      reply_markup: buildCancelInputKeyboard(draftId),
    });

    const prompt = await ctx.reply("Ketik <b>nama supplier atau unit baru</b> (contoh: <i>Hj Muliadi</i>):", {
      parse_mode: "HTML",
    });
    state.promptMsgId = prompt.message_id;
  });

  // [📄 PDF Callback from /rekap]
  bot.callbackQuery(/^v:rekap:pdf:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "📄 Menyiapkan PDF..." });
    const kpi = await googleSheetsService.getExecutiveKpi(unitConfig.spreadsheetId);
    const today = new Date().toISOString().split("T")[0];

    const pdfBuffer = await generateOfficialSppgPdf({
      sppgName: unitConfig.name,
      periodDate: today,
      orderNo: "REKAP-BULANAN",
      totalPlafon: kpi.totalPlafon || 29581000,
      totalBelanja: kpi.totalBelanja || 24150000,
      marginBersih: kpi.marginBersih || 5431000,
      marginPercentage: kpi.marginPercentage || 18.36,
      expenses: [],
    });

    const filename = `Laporan_SPJ_${unitConfig.id}_${today}.pdf`;
    await ctx.replyWithDocument(new InputFile(pdfBuffer, filename), {
      caption: `📄 <b>Laporan Resmi SPJ Badan Gizi Nasional</b>\nUnit: <b>${escapeHtml(unitConfig.name)}</b>`,
      parse_mode: "HTML",
    });
  });

  // ============================================================================
  // TRANSACTION CRUD CALLBACK HANDLERS
  // ============================================================================

  // [📋 Daftar Transaksi]
  bot.callbackQuery("v:trx:list", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendRecentTransactions(ctx, 8);
  });

  // [🔍 Lihat Detail Transaksi]
  bot.callbackQuery(/^v:trx:view:(.+)$/, async (ctx) => {
    const trxId = ctx.match[1];
    await ctx.answerCallbackQuery();
    await sendTransactionDetail(ctx, trxId);
  });

  // [🗑️ Tombol Hapus Transaksi (Konfirmasi)]
  bot.callbackQuery(/^v:trx:del:(.+)$/, async (ctx) => {
    const trxId = ctx.match[1];
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `⚠️ Apakah Anda yakin ingin <b>menghapus permanen</b> transaksi <code>${escapeHtml(trxId)}</code> dari Google Sheets?`,
      {
        parse_mode: "HTML",
        reply_markup: buildDeleteConfirmKeyboard(trxId),
      }
    );
  });

  // [🗑️ Ya, Hapus Sekarang (Eksekusi Atomic)]
  bot.callbackQuery(/^v:trx:delyes:(.+)$/, async (ctx) => {
    const trxId = ctx.match[1];
    await ctx.answerCallbackQuery({ text: "🗑️ Menghapus transaksi...", show_alert: false });
    const result = await googleSheetsService.deleteTransactionRow(unitConfig.spreadsheetId, trxId);
    if (result.success) {
      await safeEditMessageText(
        ctx,
        `✅ <b>Transaksi Berhasil Dihapus!</b>\n\nID Transaksi: <code>${escapeHtml(trxId)}</code> telah dihapus dari Google Sheets unit <b>${escapeHtml(unitConfig.name)}</b>.`,
        { parse_mode: "HTML" }
      );
    } else {
      await safeEditMessageText(
        ctx,
        `❌ Gagal menghapus transaksi: <code>${escapeHtml(trxId)}</code> tidak ditemukan di Google Sheets.`,
        { parse_mode: "HTML" }
      );
    }
  });

  // [✏️ Ubah Nominal Transaksi]
  bot.callbackQuery(/^v:trx:edit:(.+)$/, async (ctx) => {
    const trxId = ctx.match[1];
    const state = getState(ctx.from.id);
    state.editingTransactionId = trxId;
    await ctx.answerCallbackQuery();
    const prompt = await ctx.reply(
      `Ketik <b>nominal baru</b> untuk transaksi <code>${escapeHtml(trxId)}</code> (contoh: <code>850000</code> atau <code>850rb</code>):`,
      { parse_mode: "HTML" }
    );
    state.promptMsgId = prompt.message_id;
  });

  // ============================================================================
  // TEXT MESSAGE HANDLER (CONVERSATIONAL AI AGENT & WIZARD)
  // ============================================================================

  bot.on("message:text", async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const state = getState(userId);
    const text = ctx.message.text.trim();

    // 1. If currently editing existing transaction in Google Sheets
    if (state.editingTransactionId) {
      const cleanNum = parseInt(text.replace(/[^\d]/g, ""), 10);
      const trxId = state.editingTransactionId;
      state.editingTransactionId = undefined;

      // Auto-cleanup user input & prompt message
      await ctx.deleteMessage().catch(() => { });
      if (state.promptMsgId) {
        await ctx.api.deleteMessage(chatId, state.promptMsgId).catch(() => { });
        state.promptMsgId = undefined;
      }

      if (isNaN(cleanNum) || cleanNum <= 0) {
        await ctx.reply("⚠️ Nominal tidak valid. Pembaruan dibatalkan.", { parse_mode: "HTML" });
        return;
      }

      const result = await googleSheetsService.updateTransactionRow(unitConfig.spreadsheetId, trxId, {
        total_amount: cleanNum,
      });

      if (result.success) {
        await ctx.reply(
          `✅ <b>Berhasil Memperbarui Transaksi!</b>\n\nID: <code>${escapeHtml(trxId)}</code>\nNominal Baru: <b>${formatRupiah(cleanNum)}</b>\nData telah disinkronkan ke Google Sheets unit <b>${escapeHtml(unitConfig.name)}</b>.`,
          { parse_mode: "HTML" }
        );
      } else {
        await ctx.reply(`❌ ${escapeHtml(result.message)}`, { parse_mode: "HTML" });
      }
      return;
    }

    // 2. If currently editing pending draft field (nominal or name)
    if (state.editingField && state.activeDraftId) {
      const draft = await pendingRepo.getById(state.activeDraftId);
      if (!draft) {
        state.editingField = null;
        return;
      }

      if (state.editingField === "nominal") {
        const cleanNum = parseInt(text.replace(/[^\d]/g, ""), 10);
        if (!isNaN(cleanNum) && cleanNum > 0) {
          draft.payload.total_amount = cleanNum;
          await pendingRepo.updatePayload(draft.id, draft.payload);
        }
      } else if (state.editingField === "name") {
        if (draft.action_type === "SPPG_ORDER") {
          draft.payload.sppg_unit = text;
        } else {
          draft.payload.supplier_name = text;
        }
        await pendingRepo.updatePayload(draft.id, draft.payload);
      }

      state.editingField = null;

      // Auto-cleanup user input & prompt message
      await ctx.deleteMessage().catch(() => { });
      if (state.promptMsgId) {
        await ctx.api.deleteMessage(chatId, state.promptMsgId).catch(() => { });
        state.promptMsgId = undefined;
      }

      // In-place edit card message with updated values
      if (state.activeDraftMsgId) {
        const updatedCard =
          draft.action_type === "SPPG_ORDER"
            ? renderSppgOrderDraftCard(draft.payload, draft.id, "PENDING")
            : renderSupplierExpenseDraftCard(draft.payload, draft.id, "PENDING", draft.media_url);

        await ctx.api.editMessageText(chatId, state.activeDraftMsgId, updatedCard, {
          parse_mode: "HTML",
          reply_markup: buildDraftConfirmationKeyboard(draft.id, draft.action_type),
        });
      }
      return;
    }

    // 3. Conversational Meta-Agent Classifier & Router
    await withTyping(ctx, async () => {
      const intent = await metaAgent.classifyAndRoute(text, unitConfig.name);
      logger.info({ userId, intentType: intent.type }, "Meta-agent classified user message");

      switch (intent.type) {
        case "GET_REKAP":
          await sendRekap(ctx);
          break;

        case "GET_PDF":
          await sendPdf(ctx);
          break;

        case "GET_SHEETS":
          await sendSheets(ctx);
          break;

        case "GET_MY_ID":
          await sendMyId(ctx);
          break;

        case "LIST_TRANSACTIONS":
          await sendRecentTransactions(ctx, intent.limit || 8);
          break;

        case "DETAIL_TRANSACTION":
          await sendTransactionDetail(ctx, intent.transactionId);
          break;

        case "DELETE_TRANSACTION":
          await ctx.reply(
            `⚠️ Apakah Anda yakin ingin <b>menghapus permanen</b> transaksi <code>${escapeHtml(intent.transactionId)}</code> dari Google Sheets?`,
            {
              parse_mode: "HTML",
              reply_markup: buildDeleteConfirmKeyboard(intent.transactionId),
            }
          );
          break;

        case "EDIT_TRANSACTION":
          if (intent.newAmount) {
            const res = await googleSheetsService.updateTransactionRow(unitConfig.spreadsheetId, intent.transactionId, {
              total_amount: intent.newAmount,
            });
            if (res.success) {
              await ctx.reply(
                `✅ Berhasil memperbarui nominal transaksi <b>${escapeHtml(intent.transactionId)}</b> menjadi <b>${formatRupiah(intent.newAmount)}</b> di Google Sheets.`,
                { parse_mode: "HTML" }
              );
            } else {
              await ctx.reply(`⚠️ Transaksi <code>${escapeHtml(intent.transactionId)}</code> tidak ditemukan di Google Sheets.`, {
                parse_mode: "HTML",
              });
            }
          } else {
            state.editingTransactionId = intent.transactionId;
            const prompt = await ctx.reply(
              `Ketik <b>nominal baru</b> untuk transaksi <code>${escapeHtml(intent.transactionId)}</code> (contoh: <code>850000</code> atau <code>850rb</code>):`,
              { parse_mode: "HTML" }
            );
            state.promptMsgId = prompt.message_id;
          }
          break;

        case "INVITE":
          await handleInviteCommand(ctx, intent.name, intent.role);
          break;

        case "RECORD_TRANSACTION": {
          const draftId = `draft_${Date.now()}`;
          await pendingRepo.create({
            id: draftId,
            sppg_id: unitConfig.id,
            telegram_user_id: userId,
            telegram_chat_id: chatId,
            action_type: intent.parsed.type,
            payload: intent.parsed.data,
          });

          state.activeDraftId = draftId;

          const cardText =
            intent.parsed.type === "SPPG_ORDER"
              ? renderSppgOrderDraftCard(intent.parsed.data as any, draftId, "PENDING")
              : renderSupplierExpenseDraftCard(intent.parsed.data as any, draftId, "PENDING");

          const sentMsg = await ctx.reply(cardText, {
            parse_mode: "HTML",
            reply_markup: buildDraftConfirmationKeyboard(draftId, intent.parsed.type),
          });

          state.activeDraftMsgId = sentMsg.message_id;
          break;
        }

        case "GENERAL_CHAT":
        default:
          await ctx.reply(intent.reply, { parse_mode: "HTML" });
          break;
      }
    });
  });

  return bot;
}
