# SMART Health Link packaging

The complete Period Tracking MVP Bundle is one FHIR JSON file suitable for SMART Health Link distribution.

## Content type

Use:

```text
application/fhir+json;fhirVersion=4.0.1
```

## Encryption boundary

The sharing application SHOULD:

1. build the final Bundle locally;
2. serialize exactly the Bundle shown in the user's preview;
3. generate the SMART Health Link encryption key locally;
4. encrypt the FHIR JSON using the SMART Health Link JWE requirements;
5. upload only ciphertext to the file host; and
6. construct and render the `shlink:/` URI and QR code locally.

The file host does not need the decryption key and should not receive plaintext FHIR, native JSON, patient labels, or diary text.

## Direct-file SHLinks

Period Tracking MVP shares use SMART Health Links direct-file mode.

A conforming share SHALL:

- include `U` in the SHLink `flag`;
- set `url` to a direct-file endpoint for one compact JWE;
- encrypt exactly one `application/fhir+json` Period Tracking MVP Bundle; and
- let receivers retrieve the JWE with `GET <url>?recipient=...`.

This guide does not define a manifest-based Period Tracking MVP share. If an implementation chooses another SMART Health Links pattern, it is outside this guide's constrained exchange profile.

The SMART Health Links specification requires compact JWE using direct key management and A256GCM, with the payload content type identified in the protected header. The payload SHOULD be compressed with raw DEFLATE before encryption, signalled by `"zip":"DEF"` in the JWE protected header; recipients SHALL accept both compressed and uncompressed payloads. The worked example below compresses a ~640 KB Bundle to a ~20 KB encrypted file this way.

## Link lifetime and use limits

Period-tracking SHLinks should be scoped to the intended clinical handoff.

For an in-person QR or same-day handoff, sharing applications SHOULD create short-lived links, for example 5-15 minutes. For scheduled or asynchronous review, sharing applications SHOULD prefer a bounded lifetime such as 24-48 hours.

When the file is served by a backend, the server SHOULD support deletion, expiry, or a small maximum-use count and return 404 after the link is no longer active. When the JWE is hosted as a static object, `exp` is only a receiver-visible staleness hint; enforced expiry requires deleting or rotating the object.

## Recipient behavior

The receiving application SHALL decrypt the file before parsing FHIR. It SHOULD validate the Bundle against this guide, retain the original encrypted payload or hash for audit when appropriate, and clearly indicate that ordinary FHIR JSON is patient-generated rather than cryptographically attested clinical data.

## Reference viewer and worked SMART Health Link

This guide publishes a self-contained **[clinician viewer](viewer/)** and a worked SMART Health Link that exercises the whole path end to end. Open the {% include demo-shlink-link.xhtml %} to inspect the real viewer-prefixed `shlink:/…` URL.

- The **[longitudinal example Bundle](Bundle-period-tracking-longitudinal-example.html)** — a synthetic seven-cycle copper-IUD case built entirely from the common-core facts — is the cleartext.
- It is encrypted to the direct-file SHL payload published at [`viewer/example.jwe`](viewer/example.jwe) (with `zip:DEF`), and the shareable link is published at [`viewer/shlink.txt`](viewer/shlink.txt).
- Opening the URL in [`viewer/shlink.txt`](viewer/shlink.txt), or pasting it into [`viewer/`](viewer/), prepopulates the viewer with the SHLink. The recipient then enters or accepts the visible name field and clicks Open; the viewer sends that value as the SHLink `recipient`, decrypts the file **in the browser**, runs the application-independent transform, derives the cycle/bleeding/pain/symptom analytics from the granular facts (no precomputed summaries travel in the Bundle), and renders a clinician-facing readout.

The viewer also accepts a full link as a URL fragment, `viewer/#shlink:/…`, so any conformant `shlink:/` for this profile can be rendered by the same page. The decryption key in the published demo is intentionally public because the data is synthetic; a real share keeps the key only in the `shlink:/` URI. The viewer is a reference for receivers and is **not** a substitute for clinical judgement.
