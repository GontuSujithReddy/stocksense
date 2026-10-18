import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const DELIVERY_OTP_TTL_MS = 10 * 60 * 1000;
export const DELIVERY_OTP_MAX_ATTEMPTS = 5;
export const DELIVERY_OTP_MAX_SENDS = 6;
export const DELIVERY_OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const DELIVERY_CHAT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createDeliveryOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashDeliveryOtp(operationId: number, otp: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("The delivery verification secret is not configured.");
  return createHmac("sha256", secret).update(`delivery-otp:${operationId}:${otp}`).digest("hex");
}

export function deliveryOtpMatches(operationId: number, otp: string, expectedHash: string): boolean {
  const candidate = Buffer.from(hashDeliveryOtp(operationId, otp), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function createDeliveryChatToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDeliveryChatToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function maskCustomerEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain, ...extra] = email.split("@");
  if (!local || !domain || extra.length) return null;
  const visibleLocal = local.length > 1 ? local.slice(0, 1) : local;
  return `${visibleLocal}${"*".repeat(Math.min(Math.max(local.length - 1, 2), 6))}@${domain}`;
}
