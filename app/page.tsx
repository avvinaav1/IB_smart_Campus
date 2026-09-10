import { SmartCampusApp } from "@/components/smart-campus-app";
import { developmentPreviewUser } from "@/lib/dev-preview";

export default function Page() {
  return <SmartCampusApp previewUser={developmentPreviewUser()} />;
}
