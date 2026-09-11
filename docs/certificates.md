# Certificate studio

Open `/certificates`, or choose **Certificates** in the desktop navigation. On mobile, open **Profile → Open certificate studio**.

Public cryptographic code lookup is available at `/verify`. See [certificate-verification.md](certificate-verification.md) for the additive schema, code lifecycle, rate limits and setup. New backend batches include a reserved `{{verification_code}}` variable; local preview exports remain unverified.

## Local preview

With `DEV_SKIP_LOGIN=true` in `.env.local`, `npm run dev` opens the UI with a preview profile. This flag is ignored in production. The studio supports background uploads, CSV/XLSX import, dragging/touch positioning, resizing, zooming, text styling and per-row overrides without Firebase.

CSV imports support up to 50 MB and 50,000 attendees, with progress updates and cancellation in the browser worker. The worker reads the CSV text and parses it in 256 KB chunks; it retains the attendee list for editing, so this is bounded in-memory import, not unlimited streaming. XLSX imports remain limited to 8 MB / 2,000 attendees; export larger spreadsheets as CSV. Both formats allow 50 populated columns and up to 2,000 characters per cell.

Choose **From row / To row** above the editor to select an export or delivery batch. Importing retains every attendee; it initially selects the first 100 rows in local preview, or 2,000 rows when signed in. Use **Next batch** after exporting/delivering to continue. Preview ZIP exports run in a browser worker and are limited to 100 rows / 64 MB of PNGs per batch. Local archive names and PNG filenames include the original imported row numbers. Real server jobs support up to 2,000 rows per batch (6 MB request data), 50 text layers, canvases up to 8 megapixels and archives up to 500 MB of source PNGs. Server batch history numbers rows within each submitted batch. Select a smaller range if a batch exceeds the byte limit. The preview account cannot write database records or send email.

Use **Save design** to download reusable JSON containing the layout, background and email copy. **Open design** restores it. Attendee rows are imported separately; do not assume this design file saves attendees or row overrides. ZIP filenames include the one-based data row number, preventing collisions between equal names. CSV headers are not counted as attendee rows. XLSX uses the first worksheet and cached formula results; it does not execute spreadsheet formulas.

## Configure saved awards and email

Set these in `.env.local` for both the Next.js server and the worker:

```dotenv
FIREBASE_SERVICE_ACCOUNT_PATH=./.secrets/firebase-service-account.json
AUTH_SECRET=your-long-random-secret
DEV_SKIP_LOGIN=false
SMTP_HOST=smtp.your-provider.example
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-username
SMTP_PASS=your-smtp-password
CERTIFICATE_FROM_EMAIL=Smart Campus <certificates@your-domain.example>
```

Use an existing Firebase project with its default Firestore database. The service account needs Firestore access. The certificate sender falls back to `AUTH_FROM_EMAIL` if `CERTIFICATE_FROM_EMAIL` is absent. Configure a sender address your SMTP provider permits. Secrets are never returned to the browser.

Deploy the additive indexes in `firestore.indexes.json` to your chosen project, using the Firebase CLI:

```powershell
npx firebase-tools deploy --only firestore:indexes --project YOUR_PROJECT_ID
```

If an existing deployment already has an index file, merge these indexes into it first. No project is selected or cloud deployment performed by this implementation. Rules snippets for the server-only collections are in `docs/certificate-security-rules.txt`; merge them with existing rules and avoid broad client-access grants on these collections. This application authenticates API requests with its own session cookie, not Firebase browser authentication.

`npm run dev` alone is enough — no separate worker process is required. The certificate API itself drives queued jobs forward: job creation, a retry, and every status poll from the Batch history tab (every 5s while that tab is open) each claim the job via a transactional lease (`leaseJobById` in `lib/certificates/store.ts`) and run one bounded chunk of processing (`processJob` in `lib/certificates/worker.ts`, capped by `JOB_CHUNK_BUDGET_MS` in `lib/certificates/api.ts`, currently 45s) before handing it back to the queue for the next request to continue. This is what lets it run inside a normal serverless request instead of needing an always-on process — see `export const maxDuration` in `app/api/certificates/[[...path]]/route.ts` (60s, the ceiling on Vercel's Hobby plan; raise it if your plan allows more). A batch only advances while a browser tab is actively polling its status (the Batch history view, or the request that just created/retried it); closing that tab pauses it, and reopening the job resumes it from wherever it left off — nothing is lost, rows already processed are skipped on resume.

For very large batches on a host with a short `maxDuration`, more chunks are needed and each one redoes a fresh Firestore read of already-finished rows before reaching new work, so more polls elapse before completion; this is a throughput/cost trade-off against not needing infrastructure beyond the web app itself.

If you deploy somewhere that can run a long-lived process (a VM, container, etc.) instead of serverless functions, you can still run a standalone worker as an alternative or supplement — it will happily share the same queue via transactional leases:

```powershell
npm run certificates:worker
```

For a single queue poll, use `npm run certificates:worker -- --once`. The worker loads `.env.local`, uses the bundled fonts, and requires Node.js plus this repository's runtime dependencies. Its `react-server` condition permits the existing server-only storage modules to be imported outside Next.js; it does not run React or bypass authentication. A production worker needs `tsx` available too (included as a runtime dependency). It processes rows to completion in one call (no deadline), leasing one job at a time; multiple worker processes — or a worker running alongside the API's own inline chunks — can share the queue safely, since transactional leases prevent two callers from committing the same job at once, and a heartbeat renews each lease so an interrupted one can be reclaimed (by either mechanism) after it expires.

## Workflow and semantics

1. Upload a background or use the included certificate design. Import a CSV/XLSX file. Tap/click column chips to add variables, or drag them onto the canvas.
2. Select a text layer and adjust font, size, color, bold, italic, alignment, line height, rotation, box size or shadow. Changes affect the template unless **Edit only Row N** is enabled. Override indicators and **Reset row overrides** make exceptions visible.
3. Preview different rows. Long text wraps and clips inside its text box; reduce its font size or enlarge the box for that row. Resizing the UI/zoom does not alter exported pixel dimensions.
4. **Download as ZIP** queues rendering/export only. It does not email or award certificates.
5. **Review & deliver** lets you map email/username columns, preview variable email copy, inspect internal matches and select email and/or profile/chat delivery. The final button enqueues the explicitly selected actions and an archive.
6. **Batch history** polls progress, lists row-level outcomes, links to generated PNGs/ZIPs, and offers cancellation or retry. Cancelling stops unstarted work; already sent emails and awarded certificates remain.

Matching is exact after trimming/case normalization. An unmatched valid email remains an SMTP recipient. Conflicting or ambiguous identities never receive an internal award. A username-only match can use the account's stored email. Duplicate recipients are rejected by default; the organizer can explicitly mark repeated rows as distinct awards. The batch request is idempotent across network retries. To intentionally issue an identical new batch, submit a new request key (a fresh studio session does this).

For internal matches, one Firestore transaction writes the certificate, the recipient's system inbox message, the profile counter and the row's delivery marker. Retries do not add awards or increment badges twice. This dedicated inbox appears under **Chat → Certificates** and does not accept or create person-to-person chat requests.

SMTP is sent outside database transactions. `accepted` means the server accepted the message, not that it reached the recipient's inbox. Transport interruptions produce `unknown`; retrying those outcomes requires the explicit checkbox because duplicate emails are possible. Definite SMTP rejections can be retried. Restarted workers do not blindly resend rows left in `sending` state.

Profiles have private-by-default certificate galleries and an external PNG/JPEG/WebP upload flow. Images are normalized to PNG. Users can publish or remove their own certificates; removal updates the badge count transactionally. Public profile URLs are `/members/{userId}` and respect private account/follower visibility. Only public certificate images appear to other viewers. Authorized organizers can still access their own batch assets.

Badge tiers count active internal and external certificates together: zero = no badge, 1–2 = Beginner, 3–5 = Intermediate, 6+ = Expert. The tier is derived from stored counters at read time, so it cannot become inconsistent with a separately stored tier. Self-uploaded certificates are labeled as such.

## API map

All endpoints are under `/api/certificates`. GET profiles and certificate images can be public only when their ownership/visibility rules allow it. Other endpoints require a real session. Mutations enforce the app's same-origin policy.

| Method and path | Purpose |
| --- | --- |
| `GET /` | Owner gallery, stats, cursor pagination |
| `GET /profiles/{userId}` | Public/private-profile-aware gallery and badge |
| `POST /assets` | Validated multipart background or external image upload |
| `GET /assets/{assetId}` | Organizer/asset-owner read |
| `POST /external` | Save an external certificate, with upload idempotency key |
| `PATCH /{certificateId}` | Change visibility or remove a certificate |
| `GET /{certificateId}/image` | Authorized image; `?download=1` adds attachment headers |
| `POST /match` | Exact-match review; returns status without exposing the user directory |
| `POST /jobs` | Validate and freeze a batch; requires `Idempotency-Key`; returns 202 |
| `GET /jobs` | Organizer's most recent batches |
| `GET /jobs/{jobId}` | Progress and paginated row report |
| `PATCH /jobs/{jobId}` | Cancel/retry; explicit opt-in for unknown SMTP outcomes |
| `GET /jobs/{jobId}/download` | Stream completed ZIP |
| `GET /templates` and `GET /templates/{id}` | Read templates/revisions saved with submitted batches |
| `GET /inbox` | Paginated certificate inbox |
| `PATCH /inbox/{messageId}` | Mark own delivery read |

## Storage and operating limits

Collections are created lazily by the Admin SDK; no SQL migration is required. User/auth and existing social records keep their current schema. The approved schema is in `certificate-schema-proposal.md`; runtime validation lives in `lib/certificates/model.ts`.

The initial implementation reuses the existing Firestore chunk storage format for binary assets, with metadata in `certificateAssets`. Archives stream from temporary files into chunks; requests stream them out in bounded pages. Worker temporary files are removed in `finally`. At sustained production volume, replace `lib/certificates/assets.ts` with object storage rather than using Firestore for large ZIPs.

Assets and original batch snapshots currently remain stored to permit retries and organizer downloads. Automatic retention/garbage collection is not enabled: add a reference-aware retention job before sustained production usage. Do not apply Firestore TTL to parent documents and assume their binary chunks or job rows are deleted. External file validation is capped at 8 MB and 8 megapixels; imported batch JSON is capped at 6 MB.

## Verification

```powershell
npm run test:certificates
npm run typecheck
npm run lint
npm run build
```

Focused tests cover badge boundaries, exact/ambiguous/conflicting/unmatched recipient lookup, CSV/XLSX parsing, template validation, isolated row overrides, email escaping and full-resolution PNG/ZIP output. SMTP tests only construct messages; they never send email. Browser checks cover local export, spreadsheet upload and responsive layout. Live Firestore transactions and SMTP acceptance require configured services and should be exercised in a staging project before production rollout.
