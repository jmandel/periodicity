import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { Json, ResolvedPackage } from './packages';

export type PackageResourceEntry = {
  package: { name: string; version: string };
  sourcePath: string;
  resource: Json;
};

function readJson(path: string): Json {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function jsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => join(dir, f)).sort();
}

export function packageResourceFiles(pkg: ResolvedPackage): string[] {
  const indexPath = join(pkg.dir, '.index.json');
  if (!existsSync(indexPath)) return jsonFiles(pkg.dir);
  const index = readJson(indexPath);
  const files = Array.isArray(index.files) ? index.files : [];
  return files
    .map((f: any) => f?.filename)
    .filter((filename: unknown): filename is string => typeof filename === 'string' && filename.endsWith('.json'))
    .map((filename) => join(pkg.dir, filename))
    .sort();
}

export function buildPackageResourceIndex(
  packages: ResolvedPackage[],
  options: { labelRoot?: string; profile?: boolean } = {},
): PackageResourceEntry[] {
  const entries: PackageResourceEntry[] = [];
  for (const pkg of packages) {
    const start = performance.now();
    const files = packageResourceFiles(pkg);
    for (const file of files) {
      entries.push({
        package: { name: pkg.name, version: pkg.version },
        sourcePath: file,
        resource: readJson(file),
      });
    }
    if (options.profile) {
      const label = options.labelRoot ? relative(options.labelRoot, dirname(pkg.dir)) : `${pkg.name}#${pkg.version}`;
      console.error(`[publisher-profile] scan package ${label}: ${(performance.now() - start).toFixed(1)}ms`);
      console.error(`[publisher-profile]   resources=${files.length}`);
    }
  }
  return entries;
}
