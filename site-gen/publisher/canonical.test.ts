import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  buildCanonicalIndex,
  buildCurrentCanonicalIndex,
  resolvePackageEntry,
  resolvePublisherResource,
  type CanonicalIndex,
  type IndexedResource,
} from './canonical';
import type { ResolvedPackage } from './packages';

function emptyIndex(): CanonicalIndex {
  return {
    byCanonical: new Map(),
    byCodeSystemUrl: new Map(),
    byCodeSystemUrlAll: new Map(),
    byNamingSystemUri: new Map(),
    packages: [],
  };
}

function indexed(resourceType: string, url: string, packageName: string, marker: string): IndexedResource {
  return {
    key: { resourceType, url },
    package: { name: packageName, version: '1.0.0' },
    sourcePath: `/packages/${packageName}/${resourceType}-${marker}.json`,
    resource: { resourceType, url, id: marker, marker },
  };
}

function add(index: CanonicalIndex, entry: IndexedResource) {
  index.byCanonical.set(`${entry.key.resourceType}|${entry.key.url}`, entry);
  if (entry.key.resourceType === 'CodeSystem') {
    index.byCodeSystemUrl.set(entry.key.url, entry);
    index.byCodeSystemUrlAll.set(entry.key.url, [...(index.byCodeSystemUrlAll.get(entry.key.url) || []), entry]);
  }
}

function fixturePackage(root: string, name: string, version: string, resources: Record<string, any>[]): ResolvedPackage {
  const dir = join(root, `${name}-${version}`);
  mkdirSync(dir, { recursive: true });
  for (const resource of resources) {
    writeFileSync(join(dir, `${resource.resourceType}-${resource.id}.json`), JSON.stringify(resource));
  }
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }));
  return {
    name,
    version,
    dir,
    manifest: { name, version },
    acquisition: { source: 'cache', packageDir: dir },
    resolution: { role: 'declared', loadDependencies: false },
  };
}

describe('publisher canonical resolver', () => {
  test('prefers current IG resources over package resources', () => {
    const current = buildCurrentCanonicalIndex([
      { resourceType: 'ValueSet', id: 'local', url: 'http://example.org/ValueSet/demo', marker: 'local' },
    ]);
    const core = emptyIndex();
    const dependencies = emptyIndex();
    add(core, indexed('ValueSet', 'http://example.org/ValueSet/demo', 'hl7.fhir.r4.core', 'core'));

    expect(resolvePublisherResource({ current, core, dependencies }, {
      resourceType: 'ValueSet',
      url: 'http://example.org/ValueSet/demo',
    })?.marker).toBe('local');
  });

  test('prefers THO ValueSets and CodeSystems from dependencies before R4 core', () => {
    const current = buildCurrentCanonicalIndex([]);
    const core = emptyIndex();
    const dependencies = emptyIndex();
    add(core, indexed('ValueSet', 'http://terminology.hl7.org/ValueSet/v3-ActCode', 'hl7.fhir.r4.core', 'core-vs'));
    add(dependencies, indexed('ValueSet', 'http://terminology.hl7.org/ValueSet/v3-ActCode', 'hl7.terminology.r4', 'tho-vs'));
    add(core, indexed('CodeSystem', 'http://terminology.hl7.org/CodeSystem/v3-ActCode', 'hl7.fhir.r4.core', 'core-cs'));
    add(dependencies, indexed('CodeSystem', 'http://terminology.hl7.org/CodeSystem/v3-ActCode', 'hl7.terminology.r4', 'tho-cs'));

    expect(resolvePublisherResource({ current, core, dependencies }, {
      resourceType: 'ValueSet',
      url: 'http://terminology.hl7.org/ValueSet/v3-ActCode',
    })?.marker).toBe('tho-vs');
    expect(resolvePublisherResource({ current, core, dependencies }, {
      resourceType: 'CodeSystem',
      url: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
    })?.marker).toBe('tho-cs');
  });

  test('indexes preferred THO package resources when multiple packages carry the same canonical', () => {
    const root = mkdtempSync(join(tmpdir(), 'canonical-index-'));
    try {
      const url = 'http://terminology.hl7.org/CodeSystem/v3-RoleCode';
      const oldXver = fixturePackage(root, 'hl7.fhir.uv.xver-r5.r4', '0.1.0', [
        { resourceType: 'CodeSystem', id: 'v3-RoleCode', url, version: '2.2.0', marker: 'xver' },
      ]);
      const oldTho = fixturePackage(root, 'hl7.terminology.r4', '7.1.0', [
        { resourceType: 'CodeSystem', id: 'v3-RoleCode', url, version: '3.0.0', marker: 'tho-7.1' },
      ]);
      const newTho = fixturePackage(root, 'hl7.terminology.r4', '7.2.0', [
        { resourceType: 'CodeSystem', id: 'v3-RoleCode', url, version: '4.0.0', marker: 'tho-7.2' },
      ]);

      const index = buildCanonicalIndex([oldXver, oldTho, newTho]);
      expect(index.byCanonical.get(`CodeSystem|${url}`)?.resource.marker).toBe('tho-7.2');
      expect(index.byCodeSystemUrl.get(url)?.resource.marker).toBe('tho-7.2');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('keeps all CodeSystem candidates and lets later same-version package files win', () => {
    const root = mkdtempSync(join(tmpdir(), 'canonical-index-'));
    try {
      const url = 'http://hl7.org/fhir/sid/icd-9-cm';
      const terminology = fixturePackage(root, 'hl7.terminology.r4', '6.5.0', [
        { resourceType: 'CodeSystem', id: 'ICD-9CM-diagnosiscodes', url, version: '3.0.0', marker: 'diagnosis' },
        { resourceType: 'CodeSystem', id: 'ICD-9CM-procedurecodes', url, version: '3.0.0', marker: 'procedure' },
      ]);

      const index = buildCanonicalIndex([terminology]);
      expect(index.byCodeSystemUrl.get(url)?.resource.marker).toBe('procedure');
      expect(index.byCodeSystemUrlAll.get(url)?.map((entry) => entry.resource.marker)).toEqual(['diagnosis', 'procedure']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('uses terminology metadata as a CodeSystem fallback only after packages', () => {
    const current = buildCurrentCanonicalIndex([]);
    const core = emptyIndex();
    const dependencies = emptyIndex();
    const terminologyCodeSystems = new Map([
      ['http://standardterms.edqm.eu', { resourceType: 'CodeSystem', url: 'http://standardterms.edqm.eu', marker: 'tx' }],
    ]);

    expect(resolvePublisherResource({ current, core, dependencies, terminologyCodeSystems }, {
      resourceType: 'CodeSystem',
      url: 'http://standardterms.edqm.eu',
    })?.marker).toBe('tx');

    add(dependencies, indexed('CodeSystem', 'http://standardterms.edqm.eu', 'some.package', 'package'));
    expect(resolvePublisherResource({ current, core, dependencies, terminologyCodeSystems }, {
      resourceType: 'CodeSystem',
      url: 'http://standardterms.edqm.eu',
    })?.marker).toBe('package');
  });

  test('uses terminology metadata instead of retired not-present package stubs', () => {
    const current = buildCurrentCanonicalIndex([]);
    const core = emptyIndex();
    const dependencies = emptyIndex();
    const url = 'http://example.org/retired-stub';
    add(dependencies, {
      key: { resourceType: 'CodeSystem', url },
      package: { name: 'hl7.terminology.r4', version: '1.0.0' },
      sourcePath: '/packages/hl7.terminology.r4/CodeSystem-retired.json',
      resource: {
        resourceType: 'CodeSystem',
        url,
        content: 'not-present',
        description: 'This code system stub has been retired and superseded.',
        marker: 'package-stub',
      },
    });
    const terminologyCodeSystems = new Map([
      [url, { resourceType: 'CodeSystem', url, version: '2026', marker: 'tx' }],
    ]);

    expect(resolvePublisherResource({ current, core, dependencies, terminologyCodeSystems }, {
      resourceType: 'CodeSystem',
      url,
    })?.marker).toBe('tx');
  });

  test('keeps retired not-present non-terminology package CodeSystems before terminology metadata', () => {
    const current = buildCurrentCanonicalIndex([]);
    const core = emptyIndex();
    const dependencies = emptyIndex();
    const url = 'urn:ietf:bcp:47';
    add(dependencies, {
      key: { resourceType: 'CodeSystem', url },
      package: { name: 'hl7.fhir.uv.xver-r5.r4', version: '0.1.0' },
      sourcePath: '/packages/hl7.fhir.uv.xver-r5.r4/CodeSystem-v3-ietf3066.json',
      resource: {
        resourceType: 'CodeSystem',
        url,
        version: '2.0.1',
        content: 'not-present',
        description: 'Older value from OID registry. Superceded; see recommendations in BCP-47.',
        marker: 'xver',
      },
    });
    const terminologyCodeSystems = new Map([
      [url, { resourceType: 'CodeSystem', url, marker: 'tx-placeholder' }],
    ]);

    expect(resolvePublisherResource({ current, core, dependencies, terminologyCodeSystems }, {
      resourceType: 'CodeSystem',
      url,
    })?.marker).toBe('xver');
  });

  test('keeps ordinary not-present package CodeSystems before terminology metadata', () => {
    const current = buildCurrentCanonicalIndex([]);
    const core = emptyIndex();
    const dependencies = emptyIndex();
    const url = 'http://example.org/not-present';
    add(dependencies, {
      key: { resourceType: 'CodeSystem', url },
      package: { name: 'example.terminology', version: '1.0.0' },
      sourcePath: '/packages/example.terminology/CodeSystem-not-present.json',
      resource: {
        resourceType: 'CodeSystem',
        url,
        content: 'not-present',
        description: 'External code system metadata.',
        marker: 'package',
      },
    });
    const terminologyCodeSystems = new Map([
      [url, { resourceType: 'CodeSystem', url, version: '2026', marker: 'tx' }],
    ]);

    expect(resolvePublisherResource({ current, core, dependencies, terminologyCodeSystems }, {
      resourceType: 'CodeSystem',
      url,
    })?.marker).toBe('package');
  });

  test('package source lookup intentionally excludes current IG resources', () => {
    const current = buildCurrentCanonicalIndex([
      { resourceType: 'ValueSet', id: 'local', url: 'http://example.org/ValueSet/local' },
    ]);
    const core = emptyIndex();
    const dependencies = emptyIndex();

    expect(resolvePackageEntry({ current, core, dependencies }, {
      resourceType: 'ValueSet',
      url: 'http://example.org/ValueSet/local',
    })).toBeUndefined();
  });
});
