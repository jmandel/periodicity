import { canonicalNoVersion, resolvePublisherResource, type PublisherCanonicalIndexes } from './canonical';

type Json = Record<string, any>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function hasSnapshot(resource: Json): boolean {
  return Array.isArray(resource.snapshot?.element) && resource.snapshot.element.length > 0;
}

export function missingStructureDefinitionSnapshots(resources: Json[]): string[] {
  return resources
    .filter((r) => r.resourceType === 'StructureDefinition')
    .filter((r) => !hasSnapshot(r))
    .map((r) => `${r.id || '(no id)'}${r.url ? ` <${r.url}>` : ''}`);
}

export function assertStructureDefinitionSnapshots(resources: Json[]): void {
  const missing = missingStructureDefinitionSnapshots(resources);
  if (missing.length) {
    throw new Error([
      'StructureDefinition snapshots are required for a publisher-grade package.db.',
      'site-gen renders profile pages from Resources.Json.snapshot.element; reconstructing snapshots in the renderer is intentionally unsupported.',
      'Run the publisher with integrated SUSHI enabled, or provide snapshot-bearing StructureDefinitions with PUBLISHER_RUN_SUSHI=0.',
      `Missing snapshots: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? `, ... ${missing.length - 12} more` : ''}`,
    ].join('\n'));
  }
}

function snapshotElementKey(element: Json): string | null {
  return typeof element.id === 'string' ? element.id : typeof element.path === 'string' ? element.path : null;
}

function normalizedDifferentialElement(element: Json): Json {
  const out = clone(element);
  if (!out.id && typeof out.path === 'string') out.id = out.path;
  if (!out.path && typeof out.id === 'string') out.path = out.id.split(':')[0];
  if (out.path && !out.base) out.base = { path: out.path, min: out.min ?? 0, max: out.max ?? '*' };
  return out;
}

function mergeElement(base: Json, differential: Json): Json {
  const diff = normalizedDifferentialElement(differential);
  return {
    ...clone(base),
    ...diff,
    base: diff.base || base.base || (diff.path ? { path: diff.path, min: diff.min ?? base.min ?? 0, max: diff.max ?? base.max ?? '*' } : undefined),
  };
}

function introducedSlicePaths(differentialElements: Json[]): Set<string> {
  const out = new Set<string>();
  for (const differential of differentialElements) {
    const normalized = normalizedDifferentialElement(differential);
    const id = typeof normalized.id === 'string' ? normalized.id : '';
    const path = typeof normalized.path === 'string' ? normalized.path : '';
    if (path && (typeof normalized.sliceName === 'string' || id.includes(':'))) out.add(path);
  }
  return out;
}

function explicitlyConstrainedUnslicedPaths(differentialElements: Json[]): Set<string> {
  const out = new Set<string>();
  for (const differential of differentialElements) {
    const normalized = normalizedDifferentialElement(differential);
    const id = typeof normalized.id === 'string' ? normalized.id : '';
    const path = typeof normalized.path === 'string' ? normalized.path : '';
    if (path && id === path && typeof normalized.sliceName !== 'string' && !id.includes(':')) out.add(path);
  }
  return out;
}

function prunedInheritedUnslicedDescendants(out: Json[], differentialElements: Json[]): Json[] {
  const slicePaths = introducedSlicePaths(differentialElements);
  if (!slicePaths.size) return out;
  const constrainedUnslicedPaths = explicitlyConstrainedUnslicedPaths(differentialElements);
  for (const path of constrainedUnslicedPaths) slicePaths.delete(path);
  if (!slicePaths.size) return out;
  const differentialKeys = new Set(differentialElements.map(normalizedDifferentialElement).map(snapshotElementKey).filter(Boolean));
  return out.filter((element) => {
    const key = snapshotElementKey(element);
    if (key && differentialKeys.has(key)) return true;
    const id = typeof element.id === 'string' ? element.id : '';
    if (!id || id.includes(':')) return true;
    for (const slicePath of slicePaths) {
      if (id.startsWith(`${slicePath}.`)) return false;
    }
    return true;
  });
}

function overlayDifferential(baseElements: Json[], differentialElements: Json[]): Json[] {
  const out = baseElements.map(clone);
  const byKey = new Map<string, number>();
  out.forEach((element, index) => {
    const key = snapshotElementKey(element);
    if (key && !byKey.has(key)) byKey.set(key, index);
  });

  for (const differential of differentialElements) {
    const normalized = normalizedDifferentialElement(differential);
    const key = snapshotElementKey(normalized);
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing !== undefined) {
      out[existing] = mergeElement(out[existing], normalized);
    } else {
      byKey.set(key, out.length);
      out.push(normalized);
    }
  }
  return prunedInheritedUnslicedDescendants(out, differentialElements);
}

function baseSnapshotFor(
  sd: Json,
  indexes: PublisherCanonicalIndexes,
  completedByUrl: Map<string, Json> = new Map(),
): Json[] | null {
  const baseDefinition = canonicalNoVersion(sd.baseDefinition);
  if (!baseDefinition || baseDefinition === 'http://hl7.org/fhir/StructureDefinition/Base') return null;
  const completedBase = completedByUrl.get(baseDefinition);
  if (hasSnapshot(completedBase || {})) return clone(completedBase!.snapshot.element);
  const base = resolvePublisherResource(indexes, { resourceType: 'StructureDefinition', url: baseDefinition });
  return hasSnapshot(base || {}) ? clone(base!.snapshot.element) : null;
}

function generatedSnapshotElements(sd: Json, indexes: PublisherCanonicalIndexes, completedByUrl = new Map<string, Json>()): Json[] {
  const differential = Array.isArray(sd.differential?.element) ? sd.differential.element : [];
  const baseElements = baseSnapshotFor(sd, indexes, completedByUrl);
  if (!baseElements) return differential.map(normalizedDifferentialElement);
  return overlayDifferential(baseElements, differential);
}

function elementKey(element: Json): string | null {
  return typeof element.id === 'string' ? element.id : typeof element.path === 'string' ? element.path : null;
}

function choiceSliceRootPath(element: Json): string | null {
  const id = typeof element.id === 'string' ? element.id : '';
  if (!id.includes('[x]:')) return null;
  const path = typeof element.path === 'string' ? element.path : id.split(':')[0];
  return path.includes('[x]') ? path : null;
}

function bindableType(element: Json): boolean {
  return (element.type || []).some((type: Json) => {
    const code = type?.code;
    return code === 'code'
      || code === 'Coding'
      || code === 'CodeableConcept'
      || code === 'CodeableReference'
      || code === 'Quantity';
  });
}

function reconcileChoiceSliceBindings(sd: Json, indexes: PublisherCanonicalIndexes, completedByUrl = new Map<string, Json>()): Json {
  if (!hasSnapshot(sd)) return sd;
  const baseElements = baseSnapshotFor(sd, indexes, completedByUrl);
  if (!baseElements) return sd;

  const baseByPath = new Map<string, Json>();
  for (const base of baseElements) {
    if (typeof base.path === 'string' && !baseByPath.has(base.path)) baseByPath.set(base.path, base);
  }

  const differentialByKey = new Map<string, Json>();
  for (const differential of sd.differential?.element || []) {
    const key = elementKey(differential);
    if (key) differentialByKey.set(key, differential);
  }

  let changed = false;
  const snapshotElements = sd.snapshot.element.map((element: Json) => {
    const rootPath = choiceSliceRootPath(element);
    if (!rootPath) return element;
    const diff = elementKey(element) ? differentialByKey.get(elementKey(element)!) : undefined;
    if (diff?.binding) return element;

    const base = baseByPath.get(rootPath);
    if (!base?.binding) return element;

    const next = clone(element);
    if (bindableType(element)) {
      if (JSON.stringify(next.binding) === JSON.stringify(base.binding)) return element;
      next.binding = clone(base.binding);
      changed = true;
      return next;
    }
    if (next.binding) {
      delete next.binding;
      changed = true;
      return next;
    }
    return element;
  });

  return changed ? { ...sd, snapshot: { ...sd.snapshot, element: snapshotElements } } : sd;
}

function pruneSnapshotForDifferentialSlices(sd: Json): Json {
  if (!hasSnapshot(sd)) return sd;
  const differentialElements = Array.isArray(sd.differential?.element) ? sd.differential.element : [];
  if (!differentialElements.length) return sd;
  const pruned = prunedInheritedUnslicedDescendants(sd.snapshot.element, differentialElements);
  return pruned.length === sd.snapshot.element.length ? sd : { ...sd, snapshot: { ...sd.snapshot, element: pruned } };
}

export function completeStructureDefinitionSnapshots(resources: Json[], indexes: PublisherCanonicalIndexes): Json[] {
  const localByUrl = new Map<string, Json>();
  for (const resource of resources) {
    const url = canonicalNoVersion(resource.url);
    if (resource.resourceType === 'StructureDefinition' && url) localByUrl.set(url, resource);
  }

  const completedByUrl = new Map<string, Json>();
  const visiting = new Set<string>();

  const complete = (resource: Json): Json => {
    const url = canonicalNoVersion(resource.url);
    if (url && completedByUrl.has(url)) return completedByUrl.get(url)!;
    if (url && visiting.has(url)) return resource;
    if (url) visiting.add(url);

    const baseUrl = canonicalNoVersion(resource.baseDefinition);
    if (baseUrl && localByUrl.has(baseUrl)) complete(localByUrl.get(baseUrl)!);

    let completed = resource;
    if (hasSnapshot(completed)) {
      completed = pruneSnapshotForDifferentialSlices(completed);
      completed = reconcileChoiceSliceBindings(completed, indexes, completedByUrl);
    } else {
      const snapshotElements = generatedSnapshotElements(completed, indexes, completedByUrl);
      if (snapshotElements.length) {
        completed = reconcileChoiceSliceBindings({
          ...completed,
          snapshot: {
            element: snapshotElements,
          },
        }, indexes, completedByUrl);
      }
    }

    if (url) {
      visiting.delete(url);
      completedByUrl.set(url, completed);
    }
    return completed;
  };

  return resources.map((resource) => {
    if (resource.resourceType !== 'StructureDefinition') return resource;
    const completed = complete(resource);
    if (hasSnapshot(completed)) return completed;
    const snapshotElements = generatedSnapshotElements(completed, indexes, completedByUrl);
    if (!snapshotElements.length) return resource;
    return reconcileChoiceSliceBindings({
      ...completed,
      snapshot: {
        element: snapshotElements,
      },
    }, indexes, completedByUrl);
  });
}
