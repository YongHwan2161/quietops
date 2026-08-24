import { createHash, timingSafeEqual } from "node:crypto";

const MIN_OPERATOR_TOKEN_BYTES = 32;
const MAX_OPERATOR_TOKEN_BYTES = 256;

export function normalizeOperatorToken(value: string): string {
  const bytes = Buffer.byteLength(value, "utf8");
  if (
    value.trim() !== value ||
    /\s|[\u0000-\u001f\u007f]/.test(value) ||
    bytes < MIN_OPERATOR_TOKEN_BYTES ||
    bytes > MAX_OPERATOR_TOKEN_BYTES
  ) {
    throw new Error(
      "Operator token must be 32-256 bytes without whitespace or control characters.",
    );
  }
  return value;
}

export function verifyOperatorBearer(
  authorization: string | readonly string[] | undefined,
  expectedToken: string,
): boolean {
  const header = typeof authorization === "string" ? authorization : "";
  const match = /^Bearer ([^\s]+)$/.exec(header);
  const suppliedToken = match?.[1] ?? "";
  const expectedDigest = createHash("sha256").update(expectedToken).digest();
  const suppliedDigest = createHash("sha256").update(suppliedToken).digest();
  const equal = timingSafeEqual(expectedDigest, suppliedDigest);
  return match !== null && equal;
}
