// Shared syntax only: the browser never issues an authentic verification code.
export const VERIFICATION_VARIABLE = "verification_code";
export const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const CODE_LENGTH = 12;
export function isVerificationVariable(value: string) { return value.trim().toLowerCase() === VERIFICATION_VARIABLE; }
export function normalizeVerificationCode(value: string) { return value.trim().toUpperCase(); }
export function validVerificationCode(value: string) { return /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/.test(value); }
export type VerificationDetails = { verificationCode: string; recipientName: string; courseName: string; issuedAt: number; issuerName: string };
export function publicVerification(certificate: Record<string, unknown> | undefined, code: string): VerificationDetails | null {
  if (!certificate || certificate.source !== "internal" || certificate.status !== "active" || certificate.verificationCode !== code || typeof certificate.assetId !== "string") return null;
  if (typeof certificate.recipientName !== "string" || typeof certificate.courseName !== "string" || typeof certificate.issuedAt !== "number" || typeof certificate.issuerName !== "string") return null;
  return { verificationCode: code, recipientName: certificate.recipientName, courseName: certificate.courseName, issuedAt: certificate.issuedAt, issuerName: certificate.issuerName };
}
