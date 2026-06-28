import { fhirPublicationBaseForVersion } from './fhir-versions';

export type Json = Record<string, any>;

export type MetadataRow = {
  key: number;
  name: string;
  value: string;
};

export type ConceptRow = {
  key: number;
  resourceKey: number;
  parentKey: number | null;
  code: string | null;
  display: string | null;
  definition: string | null;
};

export type PropertyRow = {
  key: number;
  resourceKey: number;
  code: string | null;
  uri: string | null;
  description: string | null;
  type: string | null;
};

export type ConceptPropertyRow = {
  key: number;
  resourceKey: number;
  conceptKey: number;
  propertyKey: number | null;
  code: string | null;
  value: string | null;
};

export type CodeSystemPropertyRows = {
  propertyRows: PropertyRow[];
  conceptPropertyRows: ConceptPropertyRow[];
};

export type ResourceRow = {
  key: number;
  type: string;
  custom: number;
  id: string;
  web: string;
  url: string | null;
  version: string | null;
  status: string | null;
  date: string | null;
  name: string;
  title: string | null;
  experimental: string | null;
  realm: string | null;
  description: string | null;
  purpose: string | null;
  copyright: string | null;
  copyrightLabel: string | null;
  derivation: string | null;
  standardStatus: string | null;
  kind: string | null;
  sdType: string | null;
  base: string | null;
  content: string | null;
  supplements: string | null;
  json: string;
};

export type ResourceRows = {
  rows: ResourceRow[];
  keyByRef: Map<string, number>;
};

export type ValueSetCodeRow = {
  key: number;
  resourceKey: number;
  valueSetUri: string;
  valueSetVersion: string;
  system: string;
  version: string | null;
  code: string;
  display: string | null;
};

export type ValueSetExpansionLike = {
  codes: Array<{
    system: string;
    version?: string | null;
    code: string;
    display?: string | null;
  }>;
};

function scalarString(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  return null;
}

function boolString(v: unknown): string | null {
  return typeof v === 'boolean' ? String(v) : null;
}

function formatGenDate(d: Date): string {
  const day = d.toLocaleDateString('en-US', { weekday: 'short', timeZoneName: undefined });
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  const offStr = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}${String(abs % 60).padStart(2, '0')}`;
  return `${day}, ${month} ${dd}, ${yyyy} ${hh}:${mm}${offStr}`;
}

export function pageFor(type: string, id: string): string {
  return type === 'ImplementationGuide' ? 'index.html' : `${type}-${id}.html`;
}

export function resourceRef(r: Json): string {
  return `${r.resourceType}/${r.id}`;
}

function hasCanonicalUrl(resource: Json): boolean {
  return typeof resource.url === 'string' && resource.url.length > 0;
}

function displayName(resource: Json, meta: Json | undefined): string {
  return scalarString(resource.name)
    || scalarString(meta?.name)
    || scalarString(resource.title)
    || resource.id
    || `${resource.resourceType || 'Resource'}`;
}

function extensionValue(resourceOrConfig: Json, url: string, field: string): unknown {
  return (resourceOrConfig.extension || []).find((e: any) => e.url === url)?.[field];
}

const NON_IMPLEMENTABLE_STATUS_TYPES = new Set([
  'ChargeItemDefinition',
  'Citation',
  'ConditionDefinition',
  'EvidenceReport',
  'EvidenceVariable',
  'ExampleScenario',
  'ObservationDefinition',
]);

function standardStatus(resource: Json): string | null {
  return scalarString(extensionValue(resource, 'http://hl7.org/fhir/StructureDefinition/structuredefinition-standards-status', 'valueCode'));
}

function isExampleResource(meta: Json | undefined): boolean {
  return meta?.exampleBoolean === true || typeof meta?.exampleCanonical === 'string' || typeof meta?.profile === 'string';
}

function igCanonicalBase(ig: Json | undefined): string | null {
  const url = scalarString(ig?.url);
  return url?.replace(/\/ImplementationGuide\/[^/]+$/, '') ?? null;
}

function hasCurrentIgProfile(resource: Json, igCanonical: string | null): boolean {
  if (!igCanonical || !Array.isArray(resource.meta?.profile)) return false;
  return resource.meta.profile.some((p: unknown) => typeof p === 'string' && p.startsWith(`${igCanonical}/StructureDefinition/`));
}

function propagatedStandardStatus(resource: Json, meta: Json | undefined, igStandardStatus: string | null, igCanonical: string | null): string | null {
  const explicit = standardStatus(resource);
  if (explicit || !igStandardStatus || isExampleResource(meta)) return explicit;
  if (
    resource.experimental === true
    && (resource.resourceType === 'CodeSystem' || resource.resourceType === 'Questionnaire' || resource.resourceType === 'ValueSet')
    && hasCurrentIgProfile(resource, igCanonical)
  ) {
    return null;
  }
  if (resource.experimental === true || NON_IMPLEMENTABLE_STATUS_TYPES.has(String(resource.resourceType))) return 'informative';
  return igStandardStatus;
}

function baseDefinitionForDb(resource: Json, cfg: Json): string | null {
  const base = scalarString(resource.baseDefinition);
  if (!base || base.includes('|') || cfg.parameters?.['pin-canonicals'] !== 'pin-all') return base;
  const fhirVersion = Array.isArray(cfg.fhirVersion) ? cfg.fhirVersion[0] : cfg.fhirVersion;
  if (cfg.canonical && base.startsWith(`${cfg.canonical}/`)) return `${base}|${cfg.version}`;
  if (base.startsWith('http://hl7.org/fhir/StructureDefinition/') && fhirVersion) return `${base}|${fhirVersion}`;
  return base;
}

export function deriveMetadataRows(args: {
  cfg: Json;
  ig: Json;
  now: Date;
  branch?: string | null;
  revision?: string | null;
}): MetadataRow[] {
  const { cfg, ig, now, branch, revision } = args;
  const fhirVersion = Array.isArray(cfg.fhirVersion) ? cfg.fhirVersion[0] : cfg.fhirVersion;
  const values = [
    ['path', fhirVersion ? fhirPublicationBaseForVersion(fhirVersion) : ''],
    ['canonical', cfg.canonical || ig.url?.replace(/\/ImplementationGuide\/.+$/, '') || ''],
    ['igId', cfg.id || ig.id || ''],
    ['igName', cfg.name || ig.name || ''],
    ['packageId', cfg.id || ig.packageId || ig.id || ''],
    ['igVer', cfg.version || ig.version || ''],
    ['errorCount', '0'],
    ['version', fhirVersion || ''],
    ['releaseLabel', cfg.releaseLabel || 'ci-build'],
    ['revision', revision || 'unknown'],
    ['versionFull', fhirVersion ? `${fhirVersion}-${revision || 'unknown'}` : revision || 'unknown'],
    ['toolingVersion', 'site-gen.publisher'],
    ['toolingRevision', '0'],
    ['toolingVersionFull', 'site-gen.publisher experiment'],
    ['genDate', formatGenDate(now)],
    ['genDay', `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`],
    ['gitstatus', branch || 'unknown'],
  ];
  return values.map(([name, value], i) => ({ key: i + 1, name, value }));
}

export function deriveResourceRows(resources: Json[], resourceMeta: Map<string, Json>, cfg: Json): ResourceRows {
  const rows: ResourceRow[] = [];
  const keyByRef = new Map<string, number>();
  const ig = resources.find((r) => r.resourceType === 'ImplementationGuide');
  const igStandardStatus = ig ? standardStatus(ig) : null;
  const igCanonical = igCanonicalBase(ig);
  resources.forEach((r, i) => {
    const key = i + 1;
    keyByRef.set(resourceRef(r), key);
    const meta = resourceMeta.get(resourceRef(r));
    const canonicalResource = hasCanonicalUrl(r);
    rows.push({
      key,
      type: r.resourceType,
      custom: 0,
      id: r.id,
      web: pageFor(r.resourceType, r.id),
      url: canonicalResource ? r.url ?? null : null,
      version: canonicalResource ? r.version ?? null : null,
      status: r.status ?? null,
      date: canonicalResource ? r.date ?? null : null,
      name: canonicalResource ? scalarString(r.name) : displayName(r, meta),
      title: scalarString(r.title),
      experimental: boolString(r.experimental),
      realm: null,
      description: canonicalResource ? scalarString(r.description) : scalarString(r.description) || scalarString(meta?.description),
      purpose: scalarString(r.purpose),
      copyright: scalarString(r.copyright),
      copyrightLabel: scalarString(r.copyrightLabel),
      derivation: scalarString(r.derivation),
      standardStatus: canonicalResource ? propagatedStandardStatus(r, meta, igStandardStatus, igCanonical) : null,
      kind: r.resourceType === 'StructureDefinition' ? scalarString(r.kind) : null,
      sdType: r.resourceType === 'StructureDefinition' ? scalarString(r.type) : null,
      base: r.resourceType === 'StructureDefinition' ? baseDefinitionForDb(r, cfg) : null,
      content: scalarString(r.content),
      supplements: scalarString(r.supplements),
      json: JSON.stringify(r),
    });
  });
  return { rows, keyByRef };
}

function collectConceptRows(resources: Json[], keyByRef: Map<string, number>): { rows: ConceptRow[]; keyByConcept: WeakMap<Json, number> } {
  const rows: ConceptRow[] = [];
  const keyByConcept = new WeakMap<Json, number>();
  function walk(resourceKey: number, concepts: any[], parentKey: number | null) {
    for (const c of concepts || []) {
      const row: ConceptRow = {
        key: rows.length + 1,
        resourceKey,
        parentKey,
        code: scalarString(c.code),
        display: scalarString(c.display),
        definition: scalarString(c.definition),
      };
      rows.push(row);
      keyByConcept.set(c, row.key);
      if (Array.isArray(c.concept)) walk(resourceKey, c.concept, row.key);
    }
  }
  for (const r of resources.filter((r) => r.resourceType === 'CodeSystem')) {
    const resourceKey = keyByRef.get(resourceRef(r));
    if (resourceKey) walk(resourceKey, r.concept || [], null);
  }
  return { rows, keyByConcept };
}

export function deriveConceptRows(resources: Json[], keyByRef: Map<string, number>): ConceptRow[] {
  return collectConceptRows(resources, keyByRef).rows;
}

export function deriveCodeSystemPropertyRows(resources: Json[], keyByRef: Map<string, number>): CodeSystemPropertyRows {
  const propertyRows: PropertyRow[] = [];
  const conceptPropertyRows: ConceptPropertyRow[] = [];
  const propertyKeyByResourceAndCode = new Map<string, number>();
  const { keyByConcept } = collectConceptRows(resources, keyByRef);

  for (const cs of resources.filter((r) => r.resourceType === 'CodeSystem')) {
    const resourceKey = keyByRef.get(resourceRef(cs));
    if (!resourceKey) continue;
    for (const property of cs.property || []) {
      const row: PropertyRow = {
        key: propertyRows.length + 1,
        resourceKey,
        code: scalarString(property.code),
        uri: scalarString(property.uri),
        description: scalarString(property.description),
        type: scalarString(property.type),
      };
      propertyRows.push(row);
      if (row.code) propertyKeyByResourceAndCode.set(`${resourceKey}|${row.code}`, row.key);
    }
  }

  function walk(resourceKey: number, concepts: Json[] = []) {
    for (const concept of concepts) {
      const conceptKey = keyByConcept.get(concept);
      if (conceptKey) {
        for (const property of concept.property || []) {
          const code = scalarString(property.code);
          conceptPropertyRows.push({
            key: conceptPropertyRows.length + 1,
            resourceKey,
            conceptKey,
            propertyKey: code ? propertyKeyByResourceAndCode.get(`${resourceKey}|${code}`) ?? null : null,
            code,
            // Match the current Java Publisher package.db contract.
            value: null,
          });
        }
      }
      if (Array.isArray(concept.concept)) walk(resourceKey, concept.concept);
    }
  }

  for (const cs of resources.filter((r) => r.resourceType === 'CodeSystem')) {
    const resourceKey = keyByRef.get(resourceRef(cs));
    if (resourceKey) walk(resourceKey, cs.concept || []);
  }

  return { propertyRows, conceptPropertyRows };
}

export function deriveValueSetCodeRows(
  resources: Json[],
  keyByRef: Map<string, number>,
  expansions: Map<string, ValueSetExpansionLike>,
): ValueSetCodeRow[] {
  const rows: ValueSetCodeRow[] = [];
  for (const vs of resources.filter((r) => r.resourceType === 'ValueSet')) {
    const resourceKey = keyByRef.get(resourceRef(vs));
    if (!resourceKey || !vs.url) continue;
    const expansion = expansions.get(resourceRef(vs));
    if (!expansion) continue;
    for (const c of expansion.codes) {
      rows.push({
        key: rows.length + 1,
        resourceKey,
        valueSetUri: vs.url,
        valueSetVersion: scalarString(vs.version) || '',
        system: c.system,
        version: c.version ?? null,
        code: c.code,
        display: c.display ?? null,
      });
    }
  }
  return rows;
}
