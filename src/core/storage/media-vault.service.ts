import { getSupabaseClient } from "../db/supabase.js";
import { optimizeReceiptImage } from "../utils/image-optimizer.js";
import { logger } from "../utils/logger.js";

export interface VaultUploadResult {
  webViewLink: string;
  fileId: string;
}

export class MediaVaultService {
  private bucketName = "nota";

  /**
   * Uploads receipt image or PDF document to Supabase Storage bucket 'nota'.
   * Images are automatically compressed to WebP (~80-120KB).
   * Hierarchical path: [sppgId]/[YYYY]/[MM-Month]/[docType]/[fileName]
   */
  async uploadReceipt(
    rawBuffer: Buffer,
    fileName: string,
    sppgId: string,
    docType: "01_Nota_Pesanan_SPPG" | "02_Kwitansi_Supplier" | "03_Dokumen_PDF" | string = "02_Kwitansi_Supplier"
  ): Promise<VaultUploadResult> {
    const supabase = getSupabaseClient();

    // 1. Detect if document is PDF or image
    const isPdf = fileName.toLowerCase().endsWith(".pdf") || rawBuffer.subarray(0, 5).toString() === "%PDF-";
    let finalFileName: string;
    let mimeType: string;
    let bufferToUpload: Buffer;

    if (isPdf) {
      finalFileName = fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`;
      mimeType = "application/pdf";
      bufferToUpload = rawBuffer;
    } else {
      const optimized = await optimizeReceiptImage(rawBuffer);
      const cleanBaseName = fileName.replace(/\.[^/.]+$/, "");
      finalFileName = fileName.endsWith(".webp") ? fileName : `${cleanBaseName}.webp`;
      mimeType = "image/webp";
      bufferToUpload = optimized.buffer;
    }

    // 2. Build hierarchical storage path
    const now = new Date();
    const year = String(now.getFullYear());
    const month = `${String(now.getMonth() + 1).padStart(2, "0")}-${now.toLocaleString("id-ID", { month: "long" })}`;
    const sanitizedSppgId = sppgId.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const filePath = `${sanitizedSppgId}/${year}/${month}/${docType}/${finalFileName}`;

    logger.info({ filePath, mimeType, size: bufferToUpload.length }, "Uploading receipt to Supabase Storage Vault...");

    // 3. Upload to Supabase Storage bucket 'nota'
    const { data, error } = await supabase.storage.from(this.bucketName).upload(filePath, bufferToUpload, {
      contentType: mimeType,
      upsert: true,
    });

    if (error) {
      logger.error({ error, filePath }, "Failed uploading to Supabase Storage");
      throw new Error(`Supabase Storage upload error: ${error.message}`);
    }

    // 4. Retrieve public URL
    const { data: urlData } = supabase.storage.from(this.bucketName).getPublicUrl(filePath);
    const webViewLink = urlData?.publicUrl || "";

    logger.info({ filePath, webViewLink }, "Successfully saved receipt to Media Vault");

    return {
      webViewLink,
      fileId: filePath,
    };
  }
}

export const mediaVaultService = new MediaVaultService();

export interface CachedMediaBuffer {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  createdAt: number;
}

class MediaBufferCache {
  private cache = new Map<string, CachedMediaBuffer>();

  set(draftId: string, item: { buffer: Buffer; fileName: string; mimeType: string }): void {
    this.cache.set(draftId, {
      ...item,
      createdAt: Date.now(),
    });
  }

  get(draftId: string): CachedMediaBuffer | undefined {
    return this.cache.get(draftId);
  }

  delete(draftId: string): boolean {
    return this.cache.delete(draftId);
  }

  has(draftId: string): boolean {
    return this.cache.has(draftId);
  }
}

export const mediaBufferCache = new MediaBufferCache();
