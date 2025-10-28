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
