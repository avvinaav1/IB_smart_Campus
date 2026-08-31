import { createObjectCsvStringifier } from "csv-writer";
import type { NextRequest } from "next/server";
import { getEventAttendeeUsers } from "@/lib/auth-store";
import { authenticatedUserId } from "@/lib/auth-http";
import { answerForCsv, listEventRsvpsForManager } from "@/lib/event-store";

export const runtime = "nodejs";

function excelSafe(value: string) {
  const normalized = value.replace(/\r\n?/g, "\n");
  return /^[\s]*[=+\-@]/.test(normalized) || /^[\t\r]/.test(normalized) ? `'${normalized}` : normalized;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await authenticatedUserId(request);
  if (!userId) return Response.json({ error: "Your session has expired." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const { id } = await params;
  const result = await listEventRsvpsForManager(id, userId);
  if ("error" in result) return Response.json({ error: result.error }, { status: result.status, headers: { "Cache-Control": "no-store" } });
  const users = await getEventAttendeeUsers(result.rsvps.map((rsvp) => rsvp.userId));
  const customHeaders = result.event.customFormSchema.fields.map((field) => ({ id: `question_${field.id}`, title: excelSafe(field.label) }));
  const csv = createObjectCsvStringifier({
    header: [
      { id: "username", title: "Name" },
      { id: "email", title: "Email" },
      { id: "rsvpStatus", title: "RSVP Status" },
      { id: "checkInStatus", title: "Check-in Status" },
      { id: "checkInCode", title: "Check-in Code" },
      { id: "createdAt", title: "RSVP Date" },
      ...customHeaders,
    ],
    recordDelimiter: "\r\n",
  });
  const records = result.rsvps.flatMap((rsvp) => {
    const user = users.get(rsvp.userId);
    if (!user) return [];
    const customAnswers = Object.fromEntries(result.event.customFormSchema.fields.map((field) => [`question_${field.id}`, excelSafe(answerForCsv(field, rsvp.customFormAnswers[field.id]))]));
    return [{ username: excelSafe(user.username), email: excelSafe(user.email), rsvpStatus: rsvp.rsvpStatus, checkInStatus: rsvp.status, checkInCode: rsvp.checkInCode, createdAt: new Date(rsvp.createdAt).toISOString(), ...customAnswers }];
  });
  const body = `\uFEFF${csv.getHeaderString()}${csv.stringifyRecords(records)}`;
  const filename = `${result.event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "event"}-rsvps.csv`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
