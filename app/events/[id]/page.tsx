import type { Metadata } from "next";
import Link from "next/link";
import { getPublicEvent } from "@/lib/event-store";
import { eventHasEnded, eventSharePath, eventWhen } from "@/lib/event-format";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

function summary(description: string) {
  const text = description.trim();
  return text.length > 180 ? `${text.slice(0, 177).trimEnd()}…` : text;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const event = await getPublicEvent(id);
  if (!event) return { title: "Event not available", robots: { index: false, follow: false } };
  const when = `${eventWhen(event)} IST`;
  const where = [event.venueName, event.campus].filter(Boolean).join(" · ");
  const description = [when, where, summary(event.description)].filter(Boolean).join(" — ");
  const url = `${SITE_URL}${eventSharePath(event.id)}`;
  const banner = { url: `${url}/banner`, width: 1200, height: 630, type: "image/jpeg", alt: event.title };
  return {
    title: event.title,
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", title: event.title, description, url, siteName: "IB Smart Campus", images: [banner] },
    twitter: { card: "summary_large_image", title: event.title, description, images: [banner] },
  };
}

export default async function EventSharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await getPublicEvent(id);
  if (!event) return <main className="event-public-page"><Link href="/">← Smart Campus</Link><div className="event-public-missing"><h1>Event not available</h1><p>This event is no longer published or the link is wrong.</p></div></main>;
  const ended = eventHasEnded(event);
  return (
    <main className="event-public-page">
      <Link href="/">← Smart Campus</Link>
      <article className="event-public-card">
        <div className="event-public-cover">
          {/* eslint-disable-next-line @next/next/no-img-element -- cover may be a remote URL or our image route */}
          <img src={event.imageUrl} alt="" />
          <span>{ended ? "Completed" : event.category}</span>
        </div>
        <div className="event-public-copy">
          <p className="event-public-when">{eventWhen(event)} IST</p>
          <h1>{event.title}</h1>
          <p className="event-public-where"><b>{event.venueName}</b>{event.venueAddress && event.venueAddress !== event.venueName ? ` · ${event.venueAddress}` : ""}{event.campus ? ` · ${event.campus}` : ""}</p>
          {event.description && <p className="event-public-description">{event.description}</p>}
          <p className="event-public-count">{event.going} going{!ended && event.capacity ? ` · ${Math.max(0, event.capacity - event.going)} spots left` : ""}</p>
          <div className="event-public-actions">
            <Link className="event-public-cta" href={`/?view=events&event=${encodeURIComponent(event.id)}`}>{ended ? "View on Smart Campus" : "Register on Smart Campus"}</Link>
            {event.directionsUrl && <a href={event.directionsUrl} target="_blank" rel="noreferrer">Directions</a>}
          </div>
        </div>
      </article>
    </main>
  );
}
