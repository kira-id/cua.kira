import type { Coordinates } from "../types/computerAction.types";

type EnvHolder = {
  process?: { env?: Record<string, string | undefined> };
};

export function getDesktopBaseUrl(rawValue?: string): string {
  const envValue =
    rawValue ??
    ((globalThis as EnvHolder).process?.env?.BYTEBOT_DESKTOP_BASE_URL);
  const value = envValue?.trim();

  if (!value) {
    throw new Error(
      'BYTEBOT_DESKTOP_BASE_URL environment variable is not set. ' +
        'Point it at the bytebot-desktop service (e.g. http://localhost:9990 when running locally ' +
        'or http://bytebot-desktop:9990 when running with Docker Compose).',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new Error(
      `Invalid BYTEBOT_DESKTOP_BASE_URL "${value}". ` +
        'Provide an absolute URL such as http://localhost:9990.',
    );
  }

  const normalized = parsed.toString();
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

export function getDisplayWidth(): number {
  const envValue = (globalThis as EnvHolder).process?.env?.DISPLAY_WIDTH;
  const parsed = parseInt(envValue?.trim() ?? '', 10);
  return isNaN(parsed) ? 1280 : parsed;
}

export function getDisplayHeight(): number {
  const envValue = (globalThis as EnvHolder).process?.env?.DISPLAY_HEIGHT;
  const parsed = parseInt(envValue?.trim() ?? '', 10);
  return isNaN(parsed) ? 960 : parsed;
}

export function getScreenDimensions(): { width: number; height: number } {
  return {
    width: getDisplayWidth(),
    height: getDisplayHeight(),
  };
}

export type CoordinateOptions = {
  validate?: boolean;
  sanitize?: boolean;
  throwOnInvalid?: boolean;
};


export function validateCoordinates(coords?: Coordinates): coords is Coordinates {
  if (!coords) return false;
  return (
    typeof coords.x === 'number' &&
    typeof coords.y === 'number' &&
    !isNaN(coords.x) &&
    !isNaN(coords.y) &&
    isFinite(coords.x) &&
    isFinite(coords.y)
  );
}

export function sanitizeCoordinates(coords: Coordinates): Coordinates {
  return {
    x: Math.max(0, Math.round(coords.x)),
    y: Math.max(0, Math.round(coords.y)),
  };
}

export function normalizeCoordinates(
  coords: Coordinates | [number, number] | undefined,
  options: CoordinateOptions = {}
): Coordinates | undefined {
  const { validate = false, sanitize = false, throwOnInvalid = false } = options;

  if (!coords) {
    if (throwOnInvalid) {
      throw new Error('Invalid coordinates provided');
    }
    return undefined;
  }

  // Convert array format [x, y] to object format {x, y}
  let coordinateObj: Coordinates;
  if (Array.isArray(coords)) {
    coordinateObj = { x: coords[0], y: coords[1] };
  } else {
    coordinateObj = coords;
  }

  if (validate && !validateCoordinates(coordinateObj)) {
    if (throwOnInvalid) {
      throw new Error('Invalid coordinates provided');
    }
    return undefined;
  }

  let normalized = coordinateObj;

  if (sanitize) {
    normalized = sanitizeCoordinates(coordinateObj);
  }

  // Ensure coordinates are within screen bounds
  const screen = getScreenDimensions();
  normalized = {
    x: Math.max(0, Math.min(normalized.x, screen.width - 1)),
    y: Math.max(0, Math.min(normalized.y, screen.height - 1)),
  };

  return normalized;
}
