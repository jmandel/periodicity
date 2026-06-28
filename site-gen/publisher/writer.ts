import { Database } from 'bun:sqlite';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IndexedListRows } from './indexed-lists';
import type { ConceptPropertyRow, ConceptRow, MetadataRow, PropertyRow, ResourceRow, ValueSetCodeRow } from './rows';
import { createPackageDbSchema } from './schema';

export type PackageDbRows = {
  metadataRows: MetadataRow[];
  resourceRows: ResourceRow[];
  conceptRows: ConceptRow[];
  propertyRows: PropertyRow[];
  conceptPropertyRows: ConceptPropertyRow[];
  valueSetCodeRows: ValueSetCodeRow[];
  indexedListRows: IndexedListRows;
};

type Timed = <T>(label: string, fn: () => T) => T;

function run<T>(timed: Timed | undefined, label: string, fn: () => T): T {
  return timed ? timed(label, fn) : fn();
}

function insertMetadataRows(db: Database, rows: MetadataRow[]) {
  const ins = db.prepare('INSERT INTO Metadata (Key, Name, Value) VALUES (?,?,?)');
  rows.forEach((row) => ins.run(row.key, row.name, row.value));
}

function insertResourceRows(db: Database, rows: ResourceRow[]) {
  const ins = db.prepare(`INSERT INTO Resources (
    Key, Type, Custom, Id, Web, Url, Version, Status, Date, Name, Title, Experimental, Realm,
    Description, Purpose, Copyright, CopyrightLabel, derivation, standardStatus, kind, sdType,
    base, content, supplements, Json
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  rows.forEach((row) => {
    ins.run(
      row.key,
      row.type,
      row.custom,
      row.id,
      row.web,
      row.url,
      row.version,
      row.status,
      row.date,
      row.name,
      row.title,
      row.experimental,
      row.realm,
      row.description,
      row.purpose,
      row.copyright,
      row.copyrightLabel,
      row.derivation,
      row.standardStatus,
      row.kind,
      row.sdType,
      row.base,
      row.content,
      row.supplements,
      row.json,
    );
  });
}

function insertConceptRows(db: Database, rows: ConceptRow[]) {
  const ins = db.prepare('INSERT INTO Concepts (Key, ResourceKey, ParentKey, Code, Display, Definition) VALUES (?,?,?,?,?,?)');
  rows.forEach((row) => ins.run(row.key, row.resourceKey, row.parentKey, row.code, row.display, row.definition));
}

function insertPropertyRows(db: Database, rows: PropertyRow[]) {
  const ins = db.prepare('INSERT INTO Properties (Key, ResourceKey, Code, Uri, Description, Type) VALUES (?,?,?,?,?,?)');
  rows.forEach((row) => ins.run(row.key, row.resourceKey, row.code, row.uri, row.description, row.type));
}

function insertConceptPropertyRows(db: Database, rows: ConceptPropertyRow[]) {
  const ins = db.prepare('INSERT INTO ConceptProperties (Key, ResourceKey, ConceptKey, PropertyKey, Code, Value) VALUES (?,?,?,?,?,?)');
  rows.forEach((row) => ins.run(row.key, row.resourceKey, row.conceptKey, row.propertyKey, row.code, row.value));
}

function insertValueSetExpansions(
  db: Database,
  rows: ValueSetCodeRow[],
) {
  const ins = db.prepare('INSERT INTO ValueSet_Codes (Key, ResourceKey, ValueSetUri, ValueSetVersion, System, Version, Code, Display) VALUES (?,?,?,?,?,?,?,?)');
  rows.forEach((row) => ins.run(row.key, row.resourceKey, row.valueSetUri, row.valueSetVersion, row.system, row.version, row.code, row.display));
}

function insertIndexedListRows(
  db: Database,
  rows: IndexedListRows,
) {
  const insVs = db.prepare('INSERT INTO ValueSetList (ValueSetListKey, ViewType, ResourceKey, Url, Version, Status, Name, Title, Description) VALUES (?,?,?,?,?,?,?,?,?)');
  const insVsOid = db.prepare('INSERT OR IGNORE INTO ValueSetListOIDs (ValueSetListKey, OID) VALUES (?,?)');
  const insVsRef = db.prepare('INSERT OR IGNORE INTO ValueSetListRefs (ValueSetListKey, Type, Id, ResourceKey, Title, Web) VALUES (?,?,?,?,?,?)');
  const insVsSystem = db.prepare('INSERT OR IGNORE INTO ValueSetListSystems (ValueSetListKey, URL) VALUES (?,?)');
  const insVsSource = db.prepare('INSERT OR IGNORE INTO ValueSetListSources (ValueSetListKey, Source) VALUES (?,?)');
  const insCs = db.prepare('INSERT INTO CodeSystemList (CodeSystemListKey, ViewType, ResourceKey, Url, Version, Status, Name, Title, Description) VALUES (?,?,?,?,?,?,?,?,?)');
  const insCsOid = db.prepare('INSERT OR IGNORE INTO CodeSystemListOIDs (CodeSystemListKey, OID) VALUES (?,?)');
  const insCsRef = db.prepare('INSERT OR IGNORE INTO CodeSystemListRefs (CodeSystemListKey, Type, Id, ResourceKey, Title, Web) VALUES (?,?,?,?,?,?)');

  for (const row of rows.valueSetRows) insVs.run(row.key, row.viewType, row.resourceKey, row.url, row.version, row.status, row.name, row.title, row.description);
  for (const row of rows.valueSetOidRows) insVsOid.run(row.valueSetListKey, row.oid);
  for (const row of rows.valueSetRefRows) insVsRef.run(row.valueSetListKey, row.type, row.id, row.resourceKey, row.title, row.web);
  for (const row of rows.valueSetSystemRows) insVsSystem.run(row.valueSetListKey, row.url);
  for (const row of rows.valueSetSourceRows) insVsSource.run(row.valueSetListKey, row.source);
  for (const row of rows.codeSystemRows) insCs.run(row.key, row.viewType, row.resourceKey, row.url, row.version, row.status, row.name, row.title, row.description);
  for (const row of rows.codeSystemOidRows) insCsOid.run(row.codeSystemListKey, row.oid);
  for (const row of rows.codeSystemRefRows) insCsRef.run(row.codeSystemListKey, row.type, row.id, row.resourceKey, row.title, row.web);
}

export function writePackageDbFile(outDb: string, rows: PackageDbRows, options: { timed?: Timed } = {}) {
  mkdirSync(dirname(outDb), { recursive: true });
  for (const f of [outDb, `${outDb}-wal`, `${outDb}-shm`]) rmSync(f, { force: true });
  const db = new Database(outDb);
  try {
    db.exec('BEGIN IMMEDIATE');
    run(options.timed, 'create schema', () => createPackageDbSchema(db));
    run(options.timed, 'metadata', () => insertMetadataRows(db, rows.metadataRows));
    run(options.timed, 'resources table', () => insertResourceRows(db, rows.resourceRows));
    run(options.timed, 'properties table', () => insertPropertyRows(db, rows.propertyRows));
    run(options.timed, 'concepts table', () => insertConceptRows(db, rows.conceptRows));
    run(options.timed, 'concept properties table', () => insertConceptPropertyRows(db, rows.conceptPropertyRows));
    run(options.timed, 'value set expansion table', () => insertValueSetExpansions(db, rows.valueSetCodeRows));
    run(options.timed, 'indexed terminology/resource lists', () => insertIndexedListRows(db, rows.indexedListRows));
    db.exec('COMMIT');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback errors from partially opened/closed transactions.
    }
    throw e;
  } finally {
    db.close();
  }
}
