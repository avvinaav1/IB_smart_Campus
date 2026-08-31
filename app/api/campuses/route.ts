import type { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/auth-http";
import { searchIndianCampuses } from "@/lib/campus-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() || "";
  if (query.length < 2 || query.length > 100) return noStoreJson({ data: { campuses: [] } });
  return noStoreJson({ data: { campuses: await searchIndianCampuses(query) } });
}
