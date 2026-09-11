import { z } from "zod";
import { resolveColumn } from "./columns";
import { isVerificationVariable } from "./verification-code";

export const FONTS = ["Noto Sans", "Noto Serif", "Noto Sans Mono"] as const;
export const FONT_FILES = ["NotoSans.ttf", "NotoSerif.ttf", "NotoSansMono.ttf"];
export const MAX_ROWS = 2000;
export const MAX_IMPORT_ROWS = 50_000;
export const MAX_CSV_UPLOAD = 50 * 1024 * 1024;
export const MAX_UPLOAD = 8 * 1024 * 1024;
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const finite = (min: number, max: number) => z.number().finite().min(min).max(max);
export const elementSchema = z.object({
  id, text: z.string().max(2000), x: finite(-4096, 4096), y: finite(-4096, 4096),
  width: finite(10, 4096), height: finite(10, 4096), rotation: finite(-360, 360),
  fontFamily: z.enum(FONTS), fontSize: finite(8, 300), color,
  bold: z.boolean(), italic: z.boolean(), align: z.enum(["left", "center", "right"]),
  lineHeight: finite(0.8, 3), shadow: z.object({ enabled: z.boolean(), color, blur: finite(0, 50), offsetX: finite(-50, 50), offsetY: finite(-50, 50), opacity: finite(0, 1) }),
});
export type TextElement = z.infer<typeof elementSchema>;
export const layoutSchema = z.object({ width: finite(320, 4096).int(), height: finite(240, 4096).int(), elements: z.array(elementSchema).min(1).max(50) })
  .refine(v => v.width * v.height <= 8_000_000, "Canvas must be at most 8 megapixels")
  .refine(v => new Set(v.elements.map(e => e.id)).size === v.elements.length, "Layer IDs must be unique");
export type Layout = z.infer<typeof layoutSchema>;
export type Overrides = Record<string, Partial<Omit<TextElement, "id">>>;
const safeHeader = z.string().trim().min(1).max(100).refine(v => !["__proto__", "constructor", "prototype"].includes(v) && !isVerificationVariable(v));
export const rowSchema = z.object({ values: z.record(safeHeader, z.string().max(2000)), overrides: z.record(id, elementSchema.omit({ id: true }).partial()).default({}) });
export type InputRow = z.infer<typeof rowSchema>;
export const jobInputSchema = z.object({
  title: z.string().trim().min(1).max(160), eventId: id.optional(), backgroundAssetId: id.optional(),
  layout: layoutSchema, headers: z.array(safeHeader).min(1).max(50), rows: z.array(rowSchema).min(1).max(MAX_ROWS),
  columnMapping: z.object({ email: z.string().max(100).optional(), username: z.string().max(100).optional(), displayName: z.string().max(100).optional() }),
  requestedActions: z.object({ archive: z.boolean(), email: z.boolean(), internalDelivery: z.boolean() }),
  emailTemplate: z.object({ subject: z.string().min(1).max(200).refine(v => !/[\r\n]/.test(v)), text: z.string().min(1).max(10000) }),
  allowDistinctAwards: z.boolean().default(false),
}).superRefine((v, ctx) => {
  const error = (message: string) => ctx.addIssue({ code: "custom", message });
  if (new Set(v.headers).size !== v.headers.length) error("Column headers must be unique");
  for (const column of Object.values(v.columnMapping)) if (column && !v.headers.includes(column)) error("Mapped column is missing");
  if (!Object.values(v.requestedActions).some(Boolean)) error("Choose an export or delivery action");
  if ((v.requestedActions.email || v.requestedActions.internalDelivery) && !v.columnMapping.email && !v.columnMapping.username) error("Map an email or username column for delivery");
  const keys = new Set(v.layout.elements.map(e => e.id));
  const templateVariables = [...v.layout.elements.flatMap(e => variables(e.text)), ...(v.requestedActions.email ? [...variables(v.emailTemplate.subject), ...variables(v.emailTemplate.text)] : [])];
  if (templateVariables.some(h => !isVerificationVariable(h) && !resolveColumn(h, v.headers))) error("Template contains an unmapped variable");
  for (const row of v.rows) {
    if (Object.keys(row.values).some(h => !v.headers.includes(h))) error("Unexpected row column");
    if (Object.keys(row.overrides).some(k => !keys.has(k))) error("Override refers to a missing layer");
    for (const text of Object.values(row.overrides).flatMap(override => override.text === undefined ? [] : [override.text])) {
      if (variables(text).some(h => !isVerificationVariable(h) && !resolveColumn(h, v.headers))) error("Template contains an unmapped variable");
    }
    if (!v.layout.elements.some(e => variables(row.overrides[e.id]?.text ?? e.text).some(isVerificationVariable))) error("Add {{verification_code}} to the certificate. Every row must include its verification code.");
  }
});
export type JobInput = z.infer<typeof jobInputSchema>;
export function variables(text: string) { return Array.from(text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g), m => m[1]); }
export function substitute(text: string, values: Record<string, string>, verificationCode?: string) { const headers = Object.keys(values); return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key: string) => { if (isVerificationVariable(key)) return verificationCode || "PREVIEW ONLY"; const column = resolveColumn(key, headers); return column !== undefined ? values[column] : ""; }); }
export function badgeFor(count: number): "None" | "Beginner" | "Intermediate" | "Expert" { return count >= 6 ? "Expert" : count >= 3 ? "Intermediate" : count >= 1 ? "Beginner" : "None"; }
export function effectiveElements(layout: Layout, row: InputRow & { verificationCode?: string }) { return layout.elements.map(e => ({ ...e, ...row.overrides[e.id], id: e.id, text: substitute(row.overrides[e.id]?.text ?? e.text, row.values, row.verificationCode) })); }
export function newElement(text = "{{name}}", index = 0): TextElement { return { id: `text-${index}`, text, x: 100, y: 170 + index * 60, width: 1000, height: 90, rotation: 0, fontFamily: "Noto Serif", fontSize: 48, color: "#27213c", bold: false, italic: false, align: "center", lineHeight: 1.25, shadow: { enabled: false, color: "#000000", blur: 4, offsetX: 2, offsetY: 2, opacity: 0.3 } }; }
export const INITIAL_LAYOUT: Layout = { width: 1200, height: 850, elements: [
  { ...newElement("CERTIFICATE OF ACHIEVEMENT", 0), y: 150, fontFamily: "Noto Sans", fontSize: 34, bold: true },
  { ...newElement("Proudly presented to", 1), y: 270, fontSize: 24 },
  { ...newElement("{{name}}", 2), y: 350, fontSize: 64, color: "#6c3bff", height: 120 },
  { ...newElement("For successfully completing {{course}}", 3), y: 510, fontSize: 28, height: 100 },
  { ...newElement("Smart Campus", 4), y: 690, fontFamily: "Noto Sans", fontSize: 22, bold: true },
  { ...newElement("Verification code: {{verification_code}}", 5), y: 755, height: 35, fontFamily: "Noto Sans Mono", fontSize: 16 },
] };
export type CertificateRecord = { id: string; userId?: string; title: string; imageUrl: string; assetId: string; source: "internal" | "external"; issuerId?: string; issuerName: string; eventId?: string; jobId?: string; rowId?: string; verificationCode?: string; recipientName?: string; courseName?: string; issuedAt?: number; profileAwarded?: boolean; createdAt: number; visibility: "private" | "public"; status: "active" | "deleted" };
export type CertificateStats = { certificateCount: number; internalCount: number; externalCount: number; certificateBadge: ReturnType<typeof badgeFor> };
export type InboxMessage = { id: string; recipientId: string; issuerId: string; issuerName: string; certificateId: string; title: string; body: string; createdAt: number; readAt?: number; imageUrl: string };
export type JobRecord = Omit<JobInput, "layout" | "rows" | "backgroundAssetId"> & { id: string; organizerId: string; issuerName: string; templateId: string; revisionId: string; importAssetId?: string; schemaVersion: 1; status: "draft" | "retrying" | "queued" | "running" | "completed" | "completed_with_errors" | "failed" | "cancelled"; totalRows: number; processedRows: number; failedRows: number; createdAt: number; updatedAt: number; leaseToken: string; leaseExpiresAt: number; attempts: number; nextAttemptAt: number; archiveStatus: "not_requested" | "queued" | "running" | "ready" | "failed"; archiveAssetId?: string; lastError?: string };
export type JobRow = InputRow & { id: string; rowNumber: number; matchStatus: string; matchedUserId?: string; emailNormalized?: string; renderStatus: "pending" | "ready" | "failed"; assetId?: string; certificateId?: string; verificationCode?: string; internalStatus: "not_requested" | "pending" | "delivered" | "skipped" | "failed"; emailStatus: "not_requested" | "pending" | "sending" | "accepted" | "failed" | "unknown" | "skipped"; emailAttempts: number; emailMessageId?: string; lastError?: string; matchReason?: string; processed?: boolean; createdAt: number; updatedAt: number };
