import { Context } from "grammy";
import crypto from "node:crypto";
import type { BotContext } from "../types/bot-context.js";
import { escapeHtml } from "../formatter.js";
import {
  buildStartQuickActionKeyboard,
  buildInviteRolePickerKeyboard,
  buildPanduanKeyboard,
} from "../keyboards.js";

export async function sendMyId(bCtx: BotContext, ctx: Context) {
  if (!ctx.from) return;
  const tgId = ctx.from.id;
  const tgName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ");
  const tgUsername = ctx.from.username ? `@${ctx.from.username}` : "(tanpa username)";
  const user = await bCtx.userRepo.getUser(tgId);
  const isSuper = await bCtx.userRepo.isSuperAdmin(tgId);
  const isAllowed = await bCtx.userRepo.isAllowed(tgId);

  let statusDesc = "❌ <b>Belum Terdaftar (Tidak Ada Akses)</b>";
  if (isSuper) {
    statusDesc = "👑 <b>Super Admin / Pemilik Sistem</b>";
  } else if (isAllowed && user) {
    if (user.role === "member") {
      statusDesc = `✅ <b>Terhubung sebagai Staf Operasional (Member Belanja)</b> (${escapeHtml(user.sppg_assigned_id || bCtx.unitConfig.id)})`;
    } else {
      statusDesc = `✅ <b>Terhubung sebagai ${escapeHtml(user.role.toUpperCase())}</b> (${escapeHtml(user.sppg_assigned_id || bCtx.unitConfig.id)})`;
    }
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
      ? `💡 <i>Sebagai Super Admin, Anda dapat mengundang anggota tim baru dengan perintah:</i>\n<code>/invite [Nama] [admin/member]</code>`
      : isAllowed
        ? user?.role === "member"
          ? `<i>Akun Anda aktif khusus untuk mencatat pengeluaran belanja supplier unit ${escapeHtml(bCtx.unitConfig.name)}.</i>`
          : `<i>Akun Anda telah diverifikasi untuk mengelola unit ${escapeHtml(bCtx.unitConfig.name)}.</i>`
        : `👉 <i>Hubungi Super Admin (@heizaa4) untuk mendapatkan link undangan resmi.</i>`,
  ];

  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
}

export async function handleInviteCommand(bCtx: BotContext, ctx: Context, targetName?: string, roleArg = "admin") {
  if (!ctx.from) return;
  const isAdmin = await bCtx.userRepo.isAdminOrSuperAdmin(ctx.from.id);
  if (!isAdmin) {
    await ctx.reply("⛔ <b>Akses Ditolak</b>: Perintah undangan hanya dapat dijalankan oleh Admin atau Super Admin.", {
      parse_mode: "HTML",
    });
    return;
  }

  let targetRole: "super_admin" | "admin" | "member" = "admin";
  let label = "Pengguna Baru";

  const raw1 = (targetName || "").toLowerCase();
  const raw2 = (roleArg || "").toLowerCase();

  if (raw1 === "admin" || raw1 === "member" || raw1 === "super_admin") {
    targetRole = raw1 as any;
    if (roleArg && roleArg !== "admin") label = roleArg;
  } else if (raw2 === "admin" || raw2 === "member" || raw2 === "super_admin") {
    targetRole = raw2 as any;
    if (targetName) label = targetName;
  } else if (targetName) {
    label = targetName;
  }

  const inviteCode = "INV-" + crypto.randomBytes(3).toString("hex").toUpperCase();
  await bCtx.userRepo.createInvite({
    code: inviteCode,
    name: label,
    role: targetRole,
    sppg_assigned_id: bCtx.unitConfig.id,
    created_by: ctx.from.id,
    ttlMinutes: 15,
  });

  const botUsername = ctx.me.username || "mbg_assistant_bot";
  const inviteLink = `https://t.me/${botUsername}?start=${inviteCode}`;

  const roleDesc =
    targetRole === "super_admin"
      ? "Super Admin"
      : targetRole === "admin"
        ? "Admin (Operator SPPG)"
        : "Staf Operasional (Member)";

  const replyText = [
    `🎟️ <b>LINK UNDANGAN RESMI BERHASIL DIBUAT!</b>`,
    `------------------------------------------`,
    `• <b>Peran:</b> <code>${roleDesc}</code>`,
    `• <b>Unit SPPG:</b> ${escapeHtml(bCtx.unitConfig.name)}`,
    `• <b>Masa Berlaku:</b> ⏱️ <b>15 Menit</b> (Sekali Pakai)`,
    `------------------------------------------`,
    `👉 <b>Kirimkan link ini langsung ke Telegram penerima:</b>`,
    `${inviteLink}`,
    ``,
    `<i>Penerima cukup mengklik link di atas dan menekan START. Nama panggilan di bot dan Google Sheets akan otomatis menggunakan display name akun Telegram beliau.</i>`,
  ].join("\n");

  await ctx.reply(replyText, { parse_mode: "HTML" });
}

/**
 * Mengirimkan panduan ringkas (cheat-sheet) bot Telegram MBG ke chat.
 * Tampilkan tombol pintasan ke fitur utama dan link ke spreadsheet panduan.
 */
export async function sendPanduan(bCtx: BotContext, ctx: Context) {
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${bCtx.unitConfig.spreadsheetId}/edit#gid=1000`;
  const panduanLines = [
    `📖 <b>PANDUAN RINGKAS ASISTEN MBG</b>`,
    `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>`,
    `------------------------------------------`,
    ``,
    `<b>✍️ CATAT BELANJA</b>`,
    `<code>Beli [bahan] [qty] [satuan] harga [harga] di [toko] tunai</code>`,
    `<i>Contoh: "Beli daging ayam 120 kg harga 36000 di Pasar tunai"</i>`,
    ``,
    `<b>📋 CATAT MULTI-BAHAN (1 Nota):</b>`,
    `<code>Catat belanja [toko] tunai:\n1. Ayam 120 kg harga 36000\n2. Beras 150 kg harga 13000</code>`,
    ``,
    `<b>📸 FOTO STRUK / NOTA:</b>`,
    `Kirim langsung → AI baca otomatis (OCR)`,
    ``,
    `<b>🗑️ HAPUS TRANSAKSI (Admin):</b>`,
    `<code>hapus EI001</code> → hapus nota + rincian (cascade)`,
    `<code>hapus Sayur Sop dari EI002</code> → hapus 1 bahan`,
    `<code>hapus Sayur Sop dan Minyak dari EI002</code> → multi-bahan`,
    ``,
    `<b>📊 LAPORAN & REKAP (Admin):</b>`,
    `<code>rekap</code> | <code>margin</code> — ringkasan KPI margin`,
    `<code>pdf</code> | <code>cetak spj</code> — dokumen SPJ PDF`,
    `<code>sheets</code> | <code>buka sheet</code> — link spreadsheet`,
    ``,
    `<b>📋 KELOLA PAGU (Admin):</b>`,
    `<code>pagu</code> — daftar & edit Surat Pesanan (PO)`,
    `<code>Buat pagu tanggal 2026-09-10 no PO-2026/09/SPPG2-01</code>`,
    ``,
    `<b>🎟️ UNDANG STAF (Admin/Super):</b>`,
    `<code>/invite [Nama] [admin/member]</code>`,
    ``,
    `------------------------------------------`,
    `📗 Panduan lengkap 6-Tab tersedia di Tab <b>00_PANDUAN_OPERASIONAL</b> spreadsheet.`,
  ];

  await ctx.reply(panduanLines.join("\n"), {
    parse_mode: "HTML",
    reply_markup: buildPanduanKeyboard(sheetUrl, bCtx.unitConfig.id),
  });
}

export function registerCommonHandlers(bCtx: BotContext) {
  bCtx.bot.command("myid", (ctx) => sendMyId(bCtx, ctx));

  // /start - Handles both standard greeting and secure invite claim (?start=INV-XXXXXX)
  bCtx.bot.command("start", async (ctx) => {
    if (!ctx.from) return;
    const payload = ctx.match?.trim();

    // CASE A: User is claiming an invite code (?start=INV-XXXXXX)
    if (payload && payload.startsWith("INV-")) {
      const invite = await bCtx.userRepo.getInvite(payload);

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

      const isSuper = await bCtx.userRepo.isSuperAdmin(ctx.from.id);
      if (isSuper && ctx.from.id === invite.created_by) {
        await ctx.reply(
          `⚠️ <b>Ini adalah Link Undangan khusus untuk ${escapeHtml(invite.name)}!</b>\n\n` +
          `Akun Telegram Anda sudah berstatus Super Admin.\n` +
          `👉 <b>Jangan klik link ini di akun Anda sendiri</b>, melainkan teruskan/kirim link ini ke Telegram <b>${escapeHtml(invite.name)}</b> agar akun beliau yang terverifikasi.`,
          { parse_mode: "HTML" }
        );
        return;
      }

      const result = await bCtx.userRepo.claimInvite(payload, {
        id: ctx.from.id,
        username: ctx.from.username,
        first_name: ctx.from.first_name,
        last_name: ctx.from.last_name,
      });

      if (!result) {
        await ctx.reply(`⚠️ Gagal memproses klaim undangan. Silakan coba lagi.`, { parse_mode: "HTML" });
        return;
      }

      const isMember = result.user.role === "member";
      const roleDesc =
        result.user.role === "super_admin"
          ? "Super Admin / Owner"
          : result.user.role === "admin"
            ? "Admin (Operator SPPG)"
            : "Staf Operasional (Member Belanja)";

      const capabilityList = isMember
        ? [
            `💡 <b>Mulai Sekarang Anda Dapat:</b>`,
            `1. ✍️ <b>Ketik Belanjaan Langsung</b>: <i>"Beli ayam 200rb di pasar ayam tunai"</i>.`,
            `2. 📸 <b>Kirim Foto Struk/Nota</b> untuk pencatatan otomatis ke Google Sheets.`,
            `3. 🎙️ <b>Pesan Suara (Voice Note)</b> untuk mendiktekan belanjaan dapur.`,
            `4. 💬 <b>Tanya AI Masakan & Gizi MBG</b> seputar porsi atau bahan baku.`,
            ``,
            `ℹ️ <i>Catatan: Akses Anda dikhususkan untuk input pengeluaran belanja supplier. Untuk laporan margin laba harian & SPJ dikelola oleh Admin.</i>`,
          ]
        : [
            `💡 <b>Mulai Sekarang Anda Dapat:</b>`,
            `1. ✍️ <b>Ketik Belanjaan Langsung</b>: <i>"Beli ayam 200rb di pasar ayam"</i>.`,
            `2. 📸 <b>Kirim Foto Nota/Struk</b> untuk pencatatan otomatis OCR.`,
            `3. 📊 Ketik <i>"rekap"</i> untuk ringkasan margin laba hari ini.`,
            `4. 📄 Ketik <i>"pdf"</i> untuk cetak dokumen resmi SPJ BGN.`,
            `5. 🌐 Ketik <i>"sheets"</i> untuk membuka spreadsheet online.`,
          ];

      const claimSuccessText = [
        `🎉 <b>VERIFIKASI BERHASIL! SELAMAT DATANG!</b>`,
        `------------------------------------------`,
        `Halo <b>${escapeHtml(result.user.first_name || invite.name)}</b>, akun Telegram Anda telah resmi terhubung sebagai:`,
        `🏢 Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>`,
        `🎖️ Peran: <b>${roleDesc}</b>`,
        `------------------------------------------`,
        ...capabilityList,
      ].join("\n");

      const state = bCtx.getState(ctx.from.id);
      await bCtx.clearObsoleteKeyboards(ctx, state);

      const kbRole = result.user.role === "member" ? "member" : "admin";
      const sentMsg = await ctx.reply(claimSuccessText, {
        parse_mode: "HTML",
        reply_markup: buildStartQuickActionKeyboard(kbRole),
      });
      state.activeQuickActionMsgId = sentMsg.message_id;
      return;
    }

    // CASE B: Standard Start
    const isAllowed = await bCtx.userRepo.isAllowed(ctx.from.id);
    if (!isAllowed) {
      await ctx.reply(
        `⛔ <b>Akses Ditolak (Privat & Terbatas)</b>\n\n` +
        `Akun Telegram Anda (ID: <code>${ctx.from.id}</code>) belum terdaftar di sistem asisten MBG.\n\n` +
        `👉 <i>Ketik /myid untuk melihat identitas Anda, atau hubungi Super Admin (@heizaa4) untuk mendapatkan link undangan resmi.</i>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const user = await bCtx.userRepo.getUser(ctx.from.id);
    const isMemberUser = user?.role === "member";
    const userRole = isMemberUser ? "member" : "admin";

    const welcomeLines = isMemberUser
      ? [
          `👋 <b>Halo, Selamat Datang di Asisten Operasional MBG!</b>`,
          `🏢 Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>`,
          `🎖️ Akses: <b>Staf Operasional (Member Belanja)</b>`,
          `Badan Gizi Nasional (BGN) Republik Indonesia`,
          `--------------------------------------`,
          `💡 <b>Layanan Pencatatan Belanja Dapur:</b>`,
          `1. ✍️ <b>Ketik Belanja:</b> <i>"Beli telur 3 rak 165rb di Hj Muliadi tunai"</i>`,
          `2. 📸 <b>Kirim Foto Nota:</b> Foto bon/kuitansi belanja pasar untuk OCR otomatis`,
          `3. 🎙️ <b>Voice Note:</b> Rekam suara rincian belanjaan Anda`,
          `4. 💬 <b>Tanya AI:</b> Konsultasi menu, porsi, atau takaran gizi MBG`,
        ]
      : [
          `👋 <b>Halo, Selamat Datang di Asisten Operasional MBG!</b>`,
          `🏢 Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>`,
          `Badan Gizi Nasional (BGN) Republik Indonesia`,
          `--------------------------------------`,
          `💡 <b>AI Agent Siap Melayani Anda Secara Natural:</b>`,
          `1. ✍️ <b>Ketik Langsung:</b> <i>"Beli telur 3 rak 165rb di Hj Muliadi tunai"</i>`,
          `2. 📸 <b>Kirim Foto:</b> Foto Nota SPPG atau Bon belanja pasar`,
          `3. 📊 <b>Minta Rekap:</b> Cukup ketik <i>"rekap"</i> atau <i>"margin"</i>`,
          `4. 📄 <b>Laporan SPJ:</b> Cukup ketik <i>"kirim pdf"</i> atau <i>"cetak spj"</i>`,
          `5. 🌐 <b>Spreadsheet:</b> Cukup ketik <i>"buka sheets"</i>`,
          `6. 🔍 <b>Riwayat Belanja:</b> Cukup ketik <i>"transaksi"</i>`,
        ];

    const state = bCtx.getState(ctx.from.id);
    await bCtx.clearObsoleteKeyboards(ctx, state);

    const sentMsg = await ctx.reply(welcomeLines.join("\n"), {
      parse_mode: "HTML",
      reply_markup: buildStartQuickActionKeyboard(userRole),
    });
    state.activeQuickActionMsgId = sentMsg.message_id;
  });

  // /menu - Quick Action Shortcuts
  bCtx.bot.command("menu", async (ctx) => {
    if (!ctx.from) return;
    const isAllowed = await bCtx.userRepo.isAllowed(ctx.from.id);
    if (!isAllowed) return;

    const state = bCtx.getState(ctx.from.id);
    await bCtx.clearObsoleteKeyboards(ctx, state);

    const user = await bCtx.userRepo.getUser(ctx.from.id);
    const userRole = user?.role === "member" ? "member" : "admin";

    const sentMsg = await ctx.reply(
      `⚡ <b>PINTASAN MENU OPERASIONAL (${escapeHtml(bCtx.unitConfig.name)})</b>\n\n` +
      `Silakan ketuk pintasan di bawah ini atau langsung kirim pesan teks, foto struk, maupun rekaman suara:`,
      {
        parse_mode: "HTML",
        reply_markup: buildStartQuickActionKeyboard(userRole),
      }
    );
    state.activeQuickActionMsgId = sentMsg.message_id;
  });

  // /invite
  bCtx.bot.command("invite", async (ctx) => {
    const args = ctx.match?.trim().split(/\s+/) || [];
    await handleInviteCommand(bCtx, ctx, args[0], args[1]);
  });

  // /panduan | /help | /bantuan — Cheat-sheet ringkas & link panduan lengkap
  for (const cmd of ["panduan", "help", "bantuan"]) {
    bCtx.bot.command(cmd, async (ctx) => {
      if (!ctx.from) return;
      const isAllowed = await bCtx.userRepo.isAllowed(ctx.from.id);
      if (!isAllowed) return;
      await sendPanduan(bCtx, ctx);
    });
  }

  // Quick Action Buttons Callback Router
  bCtx.bot.callbackQuery(/^qa:(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    const userId = ctx.from?.id;
    const isMember = await bCtx.isCallerMember(userId);

    if (ctx.chat && ctx.callbackQuery?.message?.message_id) {
      await ctx.api.editMessageReplyMarkup(ctx.chat.id, ctx.callbackQuery.message.message_id, {
        reply_markup: { inline_keyboard: [] },
      }).catch(() => {});
    }
    if (userId) {
      const state = bCtx.getState(userId);
      state.activeQuickActionMsgId = undefined;
    }

    switch (action) {
      case "pagu": {
        if (isMember) {
          await ctx.answerCallbackQuery({ text: "⛔ Akses Dibatasi: Kelola pagu hanya untuk Admin.", show_alert: true });
          await bCtx.notifyMemberRestricted(ctx, "Kelola Pagu Anggaran");
          return;
        }
        await ctx.answerCallbackQuery({ text: "📋 Memuat Rincian Pagu..." });
        await bCtx.sendPaguOrders(ctx);
        break;
      }

      case "start":
      case "menu": {
        await ctx.answerCallbackQuery();
        const user = userId ? await bCtx.userRepo.getUser(userId) : null;
        const userRole = user?.role === "member" ? "member" : "admin";
        const sentMsg = await ctx.reply(
          `⚡ <b>PINTASAN MENU OPERASIONAL (${escapeHtml(bCtx.unitConfig.name)})</b>\n\n` +
          `Silakan ketuk pintasan di bawah ini atau langsung kirim pesan teks, foto struk, maupun rekaman suara:`,
          {
            parse_mode: "HTML",
            reply_markup: buildStartQuickActionKeyboard(userRole),
          }
        );
        if (userId) {
          const state = bCtx.getState(userId);
          state.activeQuickActionMsgId = sentMsg.message_id;
        }
        break;
      }

      case "rekap": {
        if (isMember) {
          await ctx.answerCallbackQuery({ text: "⛔ Akses Dibatasi: Rekap margin hanya untuk Admin.", show_alert: true });
          await bCtx.notifyMemberRestricted(ctx, "Laporan Rekap Margin");
          return;
        }
        await ctx.answerCallbackQuery({ text: "📊 Memuat Rekap Margin..." });
        await bCtx.sendRekap(ctx);
        break;
      }

      case "pdf": {
        if (isMember) {
          await ctx.answerCallbackQuery({ text: "⛔ Akses Dibatasi: Cetak SPJ hanya untuk Admin.", show_alert: true });
          await bCtx.notifyMemberRestricted(ctx, "Cetak Dokumen SPJ");
          return;
        }
        await ctx.answerCallbackQuery({ text: "📄 Menyiapkan Dokumen PDF SPJ..." });
        await bCtx.sendPdf(ctx);
        break;
      }

      case "sheets": {
        if (isMember) {
          await ctx.answerCallbackQuery({ text: "⛔ Akses Dibatasi: Link spreadsheet hanya untuk Admin.", show_alert: true });
          await bCtx.notifyMemberRestricted(ctx, "Akses Google Sheets");
          return;
        }
        await ctx.answerCallbackQuery({ text: "🌐 Membuka Link Spreadsheet..." });
        await bCtx.sendSheets(ctx);
        break;
      }

      case "transaksi": {
        if (isMember) {
          await ctx.answerCallbackQuery({ text: "⛔ Akses Dibatasi: Riwayat transaksi hanya untuk Admin.", show_alert: true });
          await bCtx.notifyMemberRestricted(ctx, "Riwayat Transaksi");
          return;
        }
        await ctx.answerCallbackQuery({ text: "🔍 Memuat Riwayat Transaksi..." });
        await bCtx.sendRecentTransactions(ctx, 8);
        break;
      }

      case "myid": {
        await ctx.answerCallbackQuery();
        await sendMyId(bCtx, ctx);
        break;
      }

      case "invite_prompt": {
        const isAdmin = userId ? await bCtx.userRepo.isAdminOrSuperAdmin(userId) : false;
        if (!isAdmin) {
          await ctx.answerCallbackQuery({ text: "⛔ Hanya Admin/Super Admin yang dapat mengundang.", show_alert: true });
          return;
        }
        await ctx.answerCallbackQuery();
        await ctx.reply(
          `🎟️ <b>PILIH PERAN UNDANGAN BARU</b>\n` +
          `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>\n\n` +
          `Pilih peran yang akan diberikan kepada pengguna:\n` +
          `• <b>Admin:</b> Akses penuh kelola anggaran, belanja, rekap margin, dan SPJ.\n` +
          `• <b>Member:</b> Khusus staf belanja untuk input pengeluaran belanja supplier dapur.`,
          {
            parse_mode: "HTML",
            reply_markup: buildInviteRolePickerKeyboard(),
          }
        );
        break;
      }

      case "geninvite:admin": {
        const isAdmin = userId ? await bCtx.userRepo.isAdminOrSuperAdmin(userId) : false;
        if (!isAdmin) {
          await ctx.answerCallbackQuery({ text: "⛔ Akses Ditolak", show_alert: true });
          return;
        }
        await ctx.answerCallbackQuery({ text: "🎟️ Membuat undangan Admin..." });
        await handleInviteCommand(bCtx, ctx, "Admin SPPG", "admin");
        break;
      }

      case "geninvite:member": {
        const isAdmin = userId ? await bCtx.userRepo.isAdminOrSuperAdmin(userId) : false;
        if (!isAdmin) {
          await ctx.answerCallbackQuery({ text: "⛔ Akses Ditolak", show_alert: true });
          return;
        }
        await ctx.answerCallbackQuery({ text: "🎟️ Membuat undangan Member..." });
        await handleInviteCommand(bCtx, ctx, "Staf Belanja", "member");
        break;
      }

      case "invite_cancel": {
        await ctx.answerCallbackQuery({ text: "❌ Dibatalkan" });
        await ctx.deleteMessage().catch(() => {});
        break;
      }

      case "format_belanja": {
        await ctx.answerCallbackQuery();
        const guideText = [
          `✍️ <b>PANDUAN PENCATATAN BELANJA DAPUR MBG</b>`,
          `------------------------------------------`,
          `Anda dapat mencatat belanja harian dengan sangat mudah:`,
          ``,
          `<b>1. Ketik Bebas (Bahasa Alami):</b>`,
          `• <i>"Beli ayam 250rb di pasar ayam tunai"</i>`,
          `• <i>"Beli beras 50kg 700rb supplier Pak Budi tempo"</i>`,
          `• <i>"Beli bumbu dapur 120rb pasar sentral tunai"</i>`,
          ``,
          `<b>2. Kirim Foto Bon / Struk Belanja:</b>`,
          `• Foto nota belanja pasar Anda, AI akan membaca otomatis (OCR).`,
          ``,
          `<b>3. Pesan Suara (Voice Note):</b>`,
          `• Rekam suara Anda menyebutkan belanjaan dapur.`,
          ``,
          `💡 <i>Setelah dikirim, bot akan menampilkan kartu draf konfirmasi untuk Anda periksa sebelum tersimpan ke Google Sheets.</i>`,
        ].join("\n");
        await ctx.reply(guideText, { parse_mode: "HTML" });
        break;
      }

      case "tips_gizi": {
        await ctx.answerCallbackQuery();
        const tipsText = [
          `💡 <b>KONSULTASI MENU & STANDAR GIZI MBG</b>`,
          `------------------------------------------`,
          `AI Asisten siap membantu Anda menghitung porsi dan standar gizi sesuai Pedoman Badan Gizi Nasional (BGN).`,
          ``,
          `<b>Contoh Pertanyaan yang Bisa Anda Ketik Langsung:</b>`,
          `• <i>"Berapa gram porsi ayam per porsi untuk anak SD?"</i>`,
          `• <i>"Berapa kebutuhan beras untuk 1.500 porsi makan bergizi?"</i>`,
          `• <i>"Rekomendasi sayuran berprotein tinggi untuk menu MBG"</i>`,
          `• <i>"Bagaimana standar kebersihan penyimpanan bahan segar?"</i>`,
          ``,
          `👉 <i>Silakan langsung ketik pertanyaan Anda sekarang di chat ini!</i>`,
        ].join("\n");
        await ctx.reply(tipsText, { parse_mode: "HTML" });
        break;
      }

      default:
        await ctx.answerCallbackQuery();
        break;
    }
  });
}
