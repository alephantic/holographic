import { timingSafeEqual } from "node:crypto";

// Optional shared access key. When HOLOGRAPHIC_ACCESS_KEY is set, chat requests
// must carry the same value in the x-holographic-key header. This is a simple
// gate on who can spend the model credential, not a user system.

export const ACCESS_HEADER = "x-holographic-key";

function configuredKey(): string | undefined {
  const value = process.env.HOLOGRAPHIC_ACCESS_KEY?.trim();
  return value ? value : undefined;
}

export function accessKeyRequired(): boolean {
  return configuredKey() !== undefined;
}

/** True when no key is required, or the supplied one matches (constant-time compare). */
export function accessGranted(supplied: string | undefined): boolean {
  const expected = configuredKey();
  if (!expected) return true;
  if (!supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}
