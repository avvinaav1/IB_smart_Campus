import "server-only";

import { randomInt, randomUUID } from "node:crypto";
import { mutateDocument, readDocument } from "@/lib/firebase-admin";
import { events as initialEvents } from "@/lib/data";
import type { CampusEvent, CoverFit, CustomFormAnswers, CustomFormField, CustomFormSchema } from "@/lib/types";

export type { CoverFit } from "@/lib/types";

export type RsvpStatus = "going" | "waitlisted";
export type CheckInStatus = "REGISTERED" | "CHECKED_IN";

type StoredEvent = {
  id: string;
  creatorId: string;
  title: string;
  description: string;
  category: string;
  location: string;
  venueName: string;
  venueAddress: string;
  directionsUrl: string;
  campus: string;
  community?: string;
  startsAt: string;
  endsAt?: string;
  capacity: number;
  imageUrl: string;
  coverFit: CoverFit;
  coverFocusX: number;
  coverFocusY: number;
  customFormSchema: CustomFormSchema;
  createdAt: number;
  updatedAt: number;
};

export type RsvpRecord = {
  id: string;
  eventId: string;
  userId: string;
  rsvpStatus: RsvpStatus;
  customFormAnswers: CustomFormAnswers;
  checkInCode: string;
  status: CheckInStatus;
  checkedInAt?: number;
  checkedInBy?: string;
  createdAt: number;
  updatedAt: number;
};

export type EventAdminRecord = {
  id: string;
  eventId: string;
  userId: string;
  addedBy: string;
  createdAt: number;
};

type EventDatabase = {
  version: 4;
  events: Record<string, StoredEvent>;
  rsvps: Record<string, RsvpRecord>;
  eventAdmins: Record<string, EventAdminRecord>;
  rsvpIndex: Record<string, string>;
  checkInCodeIndex: Record<string, string>;
  eventAdminIndex: Record<string, string>;
};

type LegacyEventDatabase = {
  version?: number;
  events?: Record<string, Partial<StoredEvent>>;
  rsvps?: Record<string, Omit<Partial<RsvpRecord>, "status"> & { status?: string }>;
  eventAdmins?: Record<string, Partial<EventAdminRecord>>;
};

export type NewEventInput = {
  title: string;
  description: string;
  category: string;
  location: string;
  venueName: string;
  venueAddress: string;
  directionsUrl: string;
  campus: string;
  community?: string;
  startsAt: string;
  endsAt?: string;
  capacity: number;
  imageUrl: string;
  coverFit: CoverFit;
  coverFocusX: number;
  coverFocusY: number;
  customFormSchema: CustomFormSchema;
};

// Every field optional: the creator edits only what changed. `endsAt: ""` clears
// a previously set end.
export type EventUpdateInput = Partial<NewEventInput>;

const EMPTY_FORM_SCHEMA: CustomFormSchema = { version: 1, fields: [] };
const CHECK_IN_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const STORE_DOC = process.env.EVENTS_STORE_DOC || "events";
let writeQueue: Promise<unknown> = Promise.resolve();

function clampPercent(value: unknown, fallback = 50) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : fallback;
}

function rsvpKey(eventId: string, userId: string) { return `${eventId}:${userId}`; }
function eventAdminKey(eventId: string, userId: string) { return `${eventId}:${userId}`; }
function isPlainObject(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function validId(value: unknown) { return typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value); }

export function validateCustomFormSchema(input: unknown) {
  if (!isPlainObject(input) || input.version !== 1 || !Array.isArray(input.fields)) return "The registration form is invalid.";
  if (input.fields.length > 30) return "Registration forms can contain at most 30 questions.";
  if (JSON.stringify(input).length > 65_536) return "The registration form is too large.";
  const fieldIds = new Set<string>();
  for (const rawField of input.fields) {
    if (!isPlainObject(rawField) || !validId(rawField.id) || fieldIds.has(rawField.id as string)) return "Every registration question needs a unique ID.";
    fieldIds.add(rawField.id as string);
    if (typeof rawField.label !== "string" || !rawField.label.trim() || rawField.label.trim().length > 120) return "Question labels must be 1–120 characters.";
    if (typeof rawField.required !== "boolean") return "Every registration question must specify whether it is required.";
    if (rawField.type === "short_text" || rawField.type === "long_text") {
      if (rawField.placeholder !== undefined && (typeof rawField.placeholder !== "string" || rawField.placeholder.length > 160)) return "Question placeholders must be 160 characters or fewer.";
      if (rawField.maxLength !== undefined && (!Number.isInteger(rawField.maxLength) || (rawField.maxLength as number) < 1 || (rawField.maxLength as number) > 5_000)) return "Text limits must be between 1 and 5,000 characters.";
      continue;
    }
    if (rawField.type === "number") {
      if (rawField.min !== undefined && (typeof rawField.min !== "number" || !Number.isFinite(rawField.min))) return "Number minimums must be finite numbers.";
      if (rawField.max !== undefined && (typeof rawField.max !== "number" || !Number.isFinite(rawField.max))) return "Number maximums must be finite numbers.";
      if (typeof rawField.min === "number" && typeof rawField.max === "number" && rawField.min > rawField.max) return "A number question's minimum cannot exceed its maximum.";
      continue;
    }
    if (rawField.type === "select") {
      if (!Array.isArray(rawField.options) || rawField.options.length < 2 || rawField.options.length > 50) return "Dropdown questions need 2–50 options.";
      const optionIds = new Set<string>();
      const optionValues = new Set<string>();
      for (const option of rawField.options) {
        if (!isPlainObject(option) || !validId(option.id) || optionIds.has(option.id as string)) return "Every dropdown option needs a unique ID.";
        if (typeof option.label !== "string" || !option.label.trim() || option.label.trim().length > 120) return "Dropdown labels must be 1–120 characters.";
        if (typeof option.value !== "string" || !option.value.trim() || option.value.length > 120 || optionValues.has(option.value)) return "Dropdown option values must be unique and 1–120 characters.";
        optionIds.add(option.id as string);
        optionValues.add(option.value);
      }
      continue;
    }
    if (rawField.type !== "checkbox") return "Choose a supported registration question type.";
  }
  return "";
}

function normalizeFormSchema(value: unknown): CustomFormSchema {
  return validateCustomFormSchema(value) ? { ...EMPTY_FORM_SCHEMA } : value as CustomFormSchema;
}

function normalizeAnswers(schema: CustomFormSchema, input: unknown): { answers: CustomFormAnswers } | { error: string } {
  if (!isPlainObject(input)) return { error: "Submit your registration answers as an object." };
  const fieldsById = new Map(schema.fields.map((field) => [field.id, field]));
  if (Object.keys(input).some((key) => !fieldsById.has(key))) return { error: "The registration contains an unknown question." };
  const answers: CustomFormAnswers = {};
  for (const field of schema.fields) {
    const value = input[field.id];
    const missing = value === undefined || value === "";
    if (missing) {
      if (field.required) return { error: `Answer “${field.label}” before registering.` };
      continue;
    }
    if (field.type === "short_text" || field.type === "long_text") {
      if (typeof value !== "string") return { error: `“${field.label}” must be text.` };
      const answer = value.trim();
      if (!answer && field.required) return { error: `Answer “${field.label}” before registering.` };
      const maximum = field.maxLength || (field.type === "short_text" ? 500 : 5_000);
      if (answer.length > maximum) return { error: `“${field.label}” must be ${maximum.toLocaleString()} characters or fewer.` };
      if (answer) answers[field.id] = answer;
    } else if (field.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) return { error: `“${field.label}” must be a valid number.` };
      if (field.min !== undefined && value < field.min) return { error: `“${field.label}” must be at least ${field.min}.` };
      if (field.max !== undefined && value > field.max) return { error: `“${field.label}” must be at most ${field.max}.` };
      answers[field.id] = value;
    } else if (field.type === "select") {
      if (typeof value !== "string" || !field.options.some((option) => option.value === value)) return { error: `Choose a valid option for “${field.label}”.` };
      answers[field.id] = value;
    } else {
      if (typeof value !== "boolean") return { error: `“${field.label}” must be confirmed or left unchecked.` };
      if (field.required && !value) return { error: `Confirm “${field.label}” before registering.` };
      answers[field.id] = value;
    }
  }
  return { answers };
}

function generateUniqueCheckInCode(database: EventDatabase) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    let code = "";
    for (let index = 0; index < 6; index += 1) code += CHECK_IN_ALPHABET[randomInt(CHECK_IN_ALPHABET.length)];
    if (!database.checkInCodeIndex[code]) return code;
  }
  throw new Error("Could not allocate a unique check-in code.");
}

function seededDatabase(): EventDatabase {
  const seedTime = Date.now();
  return {
    version: 4,
    events: Object.fromEntries(initialEvents.map((event, index) => [event.id, { ...event, creatorId: "system", customFormSchema: { ...EMPTY_FORM_SCHEMA }, createdAt: seedTime - index * 1_000, updatedAt: seedTime - index * 1_000 }])),
    rsvps: {}, eventAdmins: {}, rsvpIndex: {}, checkInCodeIndex: {}, eventAdminIndex: {},
  };
}

function normalizeDatabase(stored: LegacyEventDatabase): EventDatabase {
  const database: EventDatabase = { version: 4, events: {}, rsvps: {}, eventAdmins: {}, rsvpIndex: {}, checkInCodeIndex: {}, eventAdminIndex: {} };
  for (const [id, rawEvent] of Object.entries(stored.events || {})) {
    if (!rawEvent || typeof rawEvent.creatorId !== "string") continue;
    const event = rawEvent as StoredEvent;
    event.venueName = typeof event.venueName === "string" && event.venueName ? event.venueName : event.location;
    event.venueAddress = typeof event.venueAddress === "string" && event.venueAddress ? event.venueAddress : event.location;
    const legacy = event as StoredEvent & { lat?: unknown; lng?: unknown };
    event.directionsUrl = typeof event.directionsUrl === "string" ? event.directionsUrl : typeof legacy.lat === "number" && typeof legacy.lng === "number" ? `https://www.google.com/maps/dir/?api=1&destination=${legacy.lat},${legacy.lng}` : "";
    event.customFormSchema = normalizeFormSchema(rawEvent.customFormSchema);
    event.endsAt = typeof rawEvent.endsAt === "string" && !Number.isNaN(new Date(rawEvent.endsAt).getTime()) ? rawEvent.endsAt : undefined;
    event.coverFit = rawEvent.coverFit === "fit" ? "fit" : "fill";
    event.coverFocusX = clampPercent(rawEvent.coverFocusX);
    event.coverFocusY = clampPercent(rawEvent.coverFocusY);
    database.events[id] = event;
  }
  for (const [id, rawRsvp] of Object.entries(stored.rsvps || {})) {
    if (!rawRsvp || typeof rawRsvp.eventId !== "string" || typeof rawRsvp.userId !== "string" || !database.events[rawRsvp.eventId]) continue;
    const legacyStatus = rawRsvp.status === "going" || rawRsvp.status === "waitlisted" ? rawRsvp.status : undefined;
    const rsvpStatus = rawRsvp.rsvpStatus === "going" || rawRsvp.rsvpStatus === "waitlisted" ? rawRsvp.rsvpStatus : legacyStatus || "going";
    const status: CheckInStatus = rawRsvp.status === "CHECKED_IN" ? "CHECKED_IN" : "REGISTERED";
    let checkInCode = typeof rawRsvp.checkInCode === "string" ? rawRsvp.checkInCode.trim().toUpperCase() : "";
    if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(checkInCode) || database.checkInCodeIndex[checkInCode]) checkInCode = generateUniqueCheckInCode(database);
    const answers = isPlainObject(rawRsvp.customFormAnswers)
      ? Object.fromEntries(Object.entries(rawRsvp.customFormAnswers).filter((entry): entry is [string, string | number | boolean] => ["string", "number", "boolean"].includes(typeof entry[1])))
      : {};
    const rsvp: RsvpRecord = {
      id, eventId: rawRsvp.eventId, userId: rawRsvp.userId, rsvpStatus, customFormAnswers: answers, checkInCode, status,
      ...(typeof rawRsvp.checkedInAt === "number" ? { checkedInAt: rawRsvp.checkedInAt } : {}),
      ...(typeof rawRsvp.checkedInBy === "string" ? { checkedInBy: rawRsvp.checkedInBy } : {}),
      createdAt: typeof rawRsvp.createdAt === "number" ? rawRsvp.createdAt : Date.now(),
      updatedAt: typeof rawRsvp.updatedAt === "number" ? rawRsvp.updatedAt : Date.now(),
    };
    database.rsvps[id] = rsvp;
    database.rsvpIndex[rsvpKey(rsvp.eventId, rsvp.userId)] = id;
    database.checkInCodeIndex[checkInCode] = id;
  }
  for (const [id, rawAdmin] of Object.entries(stored.eventAdmins || {})) {
    if (!rawAdmin || typeof rawAdmin.eventId !== "string" || typeof rawAdmin.userId !== "string" || typeof rawAdmin.addedBy !== "string") continue;
    const event = database.events[rawAdmin.eventId];
    if (!event || event.creatorId === rawAdmin.userId || database.eventAdminIndex[eventAdminKey(rawAdmin.eventId, rawAdmin.userId)]) continue;
    const admin: EventAdminRecord = { id, eventId: rawAdmin.eventId, userId: rawAdmin.userId, addedBy: rawAdmin.addedBy, createdAt: typeof rawAdmin.createdAt === "number" ? rawAdmin.createdAt : Date.now() };
    database.eventAdmins[id] = admin;
    database.eventAdminIndex[eventAdminKey(admin.eventId, admin.userId)] = id;
  }
  return database;
}

function hydrate(stored: LegacyEventDatabase | null): EventDatabase {
  if (!stored || !stored.events) return seededDatabase();
  return normalizeDatabase(stored);
}

async function loadDatabase() {
  return hydrate(await readDocument<LegacyEventDatabase>(STORE_DOC));
}

function mutate<T>(action: (database: EventDatabase) => T | Promise<T>): Promise<T> {
  const operation = writeQueue.then(async () => {
    let result!: T;
    await mutateDocument<LegacyEventDatabase, EventDatabase>(STORE_DOC, async (current) => {
      const database = hydrate(current);
      result = await action(database);
      return database;
    });
    return result;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function canManage(database: EventDatabase, event: StoredEvent, userId: string) {
  return event.creatorId === userId || Boolean(database.eventAdminIndex[eventAdminKey(event.id, userId)]);
}

function publicEvent(database: EventDatabase, event: StoredEvent, viewerId: string): CampusEvent {
  const rsvps = Object.values(database.rsvps).filter((rsvp) => rsvp.eventId === event.id);
  const viewerRsvp = rsvps.find((rsvp) => rsvp.userId === viewerId);
  const start = new Date(event.startsAt);
  const end = event.endsAt ? new Date(event.endsAt) : null;
  const isCreator = event.creatorId === viewerId;
  const isEventAdmin = Boolean(database.eventAdminIndex[eventAdminKey(event.id, viewerId)]);
  const fmt = (date: Date) => ({
    month: date.toLocaleString("en", { month: "short", timeZone: "Asia/Kolkata" }).toUpperCase(),
    day: date.toLocaleString("en", { day: "2-digit", timeZone: "Asia/Kolkata" }),
    time: date.toLocaleString("en", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }),
  });
  const started = fmt(start);
  return {
    ...event,
    going: rsvps.filter((rsvp) => rsvp.rsvpStatus === "going").length,
    waitlisted: rsvps.filter((rsvp) => rsvp.rsvpStatus === "waitlisted").length,
    viewerRsvpStatus: viewerRsvp?.rsvpStatus,
    viewerCheckInCode: viewerRsvp?.checkInCode,
    viewerCheckInStatus: viewerRsvp?.status,
    isCreator, isEventAdmin, canManageEvent: isCreator || isEventAdmin,
    month: started.month,
    day: started.day,
    time: started.time,
    ...(end ? { endMonth: fmt(end).month, endDay: fmt(end).day, endTime: fmt(end).time } : {}),
  };
}

export function validateEventInput(input: NewEventInput, options?: { allowPastStart?: boolean }) {
  const startsAt = new Date(input.startsAt);
  if (!input.title.trim() || input.title.trim().length > 90) return "Event titles must be 1–90 characters.";
  if (input.description.length > 2_000) return "Event descriptions must be 2,000 characters or fewer.";
  if (!/^[A-Za-z][A-Za-z &-]{1,30}$/.test(input.category)) return "Choose a valid event category.";
  if (!input.location.trim() || input.location.trim().length > 160) return "Add a venue of 160 characters or fewer.";
  if (!input.venueName.trim() || input.venueName.trim().length > 160) return "Add a valid venue name.";
  if (!input.venueAddress.trim() || input.venueAddress.trim().length > 300) return "Add a valid venue address.";
  if (input.directionsUrl.trim().length > 2_048) return "Google Maps links must be 2,048 characters or fewer.";
  if (input.directionsUrl.trim()) {
    try {
      const url = new URL(input.directionsUrl.trim());
      const googleMapsHost = /^(?:www\.|maps\.)?google\.(?:com|co\.in)$/.test(url.hostname) && url.pathname.startsWith("/maps");
      const googleShortLink = url.hostname === "maps.app.goo.gl" || (url.hostname === "goo.gl" && url.pathname.startsWith("/maps"));
      if (url.protocol !== "https:" || (!googleMapsHost && !googleShortLink)) return "Paste a valid Google Maps directions link.";
    } catch { return "Paste a valid Google Maps directions link."; }
  }
  const campus = input.campus.trim();
  if (campus.length < 2 || campus.length > 100) return "Add a host campus of 2–100 characters.";
  if (!/^[\p{L}\p{N} .,'&()\/-]+$/u.test(campus)) return "Use only letters, numbers, spaces and basic punctuation for the campus.";
  if (input.community && !/^(?:c\/[a-z0-9._-]{2,40}|seed-[a-z0-9-]+|[0-9a-f-]{36})$/i.test(input.community)) return "Choose a valid community.";
  if (Number.isNaN(startsAt.getTime())) return "Choose a valid date and time.";
  if (!options?.allowPastStart && startsAt.getTime() <= Date.now()) return "Choose a future date and time.";
  if (input.endsAt) {
    const endsAt = new Date(input.endsAt);
    if (Number.isNaN(endsAt.getTime())) return "Choose a valid end date and time.";
    if (endsAt.getTime() <= startsAt.getTime()) return "The event must end after it starts.";
    if (endsAt.getTime() - startsAt.getTime() > 30 * 86_400_000) return "Events can run for at most 30 days.";
  }
  if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 10_000) return "Capacity must be between 1 and 10,000.";
  if (input.coverFit !== "fill" && input.coverFit !== "fit") return "Choose how the cover image should fit.";
  for (const focus of [input.coverFocusX, input.coverFocusY]) {
    if (!Number.isFinite(focus) || focus < 0 || focus > 100) return "The cover focal point is out of range.";
  }
  const uploaded = /^\/api\/events\/images\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(input.imageUrl);
  const builtIn = /^\/[a-z0-9-]+\.svg$/.test(input.imageUrl);
  if (!uploaded && !builtIn) return "Choose a valid event image.";
  return validateCustomFormSchema(input.customFormSchema);
}

export async function listEvents(viewerId: string) {
  await writeQueue;
  const database = await loadDatabase();
  return Object.values(database.events).sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime() || b.createdAt - a.createdAt).map((event) => publicEvent(database, event, viewerId));
}

export async function getEvent(eventId: string, viewerId: string) {
  await writeQueue;
  const database = await loadDatabase();
  const event = database.events[eventId];
  return event ? publicEvent(database, event, viewerId) : null;
}

export async function createEvent(creatorId: string, input: NewEventInput) {
  return mutate((database) => {
    const now = Date.now();
    const event: StoredEvent = {
      id: randomUUID(), creatorId, title: input.title.trim(), description: input.description.trim(), category: input.category.trim(), location: input.location.trim(),
      venueName: input.venueName.trim(), venueAddress: input.venueAddress.trim(), directionsUrl: input.directionsUrl.trim(), campus: input.campus.trim(),
      ...(input.community ? { community: input.community } : {}), startsAt: new Date(input.startsAt).toISOString(),
      ...(input.endsAt ? { endsAt: new Date(input.endsAt).toISOString() } : {}),
      capacity: input.capacity, imageUrl: input.imageUrl,
      coverFit: input.coverFit, coverFocusX: clampPercent(input.coverFocusX), coverFocusY: clampPercent(input.coverFocusY),
      customFormSchema: input.customFormSchema, createdAt: now, updatedAt: now,
    };
    database.events[event.id] = event;
    return publicEvent(database, event, creatorId);
  });
}

// Merge the current stored event with the partial patch, then reuse
// validateEventInput so an edit is held to the same rules as a create.
function mergedEventInput(event: StoredEvent, patch: EventUpdateInput): NewEventInput {
  const pick = <K extends keyof NewEventInput>(key: K, current: NewEventInput[K]): NewEventInput[K] =>
    patch[key] === undefined ? current : (patch[key] as NewEventInput[K]);
  return {
    title: pick("title", event.title),
    description: pick("description", event.description),
    category: pick("category", event.category),
    location: pick("location", event.location),
    venueName: pick("venueName", event.venueName || event.location),
    venueAddress: pick("venueAddress", event.venueAddress || event.location),
    directionsUrl: pick("directionsUrl", event.directionsUrl),
    campus: pick("campus", event.campus),
    community: pick("community", event.community),
    startsAt: pick("startsAt", event.startsAt),
    endsAt: patch.endsAt === undefined ? event.endsAt : (patch.endsAt || undefined),
    capacity: pick("capacity", event.capacity),
    imageUrl: pick("imageUrl", event.imageUrl),
    coverFit: pick("coverFit", event.coverFit),
    coverFocusX: pick("coverFocusX", event.coverFocusX),
    coverFocusY: pick("coverFocusY", event.coverFocusY),
    customFormSchema: pick("customFormSchema", event.customFormSchema),
  };
}

export async function updateEvent(eventId: string, userId: string, patch: EventUpdateInput) {
  return mutate((database) => {
    const event = database.events[eventId];
    if (!event) return { error: "Event not found.", status: 404 } as const;
    if (event.creatorId !== userId) return { error: "Only the event creator can edit this event.", status: 403 } as const;
    const merged = mergedEventInput(event, patch);
    const startUnchanged = new Date(merged.startsAt).toISOString() === new Date(event.startsAt).toISOString();
    const validationError = validateEventInput(merged, { allowPastStart: startUnchanged });
    if (validationError) return { error: validationError, status: 400 } as const;

    event.title = merged.title.trim();
    event.description = merged.description.trim();
    event.category = merged.category.trim();
    event.location = merged.location.trim();
    event.venueName = merged.venueName.trim();
    event.venueAddress = merged.venueAddress.trim();
    event.directionsUrl = merged.directionsUrl.trim();
    event.campus = merged.campus.trim();
    if (merged.community) event.community = merged.community;
    else delete event.community;
    event.startsAt = new Date(merged.startsAt).toISOString();
    if (merged.endsAt) event.endsAt = new Date(merged.endsAt).toISOString();
    else delete event.endsAt;
    event.capacity = merged.capacity;
    event.imageUrl = merged.imageUrl;
    event.coverFit = merged.coverFit;
    event.coverFocusX = clampPercent(merged.coverFocusX);
    event.coverFocusY = clampPercent(merged.coverFocusY);
    event.customFormSchema = merged.customFormSchema;
    event.updatedAt = Date.now();
    return { event: publicEvent(database, event, userId) } as const;
  });
}

export async function setEventRsvp(eventId: string, userId: string, submittedAnswers: unknown) {
  return mutate((database) => {
    const event = database.events[eventId];
    if (!event) return { error: "Event not found.", status: 404 } as const;
    const existingId = database.rsvpIndex[rsvpKey(eventId, userId)];
    const existing = existingId ? database.rsvps[existingId] : undefined;
    if (existing) return { event: publicEvent(database, event, userId), rsvp: existing, alreadyExisted: true } as const;
    const answerResult = normalizeAnswers(event.customFormSchema, submittedAnswers);
    if ("error" in answerResult) return { error: answerResult.error, status: 400 } as const;
    const goingCount = Object.values(database.rsvps).filter((rsvp) => rsvp.eventId === eventId && rsvp.rsvpStatus === "going").length;
    const now = Date.now();
    const checkInCode = generateUniqueCheckInCode(database);
    const rsvp: RsvpRecord = { id: randomUUID(), eventId, userId, rsvpStatus: goingCount >= event.capacity ? "waitlisted" : "going", customFormAnswers: answerResult.answers, checkInCode, status: "REGISTERED", createdAt: now, updatedAt: now };
    database.rsvps[rsvp.id] = rsvp;
    database.rsvpIndex[rsvpKey(eventId, userId)] = rsvp.id;
    database.checkInCodeIndex[checkInCode] = rsvp.id;
    return { event: publicEvent(database, event, userId), rsvp, alreadyExisted: false } as const;
  });
}

export async function cancelEventRsvp(eventId: string, userId: string) {
  return mutate((database) => {
    const event = database.events[eventId];
    if (!event) return { error: "Event not found.", status: 404 } as const;
    const key = rsvpKey(eventId, userId);
    const rsvpId = database.rsvpIndex[key];
    if (!rsvpId) return { error: "You have not RSVP’d to this event.", status: 404 } as const;
    const removedRsvp = database.rsvps[rsvpId];
    if (removedRsvp.status === "CHECKED_IN") return { error: "A checked-in registration cannot be cancelled.", status: 409 } as const;
    delete database.rsvps[rsvpId]; delete database.rsvpIndex[key]; delete database.checkInCodeIndex[removedRsvp.checkInCode];
    if (removedRsvp.rsvpStatus === "going") {
      const waitlisted = Object.values(database.rsvps).filter((rsvp) => rsvp.eventId === eventId && rsvp.rsvpStatus === "waitlisted").sort((a, b) => a.createdAt - b.createdAt)[0];
      if (waitlisted) { waitlisted.rsvpStatus = "going"; waitlisted.updatedAt = Date.now(); }
    }
    return { event: publicEvent(database, event, userId) } as const;
  });
}

export async function listEventRsvpsForManager(eventId: string, userId: string) {
  await writeQueue;
  const database = await loadDatabase();
  const event = database.events[eventId];
  if (!event) return { error: "Event not found.", status: 404 } as const;
  if (!canManage(database, event, userId)) return { error: "You are not allowed to manage this event.", status: 403 } as const;
  const rsvps = Object.values(database.rsvps).filter((rsvp) => rsvp.eventId === eventId).sort((a, b) => a.createdAt - b.createdAt);
  return { event, rsvps, isCreator: event.creatorId === userId } as const;
}

export async function listEventAdminsForManager(eventId: string, userId: string) {
  await writeQueue;
  const database = await loadDatabase();
  const event = database.events[eventId];
  if (!event) return { error: "Event not found.", status: 404 } as const;
  if (!canManage(database, event, userId)) return { error: "You are not allowed to manage this event.", status: 403 } as const;
  return { event, isCreator: event.creatorId === userId, admins: Object.values(database.eventAdmins).filter((admin) => admin.eventId === eventId).sort((a, b) => a.createdAt - b.createdAt) } as const;
}

export async function addEventAdmin(eventId: string, creatorId: string, adminUserId: string) {
  return mutate((database) => {
    const event = database.events[eventId];
    if (!event) return { error: "Event not found.", status: 404 } as const;
    if (event.creatorId !== creatorId) return { error: "Only the event creator can add administrators.", status: 403 } as const;
    if (adminUserId === creatorId) return { error: "The event creator already has full access.", status: 409 } as const;
    const key = eventAdminKey(eventId, adminUserId);
    if (database.eventAdminIndex[key]) return { error: "That user is already an event administrator.", status: 409 } as const;
    const admin: EventAdminRecord = { id: randomUUID(), eventId, userId: adminUserId, addedBy: creatorId, createdAt: Date.now() };
    database.eventAdmins[admin.id] = admin; database.eventAdminIndex[key] = admin.id;
    return { admin } as const;
  });
}

export async function removeEventAdmin(eventId: string, creatorId: string, adminUserId: string) {
  return mutate((database) => {
    const event = database.events[eventId];
    if (!event) return { error: "Event not found.", status: 404 } as const;
    if (event.creatorId !== creatorId) return { error: "Only the event creator can remove administrators.", status: 403 } as const;
    const key = eventAdminKey(eventId, adminUserId);
    const adminId = database.eventAdminIndex[key];
    if (!adminId) return { error: "That user is not an event administrator.", status: 404 } as const;
    delete database.eventAdmins[adminId]; delete database.eventAdminIndex[key];
    return { removed: true } as const;
  });
}

export async function checkInEventAttendee(eventId: string, managerId: string, submittedCode: string) {
  return mutate((database) => {
    const event = database.events[eventId];
    if (!event) return { error: "Event not found.", status: 404 } as const;
    if (!canManage(database, event, managerId)) return { error: "You are not allowed to check in attendees for this event.", status: 403 } as const;
    const code = submittedCode.trim().toUpperCase();
    if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(code)) return { error: "Enter a valid 6-character check-in code.", status: 400 } as const;
    const rsvpId = database.checkInCodeIndex[code];
    const rsvp = rsvpId ? database.rsvps[rsvpId] : undefined;
    if (!rsvp || rsvp.eventId !== eventId) return { error: "No attendee for this event matches that code.", status: 404 } as const;
    if (rsvp.status === "CHECKED_IN") return { error: "This attendee has already checked in.", status: 409 } as const;
    if (rsvp.rsvpStatus !== "going") return { error: "Waitlisted attendees cannot check in until a spot opens.", status: 409 } as const;
    const now = Date.now();
    rsvp.status = "CHECKED_IN"; rsvp.checkedInAt = now; rsvp.checkedInBy = managerId; rsvp.updatedAt = now;
    return { rsvp } as const;
  });
}

export function answerForCsv(field: CustomFormField, answer: string | number | boolean | undefined) {
  if (answer === undefined) return "";
  if (field.type === "select") return field.options.find((option) => option.value === answer)?.label || String(answer);
  if (field.type === "checkbox") return answer ? "Yes" : "No";
  return String(answer);
}
