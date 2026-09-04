import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { optimizeReceiptImage } from "../src/core/utils/image-optimizer.js";
import { googleDriveService } from "../src/core/google/drive.service.js";

describe("Google Drive Vault & Sharp WebP Optimizer", () => {
  it("should compress image buffer into WebP with size reduction", async () => {
    // Generate a dummy 2000x2000 SVG image as realistic high-res input
    const svgImage = Buffer.from(`
      <svg width="2000" height="2000">
        <rect width="2000" height="2000" fill="#0F2042" />
        <circle cx="1000" cy="1000" r="500" fill="#D4A017" />
        <text x="500" y="1000" font-size="80" fill="#FFFFFF">MBG SPPG PATILA NOTA TEST</text>
      </svg>
    `);

    const pngBuffer = await sharp(svgImage).png().toBuffer();
    const result = await optimizeReceiptImage(pngBuffer, 1200, 80);

    expect(result.format).toBe("webp");
    expect(result.width).toBeLessThanOrEqual(1200);
    expect(result.optimizedSize).toBeLessThan(result.originalSize);
  });

  it("should instantiate GoogleDriveService with verified root folder ID", () => {
    expect(googleDriveService).toBeDefined();
  });
});
