import { describe, expect, test } from 'bun:test';
import { deriveConceptRows, deriveMetadataRows, deriveResourceRows, deriveValueSetCodeRows } from './rows';

describe('package DB row derivation', () => {
  test('derives deterministic metadata rows from explicit inputs', () => {
    const rows = deriveMetadataRows({
      cfg: {
        fhirVersion: '4.0.1',
        canonical: 'https://example.org/ig',
        id: 'example.ig',
        name: 'ExampleIG',
        version: '1.2.3',
        releaseLabel: 'test-build',
      },
      ig: {
        resourceType: 'ImplementationGuide',
        id: 'ig',
        url: 'https://example.org/ig/ImplementationGuide/example.ig',
      },
      now: new Date('2026-06-27T12:34:56Z'),
      branch: 'main',
      revision: 'abc123def0',
    });

    expect(rows.map((row) => [row.key, row.name])).toEqual([
      [1, 'path'],
      [2, 'canonical'],
      [3, 'igId'],
      [4, 'igName'],
      [5, 'packageId'],
      [6, 'igVer'],
      [7, 'errorCount'],
      [8, 'version'],
      [9, 'releaseLabel'],
      [10, 'revision'],
      [11, 'versionFull'],
      [12, 'toolingVersion'],
      [13, 'toolingRevision'],
      [14, 'toolingVersionFull'],
      [15, 'genDate'],
      [16, 'genDay'],
      [17, 'gitstatus'],
    ]);
    const byName = new Map(rows.map((row) => [row.name, row.value]));
    expect(byName.get('path')).toBe('http://hl7.org/fhir/R4/');
    expect(byName.get('canonical')).toBe('https://example.org/ig');
    expect(byName.get('versionFull')).toBe('4.0.1-abc123def0');
    expect(byName.get('gitstatus')).toBe('main');
  });

  test('uses FHIR release publication paths in metadata rows', () => {
    const baseArgs = {
      ig: { resourceType: 'ImplementationGuide', id: 'ig' },
      now: new Date('2026-06-27T12:34:56Z'),
    };

    expect(new Map(deriveMetadataRows({
      ...baseArgs,
      cfg: { fhirVersion: '4.3.0' },
    }).map((row) => [row.name, row.value])).get('path')).toBe('http://hl7.org/fhir/R4B/');

    expect(new Map(deriveMetadataRows({
      ...baseArgs,
      cfg: { fhirVersion: '5.0.0' },
    }).map((row) => [row.name, row.value])).get('path')).toBe('http://hl7.org/fhir/R5/');

    expect(new Map(deriveMetadataRows({
      ...baseArgs,
      cfg: { fhirVersion: '6.0.0-ballot3' },
    }).map((row) => [row.name, row.value])).get('path')).toBe('http://hl7.org/fhir/6.0.0-ballot3/');
  });

  test('derives nested CodeSystem concept rows with stable parent keys', () => {
    const resources = [
      { resourceType: 'ImplementationGuide', id: 'ig' },
      {
        resourceType: 'CodeSystem',
        id: 'cycle',
        concept: [
          {
            code: 'parent',
            display: 'Parent',
            concept: [
              { code: 'child', display: 'Child', definition: 'Nested child' },
            ],
          },
          { code: 'sibling', display: 'Sibling' },
        ],
      },
    ];
    const rows = deriveConceptRows(resources, new Map([['CodeSystem/cycle', 2]]));

    expect(rows).toEqual([
      { key: 1, resourceKey: 2, parentKey: null, code: 'parent', display: 'Parent', definition: null },
      { key: 2, resourceKey: 2, parentKey: 1, code: 'child', display: 'Child', definition: 'Nested child' },
      { key: 3, resourceKey: 2, parentKey: null, code: 'sibling', display: 'Sibling', definition: null },
    ]);
  });

  test('derives Resources rows and the resource key map', () => {
    const resources = [
      {
        resourceType: 'ImplementationGuide',
        id: 'demo',
        name: 'DemoIG',
      },
      {
        resourceType: 'StructureDefinition',
        id: 'demo-profile',
        url: 'http://example.org/StructureDefinition/demo-profile',
        version: '1.0.0',
        name: 'DemoProfile',
        status: 'draft',
        date: '2026-01-01',
        experimental: false,
        kind: 'resource',
        type: 'Observation',
        baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Observation',
        derivation: 'constraint',
      },
    ];
    const metadata = new Map([
      ['StructureDefinition/demo-profile', { description: 'Profile from IG manifest' }],
    ]);

    const result = deriveResourceRows(resources, metadata, {
      fhirVersion: ['4.0.1'],
      parameters: { 'pin-canonicals': 'pin-all' },
    });

    expect([...result.keyByRef.entries()]).toEqual([
      ['ImplementationGuide/demo', 1],
      ['StructureDefinition/demo-profile', 2],
    ]);
    expect(result.rows).toEqual([
      expect.objectContaining({
        key: 1,
        type: 'ImplementationGuide',
        id: 'demo',
        web: 'index.html',
        url: null,
        name: 'DemoIG',
        json: JSON.stringify(resources[0]),
      }),
      expect.objectContaining({
        key: 2,
        type: 'StructureDefinition',
        id: 'demo-profile',
        web: 'StructureDefinition-demo-profile.html',
        url: 'http://example.org/StructureDefinition/demo-profile',
        version: '1.0.0',
        status: 'draft',
        date: '2026-01-01',
        name: 'DemoProfile',
        experimental: 'false',
        description: 'Profile from IG manifest',
        derivation: 'constraint',
        kind: 'resource',
        sdType: 'Observation',
        base: 'http://hl7.org/fhir/StructureDefinition/Observation|4.0.1',
        json: JSON.stringify(resources[1]),
      }),
    ]);
  });

  test('derives ValueSet_Codes rows from prepared expansions', () => {
    const resources = [
      { resourceType: 'ValueSet', id: 'flow', url: 'http://example.org/ValueSet/flow', version: '1.0.0' },
      { resourceType: 'ValueSet', id: 'unused', url: 'http://example.org/ValueSet/unused' },
    ];
    const rows = deriveValueSetCodeRows(
      resources,
      new Map([
        ['ValueSet/flow', 10],
        ['ValueSet/unused', 11],
      ]),
      new Map([
        ['ValueSet/flow', {
          codes: [
            { system: 'http://example.org/CodeSystem/flow', code: 'light', display: 'Light' },
            { system: 'http://example.org/CodeSystem/flow', version: '2', code: 'heavy' },
          ],
        }],
      ]),
    );

    expect(rows).toEqual([
      {
        key: 1,
        resourceKey: 10,
        valueSetUri: 'http://example.org/ValueSet/flow',
        valueSetVersion: '1.0.0',
        system: 'http://example.org/CodeSystem/flow',
        version: null,
        code: 'light',
        display: 'Light',
      },
      {
        key: 2,
        resourceKey: 10,
        valueSetUri: 'http://example.org/ValueSet/flow',
        valueSetVersion: '1.0.0',
        system: 'http://example.org/CodeSystem/flow',
        version: '2',
        code: 'heavy',
        display: null,
      },
    ]);
  });
});
