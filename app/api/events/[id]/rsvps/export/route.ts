import { createObjectCsvStringifier } from "csv-writer";
import type { NextRequest } from "next/server";
import { getEventAttendeeUsers, getFreshSession } from "@/lib/auth-store";
import { SESSION_COOKIE } from "@/lib/auth-http";
import { answerForCsv, listEventRsvpsForManager } from "@/lib/event-store";
import { isGlobalModerator } from "@/lib/moderation-policy";

export const runtime = "nodejs";

function excelSafe(value: string) {
  const normalized = value.replace(/\r\n?/g, "\n");
  return /^[\s]*[=+\-@]/.test(normalized) || /^[\t\r]/.test(normalized) ? `'${normalized}` : normalized;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getFreshSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return Response.json({ error: "Your session has expired." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const { id } = await params;
  const result = await listEventRsvpsForManager(id, session.id, { globalModerator: isGlobalModerator(session.appRole) });
  if ("error" in result) return Response.json({ error: result.error }, { status: result.status, headers: { "Cache-Control": "no-store" } });
  const users = await getEventAttendeeUsers(result.rsvps.map((rsvp) => rsvp.userId));
  const customHeaders = result.event.customFormSchema.fields.map((field) => ({ id: `question_${field.id}`, title: excelSafe(field.label) }));
  const csv = createObjectCsvStringifier({
    header: [
      { id: "username", title: "Name" },
      { id: "email", title: "Email" },
      { id: "phone", title: "Phone" },
      { id: "institution", title: "Institution" },
      { id: "studentId", title: "Student ID" },
      { id: "registrationSource", title: "Registration Source" },
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
    if (!user && rsvp.registrationSource !== "MANUAL_WALK_IN") return [];
    const customAnswers = Object.fromEntries(result.event.customFormSchema.fields.map((field) => [`question_${field.id}`, excelSafe(answerForCsv(field, rsvp.customFormAnswers[field.id]))]));
    return [{ username: excelSafe(rsvp.participantName || user?.username || "Walk-in attendee"), email: excelSafe(rsvp.participantEmail || user?.email || ""), phone: excelSafe(rsvp.participantPhone || ""), institution: excelSafe(rsvp.institution || ""), studentId: excelSafe(rsvp.studentId || ""), registrationSource: rsvp.registrationSource === "MANUAL_WALK_IN" ? "Manual Walk-In" : "Online", rsvpStatus: rsvp.rsvpStatus, checkInStatus: rsvp.status, checkInCode: rsvp.checkInCode, createdAt: new Date(rsvp.createdAt).toISOString(), ...customAnswers }];
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
