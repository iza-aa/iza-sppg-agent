import sharp from "sharp";
import { logger } from "./logger.js";

// Restrict Sharp's internal concurrency and disable cache completely to prevent native memory leaks
sharp.concurrency(1);
sharp.cache(false);
sharp.simd(true);

export interface OptimizationResult {
  buffer: Buffer;
  originalSize: number;
  optimizedSize: number;
  reductionPercentage: number;
  format: "webp";
  width?: number;
  height?: number;
}

// Sequential queue mutex: guarantees only 1 image is in libvips memory at any millisecond
let optimizationMutex = Promise.resolve();

async function runSharpPipeline(
  inputBuffer: Buffer,
  maxWidth: number,
  quality: number
): Promise<OptimizationResult> {
  const originalSize = inputBuffer.length;

  try {
    const pipeline = sharp(inputBuffer, { failOnError: false })
      .rotate() // Auto-orient based on EXIF
      .resize({
        width: maxWidth,
        withoutEnlargement: true,
        fit: "inside",
      })
      .webp({
        quality,
        effort: 4, // Balanced CPU vs compression ratio
      });

    const optimizedBuffer = await pipeline.toBuffer();
    const metadata = await sharp(optimizedBuffer).metadata();
    const optimizedSize = optimizedBuffer.length;
    const reductionPercentage = Math.round(((originalSize - optimizedSize) / originalSize) * 100);

    logger.debug(
      { originalSize, optimizedSize, reductionPercentage, width: metadata.width, height: metadata.height },
      "Receipt image optimized to WebP"
    );

    return {
      buffer: optimizedBuffer,
      originalSize,
      optimizedSize,
      reductionPercentage,
      format: "webp",
      width: metadata.width,
      height: metadata.height,
    };
  } catch (error: any) {
    logger.warn({ error: error?.message || error }, "Failed to optimize image via Sharp, returning original buffer");
    return {
      buffer: inputBuffer,
      originalSize,
      optimizedSize: originalSize,
      reductionPercentage: 0,
      format: "webp",
    };
  }
}

export async function optimizeReceiptImage(
  inputBuffer: Buffer,
  maxWidth = 1200,
  quality = 80
): Promise<OptimizationResult> {
  // Chain to mutex queue to guarantee sequential execution
  const task = optimizationMutex.then(
    () => runSharpPipeline(inputBuffer, maxWidth, quality),
    () => runSharpPipeline(inputBuffer, maxWidth, quality)
  );

  optimizationMutex = task.then(
    () => {},
    () => {}
  );

  return task;
}
