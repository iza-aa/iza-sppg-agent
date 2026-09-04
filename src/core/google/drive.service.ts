import { google } from "googleapis";
import { Readable } from "stream";
import fs from "fs";
import path from "path";
import { env } from "../../config/env.js";
import { optimizeReceiptImage } from "../utils/image-optimizer.js";
import { logger } from "../utils/logger.js";

export class GoogleDriveService {
  private drive: any = null;
  private rootFolderId: string;
  private folderCache = new Map<string, string>(); // `${parent}_${name}` -> folderId

  constructor(rootFolderId = env.GOOGLE_DRIVE_FOLDER_ID) {
    this.rootFolderId = rootFolderId;
  }

  private async getClient() {
    if (this.drive) return this.drive;

    const keyPath = path.resolve(process.cwd(), env.GOOGLE_SERVICE_ACCOUNT_PATH);
    if (!fs.existsSync(keyPath)) {
      throw new Error(`Google service account file not found at: ${keyPath}`);
    }

    const auth = new google.auth.GoogleAuth({
      keyFile: keyPath,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });

    this.drive = google.drive({ version: "v3", auth });
    return this.drive;
  }

  async getOrCreateFolder(folderName: string, parentFolderId: string): Promise<string> {
    const cacheKey = `${parentFolderId}_${folderName}`;
    if (this.folderCache.has(cacheKey)) {
      return this.folderCache.get(cacheKey)!;
    }

    const drive = await this.getClient();

    // 1. Search if folder already exists
    const query = `'${parentFolderId}' in parents and name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const response = await drive.files.list({
      q: query,
      fields: "files(id, name)",
      spaces: "drive",
    });

    if (response.data.files && response.data.files.length > 0) {
      const folderId = response.data.files[0].id;
      this.folderCache.set(cacheKey, folderId);
      return folderId;
    }

    // 2. Create folder if not found
    const createResponse = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentFolderId],
      },
      fields: "id",
    });

    const newFolderId = createResponse.data.id;
    this.folderCache.set(cacheKey, newFolderId);
    logger.info({ folderName, parentFolderId, newFolderId }, "Created new Google Drive folder");
    return newFolderId;
  }

  async resolveDestinationFolder(
    sppgId: string,
    year: string,
    month: string,
    docType: "01_Nota_Pesanan_SPPG" | "02_Kwitansi_Supplier"
  ): Promise<string> {
    // Structure: [Root: mbg-assistant] / [01_ARSIP_SPPG_PATILA] / [2026] / [09-September] / [02_Kwitansi_Supplier]
    const sppgFolderMap: Record<string, string> = {
      sppg_patila: "01_ARSIP_SPPG_PATILA",
      sppg_unit2: "02_ARSIP_SPPG_2",
      sppg_unit3: "03_ARSIP_SPPG_3",
    };

    const sppgFolderName = sppgFolderMap[sppgId] || `ARSIP_${sppgId.toUpperCase()}`;
    const sppgFolderId = await this.getOrCreateFolder(sppgFolderName, this.rootFolderId);
    const yearFolderId = await this.getOrCreateFolder(year, sppgFolderId);
    const monthFolderId = await this.getOrCreateFolder(month, yearFolderId);
    return await this.getOrCreateFolder(docType, monthFolderId);
  }

  async uploadReceipt(
    rawBuffer: Buffer,
    fileName: string,
    targetFolderId: string
  ): Promise<{ webViewLink: string; fileId: string }> {
    const drive = await this.getClient();

    // 1. Optimize image to WebP
    const optimized = await optimizeReceiptImage(rawBuffer);
    const finalFileName = fileName.endsWith(".webp") ? fileName : `${fileName.replace(/\.[^/.]+$/, "")}.webp`;

    const stream = new Readable();
    stream.push(optimized.buffer);
    stream.push(null);

    // 2. Check if file with same name exists (in-place upsert)
    const query = `'${targetFolderId}' in parents and name = '${finalFileName}' and trashed = false`;
    const searchRes = await drive.files.list({
      q: query,
      fields: "files(id, name, webViewLink)",
      spaces: "drive",
    });

    let fileId: string;
    let webViewLink: string;

    if (searchRes.data.files && searchRes.data.files.length > 0) {
      fileId = searchRes.data.files[0].id;
      const updateRes = await drive.files.update({
        fileId,
        media: {
          mimeType: "image/webp",
          body: stream,
        },
        fields: "id, webViewLink",
      });
      webViewLink = updateRes.data.webViewLink;
      logger.info({ fileId, finalFileName }, "Updated existing file content in Google Drive");
    } else {
      const createRes = await drive.files.create({
        requestBody: {
          name: finalFileName,
          parents: [targetFolderId],
        },
        media: {
          mimeType: "image/webp",
          body: stream,
        },
        fields: "id, webViewLink",
      });
      fileId = createRes.data.id;
      webViewLink = createRes.data.webViewLink;
      logger.info({ fileId, finalFileName }, "Uploaded new WebP file to Google Drive");
    }

    // 3. Set public view permission so user can click without permission error
    try {
      await drive.permissions.create({
        fileId,
        requestBody: {
          role: "reader",
          type: "anyone",
        },
      });
    } catch (permErr) {
      logger.debug({ permErr }, "Permission already granted or domain restricted");
    }

    return { fileId, webViewLink: webViewLink || `https://drive.google.com/file/d/${fileId}/view` };
  }
}

export const googleDriveService = new GoogleDriveService();
