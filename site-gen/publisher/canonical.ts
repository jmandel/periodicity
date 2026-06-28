import type { Json, ResolvedPackage } from './packages';
import { buildPackageResourceIndex } from './package-index';

export type CanonicalKey = {
  resourceType: string;
  url: string;
  version?: string;
};

export type IndexedResource = {
  key: CanonicalKey;
  package?: { name: string; version: string; dir?: string; manifest?: Json };
  sourcePath: string;
  resource: Json;
};

export type CanonicalIndex = {
  byCanonical: Map<string, IndexedResource>;
  byCodeSystemUrl: Map<string, IndexedResource>;
  byCodeSystemUrlAll: Map<string, IndexedResource[]>;
  byNamingSystemUri: Map<string, IndexedResource>;
  packages: ResolvedPackage[];
};

export type PublisherCanonicalIndexes = {
  current: CanonicalIndex;
  core: CanonicalIndex;
  dependencies: CanonicalIndex;
  terminologyCodeSystems?: Map<string, Json>;
};

export function isRetiredNotPresentCodeSystem(resource: Json | undefined): boolean {
  if (!resource || resource.resourceType !== 'CodeSystem') return false;
  if (resource.content !== 'not-present') return false;
  const text = [resource.description, resource.title, resource.name].filter((v) => typeof v === 'string').join('\n');
  return /\b(retired|superseded|superceded)\b/i.test(text);
}

export function isTerminologyPackageResource(entry: IndexedResource): boolean {
  return entry.package?.name?.startsWith('hl7.terminology') === true;
}

export function canonicalNoVersion(url: string | undefined): string | null {
  if (!url) return null;
  return url.split('|')[0];
}

export function canonicalMapKey(resourceType: string, url: string, version?: string): string {
  return `${resourceType}|${canonicalNoVersion(url)}${version ? `|${version}` : ''}`;
}

function emptyCanonicalIndex(packages: ResolvedPackage[] = []): CanonicalIndex {
  return {
    byCanonical: new Map(),
    byCodeSystemUrl: new Map(),
    byCodeSystemUrlAll: new Map(),
    byNamingSystemUri: new Map(),
    packages,
  };
}

function packageName(entry: IndexedResource): string {
  return entry.package?.name || '';
}

function isCorePackage(name: string): boolean {
  return /^hl7\.fhir\.r(3|4|4b|5|6)\.core$/.test(name);
}

function comparePackageVersions(a = '', b = ''): number {
  const aa = a.split(/[.-]/);
  const bb = b.split(/[.-]/);
  const len = Math.max(aa.length, bb.length);
  for (let i = 0; i < len; i++) {
    const av = aa[i] ?? '0';
    const bv = bb[i] ?? '0';
    const an = /^\d+$/.test(av) ? Number(av) : NaN;
    const bn = /^\d+$/.test(bv) ? Number(bv) : NaN;
    const cmp = Number.isFinite(an) && Number.isFinite(bn)
      ? an - bn
      : av.localeCompare(bv);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

function packageResourcePriority(entry: IndexedResource): number {
  const url = entry.key.url;
  const name = packageName(entry);

  if (url.startsWith('http://terminology.hl7.org/')) {
    if (name.startsWith('hl7.terminology')) return 100;
    if (isCorePackage(name)) return 50;
    return 10;
  }

  if (url.startsWith('http://hl7.org/fhir/')) {
    if (isCorePackage(name)) return 100;
    if (name.startsWith('hl7.fhir.r') && name.includes('.examples')) return 50;
    return 10;
  }

  return 0;
}

function shouldReplaceIndexedResource(existing: IndexedResource, candidate: IndexedResource): boolean {
  const existingPriority = packageResourcePriority(existing);
  const candidatePriority = packageResourcePriority(candidate);
  if (candidatePriority !== existingPriority) return candidatePriority > existingPriority;
  if (
    candidate.package?.name === existing.package?.name
    && candidate.package?.version === existing.package?.version
    && candidate.key.resourceType === existing.key.resourceType
    && candidate.key.url === existing.key.url
    && candidate.key.version === existing.key.version
  ) {
    return candidate.sourcePath.localeCompare(existing.sourcePath) > 0;
  }
  if (candidatePriority > 0) return comparePackageVersions(candidate.package?.version, existing.package?.version) > 0;
  return false;
}

function setPreferred(map: Map<string, IndexedResource>, key: string, candidate: IndexedResource): boolean {
  const existing = map.get(key);
  if (!existing) {
    map.set(key, candidate);
    return true;
  }
  if (shouldReplaceIndexedResource(existing, candidate)) {
    map.set(key, candidate);
  }
  return false;
}

function indexResource(
  index: CanonicalIndex,
  resource: Json,
  sourcePath: string,
  packageId?: { name: string; version: string },
): boolean {
  const indexed: IndexedResource = {
    key: {
      resourceType: resource.resourceType || 'Resource',
      url: canonicalNoVersion(resource.url) || resource.url || resource.id || sourcePath,
      version: resource.version,
    },
    ...(packageId ? { package: packageId } : {}),
    sourcePath,
    resource,
  };
  if (resource.resourceType === 'CodeSystem' && resource.url) {
    const codeSystemUrl = canonicalNoVersion(resource.url) || resource.url;
    index.byCodeSystemUrlAll.set(codeSystemUrl, [...(index.byCodeSystemUrlAll.get(codeSystemUrl) || []), indexed]);
    setPreferred(index.byCodeSystemUrl, codeSystemUrl, indexed);
  }
  if (resource.resourceType === 'NamingSystem' && Array.isArray(resource.uniqueId)) {
    for (const uniqueId of resource.uniqueId) {
      if (uniqueId?.type === 'uri' && typeof uniqueId.value === 'string' && !index.byNamingSystemUri.has(uniqueId.value)) {
        index.byNamingSystemUri.set(uniqueId.value, indexed);
      }
    }
  }
  if (!resource.resourceType || !resource.url) return false;
  const key = {
    resourceType: resource.resourceType,
    url: canonicalNoVersion(resource.url) || resource.url,
    version: resource.version,
  };
  const noVersionKey = canonicalMapKey(resource.resourceType, resource.url);
  const inserted = setPreferred(index.byCanonical, noVersionKey, { ...indexed, key });
  if (resource.version) {
    const versionedKey = canonicalMapKey(resource.resourceType, resource.url, resource.version);
    setPreferred(index.byCanonical, versionedKey, { ...indexed, key });
  }
  return inserted;
}

export function buildCurrentCanonicalIndex(resources: Json[]): CanonicalIndex {
  const index = emptyCanonicalIndex();
  for (const resource of resources) {
    const ref = resource.resourceType && resource.id ? `${resource.resourceType}/${resource.id}` : resource.id || 'resource';
    indexResource(index, resource, `current:${ref}`);
  }
  return index;
}

export function buildCanonicalIndex(
  packages: ResolvedPackage[],
  options: { labelRoot?: string; profile?: boolean } = {},
): CanonicalIndex {
  const index = emptyCanonicalIndex(packages);
  for (const entry of buildPackageResourceIndex(packages, options)) {
    indexResource(index, entry.resource, entry.sourcePath, entry.package);
  }
  return index;
}

export function canonicalIndexResources(index: CanonicalIndex): Json[] {
  const seen = new Set<string>();
  const resources: Json[] = [];
  for (const entry of index.byCanonical.values()) {
    const key = entry.sourcePath;
    if (seen.has(key)) continue;
    seen.add(key);
    resources.push(entry.resource);
  }
  return resources;
}

export function resolveIndexedResource(
  index: CanonicalIndex,
  request: { resourceType: string; url: string; version?: string },
): Json | undefined {
  return resolveIndexedEntry(index, request)?.resource;
}

export function resolveIndexedEntry(
  index: CanonicalIndex,
  request: { resourceType: string; url: string; version?: string },
): IndexedResource | undefined {
  const clean = canonicalNoVersion(request.url);
  if (!clean) return undefined;
  if (request.version) {
    const versioned = index.byCanonical.get(canonicalMapKey(request.resourceType, clean, request.version));
    if (versioned) return versioned;
  }
  return index.byCanonical.get(canonicalMapKey(request.resourceType, clean));
}

function packageSearchOrder(indexes: PublisherCanonicalIndexes, resourceType: string, url: string): CanonicalIndex[] {
  const clean = canonicalNoVersion(url) || url;
  if (
    (resourceType === 'ValueSet' && clean.startsWith('http://terminology.hl7.org/ValueSet/'))
    || (resourceType === 'CodeSystem' && clean.startsWith('http://terminology.hl7.org/CodeSystem/'))
  ) {
    return [indexes.dependencies, indexes.core];
  }
  return [indexes.core, indexes.dependencies];
}

export function resolvePublisherEntry(
  indexes: PublisherCanonicalIndexes,
  request: { resourceType: string; url: string; version?: string },
): IndexedResource | undefined {
  const clean = canonicalNoVersion(request.url);
  if (!clean) return undefined;
  const local = resolveIndexedEntry(indexes.current, { ...request, url: clean });
  if (local) return local;
  const terminologyCodeSystem = request.resourceType === 'CodeSystem' ? indexes.terminologyCodeSystems?.get(clean) : undefined;
  for (const index of packageSearchOrder(indexes, request.resourceType, clean)) {
    const entry = resolveIndexedEntry(index, { ...request, url: clean });
    if (entry) {
      if (terminologyCodeSystem && isRetiredNotPresentCodeSystem(entry.resource) && isTerminologyPackageResource(entry)) {
        return {
          key: { resourceType: 'CodeSystem', url: clean, version: terminologyCodeSystem.version },
          sourcePath: `terminology:${clean}`,
          resource: terminologyCodeSystem,
        };
      }
      return entry;
    }
  }
  if (terminologyCodeSystem) {
    return {
      key: { resourceType: 'CodeSystem', url: clean, version: terminologyCodeSystem.version },
      sourcePath: `terminology:${clean}`,
      resource: terminologyCodeSystem,
    };
  }
  return undefined;
}

export function resolvePublisherResource(
  indexes: PublisherCanonicalIndexes,
  request: { resourceType: string; url: string; version?: string },
): Json | undefined {
  return resolvePublisherEntry(indexes, request)?.resource;
}

export function resolvePackageEntry(
  indexes: PublisherCanonicalIndexes,
  request: { resourceType: string; url: string; version?: string },
): IndexedResource | undefined {
  const clean = canonicalNoVersion(request.url);
  if (!clean) return undefined;
  for (const index of packageSearchOrder(indexes, request.resourceType, clean)) {
    const entry = resolveIndexedEntry(index, { ...request, url: clean });
    if (entry) return entry;
  }
  return undefined;
}
