# SMART Health Links reference

A SMART Health Link (SHL) lets a user share the FHIR Bundle as an **encrypted file plus a key**, where the hosting server only ever sees ciphertext. The key travels inside the link (in the URL fragment), so a blind host — your CDN, an object store, or a third party — can never read the cycle data.

The normative Period Tracking MVP packaging guidance lives in `input/pagecontent/smart-health-links.md` and is published at https://build.fhir.org/ig/jmandel/periodicity/smart-health-links.html. Follow that page for the required share shape, lifetime, and use-limit rules; this reference is implementation support.
Spec: SMART Health Links (smarthealthit.org / HL7).

## The `shlink:/` payload

A link is `shlink:/` + base64url(minified JSON):

| field | meaning |
|---|---|
| `url` | where the encrypted content lives. For Period Tracking MVP, see the packaging page. ≤128 chars. |
| `key` | base64url of **32 random bytes** — the AES-256 key. (43 chars.) |
| `flag` | optional letters defined by SMART Health Links. For Period Tracking MVP requirements, see the packaging page. |
| `label` | optional ≤80-char human label. |
| `exp` | optional expiry, **epoch seconds** (advisory staleness hint). |
| `v` | optional version int, default 1. |

Encryption: **compact JWE, `alg:"dir"`, `enc:"A256GCM"`**, `cty` header = `application/fhir+json`. A fresh 12-byte IV per encryption. Optional `zip:"DEF"` (raw DEFLATE before encrypt).

**DEFLATE caveat:** `zip:"DEF"` shrinks a bundle dramatically (our ~640 KB example → ~20 KB), and the IG demo uses it. But modern `jose` dropped JWE `zip` support, so DEF is a common failure point for third-party receivers. **Default to uncompressed** for links you'll send to unknown viewers; use DEF only for large bundles when you control or trust the receiver. The IG reference viewer inflates DEF.

## Retrieval implementation note

For a direct-file SHLink, the receiver does `GET <url>?recipient=<org>` and the body is the JWE (`Content-Type: application/jose`). `recipient` is required. The receiver then decrypts the JWE with `key` and parses the FHIR Bundle.

**Why a plain static file is a compliant SHL.** Normally `url` is a *manifest endpoint* the receiver `POST`s to — that needs a server. The **`U` ("direct file") flag** tells the receiver to skip the manifest and `GET` the `url` directly, with the encrypted JWE as the body. A static host (S3 / GCS / Azure blob, a CDN object, a GitHub Pages file) just returns the bytes and ignores the `?recipient` query, so no server logic is required. Our own demo *is* this: `example.jwe` is a static file on GitHub Pages with `flag:"U"`. The flip side is exactly why it's the weakest tier in the host table below — a dumb host can't read `recipient`, count opens, or enforce `exp`, and it must send permissive CORS so a browser viewer can fetch it cross-origin.

## Sharing UX — present and manage the link

Treat a share as a **live, revocable object the user owns**, not a one-off export. Its lifecycle is **create → present → deliver → manage → take down**, and the sharing UI has two jobs. The rules below hold across app architectures (static, backed, client-only, mobile).

### Present the link — checklist

The shareable string is a **viewer URL + fragment**: `<viewer>/#shlink:/eyJ…`. The `#` fragment is never sent to the server (so the key never leaks into logs). The project's own viewer prefix is `https://periodicity.fhir.me/#shlink:/…`.

- [ ] **MUST render an on-screen QR** of that full string — error-correction level M, sized to scan from a phone, label visible (optionally the SMART logo). A bare `shlink:/…` only works with SHL-aware scanners; the viewer-prefixed form opens from any phone camera. *This is the primary in-person handoff and the step implementers most often skip — it is not optional.*
- [ ] **MUST offer copy-to-clipboard** of the identical string.
- [ ] **SHOULD offer the native share sheet** (`navigator.share()` / OS share) for remote delivery — message, email, paste into a portal.
- [ ] **SHOULD state in plain language** what's inside (data types + date range), that it's encrypted, and that anyone with the link can open it.

The QR and the copied/shared text are byte-identical: one minted link, two channels (scan vs. send).

### Manage the link — checklist

Because this is reproductive data, the user must stay in control after the link leaves their screen.

- [ ] **MUST provide a visible "Stop sharing / Take it down" action** that actually makes the link stop resolving — delete the ciphertext, disable the endpoint, or revoke server-side. Every architecture must support a real take-down.
- [ ] **MUST retain a handle to each live share** (the host URL / link id) so it can be revoked later. A fire-and-forget upload you cannot delete is not acceptable.
- [ ] **SHOULD show lifetime/expiry**, and where the host can count opens, **opens-remaining / use-limit**.
- [ ] **SHOULD list active shares** with status (created · last opened · expires · revoked).

Two automatic take-down triggers, both host-enforced and surfaced here: **after N opens** (needs a counting host) and **on expiry** (a countdown that is only real if the host stops serving at `exp`). The always-available manual trigger is **user revokes now**.

### Honesty rule

**Only surface a control the host actually enforces.** Don't show "2 opens left" if the host can't count GETs; don't imply auto-expiry a static object won't enforce. The link itself carries only an advisory `exp` — enforcement (expiry, use-count, revocation) is the *host's* job, so what you can promise in the UI is gated by where the ciphertext lives (next section).

## Choosing a host by the controls you need

Start from the controls you must honestly offer, then pick the host that can back them.

| Host | Real auto-expiry | Use-limit / count | Explicit revoke | Access visible | Use when |
|---|---|---|---|---|---|
| **Static object, no backend** (CDN / S3 / GCS / Azure, permissive CORS) | ✗ advisory only — must delete to enforce | ✗ blind host can't count | ✓ delete / overwrite / rotate key | ✗ | you just need to publish a snapshot the user can hand to a clinician |
| **Your own backend** (direct-file: `GET <url>?recipient=…` → `application/jose`) | ✓ | ✓ | ✓ | ✓ | clinic check-in, tighter operational control, production with no third party in the path |
| **shlep** (deployable blind SHLink service over any object store) | ✓ | ✓ | ✓ pause / revoke | ✓ | client-only / static / mobile apps with no backend to enforce limits, revocation, passcode, or audit |

**Decision rule:** if the product promises use-limits, guaranteed revocation, passcode, or "opens remaining," a blind static host is insufficient — use a backend or deploy shlep. Static is fine for a plain snapshot, but you still owe the user a real take-down (delete the object) and must not display counters you cannot compute.

In all three, the privacy boundary holds: the host stores only ciphertext; the key stays client-side.

**shlep — a deployable blind SHLink service.** Use [shlep](https://github.com/jmandel/shlep) when the app can encrypt a Bundle but has no natural backend to host the ciphertext. It implements the SHLink data plane this guide needs (`GET /shl/{id}?recipient=…` → compact JWE; plus the manifest rail) and a capability-token control plane: create shares, add/replace/delete files, set expiry and max-use, set/clear a passcode, pause/resume, revoke, and read an access log — over ciphertext + a hashed manage token, never plaintext or the content key.

- Source + spec: https://github.com/jmandel/shlep (`docs/api-design.md`; a running instance self-documents at `GET /llms.txt`).
- Backends: any object store — S3, R2, GCS, Azure Blob, MinIO.
- Runtime: the core is Web-standard, so it runs on Node/Bun/Deno or a **Cloudflare Worker** — a Worker + an R2 bucket is a near-turnkey blind host for an app with no server.

You deploy and operate it (no public hosted instance) — the right posture for production health data: you control retention, monitoring, and how manage tokens are issued.

## Implementing it yourself (no service)

If you'd rather not run a service, the client side is small. Use shlep's reference client crypto — `src/crypto.ts` (compact JWE `dir`/A256GCM, WebCrypto only) and `src/client.ts` (encrypt + compose the `shlink:/`) at https://github.com/jmandel/shlep — directly or translated; it uses a **fresh random IV per encryption and a fresh key per share** (the correct nonce discipline). For direct-file mode you then host the `.jwe` and hand out `<viewer>#shlink:/<payload>`.

The IG's own `viewer-src/jwe.mjs` is the viewer's **decrypt** path; `scripts/gen-shl.ts` is **editorial demo tooling** that pins a fixed key+IV only to keep the published example byte-stable — do not copy that pattern for real encryption.

## Receiver notes

- **Recipient flow:** scan/paste → extract `shlink:/` → decode → `GET <url>?recipient=...` → fetch JWE → decrypt with `key` → FHIR. Always send `recipient`; expect one-time/expiring links not to re-resolve.
- **Receiver hygiene:** fetch payload URLs through a hardened, SSRF-resistant retrieval path and treat decrypted content as untrusted input. Label the rendering clearly as patient-generated, not clinically attested.
