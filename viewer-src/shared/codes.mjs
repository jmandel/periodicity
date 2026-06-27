/**
 * codes.mjs — terminology for the Period Tracking MVP *new* data model.
 *
 * The IG's point is a small common core plus optional layers:
 *   - bleeding is the universal boolean core (cycle#menstrual-bleeding)
 *   - flow is a coded optional intensity layer (cycle#flow-*)
 *   - pain is LOINC 72514-3, a 0-10 {score} Quantity
 *   - symptoms use cycle#symptom + an exact SNOMED value
 *   - basal body temperature is LOINC 8310-5 (a vital sign)
 *
 * Used by generate-example.ts (write) and transform.mjs (read).
 */

export const SYS = {
  loinc: "http://loinc.org",
  sct: "http://snomed.info/sct",
  ucum: "http://unitsofmeasure.org",
  obsCat: "http://terminology.hl7.org/CodeSystem/observation-category",
  cycle: "https://cycle.fhir.me/CodeSystem/cycle",
};

export const LOINC = {
  painScore: "72514-3",
  symptom: "75325-1",
  mood: "80296-7",
  bodyTemp: "8310-5",
};

export const SCT = {
  iudInsertion: "65200003", // Insertion of intrauterine contraceptive device (procedure)
  dyspareunia: "71315007",
};

/* ----- flow: cycle CodeSystem coded values <-> ordinal 0-4 ----- */
export const FLOW_CODE_BY_LEVEL = ["flow-none", "flow-spotting", "flow-light", "flow-moderate", "flow-heavy"];
export const FLOW_LEVEL_BY_CODE = { "flow-none": 0, "flow-spotting": 1, "flow-light": 2, "flow-moderate": 3, "flow-heavy": 4 };

/* ----- premenstrual tracker symptoms -> exact SNOMED concept ----- */
export const SYMPTOM_DEFS = [
  { key: "menstrualCramp", sct: "431416001" },
  { key: "backache", sct: "161891005" },
  { key: "irritability", sct: "55929007" },
  { key: "headache", sct: "25064002" },
  { key: "migraine", sct: "37796009" },
  { key: "stomachAche", sct: "271681002" },
  { key: "nausea", sct: "422587007" },
  { key: "breastTenderness", sct: "55222007" },
  { key: "ovulationPain", sct: "43548008" },
  { key: "bloating", sct: "116289008" }, // Abdominal bloating (finding) — active
  { key: "fatigue", sct: "84229001" },
  { key: "lowMood", sct: "366979004" },
];
export const SYMPTOM_LABELS = {
  menstrualCramp: "Menstrual cramp",
  backache: "Backache",
  irritability: "Irritability",
  headache: "Headache",
  migraine: "Migraine",
  stomachAche: "Stomach ache",
  nausea: "Nausea",
  breastTenderness: "Breast tenderness",
  ovulationPain: "Ovulation pain",
  bloating: "Bloating",
  fatigue: "Fatigue",
  lowMood: "Low mood",
};
/* SNOMED concept (and the IG example's mood/stress) -> view-model symptom key */
export const FINDING_SYMPTOM_KEY = Object.fromEntries([
  ...SYMPTOM_DEFS.map((s) => [s.sct, s.key]),
  ["73595000", "lowMood"], // Stress (finding), used by the IG's own example
]);
/* SNOMED concept -> pain association the viewer recognises */
export const FINDING_PAINTYPE = { [SCT.dyspareunia]: "dyspareunia" };
