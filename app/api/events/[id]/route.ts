import type { NextRequest } from "next/server";
import { authenticatedUserId, isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";
import { type EventUpdateInput, getEvent, updateEvent } from "@/lib/event-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const { id } = await context.params;
  const event = await getEvent(id, userId);
  return event ? noStoreJson({ data: { event } }) : noStoreJson({ error: "Event not found." }, { status: 404 });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const { id } = await context.params;
  const body = await readJson(request);
  if (!body) return noStoreJson({ error: "The event body is invalid." }, { status: 400 });

  const patch: EventUpdateInput = {};
  if (typeof body.title === "string") patch.title = body.title;
  if (typeof body.description === "string") patch.description = body.description;
  if (typeof body.category === "string") patch.category = body.category;
  if (typeof body.location === "string") patch.location = body.location;
  if (typeof body.venueName === "string") patch.venueName = body.venueName;
  if (typeof body.venueAddress === "string") patch.venueAddress = body.venueAddress;
  if (typeof body.directionsUrl === "string") patch.directionsUrl = body.directionsUrl;
  if (typeof body.campus === "string") patch.campus = body.campus;
  if (typeof body.community === "string") patch.community = body.community === "None" ? undefined : body.community;
  if (typeof body.startsAt === "string") patch.startsAt = body.startsAt;
  if (typeof body.endsAt === "string") patch.endsAt = body.endsAt; // "" clears the end
  if (typeof body.capacity === "number") patch.capacity = body.capacity;
  if (typeof body.imageUrl === "string") patch.imageUrl = body.imageUrl;
  if (body.coverFit === "fill" || body.coverFit === "fit") patch.coverFit = body.coverFit;
  if (typeof body.coverFocusX === "number") patch.coverFocusX = body.coverFocusX;
  if (typeof body.coverFocusY === "number") patch.coverFocusY = body.coverFocusY;
  if (body.customFormSchema !== undefined) patch.customFormSchema = body.customFormSchema as EventUpdateInput["customFormSchema"];

  const result = await updateEvent(id, userId, patch);
  return "error" in result
    ? noStoreJson({ error: result.error }, { status: result.status })
    : noStoreJson({ data: { event: result.event } });
}
