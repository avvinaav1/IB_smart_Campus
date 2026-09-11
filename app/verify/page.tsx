import type { Metadata } from "next";
import VerificationPortal from "@/components/certificates/verification-portal";
import "./verify.css";
export const metadata: Metadata = { title: "Verify a certificate | IB Smart Campus", description: "Check the issuance details of an IB Smart Campus certificate." };
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const params = await searchParams;
  return <VerificationPortal initialCode={typeof params.code === "string" ? params.code.slice(0, 24) : ""} />;
}
