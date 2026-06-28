#!/usr/bin/env bun
/**
 * Compare a Bun-produced package DB with Java Publisher output/package.db.
 *
 * The comparison deliberately keys resources by Type/Id instead of table Key.
 * Publisher row ids are implementation detail; site-gen behavior depends on
 * resource identity and field values.
 */
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { compareResourceJsonFidelity, resourceJsonCategoryLabels, type ResourceJsonDiff } from './resource-json';

const root = resolve(import.meta.dir, '../..');
const expectedPath = resolve(root, process.env.EXPECTED_DB || 'output/package.db');
const actualPath = resolve(root, process.env.ACTUAL_DB || 'temp/site-gen/publisher/package.db');
const compareReportPath = process.env.COMPARE_REPORT === 'off'
  ? null
  : resolve(root, process.env.COMPARE_REPORT || `${actualPath}.compare.md`);
const failOnDiffs = process.env.COMPARE_FAIL_ON_DIFFS !== '0';
const reportLines: string[] = [];
let differenceCount = 0;

function emit(line = '') {
  reportLines.push(line);
  console.log(line);
}

function addDifferences(count: number) {
  differenceCount += count;
}

function open(path: string): Database {
  if (!existsSync(path)) throw new Error(`DB not found: ${relative(root, path)}`);
  const db = new Database(path, { readonly: true });
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

function tableNames(db: Database): string[] {
  return (db.query("select name from sqlite_master where type='table' order by name").all() as any[]).map((r) => r.name);
}

function count(db: Database, table: string): number {
  return (db.query(`select count(*) c from ${table}`).get() as any).c;
}

function rowsBy<T extends Record<string, any>>(rows: T[], key: (r: T) => string): Map<string, T> {
  return new Map(rows.map((r) => [key(r), r]));
}

function nullable(v: unknown): string {
  return v == null ? '' : String(v);
}

function compareTables(expected: Database, actual: Database) {
  const e = tableNames(expected);
  const a = tableNames(actual);
  const all = [...new Set([...e, ...a])].sort();
  emit('Tables');
  for (const t of all) {
    if (!e.includes(t)) {
      addDifferences(1);
      emit(`  + ${t}: only in actual`);
    } else if (!a.includes(t)) {
      addDifferences(1);
      emit(`  - ${t}: missing in actual`);
    }
    else {
      const ec = count(expected, t);
      const ac = count(actual, t);
      if (ec !== ac) addDifferences(1);
      emit(`  ${ec === ac ? '=' : '!='} ${t}: expected ${ec}, actual ${ac}`);
    }
  }
}

function compareMetadata(expected: Database, actual: Database) {
  const ignored = new Set(['errorCount', 'revision', 'versionFull', 'toolingVersion', 'toolingRevision', 'toolingVersionFull', 'genDate', 'genDay', 'gitstatus']);
  const er = rowsBy(expected.query('select Name, Value from Metadata').all() as any[], (r) => r.Name);
  const ar = rowsBy(actual.query('select Name, Value from Metadata').all() as any[], (r) => r.Name);
  let ok = 0;
  const mismatches: string[] = [];
  for (const [name, ev] of er) {
    if (ignored.has(name)) continue;
    const av = ar.get(name);
    if (!av) mismatches.push(`${name}: missing`);
    else if (nullable(ev.Value) !== nullable(av.Value)) mismatches.push(`${name}: expected ${ev.Value}, actual ${av.Value}`);
    else ok++;
  }
  addDifferences(mismatches.length);
  emit(`\nMetadata: ${ok} matched, ${mismatches.length} mismatched (${[...ignored].join(', ')} ignored)`);
  for (const m of mismatches) emit(`  - ${m}`);
}

function compareResources(expected: Database, actual: Database) {
  const fields = [
    'Web', 'Url', 'Version', 'Status', 'Name', 'Title', 'Experimental', 'Description',
    'derivation', 'standardStatus', 'kind', 'sdType', 'base', 'content', 'supplements',
  ];
  const er = rowsBy(expected.query('select * from Resources').all() as any[], (r) => `${r.Type}/${r.Id}`);
  const ar = rowsBy(actual.query('select * from Resources').all() as any[], (r) => `${r.Type}/${r.Id}`);
  const missing: string[] = [];
  const extra: string[] = [];
  const diffs: string[] = [];
  let matched = 0;
  for (const [key, ev] of er) {
    const av = ar.get(key);
    if (!av) {
      missing.push(key);
      continue;
    }
    const rowDiffs = fields.filter((f) => nullable(ev[f]) !== nullable(av[f]));
    if (rowDiffs.length) {
      diffs.push(`${key}: ${rowDiffs.map((f) => `${f} expected=${JSON.stringify(ev[f])} actual=${JSON.stringify(av[f])}`).join('; ')}`);
    } else {
      matched++;
    }
  }
  for (const key of ar.keys()) if (!er.has(key)) extra.push(key);
  addDifferences(diffs.length + missing.length + extra.length);
  emit(`\nResources: ${matched} exact rows, ${diffs.length} field-diff rows, ${missing.length} missing, ${extra.length} extra`);
  for (const m of missing.slice(0, 20)) emit(`  missing ${m}`);
  for (const x of extra.slice(0, 20)) emit(`  extra ${x}`);
  for (const d of diffs.slice(0, 20)) emit(`  diff ${d}`);
}

function compactValue(value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined) return 'undefined';
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function formatJsonDiff(diff: ResourceJsonDiff): string {
  const expected = 'expected' in diff ? ` expected=${compactValue(diff.expected)}` : '';
  const actual = 'actual' in diff ? ` actual=${compactValue(diff.actual)}` : '';
  return `${diff.kind} ${diff.path}${expected}${actual}`;
}

function compareResourceJson(expected: Database, actual: Database) {
  const report = compareResourceJsonFidelity(
    expected.query('select Type, Id, Json from Resources').all() as any[],
    actual.query('select Type, Id, Json from Resources').all() as any[],
  );
  emit(`\nResource JSON fidelity: ${report.exactResources} exact resources, ${report.differingResources} resources with JSON drift, ${report.totalDiffs} field diffs`);
  emit('  review-only: these differences are classified for inspection and do not affect the package.db row parity gate');
  if (report.missingResources.length) emit(`  missing JSON resources: ${report.missingResources.slice(0, 20).join(', ')}`);
  if (report.extraResources.length) emit(`  extra JSON resources: ${report.extraResources.slice(0, 20).join(', ')}`);
  for (const category of resourceJsonCategoryLabels()) {
    const bucket = report.categories[category];
    emit(`  ${category}: ${bucket.count}`);
    for (const sample of bucket.samples) emit(`    - ${formatJsonDiff(sample)}`);
  }
}

function resourceKeyMap(db: Database): Map<number, string> {
  return new Map((db.query('select Key, Type, Id from Resources').all() as any[]).map((r) => [r.Key, `${r.Type}/${r.Id}`]));
}

function compareConcepts(expected: Database, actual: Database) {
  const eKey = resourceKeyMap(expected);
  const aKey = resourceKeyMap(actual);
  const eRows = (expected.query('select * from Concepts').all() as any[]).map((r) => ({ ...r, Resource: eKey.get(r.ResourceKey) || String(r.ResourceKey) }));
  const aRows = (actual.query('select * from Concepts').all() as any[]).map((r) => ({ ...r, Resource: aKey.get(r.ResourceKey) || String(r.ResourceKey) }));
  const er = rowsBy(eRows, (r) => `${r.Resource}|${r.Code}`);
  const ar = rowsBy(aRows, (r) => `${r.Resource}|${r.Code}`);
  let matched = 0;
  const diffs: string[] = [];
  for (const [key, ev] of er) {
    const av = ar.get(key);
    if (!av) diffs.push(`${key}: missing`);
    else if (nullable(ev.Display) !== nullable(av.Display) || nullable(ev.Definition) !== nullable(av.Definition)) {
      diffs.push(`${key}: expected ${JSON.stringify({ display: ev.Display, definition: ev.Definition })}, actual ${JSON.stringify({ display: av.Display, definition: av.Definition })}`);
    } else matched++;
  }
  for (const key of ar.keys()) if (!er.has(key)) diffs.push(`${key}: extra`);
  addDifferences(diffs.length);
  emit(`\nConcepts: ${matched} matched, ${diffs.length} differences`);
  for (const d of diffs.slice(0, 20)) emit(`  - ${d}`);
}

function compareValueSetCodes(expected: Database, actual: Database) {
  const er = rowsBy(expected.query('select ValueSetUri, System, Code, Display from ValueSet_Codes').all() as any[], (r) => `${r.ValueSetUri}|${r.System}|${r.Code}`);
  const ar = rowsBy(actual.query('select ValueSetUri, System, Code, Display from ValueSet_Codes').all() as any[], (r) => `${r.ValueSetUri}|${r.System}|${r.Code}`);
  let matched = 0;
  const diffs: string[] = [];
  for (const [key, ev] of er) {
    const av = ar.get(key);
    if (!av) diffs.push(`${key}: missing`);
    else if (nullable(ev.Display) !== nullable(av.Display)) diffs.push(`${key}: display expected=${JSON.stringify(ev.Display)} actual=${JSON.stringify(av.Display)}`);
    else matched++;
  }
  for (const key of ar.keys()) if (!er.has(key)) diffs.push(`${key}: extra`);
  addDifferences(diffs.length);
  emit(`\nValueSet_Codes: ${matched} matched, ${diffs.length} differences`);
  for (const d of diffs.slice(0, 30)) emit(`  - ${d}`);
}

function compareRowSet<T extends Record<string, any>>(
  label: string,
  expectedRows: T[],
  actualRows: T[],
  key: (r: T) => string,
  fields: string[],
) {
  const er = rowsBy(expectedRows, key);
  const ar = rowsBy(actualRows, key);
  let matched = 0;
  const diffs: string[] = [];
  for (const [rowKey, ev] of er) {
    const av = ar.get(rowKey);
    if (!av) {
      diffs.push(`${rowKey}: missing`);
      continue;
    }
    const fieldDiffs = fields.filter((f) => nullable(ev[f]) !== nullable(av[f]));
    if (fieldDiffs.length) {
      diffs.push(`${rowKey}: ${fieldDiffs.map((f) => `${f} expected=${JSON.stringify(ev[f])} actual=${JSON.stringify(av[f])}`).join('; ')}`);
    } else {
      matched++;
    }
  }
  for (const rowKey of ar.keys()) if (!er.has(rowKey)) diffs.push(`${rowKey}: extra`);
  addDifferences(diffs.length);
  emit(`\n${label}: ${matched} matched, ${diffs.length} differences`);
  for (const d of diffs.slice(0, 30)) emit(`  - ${d}`);
}

function writeCompareReport() {
  if (!compareReportPath) return;
  mkdirSync(dirname(compareReportPath), { recursive: true });
  const body = [
    '# package.db compare',
    '',
    `- Expected: \`${relative(root, expectedPath)}\``,
    `- Actual: \`${relative(root, actualPath)}\``,
    `- Differences: ${differenceCount}`,
    '',
    '```text',
    ...reportLines,
    '```',
    '',
  ].join('\n');
  writeFileSync(compareReportPath, body);
  console.log(`\nCompare report: ${relative(root, compareReportPath)}`);
}

function compareIndexedLists(expected: Database, actual: Database) {
  const listFields = ['Version', 'Status', 'Name', 'Title', 'Description'];
  compareRowSet(
    'ValueSetList',
    expected.query('select ViewType, Url, Version, Status, Name, Title, Description from ValueSetList').all() as any[],
    actual.query('select ViewType, Url, Version, Status, Name, Title, Description from ValueSetList').all() as any[],
    (r) => `${r.ViewType}|${r.Url}`,
    listFields,
  );
  compareRowSet(
    'ValueSetListSystems',
    expected.query('select l.ViewType, l.Url, s.URL from ValueSetListSystems s join ValueSetList l on l.ValueSetListKey = s.ValueSetListKey').all() as any[],
    actual.query('select l.ViewType, l.Url, s.URL from ValueSetListSystems s join ValueSetList l on l.ValueSetListKey = s.ValueSetListKey').all() as any[],
    (r) => `${r.ViewType}|${r.Url}|${r.URL}`,
    [],
  );
  compareRowSet(
    'ValueSetListSources',
    expected.query('select l.ViewType, l.Url, s.Source from ValueSetListSources s join ValueSetList l on l.ValueSetListKey = s.ValueSetListKey').all() as any[],
    actual.query('select l.ViewType, l.Url, s.Source from ValueSetListSources s join ValueSetList l on l.ValueSetListKey = s.ValueSetListKey').all() as any[],
    (r) => `${r.ViewType}|${r.Url}|${r.Source}`,
    [],
  );
  compareRowSet(
    'ValueSetListOIDs',
    expected.query('select l.ViewType, l.Url, o.OID from ValueSetListOIDs o join ValueSetList l on l.ValueSetListKey = o.ValueSetListKey').all() as any[],
    actual.query('select l.ViewType, l.Url, o.OID from ValueSetListOIDs o join ValueSetList l on l.ValueSetListKey = o.ValueSetListKey').all() as any[],
    (r) => `${r.ViewType}|${r.Url}|${r.OID}`,
    [],
  );
  compareRowSet(
    'ValueSetListRefs',
    expected.query('select l.ViewType, l.Url, r.Type, r.Id, r.Title, r.Web from ValueSetListRefs r join ValueSetList l on l.ValueSetListKey = r.ValueSetListKey').all() as any[],
    actual.query('select l.ViewType, l.Url, r.Type, r.Id, r.Title, r.Web from ValueSetListRefs r join ValueSetList l on l.ValueSetListKey = r.ValueSetListKey').all() as any[],
    (r) => `${r.ViewType}|${r.Url}|${r.Type}|${r.Id}`,
    ['Title', 'Web'],
  );
  compareRowSet(
    'CodeSystemList',
    expected.query('select ViewType, Url, Version, Status, Name, Title, Description from CodeSystemList').all() as any[],
    actual.query('select ViewType, Url, Version, Status, Name, Title, Description from CodeSystemList').all() as any[],
    (r) => `${r.ViewType}|${r.Url}`,
    listFields,
  );
  compareRowSet(
    'CodeSystemListOIDs',
    expected.query('select l.ViewType, l.Url, o.OID from CodeSystemListOIDs o join CodeSystemList l on l.CodeSystemListKey = o.CodeSystemListKey').all() as any[],
    actual.query('select l.ViewType, l.Url, o.OID from CodeSystemListOIDs o join CodeSystemList l on l.CodeSystemListKey = o.CodeSystemListKey').all() as any[],
    (r) => `${r.ViewType}|${r.Url}|${r.OID}`,
    [],
  );
  compareRowSet(
    'CodeSystemListRefs',
    expected.query('select l.ViewType, l.Url, r.Type, r.Id, r.Title, r.Web from CodeSystemListRefs r join CodeSystemList l on l.CodeSystemListKey = r.CodeSystemListKey').all() as any[],
    actual.query('select l.ViewType, l.Url, r.Type, r.Id, r.Title, r.Web from CodeSystemListRefs r join CodeSystemList l on l.CodeSystemListKey = r.CodeSystemListKey').all() as any[],
    (r) => `${r.ViewType}|${r.Url}|${r.Type}|${r.Id}`,
    ['Title', 'Web'],
  );
}

const expected = open(expectedPath);
const actual = open(actualPath);
emit(`Expected: ${relative(root, expectedPath)}`);
emit(`Actual:   ${relative(root, actualPath)}\n`);
compareTables(expected, actual);
compareMetadata(expected, actual);
compareResources(expected, actual);
compareResourceJson(expected, actual);
compareConcepts(expected, actual);
compareValueSetCodes(expected, actual);
compareIndexedLists(expected, actual);
expected.close();
actual.close();
writeCompareReport();
if (differenceCount > 0 && failOnDiffs) {
  console.error(`package.db compare found ${differenceCount} difference${differenceCount === 1 ? '' : 's'}`);
  process.exitCode = 1;
}
