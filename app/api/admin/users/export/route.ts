import { createObjectCsvStringifier } from "csv-writer";
import type { NextRequest } from "next/server";
import { listAdminUsers, type InviteSource } from "@/lib/auth-store";
import { requireGlobalModerator } from "@/lib/moderation-auth";

export const runtime = "nodejs";

const SOURCE_LABELS: Record<InviteSource, string> = {
  code: "Invite code",
  certificate: "Certificate email",
  bootstrap: "First account",
  open: "Open registration",
  legacy: "Before invite tracking",
};

function excelSafe(value: string) {
  const normalized = value.replace(/\r\n?/g, "\n");
  return /^[\s]*[=+\-@]/.test(normalized) || /^[\t\r]/.test(normalized) ? `'${normalized}` : normalized;
}

// Every registered member with how they got in and who referred them.
export async function GET(request: NextRequest) {
  const auth = await requireGlobalModerator(request);
  if ("response" in auth) return auth.response;
  const users = await listAdminUsers((new URL(request.url).searchParams.get("query") || "").slice(0, 100));
  const csv = createObjectCsvStringifier({
    header: [
      { id: "username", title: "Username" },
      { id: "email", title: "Email" },
      { id: "campus", title: "Campus" },
      { id: "role", title: "App Role" },
      { id: "joined", title: "Registered At" },
      { id: "source", title: "Registered Via" },
      { id: "codeUsed", title: "Invite Code Used" },
      { id: "referrer", title: "Referred By" },
      { id: "referrerEmail", title: "Referrer Email" },
      { id: "ownCode", title: "Own Invite Code" },
      { id: "codeStatus", title: "Own Code Status" },
      { id: "invites", title: "Members Invited" },
    ],
    recordDelimiter: "\r\n",
  });
  const records = users.map((user) => ({
    username: excelSafe(user.username),
    email: excelSafe(user.email),
    campus: excelSafe(user.campus),
    role: user.appRole,
    joined: new Date(user.createdAt).toISOString(),
    source: SOURCE_LABELS[user.inviteSource],
    codeUsed: user.inviteCodeUsed,
    referrer: excelSafe(user.invitedBy ? `${user.invitedBy.username || "Unknown"}${user.invitedBy.deleted ? " (deleted)" : ""}` : ""),
    referrerEmail: excelSafe(user.invitedBy?.email || ""),
    ownCode: user.referralCode,
    codeStatus: user.invitesEnabled ? "Active" : "Disabled",
    invites: user.inviteCount,
  }));
  const body = `﻿${csv.getHeaderString()}${csv.stringifyRecords(records)}`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="smart-campus-registrations-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
