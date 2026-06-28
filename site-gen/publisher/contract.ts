import type { Database } from 'bun:sqlite';

export const PACKAGE_DB_CONTRACT: Record<string, string[]> = {
  Metadata: ['Key', 'Name', 'Value'],
  Resources: [
    'Key',
    'Type',
    'Id',
    'Web',
    'Url',
    'Version',
    'Status',
    'Date',
    'Name',
    'Title',
    'Description',
    'derivation',
    'standardStatus',
    'kind',
    'sdType',
    'base',
    'content',
    'supplements',
    'Json',
  ],
  Concepts: ['Key', 'ResourceKey', 'ParentKey', 'Code', 'Display', 'Definition'],
  ValueSet_Codes: ['Key', 'ResourceKey', 'ValueSetUri', 'ValueSetVersion', 'System', 'Version', 'Code', 'Display'],
  ValueSetList: ['ValueSetListKey', 'ViewType', 'ResourceKey', 'Url', 'Version', 'Status', 'Name', 'Title', 'Description'],
  ValueSetListRefs: ['ValueSetListKey', 'Type', 'Id', 'ResourceKey', 'Title', 'Web'],
  ValueSetListSystems: ['ValueSetListKey', 'URL'],
  CodeSystemList: ['CodeSystemListKey', 'ViewType', 'ResourceKey', 'Url', 'Version', 'Status', 'Name', 'Title', 'Description'],
  CodeSystemListRefs: ['CodeSystemListKey', 'Type', 'Id', 'ResourceKey', 'Title', 'Web'],
};

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function tableColumns(db: Database, table: string): Set<string> | null {
  const exists = db.query('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', table);
  if (!exists) return null;
  const rows = db.query(`PRAGMA table_info(${quoteIdent(table)})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

export function packageDbContractErrors(db: Database): string[] {
  const errors: string[] = [];
  for (const [table, columns] of Object.entries(PACKAGE_DB_CONTRACT)) {
    const actual = tableColumns(db, table);
    if (!actual) {
      errors.push(`missing table ${table}`);
      continue;
    }
    for (const column of columns) {
      if (!actual.has(column)) errors.push(`missing column ${table}.${column}`);
    }
  }
  return errors;
}

export function assertPackageDbContract(db: Database): void {
  const errors = packageDbContractErrors(db);
  if (errors.length) {
    throw new Error(`package.db does not satisfy the site-gen contract:\n- ${errors.join('\n- ')}`);
  }
}
