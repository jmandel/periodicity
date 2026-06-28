export type Json = Record<string, any>;

const CANONICAL_RESOURCE_TYPES = new Set([
  'ActivityDefinition',
  'CapabilityStatement',
  'ChargeItemDefinition',
  'CodeSystem',
  'CompartmentDefinition',
  'ConceptMap',
  'EffectEvidenceSynthesis',
  'EventDefinition',
  'Evidence',
  'EvidenceVariable',
  'ExampleScenario',
  'GraphDefinition',
  'ImplementationGuide',
  'Library',
  'Measure',
  'MessageDefinition',
  'NamingSystem',
  'OperationDefinition',
  'PlanDefinition',
  'Questionnaire',
  'ResearchElementDefinition',
  'RiskEvidenceSynthesis',
  'SearchParameter',
  'StructureDefinition',
  'StructureMap',
  'TerminologyCapabilities',
  'TestScript',
  'ValueSet',
]);

function configFlag(cfg: Json, name: string): boolean {
  return cfg.parameters?.[name] === true || cfg.parameters?.[name] === 'true';
}

function hasCanonicalUrl(resource: Json): boolean {
  return typeof resource.url === 'string' && resource.url.length > 0;
}

function isCanonicalResource(resource: Json): boolean {
  return typeof resource.resourceType === 'string' && CANONICAL_RESOURCE_TYPES.has(resource.resourceType);
}

export function formatFhirDateTime(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export function canonicalUrlForResource(resource: Json, cfg: Json): string | null {
  if (!isCanonicalResource(resource) || !resource.id || !cfg.canonical) return null;
  return `${String(cfg.canonical).replace(/\/+$/, '')}/${resource.resourceType}/${resource.id}`;
}

export function configuredContact(cfg: Json): Json[] | null {
  if (Array.isArray(cfg.contact) && cfg.contact.length) return cfg.contact;
  if (!cfg.publisher?.name && !cfg.publisher?.url) return null;
  return [{
    ...(cfg.publisher?.name ? { name: cfg.publisher.name } : {}),
    ...(cfg.publisher?.url ? { telecom: [{ system: 'url', value: cfg.publisher.url }] } : {}),
  }];
}

export function applyGlobalResourceMetadata(resource: Json, cfg: Json, now: Date): Json {
  if (!hasCanonicalUrl(resource) && !isCanonicalResource(resource)) return resource;

  const out = { ...resource };
  if (!hasCanonicalUrl(out)) {
    const url = canonicalUrlForResource(out, cfg);
    if (url) out.url = url;
  }
  if (cfg.version) out.version = cfg.version;
  if (configFlag(cfg, 'apply-publisher') && cfg.publisher?.name) out.publisher = cfg.publisher.name;
  if (configFlag(cfg, 'apply-contact')) {
    const contact = configuredContact(cfg);
    if (contact?.length) out.contact = contact;
  }
  if (!out.date) out.date = formatFhirDateTime(now);
  if (!out.status) out.status = 'draft';
  return out;
}
