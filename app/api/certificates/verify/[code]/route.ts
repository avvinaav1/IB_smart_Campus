import type { NextRequest } from "next/server";
import { firestore } from "@/lib/firebase-admin";
import { lookupVerification } from "@/lib/certificates/verification-store";
import { verificationResponse } from "@/lib/certificates/verification-api";
import { verificationClientKey, verificationQuota } from "@/lib/certificates/verification-limit";
import { authenticatedUserId, noStoreJson } from "@/lib/auth-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: { params: Promise<{ code: string }> }) {
  if (!await authenticatedUserId(request)) return noStoreJson({ error: "Sign in to verify a certificate." }, { status: 401 });
  return verificationResponse((await context.params).code, () => verificationQuota(firestore(), verificationClientKey(request.headers)), code => lookupVerification(firestore(), code));
}
