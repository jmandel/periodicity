import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  IG_INTERNAL_DEPENDENCY_URL,
  IG_LINK_DEPENDENCY_URL,
  implementationGuidePackageContextSpecs,
  packageDownloadPolicyFromEnv,
  packageDownloadTimeoutMsFromEnv,
  parsePackageSpecList,
  publisherAmbientPackageSpecs,
  resolvePackages,
} from './packages';

function writePackage(cacheRoot: string, name: string, version: string, dependencies: Record<string, string> = {}) {
  const dir = join(cacheRoot, `${name}#${version}`, 'package');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version, fhirVersions: ['4.0.1'], dependencies }, null, 2));
}

function packageTarball(root: string, name: string, version: string, dependencies: Record<string, string> = {}): Uint8Array {
  const sourceRoot = join(root, `${name}-${version}`);
  const packageDir = join(sourceRoot, 'package');
  const tarPath = join(root, `${name}-${version}.tgz`);
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name, version, fhirVersions: ['4.0.1'], dependencies }, null, 2));
  const tar = Bun.spawnSync(['tar', '-czf', tarPath, '-C', sourceRoot, 'package'], { stdout: 'pipe', stderr: 'pipe' });
  if (!tar.success) throw new Error(new TextDecoder().decode(tar.stderr));
  return readFileSync(tarPath);
}

describe('FHIR package resolution helpers', () => {
  test('parses explicit package specs from environment-style strings', () => {
    expect(parsePackageSpecList('fhir.dicom#2025.3.20250714, ihe.formatcode.fhir#1.5.0', 'TEST')).toEqual([
      { name: 'fhir.dicom', version: '2025.3.20250714' },
      { name: 'ihe.formatcode.fhir', version: '1.5.0' },
    ]);
    expect(parsePackageSpecList('  a.pkg#1.0.0\nb.pkg#2.0.0  ', 'TEST')).toEqual([
      { name: 'a.pkg', version: '1.0.0' },
      { name: 'b.pkg', version: '2.0.0' },
    ]);
  });

  test('rejects unpinned package specs', () => {
    expect(() => parsePackageSpecList('fhir.dicom', 'TEST')).toThrow('name#version');
    expect(() => parsePackageSpecList('fhir.dicom#2025#extra', 'TEST')).toThrow('name#version');
  });

  test('parses package download policy', () => {
    expect(packageDownloadPolicyFromEnv({})).toBe('allow');
    expect(packageDownloadPolicyFromEnv({ PUBLISHER_PACKAGE_DOWNLOADS: 'allow' })).toBe('allow');
    expect(packageDownloadPolicyFromEnv({ PUBLISHER_PACKAGE_DOWNLOADS: 'off' })).toBe('off');
    expect(packageDownloadPolicyFromEnv({ PUBLISHER_PACKAGE_DOWNLOADS: 'FALSE' })).toBe('off');
    expect(() => packageDownloadPolicyFromEnv({ PUBLISHER_PACKAGE_DOWNLOADS: 'maybe' })).toThrow('PUBLISHER_PACKAGE_DOWNLOADS');
  });

  test('parses package download timeout', () => {
    expect(packageDownloadTimeoutMsFromEnv({})).toBe(120_000);
    expect(packageDownloadTimeoutMsFromEnv({ PUBLISHER_PACKAGE_DOWNLOAD_TIMEOUT_MS: '30000' })).toBe(30_000);
    expect(() => packageDownloadTimeoutMsFromEnv({ PUBLISHER_PACKAGE_DOWNLOAD_TIMEOUT_MS: '0' })).toThrow('PUBLISHER_PACKAGE_DOWNLOAD_TIMEOUT_MS');
    expect(() => packageDownloadTimeoutMsFromEnv({ PUBLISHER_PACKAGE_DOWNLOAD_TIMEOUT_MS: 'soon' })).toThrow('PUBLISHER_PACKAGE_DOWNLOAD_TIMEOUT_MS');
  });

  test('adds Publisher ambient packages for R4 when not declared by the IG', () => {
    expect(publisherAmbientPackageSpecs('4.0.1', [], {})).toEqual([
      { name: 'hl7.fhir.pubpack', version: '0.2.5' },
      { name: 'hl7.fhir.xver-extensions', version: '0.1.0' },
      { name: 'hl7.fhir.uv.extensions.r4', version: '5.3.0' },
      { name: 'hl7.terminology.r4', version: '7.2.0' },
      { name: 'hl7.fhir.uv.tools.r4', version: '1.1.2' },
      { name: 'fhir.dicom', version: '2025.3.20250714' },
      { name: 'ihe.formatcode.fhir', version: '1.5.0' },
    ]);
  });

  test('does not auto-add extension or terminology packages already declared by the IG', () => {
    const directDependencies = [
      { name: 'hl7.fhir.uv.extensions.r4', version: '5.2.0' },
      { name: 'hl7.terminology.r4', version: '6.2.0' },
      { name: 'hl7.fhir.uv.tools.r4', version: '1.1.2' },
    ];
    expect(publisherAmbientPackageSpecs('4.0.1', directDependencies, {})).toEqual([
      { name: 'hl7.fhir.pubpack', version: '0.2.5' },
      { name: 'hl7.fhir.xver-extensions', version: '0.1.0' },
      { name: 'fhir.dicom', version: '2025.3.20250714' },
      { name: 'ihe.formatcode.fhir', version: '1.5.0' },
    ]);
  });

  test('selects version-specific Publisher context packages', () => {
    expect(publisherAmbientPackageSpecs('5.0.0', [], {}).slice(0, 5)).toEqual([
      { name: 'hl7.fhir.pubpack', version: '0.2.5' },
      { name: 'hl7.fhir.xver-extensions', version: '0.1.0' },
      { name: 'hl7.fhir.uv.extensions.r5', version: '5.3.0' },
      { name: 'hl7.terminology.r5', version: '7.1.0' },
      { name: 'hl7.fhir.uv.tools.r5', version: '1.1.2' },
    ]);
    expect(publisherAmbientPackageSpecs('6.0.0-ballot3', [], {}).slice(0, 5)).toEqual([
      { name: 'hl7.fhir.pubpack', version: '0.2.5' },
      { name: 'hl7.fhir.xver-extensions', version: '0.1.0' },
      { name: 'hl7.fhir.uv.extensions.r5', version: '5.3.0' },
      { name: 'hl7.terminology.r5', version: '7.1.0' },
      { name: 'hl7.fhir.uv.tools.r5', version: '1.1.2' },
    ]);
    expect(publisherAmbientPackageSpecs('3.0.2', [], {}).slice(0, 5)).toEqual([
      { name: 'hl7.fhir.pubpack', version: '0.2.5' },
      { name: 'hl7.fhir.xver-extensions', version: '0.1.0' },
      { name: 'hl7.fhir.uv.extensions.r3', version: '5.3.0' },
      { name: 'hl7.terminology.r3', version: '7.1.0' },
      { name: 'hl7.fhir.uv.tools.r3', version: '1.1.2' },
    ]);
  });

  test('uses supplied env overrides when selecting ambient package versions', () => {
    const env = {
      FHIR_EXTENSION_PACKAGE_VERSION: '5.2.0',
      FHIR_TERMINOLOGY_PACKAGE_VERSION: '6.5.0',
      FHIR_TOOLING_PACKAGE_VERSION: '1.0.0',
    };
    expect(publisherAmbientPackageSpecs('4.0.1', [], env).slice(2, 5)).toEqual([
      { name: 'hl7.fhir.uv.extensions.r4', version: '5.2.0' },
      { name: 'hl7.terminology.r4', version: '6.5.0' },
      { name: 'hl7.fhir.uv.tools.r4', version: '1.0.0' },
    ]);
  });

  test('lets operators replace the ambient package set explicitly', () => {
    expect(publisherAmbientPackageSpecs('4.0.1', [], { PUBLISHER_AMBIENT_PACKAGES: 'x.pkg#1.0.0 y.pkg#2.0.0' })).toEqual([
      { name: 'x.pkg', version: '1.0.0' },
      { name: 'y.pkg', version: '2.0.0' },
    ]);
    expect(publisherAmbientPackageSpecs('4.0.1', [], { PUBLISHER_AMBIENT_PACKAGES: 'off' })).toEqual([]);
  });

  test('extracts pinned package context from generated ImplementationGuide extensions', () => {
    const ig = {
      resourceType: 'ImplementationGuide',
      definition: {
        extension: [
          { url: IG_INTERNAL_DEPENDENCY_URL, valueCode: 'internal.pkg#1.0.0' },
          { url: IG_LINK_DEPENDENCY_URL, valueCode: 'link.pkg#2.0.0' },
          { url: IG_INTERNAL_DEPENDENCY_URL, valueCode: 'hl7.fhir.uv.tools.r4#0.9.0' },
        ],
      },
    };

    expect(implementationGuidePackageContextSpecs(ig)).toEqual([
      { spec: { name: 'internal.pkg', version: '1.0.0' }, role: 'ig-internal' },
      { spec: { name: 'link.pkg', version: '2.0.0' }, role: 'ig-link' },
    ]);
  });

  test('rejects unpinned generated IG package context', () => {
    expect(() => implementationGuidePackageContextSpecs({
      resourceType: 'ImplementationGuide',
      definition: {
        extension: [
          { url: IG_INTERNAL_DEPENDENCY_URL, valueCode: 'internal.pkg' },
        ],
      },
    })).toThrow('name#version');
  });

  test('loads declared transitive dependencies but not ambient package dependencies', async () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), 'publisher-packages-'));
    try {
      writePackage(cacheRoot, 'hl7.fhir.r4.core', '4.0.1');
      writePackage(cacheRoot, 'declared.pkg', '1.0.0', { 'declared.dep': '1.0.0' });
      writePackage(cacheRoot, 'declared.dep', '1.0.0');
      writePackage(cacheRoot, 'ambient.pkg', '1.0.0', { 'ambient.dep': '1.0.0' });

      const resolved = await resolvePackages({
        fhirVersion: '4.0.1',
        dependencies: { 'declared.pkg': '1.0.0' },
      }, cacheRoot, {
        env: { PUBLISHER_AMBIENT_PACKAGES: 'ambient.pkg#1.0.0' },
      });

      expect(resolved.packages.map((p) => `${p.name}#${p.version}:${p.resolution.role}:${p.resolution.loadDependencies}`)).toEqual([
        'hl7.fhir.r4.core#4.0.1:core:false',
        'declared.pkg#1.0.0:declared:true',
        'ambient.pkg#1.0.0:ambient:false',
        'declared.dep#1.0.0:transitive:true',
      ]);
    } finally {
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  test('loads generated IG internal dependencies transitively and link dependencies as context only', async () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), 'publisher-ig-context-'));
    try {
      writePackage(cacheRoot, 'hl7.fhir.r4.core', '4.0.1');
      writePackage(cacheRoot, 'internal.pkg', '1.0.0', { 'internal.dep': '1.0.0' });
      writePackage(cacheRoot, 'internal.dep', '1.0.0');
      writePackage(cacheRoot, 'link.pkg', '2.0.0', { 'link.dep': '2.0.0' });

      const resolved = await resolvePackages({
        fhirVersion: '4.0.1',
      }, cacheRoot, {
        env: { PUBLISHER_AMBIENT_PACKAGES: 'off' },
        implementationGuide: {
          resourceType: 'ImplementationGuide',
          definition: {
            extension: [
              { url: IG_INTERNAL_DEPENDENCY_URL, valueCode: 'internal.pkg#1.0.0' },
              { url: IG_LINK_DEPENDENCY_URL, valueCode: 'link.pkg#2.0.0' },
            ],
          },
        },
      });

      expect(resolved.packages.map((p) => `${p.name}#${p.version}:${p.resolution.role}:${p.resolution.loadDependencies}`)).toEqual([
        'hl7.fhir.r4.core#4.0.1:core:false',
        'internal.pkg#1.0.0:ig-internal:true',
        'link.pkg#2.0.0:ig-link:false',
        'internal.dep#1.0.0:transitive:true',
      ]);
    } finally {
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  test('downloads required packages into a blank cache and records provenance', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'publisher-blank-cache-'));
    const cacheRoot = join(tmp, 'cache');
    const requested: string[] = [];
    const tarballs = new Map<string, Uint8Array>([
      ['/hl7.fhir.r4.core/4.0.1', packageTarball(tmp, 'hl7.fhir.r4.core', '4.0.1')],
      ['/declared.pkg/1.0.0', packageTarball(tmp, 'declared.pkg', '1.0.0', { 'declared.dep': '1.0.0' })],
      ['/declared.dep/1.0.0', packageTarball(tmp, 'declared.dep', '1.0.0')],
      ['/ambient.pkg/1.0.0', packageTarball(tmp, 'ambient.pkg', '1.0.0', { 'ambient.dep': '1.0.0' })],
    ]);
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;
        requested.push(path);
        const body = tarballs.get(path);
        return body ? new Response(body) : new Response('missing', { status: 404 });
      },
    });

    try {
      const resolved = await resolvePackages({
        fhirVersion: '4.0.1',
        dependencies: { 'declared.pkg': '1.0.0' },
      }, cacheRoot, {
        env: {
          FHIR_PACKAGE_REGISTRY: server.url.toString().replace(/\/$/, ''),
          PUBLISHER_AMBIENT_PACKAGES: 'ambient.pkg#1.0.0',
        },
      });

      expect(requested).toEqual([
        '/hl7.fhir.r4.core/4.0.1',
        '/declared.pkg/1.0.0',
        '/ambient.pkg/1.0.0',
        '/declared.dep/1.0.0',
      ]);
      expect(resolved.packages.map((p) => p.name)).toEqual([
        'hl7.fhir.r4.core',
        'declared.pkg',
        'ambient.pkg',
        'declared.dep',
      ]);
      expect(resolved.packages.every((p) => p.acquisition.source === 'download')).toBe(true);
      expect(resolved.packages.every((p) => typeof p.acquisition.tarballSha256 === 'string' && p.acquisition.tarballSha256.length === 64)).toBe(true);
      expect(resolved.packages.map((p) => p.resolution.role)).toEqual(['core', 'declared', 'ambient', 'transitive']);
    } finally {
      server.stop(true);
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('downloads the default Publisher ambient package context into a blank cache', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'publisher-default-ambient-'));
    const cacheRoot = join(tmp, 'cache');
    const requested: string[] = [];
    const specs = [
      ['hl7.fhir.r4.core', '4.0.1'],
      ['hl7.fhir.pubpack', '0.2.5'],
      ['hl7.fhir.xver-extensions', '0.1.0'],
      ['hl7.fhir.uv.extensions.r4', '5.3.0'],
      ['hl7.terminology.r4', '7.2.0'],
      ['hl7.fhir.uv.tools.r4', '1.1.2'],
      ['fhir.dicom', '2025.3.20250714'],
      ['ihe.formatcode.fhir', '1.5.0'],
    ] as const;
    const tarballs = new Map<string, Uint8Array>(
      specs.map(([name, version]) => [`/${name}/${version}`, packageTarball(tmp, name, version)]),
    );
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;
        requested.push(path);
        const body = tarballs.get(path);
        return body ? new Response(body) : new Response('missing', { status: 404 });
      },
    });

    try {
      const resolved = await resolvePackages({ fhirVersion: '4.0.1' }, cacheRoot, {
        env: { FHIR_PACKAGE_REGISTRY: server.url.toString().replace(/\/$/, '') },
      });

      expect(requested).toEqual(specs.map(([name, version]) => `/${name}/${version}`));
      expect(resolved.packages.map((p) => `${p.name}#${p.version}:${p.resolution.role}:${p.resolution.loadDependencies}`)).toEqual([
        'hl7.fhir.r4.core#4.0.1:core:false',
        'hl7.fhir.pubpack#0.2.5:ambient:false',
        'hl7.fhir.xver-extensions#0.1.0:ambient:false',
        'hl7.fhir.uv.extensions.r4#5.3.0:ambient:false',
        'hl7.terminology.r4#7.2.0:ambient:false',
        'hl7.fhir.uv.tools.r4#1.1.2:ambient:false',
        'fhir.dicom#2025.3.20250714:ambient:false',
        'ihe.formatcode.fhir#1.5.0:ambient:false',
      ]);
    } finally {
      server.stop(true);
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('fails clearly on a missing package when package downloads are disabled', async () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), 'publisher-offline-cache-'));
    const oldFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = ((..._args: Parameters<typeof fetch>) => {
      fetchCalled = true;
      throw new Error('fetch should not be called');
    }) as typeof fetch;

    try {
      await expect(resolvePackages({ fhirVersion: '4.0.1' }, cacheRoot, {
        env: {
          PUBLISHER_PACKAGE_DOWNLOADS: 'off',
          PUBLISHER_AMBIENT_PACKAGES: 'off',
        },
      })).rejects.toThrow('PUBLISHER_PACKAGE_DOWNLOADS=off');
      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = oldFetch;
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });
});
