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

/** object-fit / object-position for a cover image, honouring the creator's
 * fit choice and focal point. Spread onto an <Image>/<img> `style`. */
export function coverImageStyle(event: Pick<CampusEvent, "coverFit" | "coverFocusX" | "coverFocusY">): CSSProperties {
  return {
    objectFit: event.coverFit === "fit" ? "contain" : "cover",
    objectPosition: `${event.coverFocusX ?? 50}% ${event.coverFocusY ?? 50}%`,
  };
}
