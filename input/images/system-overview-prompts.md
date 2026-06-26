# Image generation prompts

These prompts document the generated home-page overview images:

- `system-overview.png` — widescreen version.
- `system-overview-portrait.png` — vertical/mobile version.

> Note: the image-generation tool did not expose a literal final internal prompt string. The prompts below are faithful, reusable reconstructions of the effective prompts for the most recent widescreen and vertical versions, based on the requested edits and the generated outputs.

## 1) Most recent widescreen image prompt

Create a polished, publish-ready widescreen infographic diagram for the cycle.fhir.me home page. The diagram should match the site’s visual theme: pale cream/off-white background, soft rounded cards, subtle shadows, clean sans-serif typography, high contrast black headings, and accent colors from the site palette: coral/red for Model/source/core, orange for Share/SMART Health Link, teal/green for supporting context, and purple for View/receiver.

Do **not** include website chrome, navigation bars, browser frames, logos, or surrounding page UI. The output should be only the diagram itself.

Use a horizontal three-step architecture layout: **1 MODEL**, **2 SHARE**, **3 VIEW**. Keep the design compact, diagram-focused, and suitable for embedding in a web page, not a presentation slide. Avoid large editorial headline copy.

### Overall layout

Use three main columns/cards arranged left to right:

1. **MODEL** — Source app maps real data to facts.
2. **SHARE** — Packed as an encrypted SMART Health Link.
3. **VIEW** — Receiver decrypts and computes views.

Use simple numbered circular badges for 1, 2, and 3. Connect the cards with clean arrows labeled **maps**, **packaged as**, and **opens**.

### Card 1: MODEL

Header row:
- Number badge: **1**
- Title: **MODEL**
- Subtitle: **Source app maps real data to facts**

Main card:
- Title: **Source app**
- Subtitle: **period tracker**
- Text: **Maps only real, user-entered data**
- Section label: **Example app records**

Example app records list:
- **menstrual bleeding (core)**
- **flow**
- **symptoms**
- **pain (0–10)**
- **basal body temperature**

Do **not** include notes in the source-app example list.

### Card 2: SHARE

Header row:
- Number badge: **2**
- Title: **SHARE**
- Subtitle: **Packed as an encrypted SMART Health Link**

Main bundle card:
- Badge: **FHIR R4**
- Title: **Period Tracking Bundle**
- Subtitle: **(Bundle Profile)**

Inside the bundle card, show the IG data model as stacked layers:

#### Layer 0

Heading: **Layer 0: Core interoperable facts**

Content:
- **Menstrual Bleeding Fact**
- **required for compatible exports**
- **yes / no bleeding over time**
- Add a small label: **MINIMAL CORE**

#### Layer 1+

Heading: **Layer 1+: Additional fact layers (optional)**

Tiles:
- **Flow Fact**
- **Symptom Fact**
- **Numeric Pain Fact**
- **Basal Body Temperature Fact**

#### Supporting context

Heading: **Supporting context (optional)**

Tiles:
- **Patient (optional)**
- **Device (optional)**

Below the bundle, show a separate connected SMART Health Link card:
- Title: **SMART Health Link**
- Bullets:
  - **encrypted JWE**
  - **SHLink URL + QR**
  - **host sees ciphertext only**
- Include a small QR-code-like square, but make it visually illustrative rather than a real scannable code.

### Card 3: VIEW

Header row:
- Number badge: **3**
- Title: **VIEW**
- Subtitle: **Receiver decrypts and computes views**

Main card:
- Title: **Viewer / clinician**
- Subtitle: **receiver**
- Text: **Decrypts locally and computes views**
- Show a result card:
  - **Cycle summary / review view**
  - **computed from granular facts**
- Workflow section:
  - Heading: **Use in workflow**
  - Bullets:
    - **copy snippets to clipboard for EHR/charting**
    - **inspect facts in detail**
    - **review and chart**

Do **not** say “export screenshot or report.”

### Style requirements

Use a refined vector UI style, not a generic flowchart. Rounded cards, thin borders, soft shadows, generous whitespace, consistent icon style, and subtle pastel fills. Use the cycle.fhir.me color feel: coral/red, orange, teal, purple, cream background. Keep all text crisp and readable. Make the diagram feel like a first-class website illustration.

---

## 2) Most recent vertical mobile image prompt

Create a polished, publish-ready **vertical mobile** version of the same architecture infographic for the cycle.fhir.me home page. It should match the site’s visual theme: pale cream/off-white background, soft rounded cards, subtle shadows, clean sans-serif typography, high contrast black headings, and accent colors from the site palette: coral/red for Model/source/core, orange for Share/SMART Health Link, teal/green for supporting context, and purple for View/receiver.

Do **not** include website chrome, navigation bars, browser frames, logos, or surrounding page UI. The output should be only the diagram itself.

The image should be tall and mobile-friendly. Do not place steps 1, 2, and 3 side by side. Stack them vertically as three large cards: **MODEL**, then **SHARE**, then **VIEW**.

### Critical layout requirement

Make all three main card headers symmetrical and consistent.

Each main card must begin with the same kind of header row:
- left: circular numbered badge
- next: matching round icon badge
- right: title in the same font/size/weight
- below or beside title: one short subtitle in the same style

The three headers must have consistent spacing, alignment, font sizes, icon sizes, and vertical rhythm. Do not put MODEL and SHARE outside their boxes while VIEW is inside; all three titles must be inside their respective card headers.

Use clean downward arrows between cards:
- Between MODEL and SHARE: **maps**
- Within SHARE from bundle to link: **packaged as**
- Between SHARE and VIEW: **opens**

### Card 1: MODEL

Header row:
- Number badge: **1**
- Icon: phone/source-app icon
- Title: **MODEL**
- Subtitle: **Source app maps real data to facts**

Content:
- Text: **Maps only real, user-entered data**
- Section label: **Example app records**

Example app records list in compact mobile rows:
- **menstrual bleeding (core)**
- **flow**
- **symptoms**
- **pain (0–10)**
- **basal body temperature**

Do **not** include notes.

### Card 2: SHARE

Header row:
- Number badge: **2**
- Icon: lock/share icon
- Title: **SHARE**
- Subtitle: **Packed as an encrypted SMART Health Link**

Content should include a bundle section and a SMART Health Link section.

Bundle section:
- Badge: **FHIR R4**
- Title: **Period Tracking Bundle**
- Subtitle: **(Bundle Profile)**

Inside the bundle, show stacked layers:

#### Layer 0

Heading: **Layer 0: Core interoperable facts**

Content:
- **Menstrual Bleeding Fact**
- **required for compatible exports**
- **yes / no bleeding over time**
- Label: **MINIMAL CORE**

#### Layer 1+

Heading: **Layer 1+: Additional fact layers (optional)**

Tiles:
- **Flow Fact**
- **Symptom Fact**
- **Numeric Pain Fact**
- **Basal Body Temperature Fact**

#### Supporting context

Heading: **Supporting context (optional)**

Tiles:
- **Patient (optional)**
- **Device (optional)**

SMART Health Link section:
- Title: **SMART Health Link**
- Bullets:
  - **encrypted JWE**
  - **SHLink URL + QR**
  - **host sees ciphertext only**
- Include a small QR-code-like square, clearly illustrative.

### Card 3: VIEW

Header row:
- Number badge: **3**
- Icon: monitor/viewer icon
- Title: **VIEW**
- Subtitle: **Receiver decrypts and computes views**

Content:
- Text: **Decrypts locally and computes views**
- Result card:
  - **Cycle summary / review view**
  - **computed from granular facts**
- Workflow section:
  - Heading: **Use in workflow**
  - Bullets:
    - **copy snippets to clipboard for EHR/charting**
    - **inspect facts in detail**
    - **review and chart**

Do **not** say “export screenshot or report.”

### Style requirements

Use a refined vector UI style, not a generic flowchart. Rounded cards, thin borders, soft shadows, generous whitespace, consistent icon style, and subtle pastel fills. Use the cycle.fhir.me color feel: coral/red, orange, teal, purple, cream background. Keep all text crisp and readable. Make the vertical layout feel intentional and symmetric, optimized for mobile browsing.
