import * as sharp from 'sharp';

interface CompressionOptions {
  targetSizeKB?: number;
  initialQuality?: number;
  minQuality?: number;
  format?: 'png' | 'jpeg' | 'webp';
  maxIterations?: number;
  maxWidth?: number;
  maxHeight?: number;
}

interface CompressionResult {
  base64: string;
  sizeBytes: number;
  sizeKB: number;
  sizeMB: number;
  quality: number;
  format: string;
  iterations: number;
}

class Base64ImageCompressor {
  /**
   * Compress a base64 PNG string to under specified size (default 1MB)
   */
  static async compressToSize(
    base64String: string,
    options: CompressionOptions = {},
  ): Promise<CompressionResult> {
    const {
      targetSizeKB = 1024, // 1MB default
      initialQuality = 95,
      minQuality = 10,
      format = 'png',
      maxIterations = 10,
    } = options;

    // Extract base64 data (remove data URL prefix if present)
    const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
    const inputBuffer = Buffer.from(base64Data, 'base64');

    let quality = initialQuality;
    let outputBuffer: Buffer;
    let iterations = 0;

    // Binary search for optimal quality
    let low = minQuality;
    let high = initialQuality;
    let bestResult: { buffer: Buffer; quality: number } | null = null;

    while (low <= high && iterations < maxIterations) {
      quality = Math.floor((low + high) / 2);

      outputBuffer = await this.compressBuffer(inputBuffer, quality, format);
      const sizeKB = outputBuffer.length / 1024;

      if (sizeKB <= targetSizeKB) {
        // Size is acceptable, try higher quality
        bestResult = { buffer: outputBuffer, quality };
        low = quality + 1;
      } else {
        // Size too large, reduce quality
        high = quality - 1;
      }

      iterations++;
    }

    // If no result found under target size, use lowest quality
    if (!bestResult) {
      outputBuffer = await this.compressBuffer(inputBuffer, minQuality, format);
      quality = minQuality;
    } else {
      outputBuffer = bestResult.buffer;
      quality = bestResult.quality;
    }

    // Convert back to base64
    const outputBase64 = outputBuffer.toString('base64');
    const sizeBytes = outputBuffer.length;

    return {
      base64: outputBase64,
      sizeBytes,
      sizeKB: sizeBytes / 1024,
      sizeMB: sizeBytes / (1024 * 1024),
      quality,
      format,
      iterations,
    };
  }

  /**
   * Compress buffer with specified quality
   */
  private static async compressBuffer(
    inputBuffer: Buffer,
    quality: number,
    format: 'png' | 'jpeg' | 'webp',
  ): Promise<Buffer> {
    const sharpInstance = sharp(inputBuffer);

    switch (format) {
      case 'png':
        return sharpInstance
          .png({
            quality,
            compressionLevel: 9,
            adaptiveFiltering: true,
            palette: true,
          })
          .toBuffer();

      case 'jpeg':
        return sharpInstance
          .jpeg({
            quality,
            progressive: true,
            mozjpeg: true,
            optimizeScans: true,
          })
          .toBuffer();

      case 'webp':
        return sharpInstance
          .webp({
            quality,
            alphaQuality: quality,
            lossless: false,
            nearLossless: false,
            smartSubsample: true,
          })
          .toBuffer();

      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * Compress with dimension reduction if quality alone isn't enough
   */
  static async compressWithResize(
    base64String: string,
    options: CompressionOptions & {
      maxWidth?: number;
      maxHeight?: number;
    } = {},
  ): Promise<CompressionResult> {
    const {
      targetSizeKB = 1024,
      maxWidth = 2048,
      maxHeight = 2048,
      ...compressionOptions
    } = options;

    const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
    const inputBuffer = Buffer.from(base64Data, 'base64');
    const constrainedBuffer = await this.resizeToFitDimensions(
      inputBuffer,
      maxWidth,
      maxHeight,
    );
    const constrainedBase64 = constrainedBuffer.toString('base64');

    // First try compression without additional resizing
    let result = await this.compressToSize(
      constrainedBase64,
      compressionOptions,
    );

    // If still too large, apply progressive resizing
    if (result.sizeKB > targetSizeKB) {
      const metadata = await sharp(constrainedBuffer).metadata();
      const originalWidth = metadata.width || maxWidth;
      const originalHeight = metadata.height || maxHeight;

      let scale = 0.9; // Start with 90% of original size

      while (result.sizeKB > targetSizeKB && scale > 0.3) {
        const newWidth =
          typeof originalWidth === 'number'
            ? Math.max(Math.floor(originalWidth * scale), 1)
            : undefined;
        const newHeight =
          typeof originalHeight === 'number'
            ? Math.max(Math.floor(originalHeight * scale), 1)
            : undefined;

        const resizedBuffer = await sharp(constrainedBuffer)
          .resize({
            width: newWidth,
            height: newHeight,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .toBuffer();

        const resizedBase64 = resizedBuffer.toString('base64');

        result = await this.compressToSize(resizedBase64, compressionOptions);
        scale -= 0.1;
      }
    }

    return result;
  }

  private static async resizeToFitDimensions(
    inputBuffer: Buffer,
    maxWidth?: number,
    maxHeight?: number,
  ): Promise<Buffer> {
    if (!maxWidth && !maxHeight) {
      return inputBuffer;
    }

    const metadata = await sharp(inputBuffer).metadata();
    const currentWidth = metadata.width;
    const currentHeight = metadata.height;

    const exceedsWidth =
      typeof maxWidth === 'number' &&
      typeof currentWidth === 'number' &&
      currentWidth > maxWidth;
    const exceedsHeight =
      typeof maxHeight === 'number' &&
      typeof currentHeight === 'number' &&
      currentHeight > maxHeight;

    if (!exceedsWidth && !exceedsHeight) {
      return inputBuffer;
    }

    return sharp(inputBuffer)
      .resize({
        width: maxWidth,
        height: maxHeight,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .toBuffer();
  }

  /**
   * Get size information for a base64 string
   */
  static getBase64SizeInfo(base64String: string): {
    bytes: number;
    kb: number;
    mb: number;
    formatted: string;
  } {
    const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
    const bytes = Buffer.from(base64Data, 'base64').length;
    const kb = bytes / 1024;
    const mb = bytes / (1024 * 1024);

    let formatted: string;
    if (mb >= 1) {
      formatted = `${mb.toFixed(2)} MB`;
    } else if (kb >= 1) {
      formatted = `${kb.toFixed(2)} KB`;
    } else {
      formatted = `${bytes} bytes`;
    }

    return { bytes, kb, mb, formatted };
  }
}

// Utility function for quick compression
export async function compressPngBase64Under1MB(
  base64String: string,
): Promise<string> {
  const result = await Base64ImageCompressor.compressToSize(base64String, {
    targetSizeKB: 1024,
    format: 'png',
    initialQuality: 95,
    minQuality: 10,
  });

  return result.base64;
}

// Export the class for more control
export { Base64ImageCompressor, CompressionOptions, CompressionResult };
