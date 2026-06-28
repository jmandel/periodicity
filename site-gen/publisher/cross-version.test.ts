import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import YAML from 'yaml';
import { buildCanonicalIndex, buildCurrentCanonicalIndex } from './canonical';
import { deriveIndexedListRows } from './indexed-lists';
import { resolvePackages } from './packages';
import { deriveCodeSystemPropertyRows, deriveConceptRows, deriveMetadataRows, deriveResourceRows, deriveValueSetCodeRows, resourceRef } from './rows';
import { writePackageDbFile } from './writer';

function readJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeR5CorePackage(cacheRoot: string) {
  const packageDir = join(cacheRoot, 'hl7.fhir.r5.core#5.0.0', 'package');
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
    name: 'hl7.fhir.r5.core',
    version: '5.0.0',
    url: 'http://hl7.org/fhir/R5',
    fhirVersions: ['5.0.0'],
  }, null, 2));
  writeFileSync(join(packageDir, 'ValueSet-observation-codes.json'), JSON.stringify({
    resourceType: 'ValueSet',
    id: 'observation-codes',
    url: 'http://hl7.org/fhir/ValueSet/observation-codes',
    version: '5.0.0',
    name: 'ObservationCodes',
    status: 'draft',
    compose: {
      include: [
        { system: 'http://hl7.org/fhir/CodeSystem/observation-status' },
      ],
    },
  }, null, 2));
  writeFileSync(join(packageDir, 'CodeSystem-observation-status.json'), JSON.stringify({
    resourceType: 'CodeSystem',
    id: 'observation-status',
    url: 'http://hl7.org/fhir/CodeSystem/observation-status',
    version: '5.0.0',
    name: 'ObservationStatus',
    status: 'active',
    content: 'complete',
  }, null, 2));
}

describe('cross-version publisher fixture', () => {
  test('derives R5 package DB rows and external artifact links without R4 defaults', async () => {
    const fixture = resolve(import.meta.dir, 'fixtures/r5-minimal');
    const cfg = YAML.parse(readFileSync(join(fixture, 'sushi-config.yaml'), 'utf8'));
    const resources = [
      readJson(join(fixture, 'generated-resources/ImplementationGuide-example.r5.minimal.json')),
      readJson(join(fixture, 'generated-resources/StructureDefinition-minimal-observation.json')),
    ];
    const cacheRoot = mkdtempSync(join(tmpdir(), 'publisher-r5-fixture-cache-'));
    const dbRoot = mkdtempSync(join(tmpdir(), 'publisher-r5-fixture-db-'));

    try {
      writeR5CorePackage(cacheRoot);
      const packageResolution = await resolvePackages(cfg, cacheRoot, {
        env: {
          PUBLISHER_AMBIENT_PACKAGES: 'off',
          PUBLISHER_PACKAGE_DOWNLOADS: 'off',
        },
      });
      const resourceRows = deriveResourceRows(resources, new Map(), cfg);
      const keyByRef = resourceRows.keyByRef;
      const indexes = {
        current: buildCurrentCanonicalIndex(resources),
        core: buildCanonicalIndex([packageResolution.core], { labelRoot: cacheRoot }),
        dependencies: buildCurrentCanonicalIndex([]),
      };
      const indexedListRows = deriveIndexedListRows(resources, keyByRef, indexes);
      const codeSystemPropertyRows = deriveCodeSystemPropertyRows(resources, keyByRef);
      const outDb = join(dbRoot, 'package.db');

      writePackageDbFile(outDb, {
        metadataRows: deriveMetadataRows({
          cfg,
          ig: resources[0],
          now: new Date('2026-06-27T12:00:00Z'),
          branch: 'test',
          revision: 'abc123def0',
        }),
        resourceRows: resourceRows.rows,
        conceptRows: deriveConceptRows(resources, keyByRef),
        propertyRows: codeSystemPropertyRows.propertyRows,
        conceptPropertyRows: codeSystemPropertyRows.conceptPropertyRows,
        valueSetCodeRows: deriveValueSetCodeRows(resources, keyByRef),
        indexedListRows,
      });

      const db = new Database(outDb, { readonly: true });
      try {
        expect(db.query('select Value from Metadata where Name = ?').get('path')).toEqual({ Value: 'http://hl7.org/fhir/R5/' });
        expect(db.query('select base from Resources where Type = ? and Id = ?').get('StructureDefinition', 'minimal-observation')).toEqual({
          base: 'http://hl7.org/fhir/StructureDefinition/Observation|5.0.0',
        });
        expect(db.query('select Url from ValueSetList where Url = ?').get('http://hl7.org/fhir/ValueSet/observation-codes')).toEqual({
          Url: 'http://hl7.org/fhir/ValueSet/observation-codes',
        });
        expect(db.query('select Source from ValueSetListSources where Source = ?').get('hl7.fhir.r5.core')).toEqual({ Source: 'hl7.fhir.r5.core' });
        expect(db.query('select Web from CodeSystemListRefs where Web = ?').get('http://hl7.org/fhir/R5/valueset-observation-codes.html')).toEqual({
          Web: 'http://hl7.org/fhir/R5/valueset-observation-codes.html',
        });
      } finally {
        db.close();
      }

      expect([...keyByRef.keys()]).toEqual(resources.map(resourceRef));
    } finally {
      rmSync(cacheRoot, { recursive: true, force: true });
      rmSync(dbRoot, { recursive: true, force: true });
    }
  });
});
