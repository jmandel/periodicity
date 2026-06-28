export type Json = Record<string, any>;

export type ResourceJsonDiffCategory =
  | 'structural-constraints'
  | 'human-documentation'
  | 'generated-metadata'
  | 'generated-narrative'
  | 'canonical-version-decoration'
  | 'extension-provenance-metadata';

export type ResourceJsonDiff = {
  category: ResourceJsonDiffCategory;
  kind: 'missing' | 'extra' | 'type' | 'value';
  path: string;
  expected?: unknown;
  actual?: unknown;
};

export type ResourceJsonFidelityReport = {
  exactResources: number;
  differingResources: number;
  totalDiffs: number;
  categories: Record<ResourceJsonDiffCategory, { count: number; samples: ResourceJsonDiff[] }>;
  missingResources: string[];
  extraResources: string[];
};

export type ResourceJsonRow = {
  Type: string;
  Id: string;
  Json: string | Uint8Array;
};

const categoryOrder: ResourceJsonDiffCategory[] = [
  'structural-constraints',
  'human-documentation',
  'generated-metadata',
  'generated-narrative',
  'canonical-version-decoration',
  'extension-provenance-metadata',
];

const documentationKeys = new Set([
  'alias',
  'comment',
  'copyright',
  'copyrightLabel',
  'definition',
  'description',
  'meaningWhenMissing',
  'purpose',
  'requirements',
  'short',
]);

const generatedMetadataKeys = new Set([
  'date',
  'dependsOn',
  'extension',
  'fhirVersion',
  'jurisdiction',
  'language',
  'meta',
  'packageId',
  'publisher',
]);

const generatedMetadataPrefixes = [
  'definition.parameter',
];

const canonicalKeys = new Set([
  'baseDefinition',
  'profile',
  'targetProfile',
  'url',
  'valueCanonical',
  'valueSet',
]);

function pathKey(path: string): string {
  const normalized = path.replace(/\[\d+\]/g, '');
  const parts = normalized.split('.').filter(Boolean);
  return parts[parts.length - 1] || '';
}

function stringWithoutVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.split('|')[0];
}

function differsOnlyByCanonicalVersion(expected: unknown, actual: unknown): boolean {
  const e = stringWithoutVersion(expected);
  const a = stringWithoutVersion(actual);
  return e != null && a != null && e === a && expected !== actual;
}

function classify(path: string, expected: unknown, actual: unknown): ResourceJsonDiffCategory {
  if (path === 'text' || path.startsWith('text.')) return 'generated-narrative';
  if (path.includes('.text.') || path.endsWith('.text.div') || path.endsWith('.text.status')) return 'generated-narrative';
  if (path.includes('.extension') || path === 'extension' || path.startsWith('extension[')) return 'extension-provenance-metadata';
  if (differsOnlyByCanonicalVersion(expected, actual)) return 'canonical-version-decoration';
  if (generatedMetadataPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`))) return 'generated-metadata';

  const key = pathKey(path);
  if (documentationKeys.has(key)) return 'human-documentation';
  if (generatedMetadataKeys.has(key)) return 'generated-metadata';
  return 'structural-constraints';
}

function isPrimitive(value: unknown): boolean {
  return value == null || typeof value !== 'object';
}

function formatPath(base: string, key: string): string {
  return base ? `${base}.${key}` : key;
}

function diffJson(expected: unknown, actual: unknown, path = ''): ResourceJsonDiff[] {
  if (Object.is(expected, actual)) return [];

  if (isPrimitive(expected) || isPrimitive(actual)) {
    if (typeof expected !== typeof actual) {
      return [{ category: classify(path, expected, actual), kind: 'type', path, expected, actual }];
    }
    return [{ category: classify(path, expected, actual), kind: 'value', path, expected, actual }];
  }

  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      return [{ category: classify(path, expected, actual), kind: 'type', path, expected, actual }];
    }
    const diffs: ResourceJsonDiff[] = [];
    const max = Math.max(expected.length, actual.length);
    for (let i = 0; i < max; i++) {
      const childPath = `${path}[${i}]`;
      if (i >= expected.length) {
        diffs.push({ category: classify(childPath, undefined, actual[i]), kind: 'extra', path: childPath, actual: actual[i] });
      } else if (i >= actual.length) {
        diffs.push({ category: classify(childPath, expected[i], undefined), kind: 'missing', path: childPath, expected: expected[i] });
      } else {
        diffs.push(...diffJson(expected[i], actual[i], childPath));
      }
    }
    return diffs;
  }

  const expectedObject = expected as Json;
  const actualObject = actual as Json;
  const keys = [...new Set([...Object.keys(expectedObject), ...Object.keys(actualObject)])].sort();
  const diffs: ResourceJsonDiff[] = [];
  for (const key of keys) {
    const childPath = formatPath(path, key);
    if (!(key in expectedObject)) {
      diffs.push({ category: classify(childPath, undefined, actualObject[key]), kind: 'extra', path: childPath, actual: actualObject[key] });
    } else if (!(key in actualObject)) {
      diffs.push({ category: classify(childPath, expectedObject[key], undefined), kind: 'missing', path: childPath, expected: expectedObject[key] });
    } else {
      diffs.push(...diffJson(expectedObject[key], actualObject[key], childPath));
    }
  }
  return diffs;
}

function rowKey(row: Pick<ResourceJsonRow, 'Type' | 'Id'>): string {
  return `${row.Type}/${row.Id}`;
}

function parseResourceJson(row: ResourceJsonRow): Json {
  const json = typeof row.Json === 'string' ? row.Json : new TextDecoder().decode(row.Json);
  return JSON.parse(json);
}

function initialCategories(): ResourceJsonFidelityReport['categories'] {
  return Object.fromEntries(categoryOrder.map((category) => [category, { count: 0, samples: [] }])) as ResourceJsonFidelityReport['categories'];
}

export function resourceJsonCategoryLabels(): ResourceJsonDiffCategory[] {
  return [...categoryOrder];
}

export function compareResourceJsonFidelity(expectedRows: ResourceJsonRow[], actualRows: ResourceJsonRow[], sampleLimit = 8): ResourceJsonFidelityReport {
  const expected = new Map(expectedRows.map((row) => [rowKey(row), row]));
  const actual = new Map(actualRows.map((row) => [rowKey(row), row]));
  const categories = initialCategories();
  const missingResources: string[] = [];
  const extraResources: string[] = [];
  let exactResources = 0;
  let differingResources = 0;
  let totalDiffs = 0;

  for (const [key, expectedRow] of expected) {
    const actualRow = actual.get(key);
    if (!actualRow) {
      missingResources.push(key);
      continue;
    }

    const diffs = diffJson(parseResourceJson(expectedRow), parseResourceJson(actualRow));
    if (!diffs.length) {
      exactResources++;
      continue;
    }

    differingResources++;
    totalDiffs += diffs.length;
    for (const diff of diffs) {
      const bucket = categories[diff.category];
      bucket.count++;
      if (bucket.samples.length < sampleLimit) {
        bucket.samples.push({ ...diff, path: `${key}.${diff.path}` });
      }
    }
  }

  for (const key of actual.keys()) {
    if (!expected.has(key)) extraResources.push(key);
  }

  return {
    exactResources,
    differingResources,
    totalDiffs,
    categories,
    missingResources,
    extraResources,
  };
}
