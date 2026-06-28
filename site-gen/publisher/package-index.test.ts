import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { buildPackageResourceIndex, packageResourceFiles } from './package-index';
import type { ResolvedPackage } from './packages';

function fixturePackage(dir: string): ResolvedPackage {
  return {
    name: 'example.package',
    version: '1.0.0',
    dir,
    manifest: { name: 'example.package', version: '1.0.0' },
    acquisition: { source: 'cache', packageDir: dir },
  };
}

describe('package resource index', () => {
  test('uses package .index.json as the source of package resource files', () => {
    const root = mkdtempSync(join(tmpdir(), 'package-index-'));
    try {
      writeFileSync(join(root, 'CodeSystem-indexed.json'), JSON.stringify({ resourceType: 'CodeSystem', id: 'indexed', url: 'http://example.org/cs' }));
      writeFileSync(join(root, 'ValueSet-ignored.json'), JSON.stringify({ resourceType: 'ValueSet', id: 'ignored', url: 'http://example.org/vs' }));
      writeFileSync(join(root, '.index.json'), JSON.stringify({
        files: [
          { filename: 'CodeSystem-indexed.json' },
          { filename: 'notes.txt' },
        ],
      }));

      const pkg = fixturePackage(root);
      expect(packageResourceFiles(pkg).map((f) => f.slice(root.length + 1))).toEqual(['CodeSystem-indexed.json']);
      expect(buildPackageResourceIndex([pkg])).toEqual([
        {
          package: { name: 'example.package', version: '1.0.0' },
          sourcePath: join(root, 'CodeSystem-indexed.json'),
          resource: { resourceType: 'CodeSystem', id: 'indexed', url: 'http://example.org/cs' },
        },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
