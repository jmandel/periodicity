/**
 * core/liquid.ts — GENERIC safe Liquid layer (knows nothing FHIR- or
 * project-specific). LiquidJS with strict filters and NO filesystem includes:
 * `{% include NAME %}` resolves through the injected registry or through a
 * previously-ingested DB asset. Unknown includes throw (fail loud, never silent
 * passthrough).
 */
import { Liquid } from 'liquidjs';

export type IncludeRegistry = Record<string, (ig: any) => string>;

export function renderLiquid(src: string, opts: { includes: IncludeRegistry; ig: any; assetInclude?: (name: string) => string | null }): string {
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
  return engine.parseAndRenderSync(src, { site: { data: { fhir: { ig: opts.ig } } } });
}
