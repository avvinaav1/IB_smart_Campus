import type { CSSProperties } from "react";
import type { CampusEvent } from "@/lib/types";

/**
 * Human date/time for an event, collapsing a same-day range to one date.
 *  - no end:            "SEP 03 · 6:30 PM"
 *  - same-day range:    "SEP 03 · 6:30 PM – 9:30 PM"
 *  - multi-day range:   "SEP 03, 6:30 PM – SEP 04, 1:00 AM"
 */
export function eventWhen(event: Pick<CampusEvent, "month" | "day" | "time" | "endMonth" | "endDay" | "endTime">): string {
  const start = `${event.month} ${event.day} · ${event.time}`;
  if (!event.endTime) return start;
  const sameDay = event.endMonth === event.month && event.endDay === event.day;
  if (sameDay) return `${start} – ${event.endTime}`;
  return `${event.month} ${event.day}, ${event.time} – ${event.endMonth} ${event.endDay}, ${event.endTime}`;
}

/** Short "SEP 03 · 6:30 PM" start-only label for tight spots (cards, tickets). */
export function eventStartLabel(event: Pick<CampusEvent, "month" | "day" | "time">): string {
  return `${event.month} ${event.day} · ${event.time}`;
}

// Events without an end time are assumed to run this long after they start.
const DEFAULT_EVENT_DURATION_MS = 3 * 60 * 60 * 1000;

/** When an event is over: its end time, or start + 3h when no end was set. */
export function eventEndTime(event: Pick<CampusEvent, "startsAt" | "endsAt">): number {
  return event.endsAt ? new Date(event.endsAt).getTime() : new Date(event.startsAt).getTime() + DEFAULT_EVENT_DURATION_MS;
}

export function eventHasEnded(event: Pick<CampusEvent, "startsAt" | "endsAt">, now = Date.now()): boolean {
  return eventEndTime(event) <= now;
}

/** Public link to an event's share page (works signed out, with link previews). */
export function eventSharePath(eventId: string): string {
  return `/events/${encodeURIComponent(eventId)}`;
}

/** Plain-text summary of an event for posting to social media / messaging apps.
 * Pass an empty `url` when the target attaches the link separately.
 * Deliberately emoji-free: WhatsApp's share link mangles emoji (they arrive as
 * "�"), so the text uses plain labels that render the same everywhere. */
export function eventShareText(event: Pick<CampusEvent, "title" | "description" | "venueName" | "venueAddress" | "campus" | "startsAt" | "endsAt" | "month" | "day" | "time" | "endMonth" | "endDay" | "endTime">, url: string): string {
  const where = [event.venueName, event.venueAddress !== event.venueName ? event.venueAddress : "", event.campus].filter(Boolean).join(", ");
  const about = event.description.trim().length > 220 ? `${event.description.trim().slice(0, 217).trimEnd()}...` : event.description.trim();
  return [
    event.title.toUpperCase(),
    `When: ${eventWhen(event)} (IST)`,
    where && `Where: ${where}`,
    about && `\n${about}`,
    `\n${eventHasEnded(event) ? "See the event" : "Register & RSVP"} on IB Smart Campus${url ? `: ${url}` : ""}`,
  ].filter(Boolean).join("\n");
}

/** object-fit / object-position for a cover image, honouring the creator's
 * fit choice and focal point. Spread onto an <Image>/<img> `style`. */
export function coverImageStyle(event: Pick<CampusEvent, "coverFit" | "coverFocusX" | "coverFocusY">): CSSProperties {
  return {
    objectFit: event.coverFit === "fit" ? "contain" : "cover",
    objectPosition: `${event.coverFocusX ?? 50}% ${event.coverFocusY ?? 50}%`,
  };
}
