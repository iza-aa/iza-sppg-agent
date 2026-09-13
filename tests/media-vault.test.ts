import { describe, it, expect, vi } from "vitest";
import { MediaVaultService } from "../src/core/storage/media-vault.service.js";

vi.mock("../src/core/db/supabase.js", () => {
  return {
    getSupabaseClient: () => ({
      storage: {
        from: (bucket: string) => ({
          upload: vi.fn().mockResolvedValue({ data: { path: "test.webp" }, error: null }),
          getPublicUrl: (filePath: string) => ({
            data: { publicUrl: `https://fake.supabase.co/storage/v1/object/public/${bucket}/${filePath}` },
          }),
        }),
      },
    }),
  };
});

describe("MediaVaultService", () => {
  it("should compress and upload receipt image to Supabase Storage", async () => {
    const service = new MediaVaultService();
    const dummyImage = Buffer.from("dummy-image-content");
    const result = await service.uploadReceipt(dummyImage, "nota_1.jpg", "sppg_unit2", "02_Kwitansi_Supplier");

    expect(result.webViewLink).toContain("https://fake.supabase.co/storage/v1/object/public/nota/sppg_unit2/");
    expect(result.webViewLink).toContain(".webp");
    expect(result.fileId).toContain("sppg_unit2");
  });

  it("should handle PDF files without image compression", async () => {
    const service = new MediaVaultService();
    const dummyPdf = Buffer.from("%PDF-1.4 test");
    const result = await service.uploadReceipt(dummyPdf, "document.pdf", "sppg_unit2", "03_Dokumen_PDF");

    expect(result.webViewLink).toContain(".pdf");
  });
});
