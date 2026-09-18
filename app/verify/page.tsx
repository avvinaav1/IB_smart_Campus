import type { Metadata } from "next";
import { SmartCampusApp } from "@/components/smart-campus-app";
import { developmentPreviewUser } from "@/lib/dev-preview";
export const metadata: Metadata = { title: "Verify a certificate | IB Smart Campus", description: "Check the issuance details of an IB Smart Campus certificate." };
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const params = await searchParams;
  return <SmartCampusApp previewUser={developmentPreviewUser()} initialView="certificates" initialVerificationCode={typeof params.code === "string" ? params.code.slice(0, 24) : ""} />;
}
