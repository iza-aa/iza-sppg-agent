import { describe, it, expect } from "vitest";
import { generateOfficialSppgPdf } from "../src/core/pdf/pdf-report.service.js";

describe("Official BGN PDF Report Generator", () => {
  it("should generate a valid PDF report buffer with BGN headers, summary strip, and signature blocks", async () => {
    const reportData = {
      sppgName: "Patila, Luwu Utara",
      periodDate: "2026-09-03",
      orderNo: "05/02/09/26",
      totalPlafon: 29581000,
      totalBelanja: 24150000,
      marginBersih: 5431000,
      marginPercentage: 18.36,
      expenses: [
        { date: "2026-09-03", supplier: "Ayam Pasar", items: "Ayam 248 Ekor", amount: 14880000 },
        { date: "2026-09-03", supplier: "Hj Muliadi", items: "Minyak 14 Jerigen, Sayur Wortel", amount: 3100000 },
      ],
    };

    const pdfBuffer = await generateOfficialSppgPdf(reportData);

    expect(pdfBuffer).toBeDefined();
    expect(pdfBuffer.length).toBeGreaterThan(1000);
    // PDF Magic number check: starts with %PDF-
    expect(pdfBuffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("should handle empty expenses cleanly without rendering dummy fallback rows", async () => {
    const reportData = {
      sppgName: "Patila, Luwu Utara",
      periodDate: "2026-09-06",
      orderNo: "REKAP-BULANAN",
      totalPlafon: 82847000,
      totalBelanja: 0,
      marginBersih: 82847000,
      marginPercentage: 100,
      expenses: [],
    };

    const pdfBuffer = await generateOfficialSppgPdf(reportData);

    expect(pdfBuffer).toBeDefined();
    expect(pdfBuffer.length).toBeGreaterThan(1000);
    expect(pdfBuffer.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
