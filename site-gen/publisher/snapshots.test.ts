import { describe, expect, test } from 'bun:test';
import { assertStructureDefinitionSnapshots, missingStructureDefinitionSnapshots } from './snapshots';

describe('StructureDefinition snapshot contract', () => {
  test('accepts StructureDefinitions with snapshot elements and ignores non-profiles', () => {
    const resources = [
      { resourceType: 'ImplementationGuide', id: 'ig' },
      {
        resourceType: 'StructureDefinition',
        id: 'patient-profile',
        url: 'http://example.org/StructureDefinition/patient-profile',
        snapshot: { element: [{ id: 'Patient' }] },
      },
    ];

    expect(missingStructureDefinitionSnapshots(resources)).toEqual([]);
    expect(() => assertStructureDefinitionSnapshots(resources)).not.toThrow();
  });

  test('fails clearly when a local StructureDefinition lacks a snapshot', () => {
    const resources = [
      {
        resourceType: 'StructureDefinition',
        id: 'snapshotless',
        url: 'http://example.org/StructureDefinition/snapshotless',
        differential: { element: [{ id: 'Observation' }] },
      },
    ];

    expect(missingStructureDefinitionSnapshots(resources)).toEqual([
      'snapshotless <http://example.org/StructureDefinition/snapshotless>',
    ]);
    expect(() => assertStructureDefinitionSnapshots(resources)).toThrow('StructureDefinition snapshots are required');
    expect(() => assertStructureDefinitionSnapshots(resources)).toThrow('Missing snapshots: snapshotless');
  });
});
