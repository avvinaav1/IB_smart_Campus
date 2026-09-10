import { SmartCampusApp } from "@/components/smart-campus-app";
import { developmentPreviewUser } from "@/lib/dev-preview";
export default function CertificatesPage() {
  return <SmartCampusApp previewUser={developmentPreviewUser()} initialView="certificates" />;
}
