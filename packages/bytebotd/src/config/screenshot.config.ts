import { ImageMediaType, getDisplayWidth, getDisplayHeight } from "@bytebot/shared";

type CompressionFormat = "png" | "jpeg" | "webp";

const toNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const toBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
};

const toCompressionFormat = (
  value: string | undefined,
  fallback: CompressionFormat
): CompressionFormat => {
  if (!value) {
    return fallback;
  }

  const normalized = value.toLowerCase() as CompressionFormat;
  return ["png", "jpeg", "webp"].includes(normalized)
    ? normalized
    : fallback;
};

const mediaTypeMap: Record<CompressionFormat, ImageMediaType> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const format = toCompressionFormat(
  process.env.SCREENSHOT_IMAGE_FORMAT,
  "png"
);

export const SCREENSHOT_CONFIG = {
  compressionEnabled: toBoolean(
    process.env.SCREENSHOT_COMPRESSION_ENABLED,
    true
  ),
  targetSizeKB: toNumber(process.env.SCREENSHOT_TARGET_SIZE_KB, 512),
  initialQuality: toNumber(process.env.SCREENSHOT_INITIAL_QUALITY, 85),
  minQuality: toNumber(process.env.SCREENSHOT_MIN_QUALITY, 40),
  maxWidth: getDisplayWidth(),
  maxHeight: getDisplayHeight(),
  format,
  mediaType: mediaTypeMap[format],
} as const;
