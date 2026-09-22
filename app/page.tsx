import { SmartCampusApp } from "@/components/smart-campus-app";
import { developmentPreviewUser } from "@/lib/dev-preview";
import type { View } from "@/lib/types";

const linkedViews = new Set<View>(["home", "explore", "events", "rewards", "chat", "profile", "certificates", "admin", "institute"]);

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string; community?: string; requests?: string; claimEmail?: string }> }) {
  const params = await searchParams;
  const initialView = linkedViews.has(params.view as View) ? params.view as View : "home";
  return <SmartCampusApp previewUser={developmentPreviewUser()} initialView={initialView} initialCommunityId={params.community || ""} initialChatRequests={params.requests === "follow" || params.requests === "message"} claimEmail={(params.claimEmail || "").slice(0, 254)} />;
}


