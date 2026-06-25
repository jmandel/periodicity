export const PROFILE_GROUPS = [
  { label: 'Layer 0 core', ids: ['menstrual-bleeding-fact'] },
  { label: 'Layer 1 facts', ids: ['menstrual-flow-fact', 'symptom-fact', 'numeric-pain-severity-fact', 'basal-body-temperature-fact'] },
  { label: 'Bundle', ids: ['period-tracking-bundle'] },
  { label: 'Base', ids: ['period-tracking-fact'] },
];

export function profileGroupLabel(id: string): string | null {
  return PROFILE_GROUPS.find((g) => g.ids.includes(id))?.label || null;
}
