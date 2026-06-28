import { describe, expect, test } from 'bun:test';
import { compareResourceJsonFidelity } from './resource-json';

function row(id: string, json: Record<string, any>) {
  return {
    Type: 'StructureDefinition',
    Id: id,
    Json: JSON.stringify(json),
  };
}

describe('resource JSON fidelity report', () => {
  test('classifies resource JSON differences by review category', () => {
    const expected = [row('example', {
      resourceType: 'StructureDefinition',
      id: 'example',
      url: 'http://example.org/StructureDefinition/example',
      date: '2026-01-01',
      text: { status: 'generated', div: '<div>expected</div>' },
      extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/structuredefinition-standards-status', valueCode: 'draft' }],
      snapshot: {
        element: [{
          id: 'Observation.code',
          min: 1,
          short: 'Expected short',
          binding: { strength: 'required', valueSet: 'http://example.org/ValueSet/example' },
        }],
      },
    })];
    const actual = [row('example', {
      resourceType: 'StructureDefinition',
      id: 'example',
      url: 'http://example.org/StructureDefinition/example|1.0.0',
      date: '2026-02-01',
      text: { status: 'generated', div: '<div>actual</div>' },
      extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/structuredefinition-standards-status', valueCode: 'trial-use' }],
      snapshot: {
        element: [{
          id: 'Observation.code',
          min: 0,
          short: 'Actual short',
          binding: { strength: 'required', valueSet: 'http://example.org/ValueSet/example|1.0.0' },
        }],
      },
    })];

    const report = compareResourceJsonFidelity(expected, actual);

    expect(report.exactResources).toBe(0);
    expect(report.differingResources).toBe(1);
    expect(report.categories['structural-constraints'].count).toBe(1);
    expect(report.categories['human-documentation'].count).toBe(1);
    expect(report.categories['generated-metadata'].count).toBe(1);
    expect(report.categories['generated-narrative'].count).toBe(1);
    expect(report.categories['extension-provenance-metadata'].count).toBe(1);
    expect(report.categories['canonical-version-decoration'].count).toBe(2);
  });

  test('tracks missing and extra resources without counting them as JSON field drift', () => {
    const report = compareResourceJsonFidelity(
      [row('expected-only', { resourceType: 'ValueSet', id: 'expected-only' })],
      [row('actual-only', { resourceType: 'ValueSet', id: 'actual-only' })],
    );

    expect(report.totalDiffs).toBe(0);
    expect(report.missingResources).toEqual(['StructureDefinition/expected-only']);
    expect(report.extraResources).toEqual(['StructureDefinition/actual-only']);
  });

  test('parses Publisher BLOB-style JSON rows returned as Uint8Array by Bun SQLite', () => {
    const encoder = new TextEncoder();
    const expected = [{
      Type: 'ValueSet',
      Id: 'blob-json',
      Json: encoder.encode(JSON.stringify({ resourceType: 'ValueSet', id: 'blob-json', status: 'draft' })),
    }];
    const actual = [{
      Type: 'ValueSet',
      Id: 'blob-json',
      Json: encoder.encode(JSON.stringify({ resourceType: 'ValueSet', id: 'blob-json', status: 'active' })),
    }];

    const report = compareResourceJsonFidelity(expected, actual);

    expect(report.differingResources).toBe(1);
    expect(report.categories['structural-constraints'].samples[0].path).toBe('ValueSet/blob-json.status');
  });

  test('classifies version-only canonical URL drift before documentation keys', () => {
    const report = compareResourceJsonFidelity(
      [row('definition-url', {
        resourceType: 'CapabilityStatement',
        id: 'definition-url',
        rest: [{ resource: [{ operation: [{ definition: 'http://example.org/OperationDefinition/example|1.0.0' }] }] }],
      })],
      [row('definition-url', {
        resourceType: 'CapabilityStatement',
        id: 'definition-url',
        rest: [{ resource: [{ operation: [{ definition: 'http://example.org/OperationDefinition/example' }] }] }],
      })],
    );

    expect(report.categories['canonical-version-decoration'].count).toBe(1);
    expect(report.categories['human-documentation'].count).toBe(0);
  });

  test('classifies generated ImplementationGuide dependency and language enrichment as metadata', () => {
    const report = compareResourceJsonFidelity(
      [{
        Type: 'ImplementationGuide',
        Id: 'ig',
        Json: JSON.stringify({
          resourceType: 'ImplementationGuide',
          id: 'ig',
          language: 'en',
          dependsOn: [{ packageId: 'hl7.terminology.r4', version: '7.2.0' }],
        }),
      }],
      [{
        Type: 'ImplementationGuide',
        Id: 'ig',
        Json: JSON.stringify({
          resourceType: 'ImplementationGuide',
          id: 'ig',
          dependsOn: [],
        }),
      }],
    );

    expect(report.categories['generated-metadata'].count).toBe(2);
    expect(report.categories['structural-constraints'].count).toBe(0);
  });
});
