import { normalizeVerificationCode, validVerificationCode, type VerificationDetails } from "./verification-code";
export async function verificationResponse(code: string, quota: () => Promise<{ allowed: boolean; retryAfter: number }>, lookup: (code: string) => Promise<VerificationDetails | null>) {
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
  try {
    const limit = await quota();
    if (!limit.allowed) return Response.json({ error: "Too many verification attempts. Please try again shortly." }, { status: 429, headers: { ...headers, "Retry-After": String(limit.retryAfter) } });
    const normalized = normalizeVerificationCode(code);
    const certificate = validVerificationCode(normalized) ? await lookup(normalized) : null;
    return certificate ? Response.json({ valid: true, certificate }, { headers }) : Response.json({ valid: false, error: "Invalid or Not Found" }, { status: 404, headers });
  } catch {
    return Response.json({ error: "Verification is temporarily unavailable. Please try again later." }, { status: 503, headers });
  }
}
