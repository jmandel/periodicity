/**
 * core/liquid.ts — GENERIC safe Liquid layer (knows nothing FHIR- or
 * project-specific). LiquidJS with strict filters and NO filesystem includes:
 * `{% include NAME %}` resolves through the injected registry or through a
 * previously-ingested DB asset. Unknown includes throw (fail loud, never silent
 * passthrough).
 */
import { Liquid } from 'liquidjs';

export type IncludeRegistry = Record<string, (ig: any) => string>;
export type SqlExecutor = (query: string) => Record<string, any>[];
type SqlColumn = { source?: string; name?: string; title?: string; type?: string; target?: string; system?: string; display?: string; version?: string };

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function assertSafeSelect(query: string): string {
  const normalized = query.trim();
  if (!normalized) throw new Error('Empty SQL block');
  if (normalized.includes(';')) throw new Error('SQL blocks must contain one SELECT/WITH query without semicolons');
  if (!/^(select|with)\b/i.test(normalized)) throw new Error('SQL blocks may only run SELECT/WITH queries');
  if (/\b(attach|detach|pragma|insert|update|delete|drop|alter|create|replace|vacuum)\b/i.test(normalized)) {
    throw new Error('SQL block contains a disallowed statement keyword');
  }
  return normalized;
}

function columnHintLooksLikeCode(column: string): boolean {
  return /\b(code|system|url|uri|canonical|id|json|value|pattern)\b/i.test(column);
}

function valueLooksLikeCode(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const s = String(value).trim();
  if (!s || /\s/.test(s)) return false;
  return /^(https?:\/\/|urn:|[A-Za-z][A-Za-z0-9+.-]*:\/\/)/.test(s) || /[#/{}_.:-]|\d/.test(s);
}

function renderSqlTable(rows: Record<string, any>[], control: { class?: string; titles?: boolean; columns?: SqlColumn[] } = {}): string {
  if (!rows.length) return '<p class="muted">No rows.</p>';
  const columns = control.columns?.length
    ? control.columns
    : Object.keys(rows[0]).map((name) => ({ source: name, name, title: name, type: 'auto' }));
  const codeColumns = columns.map((col) => {
    const source = col.source || col.name || '';
    const label = col.title || col.name || col.source || '';
    if (columnHintLooksLikeCode(label)) return true;
    const values = rows.map((row) => row[source]).filter((v) => v != null && String(v).trim() !== '');
    return values.length > 0 && values.every(valueLooksLikeCode);
  });
  const tableClass = `cycle-table sql-table${control.class ? ` ${esc(control.class)}` : ''}`;
  const head = control.titles === false ? '' : `<thead><tr>${columns.map((c, i) => {
    const label = c.title || c.name || c.source || '';
    return `<th${codeColumns[i] ? ' class="code-col"' : ''}>${esc(label)}</th>`;
  }).join('')}</tr></thead>`;
  const renderCell = (row: Record<string, any>, col: SqlColumn, isCodeColumn: boolean) => {
    const source = col.source || col.name || '';
    const value = row[source];
    const type = col.type || 'auto';
    if ((type === 'link' || type === 'url' || type === 'canonical') && value != null) {
      const href = row[col.target || source] ?? value;
      return `<a href="${esc(href)}">${esc(value)}</a>`;
    }
    if (type === 'coding') {
      const system = col.system ? (row[col.system] ?? col.system) : undefined;
      const display = col.display ? (row[col.display] ?? col.display) : undefined;
      return `<span class="sql-coding">${system ? `<span>${esc(system)}</span> ` : ''}<code>${esc(value)}</code>${display ? ` <span>${esc(display)}</span>` : ''}</span>`;
    }
    return isCodeColumn ? `<code>${esc(value)}</code>` : esc(value);
  };
  const body = rows.map((row) => {
    const cells = columns.map((c, i) => {
      const className = codeColumns[i] ? ' class="code-col"' : '';
      return `<td${className}>${renderCell(row, c, codeColumns[i])}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `<div class="table-scroll"><table class="${tableClass}">${head}<tbody>${body}</tbody></table></div>`;
}

function renderSqlResult(rows: Record<string, any>[], control: { class?: string; titles?: boolean; columns?: SqlColumn[] } = {}): string {
  const keys = Object.keys(rows[0] || {});
  if (rows.length === 1 && keys.length === 1 && !control.columns?.length) return esc(rows[0][keys[0]]);
  return renderSqlTable(rows, control);
}

function runSqlDirective(args: string, runSql?: SqlExecutor): string {
  if (!runSql) throw new Error('SQL tag used, but no SQL executor was provided');
  const trimmed = args.trim();
  if (!trimmed) throw new Error('Empty SQL tag');
  if (trimmed.startsWith('{')) {
    const control = JSON.parse(trimmed);
    if (!control.query) throw new Error('SQL JSON control must include query');
    return renderSqlResult(runSql(assertSafeSelect(control.query)), control);
  }
  return renderSqlResult(runSql(assertSafeSelect(trimmed)));
}

function renderSqlToData(src: string, runSql: SqlExecutor | undefined, data: Record<string, any>): string {
  return src.replace(/{%-?\s*sqlToData\s+([A-Za-z_][A-Za-z0-9_]*)\s+([\s\S]*?)\s*-?%\}/gi, (_m, name, query) => {
    if (!runSql) throw new Error('sqlToData tag used, but no SQL executor was provided');
    data[name] = runSql(assertSafeSelect(query));
    return '';
  });
}

export function renderLiquid(src: string, opts: { includes: IncludeRegistry; ig: any; assetInclude?: (name: string) => string | null; sql?: SqlExecutor }): string {
  const sqlData: Record<string, any> = {};
  let withSql = renderSqlToData(src, opts.sql, sqlData);
  withSql = withSql.replace(/{%-?\s*sql\s+([\s\S]*?)\s*-?%\}/gi, (_m, args) => runSqlDirective(args, opts.sql));
  const engine = new Liquid({ strictFilters: true, strictVariables: false, extname: '' });
  engine.registerTag('include', {
    parse(token: any) { this.name = token.args.trim().replace(/^['"]|['"]$/g, ''); },
    *render() {
      const gen = opts.includes[this.name];
      if (gen) return gen(opts.ig);
      const asset = opts.assetInclude?.(this.name);
      if (asset != null) return asset;
      throw new Error(`Unknown include '${this.name}' — register it in project/includes.ts or ingest a same-named asset before use.`);
    },
  });
  return engine.parseAndRenderSync(withSql, { ...sqlData, site: { data: { fhir: { ig: opts.ig } } } });
}
