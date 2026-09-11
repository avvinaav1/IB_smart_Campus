# Public certificate verification

Open `/verify`. Lookup is public and does not depend on a login session. `GET /api/certificates/verify/{code}` returns `200 {valid:true, certificate:{verificationCode,recipientName,courseName,issuedAt,issuerName}}`, `404 {valid:false,error:"Invalid or Not Found"}`, `429` with `Retry-After`, or `503` for unavailable storage/quota enforcement. Responses are not cached. Issue dates are UTC.

## Additive Firestore schema

This project uses Firestore collections, not SQL tables. New server-generated documents in `certificates` use schema version 2:

| Field | Meaning |
| --- | --- |
| `verificationCode` | Unique 12-character, uppercase alphanumeric Nano ID |
| `recipientName` | Immutable snapshot from the mapped name column; username fallback |
| `courseName` | Immutable snapshot of the course/event column; certificate title fallback |
| `issuedAt` | Server timestamp in milliseconds, saved when the PNG becomes ready |
| `profileAwarded` | Whether profile counters and the internal inbox have been updated |
| `userId` | Optional; attached only on internal profile delivery |

Every newly rendered backend certificate gets a record, including ZIP-only jobs and recipients without Smart Campus accounts. Only matched recipients selected for internal delivery receive profile awards. The existing `source` (`internal`/`external`), `status`, issuer and asset fields remain. Self-uploaded external certificates and legacy certificates without a code are not authenticated by this portal.

Firestore does not implement a SQL UNIQUE constraint. `certificateVerificationCodes/{verificationCode}` enforces uniqueness: one transaction reads the job lease, row and candidate-code document, creates the code document only if absent, and pins the code plus deterministic certificate ID to the row. A collision generates another candidate. Retried/concurrent attempts reuse the reserved row code. The registry uses Firestore's document-key index for direct lookups; `certificates.verificationCode` also has an explicit single-field ascending index in `firestore.indexes.json`.

Reservation happens before rendering, and does not make a code valid. After PNG storage, one transaction creates the certificate and marks the row ready. Lookup follows the registry to an active, platform-issued certificate. Failed renders and deleted certificates are not verified. Code registry entries must never be recycled or automatically deleted: retaining them prevents reuse of an old printed code.

Internal delivery attaches `userId` and flips `profileAwarded` in the same transaction as the badge counters and certificate inbox message. Retries do not count the generated certificate twice. Email and archive generation use the same PNG/code. The ZIP's delivery report includes each code.

## Editor behavior

`{{verification_code}}` is a reserved built-in variable and is printed by the default template. It can be moved and styled like other layers. Each row must retain a code placeholder before export. Existing saved designs need the built-in variable added before submitting a new batch. A CSV heading named `verification_code` is renamed during import; direct job payloads cannot supply a code. Row overrides cannot replace the reserved value with a CSV value.

The local editor and preview ZIPs print `PREVIEW ONLY`. Only the authenticated backend worker can reserve and persist real codes. Previously issued PNGs cannot acquire a printed verification code retroactively; issue a new batch with the updated template. External uploads do not become authentic merely because a user uploads them.

## Code security and lookup limits

Nano ID's secure `customAlphabet` uses the 32-character alphabet `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`, excluding 0, 1, I and O. Twelve characters provide 60 bits of random entropy. Lookup is case-insensitive. Codes are opaque issuance references, not digital signatures over PNG contents. Users must compare the public record against the document: copying a valid code onto a modified PNG does not authenticate the modifications.

Quota enforcement uses Firestore transactions shared across app instances: 20 requests per minute per client bucket and 300 total per minute. Requests rejected by the quota do not perform certificate lookups. Database failures fail closed with 503. `certificateVerificationLimits` uses stable bucket documents with a 24-hour `expiresAt` TTL to clean up inactive clients. Expiry never determines the quota reset; each quota explicitly checks its 60-second window.

By default all requests share the 20/minute client bucket. To separate clients in production, set `CERTIFICATE_CLIENT_IP_HEADER` to a single-IP header that your reverse proxy **overwrites**, and block direct public access to the backend. Arbitrary forwarded headers are not trusted by default. Requests with absent, malformed or comma-separated address values fall back to the shared bucket. This is a conservative application limit; sustained high-volume deployments should enforce additional request limits at their gateway.

## Apply and run

1. Configure Firebase and normal account authentication as described in `certificates.md`.
2. Merge the new indexes, TTL policy and server-only rules snippets into the target project's existing configuration. Deploy using that project's Firebase CLI workflow. The verification registry and limit collections must not permit direct client reads/writes.
3. Restart the Next.js server and `npm run certificates:worker` after changing environment settings.
4. Submit an authenticated batch. Open `/verify` and enter the printed code, or open `/verify?code=CODE` to prefill the form.

No existing records are rewritten and no Firebase project is deployed by this change. New records and registry documents are created lazily through the Admin SDK. Credentials are still required for a real end-to-end run.

## Validation

`npm run test:certificates` covers random-code syntax, collisions, concurrent/retried reservation, activation after rendering, expired leases, CSV spoofing, PNG substitution, deleted/external record rejection, rate limits and API outcomes. Storage transaction tests use an atomic in-memory double. Live Firestore and proxy configuration must be checked against your configured staging deployment; they cannot be exercised without credentials.
