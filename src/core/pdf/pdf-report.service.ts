import PDFDocument from "pdfkit";

export interface SppgPdfReportData {
  sppgName: string;
  periodDate: string;
  orderNo: string;
  totalPlafon: number;
  totalBelanja: number;
  marginBersih: number;
  marginPercentage: number;
  expenses: Array<{
    date: string;
    supplier: string;
    items: string;
    amount: number;
  }>;
}

function formatRupiah(num: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(num);
}

export async function generateOfficialSppgPdf(data: SppgPdfReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 36, bottom: 40, left: 40, right: 40 },
      bufferPages: true,
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (err) => reject(err));

    const navyColor = "#0F2042";
    const goldColor = "#D4A017";
    const grayBg = "#F8FAFC";
    const textDark = "#1E293B";

    // 1. HEADER / KOP SURAT RESMI
    doc.rect(40, 36, 515, 60).fill(navyColor);

    doc
      .fillColor("#FFFFFF")
      .fontSize(14)
      .font("Helvetica-Bold")
      .text("BADAN GIZI NASIONAL REPUBLIK INDONESIA", 50, 48, { align: "center" });

    doc
      .fontSize(11)
      .font("Helvetica")
      .text(`SATUAN PELAYANAN PEMENUHAN GIZI (SPPG) ${data.sppgName.toUpperCase()}`, 50, 66, {
        align: "center",
      });

    doc
      .fontSize(9)
      .fillColor(goldColor)
      .text("Laporan Rekapitulasi Pembelanjaan Bahan Makanan & Realisasi Margin", 50, 80, {
        align: "center",
      });

    // Gold accent bar
    doc.rect(40, 96, 515, 3).fill(goldColor);

    // 2. META INFORMASI LAPORAN
    let currentY = 115;
    doc
      .fillColor(textDark)
      .fontSize(9)
      .font("Helvetica-Bold")
      .text("No. Ref SPPG", 45, currentY)
      .font("Helvetica")
      .text(`: ${data.orderNo}`, 130, currentY);

    doc
      .font("Helvetica-Bold")
      .text("Tanggal / Periode", 320, currentY)
      .font("Helvetica")
      .text(`: ${data.periodDate}`, 410, currentY);

    currentY += 20;

    // 3. THREE-COLUMN KPI SUMMARY STRIP
    const boxWidth = 165;
    const boxHeight = 50;

    const totalPlafon = data.totalPlafon ?? 0;
    const totalBelanja = data.totalBelanja ?? 0;
    const marginBersih = totalPlafon - totalBelanja;
    const marginPercentage = totalPlafon > 0 ? Math.round((marginBersih / totalPlafon) * 10000) / 100 : 0;

    // Box 1: Plafon SPPG (Navy)
    doc.rect(40, currentY, boxWidth, boxHeight).fillAndStroke(navyColor, navyColor);
    doc
      .fillColor("#FFFFFF")
      .fontSize(8)
      .font("Helvetica")
      .text("TOTAL PLAFON PENDAPATAN", 45, currentY + 10, { width: boxWidth - 10, align: "center" })
      .fontSize(11)
      .font("Helvetica-Bold")
      .fillColor(goldColor)
      .text(formatRupiah(totalPlafon), 45, currentY + 26, { width: boxWidth - 10, align: "center" });

    // Box 2: Total Belanja (Slate Gray)
    doc.rect(215, currentY, boxWidth, boxHeight).fillAndStroke("#334155", "#334155");
    doc
      .fillColor("#FFFFFF")
      .fontSize(8)
      .font("Helvetica")
      .text("TOTAL BELANJA SUPPLIER", 220, currentY + 10, { width: boxWidth - 10, align: "center" })
      .fontSize(11)
      .font("Helvetica-Bold")
      .text(formatRupiah(totalBelanja), 220, currentY + 26, { width: boxWidth - 10, align: "center" });

    // Box 3: Margin Bersih (Forest Green or Red)
    const marginColor = marginBersih >= 0 ? "#14532D" : "#991B1B";
    doc.rect(390, currentY, boxWidth, boxHeight).fillAndStroke(marginColor, marginColor);
    doc
      .fillColor("#FFFFFF")
      .fontSize(8)
      .font("Helvetica")
      .text(`SISA MARGIN LABA (${marginPercentage}%)`, 395, currentY + 10, {
        width: boxWidth - 10,
        align: "center",
      })
      .fontSize(11)
      .font("Helvetica-Bold")
      .text(formatRupiah(marginBersih), 395, currentY + 26, { width: boxWidth - 10, align: "center" });

    currentY += 65;

    // 4. TABEL DETAIL BELANJA SUPPLIER
    doc.fillColor(navyColor).fontSize(10).font("Helvetica-Bold").text("RINCIAN PEMBELIAN DARI SUPPLIER PASAR:", 40, currentY);
    currentY += 15;

    // Table Header
    doc.rect(40, currentY, 515, 20).fill(navyColor);
    doc
      .fillColor("#FFFFFF")
      .fontSize(8)
      .font("Helvetica-Bold")
      .text("No", 45, currentY + 6)
      .text("Tanggal", 65, currentY + 6)
      .text("Supplier", 130, currentY + 6)
      .text("Rincian Belanja", 240, currentY + 6)
      .text("Total Bayar", 460, currentY + 6, { width: 90, align: "right" });

    currentY += 20;

    // Table Rows (Live data from Google Sheets)
    const items = data.expenses || [];
    if (items.length === 0) {
      doc.rect(40, currentY, 515, 24).fill(grayBg);
      doc
        .fillColor("#64748B")
        .fontSize(8)
        .font("Helvetica-Oblique")
        .text("Belum ada rincian belanja supplier yang tercatat pada sistem.", 45, currentY + 7, {
          width: 505,
          align: "center",
        });
      currentY += 24;
    } else {
      items.forEach((item, idx) => {
        if (currentY > 720) {
          doc.addPage();
          currentY = 40;
          doc.rect(40, currentY, 515, 20).fill(navyColor);
          doc
            .fillColor("#FFFFFF")
            .fontSize(8)
            .font("Helvetica-Bold")
            .text("No", 45, currentY + 6)
            .text("Tanggal", 65, currentY + 6)
            .text("Supplier", 130, currentY + 6)
            .text("Rincian Belanja", 240, currentY + 6)
            .text("Total Bayar", 460, currentY + 6, { width: 90, align: "right" });
          currentY += 20;
        }

        const isZebra = idx % 2 === 1;
        if (isZebra) {
          doc.rect(40, currentY, 515, 18).fill(grayBg);
        }

        doc
          .fillColor(textDark)
          .fontSize(8)
          .font("Helvetica")
          .text(String(idx + 1), 45, currentY + 4)
          .text(item.date || "-", 65, currentY + 4)
          .font("Helvetica-Bold")
          .text(item.supplier || "Supplier", 130, currentY + 4)
          .font("Helvetica")
          .text((item.items || "-").slice(0, 42), 240, currentY + 4)
          .font("Helvetica-Bold")
          .text(formatRupiah(item.amount || 0), 460, currentY + 4, { width: 90, align: "right" });

        currentY += 18;
      });
    }

    // Table Total Footer Row
    doc.rect(40, currentY, 515, 20).fill("#EEF2F6");
    doc
      .fillColor(navyColor)
      .fontSize(8)
      .font("Helvetica-Bold")
      .text("TOTAL BELANJA SUPPLIER REALISASI", 45, currentY + 6)
      .text(formatRupiah(totalBelanja), 460, currentY + 6, { width: 90, align: "right" });

    currentY += 28;

    // Check if signature fits on current page (needs ~90pt)
    if (currentY > 670) {
      doc.addPage();
      currentY = 50;
    }

    // 5. KOLOM PENGESAHAN / TANDA TANGAN
    doc
      .fillColor(textDark)
      .fontSize(9)
      .font("Helvetica")
      .text("Mengetahui,", 70, currentY)
      .text("Rekanan Penyedia Pangan / Vendor,", 340, currentY);

    doc
      .text("Kepala Unit Pelayanan SPPG,", 70, currentY + 12)
      .text("Penanggung Jawab Operasional,", 340, currentY + 12);

    currentY += 60;

    doc
      .font("Helvetica-Bold")
      .text("( .................................................... )", 70, currentY)
      .text("( .................................................... )", 340, currentY);

    // 6. RUNNING FOOTER
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc
        .fillColor("#94A3B8")
        .fontSize(7)
        .font("Helvetica")
        .text(
          `Dokumen resmi SPJ Badan Gizi Nasional - Dicetak otomatis oleh Asisten MBG | Halaman ${i + 1} dari ${pageCount}`,
          40,
          790,
          { align: "center", width: 515 }
        );
    }

    doc.end();
  });
}
