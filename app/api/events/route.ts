import type { NextRequest } from "next/server";
import { authenticatedUserId, isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";
import { createEvent, listEvents, type CoverFit, type NewEventInput, validateEventInput } from "@/lib/event-store";

export const runtime = "nodejs";

function coverFit(value: unknown): CoverFit {
  return value === "fit" ? "fit" : "fill";
}

function focus(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : fallback;
}

export async function GET(request: NextRequest) {
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  return noStoreJson({ data: { events: await listEvents(userId) } });
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const body = await readJson(request);
  if (!body) return noStoreJson({ error: "The event body is invalid." }, { status: 400 });
  const input: NewEventInput = {
    title: typeof body.title === "string" ? body.title : "",
    description: typeof body.description === "string" ? body.description : "",
    category: typeof body.category === "string" ? body.category : "",
    location: typeof body.location === "string" ? body.location : "",
    venueName: typeof body.venueName === "string" ? body.venueName : "",
    venueAddress: typeof body.venueAddress === "string" ? body.venueAddress : "",
    directionsUrl: typeof body.directionsUrl === "string" ? body.directionsUrl : "",
    campus: typeof body.campus === "string" ? body.campus : "",
    community: typeof body.community === "string" && body.community !== "None" ? body.community : undefined,
    startsAt: typeof body.startsAt === "string" ? body.startsAt : "",
    endsAt: typeof body.endsAt === "string" && body.endsAt ? body.endsAt : undefined,
    capacity: typeof body.capacity === "number" ? body.capacity : Number.NaN,
    imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : "",
    coverFit: coverFit(body.coverFit),
    coverFocusX: focus(body.coverFocusX, 50),
    coverFocusY: focus(body.coverFocusY, 50),
    customFormSchema: body.customFormSchema as NewEventInput["customFormSchema"],
  };
  const validationError = validateEventInput(input);
  if (validationError) return noStoreJson({ error: validationError }, { status: 400 });
  const event = await createEvent(userId, input);
  return noStoreJson({ data: { event } }, { status: 201 });
}
