---
name: period-tracking-fhir-sharing
description: Add standards-based menstrual/cycle data sharing to a period-, fertility-, or cycle-tracking app using the Period Tracking MVP FHIR IG — export tracked data as a FHIR R4 Bundle, share it as an encrypted SMART Health Link (SHL), and render it in a privacy-preserving client-side viewer. Use this whenever you are adding FHIR export, "share with my doctor / clinician", QR-code or link sharing of cycle data, SMART Health Link / shlink support, an interoperability or data-portability feature, or a clinician-facing summary to any app that tracks periods, menstrual flow, symptoms, fertility (BBT/LH/cervical mucus), or contraception — even if the user only says "let me export my data" or "share my cycle history."
---

# Period Tracking FHIR Sharing

Help an app turn the cycle data it already stores into a **FHIR R4 Bundle**, share that bundle as an **encrypted SMART Health Link** the user controls, and (optionally) render it in a **client-side clinician viewer**. The authoritative model is the published **Period Tracking MVP Implementation Guide**:

> **IG home:** https://build.fhir.org/ig/jmandel/periodicity/

Always consult the IG for the normative details — this skill is the working method and the glue; the IG is the source of truth for profiles, codes, and conformance.

**Three hosts, three jobs:** `cycle.fhir.me` is the canonical namespace baked into resource URLs (never fetched); `build.fhir.org/ig/jmandel/periodicity/` is the rendered IG you read; `periodicity.fhir.me` hosts the demo viewer and demo ciphertext.

**Paths in this skill:** `references/*` live in this skill directory. Every other path cited here — `input/…`, `viewer-src/`, `scripts/` — is relative to the **IG source-repo root**; clone the repo and read this skill in place (that is how the IG tells agents to use it) so those paths resolve.

## Operating rule: drive from the app's real data

Map only what the app actually stores. Read the app's data model, storage, exports, UI, and tests **before** deciding what to map. Do not invent fields the app does not have, and do not emit app *predictions*, *derived caches*, or *unedited defaults* as clinical facts. When normalization is uncertain, preserve the native value (and optionally keep a full native snapshot) rather than guessing.

This restraint is the whole point: the data is sensitive (reproductive, sexual, fertility, mental-health), and a clinician must be able to trust that every fact reflects something the user actually entered, selected, measured, or verified.

**Read the IG home and the References below before you lock a plan** — the sharing flow, host, and viewer choices all turn on constraints spelled out there.

## Workflow

1. **Plan — set criteria first.** Write a short success checklist before coding: which sharing flow (a downloaded file? a QR/link? a viewer link?), the privacy boundary (where plaintext may exist and where it must not), demo-data needs, viewer behavior, and verification steps. Note explicit non-goals. This checklist is your living plan — see `references/journal-templates.md`.

2. **Confirm the high-level choices with the user.** Before building, surface the decisions that change the shape of the work and get the user's call — propose a sensible default, then ask them to confirm or redirect:
   - **Sharing flow** — a downloaded file, a QR/link, or a viewer-prefixed link?
   - **Ciphertext host** — a static object, the app's own backend, or the ktc.joshuamandel.com companion server? Frame this as the controls you can *honestly* promise (revocability, expiry, use-limit), not just cost (`references/smart-health-links.md`).
   - **Viewer** — reuse the IG's published viewer, or embed your own?
   - **Sensitive scope** — which categories (e.g. sexual activity, mental-health, fertility signs) to include versus hold back.

   Decide silently — and record in the journal — the things the user need not weigh in on: FHIR codes per the IG, compression, bundle structure, and demo-seed mechanics.

3. **Inventory the app.** Identify stored daily facts (flow, bleeding/period status, pain, symptoms, mood, temperature, fertility signs, notes), custom/user-defined symptom labels, predicted/derived/defaulted fields, existing exports, the auth/ownership boundary, and demo-seed and test conventions. Reuse the app's existing repositories, serializers, and build tools.

4. **Classify every candidate field** into one of: `user-entered` (selected/entered/verified/measured/imported) → map it; `derived` (calculated from facts) → usually omit, or mark provenance; `prediction` (future/probabilistic) → **do not** emit as an observed fact; `default` (UI/schema default, not user intent) → do not emit; `configuration` (goals, reminders, prefs) → out of scope; `not-stored` → cannot map. Only `user-entered` becomes a clinical fact.

5. **Map to the IG model** (`references/fhir-mapping.md`). Build a `period-tracking-bundle` containing one Patient, a source-app Device, per-day `daily-tracking-panel` Observations that group the day's `period-tracking-fact` Observations via `hasMember`, and a Provenance. Use the common-core standard codes; reach for the app-native escape hatch only for genuinely app-specific concepts.

6. **Honor the missing-data rules** (in the IG scope page and `references/fhir-mapping.md`). "User explicitly said none/no" (an explicit negative) is a *different fact* from "not recorded that day" (emit nothing). Never fabricate negatives from absence.

7. **Share as a SMART Health Link.** Read the normative packaging guidance (`input/pagecontent/smart-health-links.md`, published as `smart-health-links.html`) and the implementation notes in `references/smart-health-links.md` first. Encrypt the bundle and mint a viewer-prefixed `shlink:/…`; the host only ever sees ciphertext, the key rides in the fragment. The share UI is non-negotiable: **show an on-screen QR**, offer **copy / share** of the same link, and make every share **revocable** (the user can take it down, plus expiry/use-limit where the host supports it).

8. **Render it** (`references/viewer.md`). Either point at an existing viewer (the IG ships one) or embed a small client-side viewer that decrypts in the browser and computes the summary from the granular facts — never send decrypted FHIR back to a server.

9. **Verify end to end, tracking progress as you go.** Keep the step-1 plan checklist live — tick items as you complete them (the plan tracks progress; the journal records decisions). Validate the Bundle against the IG; round-trip encrypt→decrypt; confirm the viewer renders; confirm the host never receives plaintext or the key. Keep a journal of mapping decisions and deferred fields (`references/journal-templates.md`).

## The data model in one screen

- **Bundle** (`period-tracking-bundle`): a `collection` with `identifier` + `timestamp`, exactly one Patient, ≥1 source Device, ≥1 daily panel, ≥1 granular fact, ≥1 Provenance. Optionally a `Binary` native snapshot.
- **Daily panel** (`daily-tracking-panel`): `Observation`, code `https://cycle.fhir.me/CodeSystem/cycle#daily-tracking-panel`, `effectiveDateTime` = the calendar date, `hasMember` → the day's facts, optional `note` (free-text diary). A panel exists only for a day with ≥1 fact or a note.
- **Fact** (`period-tracking-fact`): one independently meaningful `Observation` — a question `code` + a `value` + `subject`/`performer` = Patient + `device`. Category `survey` (or `vital-signs` for temperature).

Common-core facts — codes and values in `references/fhir-mapping.md`:

| Fact | code |
|---|---|
| Menstrual flow | `cycle#menstrual-flow` (coded `flow-none`/`flow-spotting`/`flow-light`/`flow-moderate`/`flow-heavy`) |
| Menstrual status | LOINC `8678-5` |
| Pain (0–10) | LOINC `72514-3` |
| Symptom | LOINC `75325-1` |
| Mood | LOINC `80296-7` |
| Basal body temperature | LOINC `8310-5` (category `vital-signs`) |

Flow intensity (`menstrual-flow`) and "is this a period" (`menstrual-status`) are **separate**: spotting without a period status is intermenstrual bleeding. The receiver derives episodes, cycle lengths, and medians from the facts — summaries do **not** travel in the bundle.

## References

Skim all of these (and the IG home) before locking the plan; re-read each in depth when you reach its phase. The **Read before…** tags index which reference anchors which phase.

- `references/fhir-mapping.md` — the concrete fact-by-fact mapping, terminology, flow/missing-data rules, and a worked bundle to copy from. **Read before building the export.**
- `input/pagecontent/smart-health-links.md` — the normative Period Tracking MVP SHLink packaging guidance (lifetime, use-limit, share shape). **Read before building sharing.**
- `references/smart-health-links.md` — the sharing UX checklist (present + manage), the host-decision table, payload/encryption details, and local scripts. **Use after the packaging page.**
- `references/viewer.md` — how the reference client-side viewer works (decrypt → transform → render) and how to reuse or embed it. **Read before building a viewer.**
- `references/journal-templates.md` — the plan checklist, journal, and mapping-issue templates to keep in the target repo.

## What "done" looks like

The app can demonstrate the patient→clinician path end to end: a FHIR Bundle built from real stored data, validated against the IG; an encrypted SHL the user can share (link or QR); a client-side render of the summary; and a verified privacy boundary (the host never sees plaintext or the key). Mapping decisions, intentionally omitted fields, and any incompatibilities are written down.
