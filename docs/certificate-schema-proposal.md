# Certificate system schema proposal

Status: approved by the user. Implementation and setup are documented in `certificates.md`. Collections are created on first use; production index deployment is still required.

## Fit with the existing application

The current backend uses Firestore through `lib/firebase-admin.ts`. User accounts are stored in `smartCampusStores/auth`, and direct conversations and messages in `smartCampusStores/social`. These stores contain serialized JSON. Images use `smartCampusImages` documents with a `chunks` subcollection through `lib/image-storage.ts`.

Use dedicated Firestore collections for certificates and processing jobs rather than adding an ever-growing array to either existing JSON store. `certificates` is the Firestore equivalent of the requested Certificates table. Existing user IDs and event IDs remain unchanged. All access goes through authenticated server APIs.

Unless stated otherwise, IDs are strings, dates are server-assigned epoch milliseconds, optional values are omitted, and records have `schemaVersion: 1`. Firestore has no foreign-key constraints, so server transactions validate references and ownership.

## 1. `certificates/{certificateId}`

One document per certificate saved to a registered user's profile.

| Field | Type | Meaning |
| --- | --- | --- |
| userId | string | Required recipient account ID |
| title | string | Display name of the certificate |
| imageUrl | string | Stable application URL, `/api/certificates/{id}/image`; permissions checked at read time |
| assetId | string | Reference to the generated PNG or external image asset |
| source | `internal` or `external` | Organizer-issued or uploaded by the recipient |
| issuerId | string, optional | Organizer account; required for internal certificates |
| issuerName | string | Issuer label; self-reported for external uploads |
| eventId | string, optional | Associated event; organizer must be allowed to manage it |
| jobId / rowId | string, optional | Immutable batch and row references; required for internal certificates |
| issuedAt | number, optional | Date printed on the certificate or supplied by uploader |
| createdAt | number | Time the certificate was added to the profile |
| visibility | `private` or `public` | Defaults to private; recipient controls public gallery visibility |
| status | `active` or `deleted` | Soft deletion; only active certificates count toward badges |
| deletedAt | number, optional | Time of removal |

Internal certificate IDs are deterministic hashes of `(jobId, rowId, userId)`. A retry cannot create a second award for the same job row. External uploads use an upload idempotency key scoped to the uploader. Image content hash may identify duplicates for review; identical artwork alone is not proof of duplicate awards.

External uploads are explicitly labeled self-uploaded, and count toward the badge as requested. They do not create chat messages or email deliveries. Initially support PNG, JPEG and WebP, normalized to a displayable image; PDF ingestion would need a separate rendering path.

Unmatched CSV recipients do not get a certificate profile record with a null user ID. Their generated image and delivery status remain on their job row, allowing ZIP export and SMTP delivery.

## 2. `certificateAssets/{assetId}`

Metadata for template backgrounds, imported source files, rendered certificates and ZIP exports.

Fields: `ownerId`, `kind` (`background | import | certificate | archive`), `objectPath`, `contentType`, `byteSize`, `sha256`, `state` (`uploading | ready | failed | deleting`), `createdAt`, optional `expiresAt`, optional `jobId`, optional `certificateId`.

Binary data stays outside certificate/job documents. Initially reuse the existing chunked binary storage adapter with a dedicated `certificates/` path prefix and authenticated serving routes. Keep the adapter replaceable with object storage for larger production batches. ZIP files and imports are private organizer artifacts with expiry; issued images stay available while referenced by a certificate. Garbage collection checks references before deleting assets.

## 3. `certificateTemplates/{templateId}` and `/revisions/{revisionId}`

Template document: `ownerId`, optional `eventId`, `title`, `currentRevisionId`, `createdAt`, `updatedAt`.

Immutable revision document: `backgroundAssetId`, `width`, `height`, `elements`, `createdAt`.

Each text element has:

```ts
type CertificateTextElement = {
  id: string;
  text: string; // Literal text and placeholders, e.g. "Presented to {{name}}"
  x: number; y: number; width: number; height: number;
  rotation: number;
  fontFamily: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
  lineHeight: number;
  shadow: {
    enabled: boolean; color: string; blur: number;
    offsetX: number; offsetY: number; opacity: number;
  };
};
```

Coordinates and font sizes use the original canvas pixel dimensions, independent of responsive display size and zoom. Array order defines layering. Fonts come from a shared allowlist available to both browser and worker. Limit element count and serialized revision size. Zoom, pan and current selection are editor state, not part of the rendered certificate.

## 4. `certificateJobs/{jobId}` and `/rows/{rowId}`

Job fields:

- `organizerId`, optional `eventId`, `templateId`, `revisionId`, `importAssetId`, `headers: string[]`.
- `columnMapping: { email?: string; username?: string; displayName?: string }`.
- `requestedActions: { archive: boolean; email: boolean; internalDelivery: boolean }`.
- `emailTemplate: { subject: string; text: string; html?: string }`; placeholders resolve per row and HTML values are escaped. SMTP credentials remain in server configuration.
- `status: draft | queued | running | completed | completed_with_errors | failed | cancelled`.
- `totalRows`, `processedRows`, `failedRows`, `createdAt`, `updatedAt`, optional `startedAt`, optional `completedAt`.
- `idempotencyKeyHash`, `workerId`, `leaseToken`, `leaseExpiresAt`, `attempts`, optional `nextAttemptAt`, optional sanitized `lastError`.
- `archiveStatus: not_requested | queued | running | ready | failed`, optional `archiveAssetId`.

Row fields:

- `rowNumber`: one-based imported data row, excluding headers; `values: Record<string, string>`.
- `overrides: Record<elementId, Partial<CertificateTextElement>>`, excluding changes to element IDs. For example Row 4 can override just one element's `fontSize`.
- `emailNormalized`, `usernameNormalized`, optional `matchedUserId`.
- `matchStatus: pending | matched | unmatched | ambiguous | conflict | invalid`; optional sanitized `matchReason`.
- `renderStatus: pending | processing | ready | failed`, optional `assetId`, optional `certificateId`.
- `internalStatus: not_requested | pending | delivered | skipped | failed`.
- `emailStatus: not_requested | pending | sending | accepted | failed | unknown | skipped`.
- `emailMessageId`, `emailAttempts`, optional `emailAcceptedAt`, optional `emailLeaseToken`, optional `emailLeaseExpiresAt`.
- `workerId`, `leaseToken`, `leaseExpiresAt`, `attempts`, optional `nextAttemptAt`, optional sanitized `lastError`, `createdAt`, `updatedAt`.

Imported rows and overrides remain editable only while the job is a draft. Submitting freezes the template revision, recipients, actions, overrides and email copy; later edits create a new job. Each row is a separate document, with explicit limits on cell length, columns and row size. Original spreadsheet row order is retained; render output filenames include the row number to avoid collisions.

A creation request idempotency record at `certificateJobRequests/{hash(organizerId, key)}` maps to the job and input digest, rejecting key reuse with different input. Separate jobs are intentional new issuance runs. Duplicate resolved users or emails inside one import are flagged before submission; one award per recipient is the default unless the organizer explicitly marks the rows as distinct awards.

### Matching and delivery rules

1. Trim and normalize email using the current auth normalization and match exactly. Match usernames exactly, case-insensitively; never use fuzzy directory search for delivery.
2. A provided email that has no account match does not silently fall back to a conflicting username. Use username-only matching when no email is supplied. Ambiguous or conflicting identifiers require correction before internal delivery.
3. For an unmatched, ambiguous or conflicting row with a valid CSV email, still generate the PNG and attempt requested SMTP delivery to that address; skip internal delivery.
4. For a username-only matched account, use its verified stored email for requested SMTP delivery. If no valid email is available, record email as skipped with a reason; internal delivery can still succeed.
5. Matching runs on the server and exposes only minimal status to organizers. Account emails and auth records are never returned wholesale to the editor.

### Background execution contract

Next.js APIs validate and enqueue work, then return `202` plus a job ID. A separately running worker leases jobs/rows transactionally and renders/archives off the web request process. Concurrency and memory are bounded; the entire CSV's PNG buffers are not retained on the web server. Work survives web-server restarts. Expired worker leases can be reclaimed, and writes check the lease token to prevent stale workers committing output.

Each stage records progress independently. An SMTP failure does not undo successful profile/chat delivery. Only the explicit Email Certificates action requests SMTP sends; ZIP export alone does not send mail or award certificates. The delivery dialog enables internal delivery by default when issuing certificates and makes the selection explicit.

SMTP acceptance is not proof of inbox delivery. Record `accepted`, not `delivered`. SMTP cannot guarantee exactly-once sending across a crash: a stale `sending` record becomes `unknown` and requires an explicit retry, rather than silently resending. Use stable Message-IDs and show possible duplication on retry. A job finishes with errors if any requested stage remains failed or unknown. Cancellation stops unstarted work and cannot undo already accepted mail.

## 5. `certificateInboxes/{userId}/messages/{certificateId}`

Dedicated system-delivery messages surfaced as a "Smart Campus Certificates" inbox in the existing Chat UI.

Fields: `recipientId`, `issuerId`, `issuerName`, `certificateId`, `title`, `body`, `createdAt`, optional `readAt`. Attachment kind is `certificate`; the UI resolves its thumbnail/download through the certificate record's authorized image route.

The document ID is the certificate ID, ensuring one message per award on retries. This system inbox does not create or approve a person-to-person chat connection and does not alter existing rejected/pending chat requests. Only the server issuance flow writes these messages. Recipients can read their own inbox and mark messages read.

Creating an internal certificate, creating its inbox message, incrementing the profile count and marking that job row internally delivered happen in one Firestore transaction after the image asset is ready. Existing certificate IDs turn retries into no-ops. Do not call SMTP or binary rendering inside a database transaction.

## 6. `certificateProfiles/{userId}`

Fields: `certificateCount`, `internalCount`, `externalCount`, `updatedAt`.

All counts represent active certificates. A transaction increments only on first creation, decrements only on the first active-to-deleted transition, and adjusts the corresponding source counter. Legacy users without this document read as zero. A reconciliation operation can rebuild counts from certificate records.

Compute `certificateBadge` in profile and public-directory responses from `certificateCount`:

| Active certificates | Badge |
| --- | --- |
| 0 | None |
| 1–2 | Beginner |
| 3–5 | Intermediate |
| 6+ | Expert |

Do not persist the tier separately; deriving it prevents stale tiers and allows threshold changes. Include both `certificateCount` and `certificateBadge` in profile DTOs without rewriting the existing auth JSON schema. These badges represent certificate totals, including self-uploaded certificates. Existing referral points remain a separate system.

The owner's gallery lists all active certificates. Public profile responses list only public certificates and respect the existing account privacy rules. The aggregate badge is displayed on public profiles, including when some certificates are private. Private certificate images cannot be fetched by guessing an ID. Organizers can access their own batch output; recipients manage visibility and their own external uploads.

## Indexes and rollout

Proposed composite indexes (remaining point reads use document IDs):

- `certificates`: `userId ASC, status ASC, createdAt DESC` for owner galleries.
- `certificates`: `userId ASC, status ASC, visibility ASC, createdAt DESC` for public galleries.
- `certificateTemplates`: `ownerId ASC, updatedAt DESC`.
- `certificateJobs`: `organizerId ASC, createdAt DESC`.
- `certificateJobs`: `status ASC, nextAttemptAt ASC` and `status ASC, leaseExpiresAt ASC` for ready/expired work.
- Job `rows` subcollections: `renderStatus ASC, rowNumber ASC`, `internalStatus ASC, rowNumber ASC`, `emailStatus ASC, rowNumber ASC` for resumable stage selection.
- Inbox messages use single-field `createdAt` ordering. Rows use single-field `rowNumber` ordering for export.

Disable field indexing for large free-form payloads (`values`, `overrides`, revision `elements`, template bodies, and errors) that are not queried. Store import/export expiry metadata for cleanup; deleting Firestore parent documents alone must not be assumed to delete binary chunks or row subcollections.

Rollout is additive: create collection validators and indexes, add API response fields with zero defaults, then enable the worker and UI. No existing user or chat records need conversion. No application data or schema migration is applied by this proposal.

The current local login bypass is only a UI preview. Real issuance, uploads, private assets and SMTP routes continue to require an authenticated account. Builder interactions and sample ZIP export can be previewed separately; operational delivery needs Firebase and SMTP configuration.

## Approval

The user approved this additive Firestore design. See `certificates.md` for the implemented endpoints, runtime limits and deployment setup. The implementation stores the idempotency digest on the deterministic job document rather than a separate request collection, and uses job-level worker leases with per-row progress markers. Asset retention remains manual until a reference-aware cleanup policy is configured.
