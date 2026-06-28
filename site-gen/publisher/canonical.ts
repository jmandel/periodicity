import type { Json, ResolvedPackage } from './packages';
import { buildPackageResourceIndex } from './package-index';

export type CanonicalKey = {
  resourceType: string;
  url: string;
  version?: string;
};

export type IndexedResource = {
  key: CanonicalKey;
  package?: { name: string; version: string };
  sourcePath: string;
  resource: Json;
};

export type CanonicalIndex = {
  byCanonical: Map<string, IndexedResource>;
  byCodeSystemUrl: Map<string, IndexedResource>;
  byNamingSystemUri: Map<string, IndexedResource>;
  packages: ResolvedPackage[];
};

export type PublisherCanonicalIndexes = {
  current: CanonicalIndex;
  core: CanonicalIndex;
  dependencies: CanonicalIndex;
  terminologyCodeSystems?: Map<string, Json>;
};

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
    byNamingSystemUri: new Map(),
    packages,
  };
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
  if (resource.resourceType === 'CodeSystem' && resource.url && !index.byCodeSystemUrl.has(resource.url)) {
    index.byCodeSystemUrl.set(resource.url, indexed);
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
  let inserted = false;
  if (!index.byCanonical.has(noVersionKey)) {
    index.byCanonical.set(noVersionKey, { ...indexed, key });
    inserted = true;
  }
  if (resource.version) {
    const versionedKey = canonicalMapKey(resource.resourceType, resource.url, resource.version);
    if (!index.byCanonical.has(versionedKey)) index.byCanonical.set(versionedKey, { ...indexed, key });
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
  for (const index of packageSearchOrder(indexes, request.resourceType, clean)) {
    const entry = resolveIndexedEntry(index, { ...request, url: clean });
    if (entry) return entry;
  }
  if (request.resourceType === 'CodeSystem') {
    const codeSystem = indexes.terminologyCodeSystems?.get(clean);
    if (codeSystem) {
      return {
        key: { resourceType: 'CodeSystem', url: clean, version: codeSystem.version },
        sourcePath: `terminology:${clean}`,
        resource: codeSystem,
      };
    }
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
