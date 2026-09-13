import "server-only";

export function listRequest(url: string) {
  const params = new URL(url).searchParams;
  const requested = Number(params.get("limit") || 25);
  const limit = Number.isFinite(requested) ? Math.min(100, Math.max(1, Math.floor(requested))) : 25;
  let offset = 0;
  const cursor = params.get("cursor");
  if (cursor) {
    try { offset = Math.max(0, Number.parseInt(Buffer.from(cursor, "base64url").toString("utf8"), 10) || 0); }
    catch { offset = 0; }
  }
  return { query: (params.get("query") || "").slice(0, 100), status: params.get("status") || "", limit, offset };
}

export function pageItems<T>(items: T[], offset: number, limit: number) {
  const page = items.slice(offset, offset + limit);
  const nextCursor = offset + page.length < items.length ? Buffer.from(String(offset + page.length)).toString("base64url") : null;
  return { items: page, nextCursor };
}
