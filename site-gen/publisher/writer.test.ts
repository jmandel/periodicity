import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { writePackageDbFile } from './writer';

const emptyIndexedLists = {
  valueSetRows: [],
  valueSetOidRows: [],
  valueSetRefRows: [],
  valueSetSystemRows: [],
  valueSetSourceRows: [],
  codeSystemRows: [],
  codeSystemOidRows: [],
  codeSystemRefRows: [],
};

describe('package DB writer', () => {
  test('creates the schema and writes supplied rows without deriving data', () => {
    const root = mkdtempSync(join(tmpdir(), 'publisher-writer-'));
    const dbPath = join(root, 'package.db');
    try {
      writePackageDbFile(dbPath, {
        metadataRows: [{ key: 1, name: 'igId', value: 'demo.ig' }],
        resourceRows: [{
          key: 1,
          type: 'ImplementationGuide',
          custom: 0,
          id: 'demo',
          web: 'index.html',
          url: 'http://example.org/ImplementationGuide/demo',
          version: '1.0.0',
          status: 'draft',
          date: '2026-01-01',
          name: 'Demo',
          title: 'Demo IG',
          experimental: 'false',
          realm: null,
          description: 'Demo description',
          purpose: null,
          copyright: null,
          copyrightLabel: null,
          derivation: null,
          standardStatus: null,
          kind: null,
          sdType: null,
          base: null,
          content: null,
          supplements: null,
          json: JSON.stringify({ resourceType: 'ImplementationGuide', id: 'demo' }),
        }],
        conceptRows: [],
        valueSetCodeRows: [],
        indexedListRows: emptyIndexedLists,
      });

      const db = new Database(dbPath, { readonly: true });
      try {
        expect(db.query('select Value from Metadata where Name = ?').get('igId')).toEqual({ Value: 'demo.ig' });
        expect(db.query('select Type, Id, Web from Resources').get()).toEqual({
          Type: 'ImplementationGuide',
          Id: 'demo',
          Web: 'index.html',
        });
      } finally {
        db.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
