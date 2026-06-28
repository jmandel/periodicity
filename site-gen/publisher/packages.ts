import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';

export type Json = Record<string, any>;

export type PackageSpec = {
  name: string;
  version: string;
};

export type PackageEnv = Record<string, string | undefined>;

export type ResolvedPackage = PackageSpec & {
  dir: string;
  manifest: Json;
  acquisition: PackageAcquisition;
  resolution: PackageResolutionRole;
};

export type PackageResolution = {
  core: ResolvedPackage;
  terminology?: ResolvedPackage;
  packages: ResolvedPackage[];
};

export type PackageResolutionOptions = {
  env?: PackageEnv;
  implementationGuide?: Json | null;
};

export type PackageAcquisition = {
  source: 'cache' | 'download';
  packageDir: string;
  registryUrl?: string;
  tarballSha256?: string;
};

export type PackageDownloadPolicy = 'allow' | 'off';

type ResolvedPackageContents = Omit<ResolvedPackage, 'resolution'>;

export type PackageResolutionRole = {
  role: 'core' | 'declared' | 'ambient' | 'ig-internal' | 'ig-link' | 'extra' | 'transitive';
  loadDependencies: boolean;
  parent?: string;
};

type PackageQueueItem = {
  spec: PackageSpec;
  resolution: PackageResolutionRole;
};

const defaultRegistry = 'https://packages2.fhir.org/packages';
const defaultPubpackPackage: PackageSpec = { name: 'hl7.fhir.pubpack', version: '0.2.5' };
const defaultXverPackage: PackageSpec = { name: 'hl7.fhir.xver-extensions', version: '0.1.0' };
const defaultDicomPackage: PackageSpec = { name: 'fhir.dicom', version: '2025.3.20250714' };
const defaultIheFormatCodePackage: PackageSpec = { name: 'ihe.formatcode.fhir', version: '1.5.0' };
const defaultToolingPackageVersion = '1.1.2';
export const IG_INTERNAL_DEPENDENCY_URL = 'http://hl7.org/fhir/tools/StructureDefinition/ig-internal-dependency';
export const IG_LINK_DEPENDENCY_URL = 'http://hl7.org/fhir/tools/StructureDefinition/ig-link-dependency';

export function packageDownloadPolicyFromEnv(env: PackageEnv = process.env): PackageDownloadPolicy {
  const value = (env.PUBLISHER_PACKAGE_DOWNLOADS || 'allow').trim().toLowerCase();
  if (['allow', 'on', 'true', '1'].includes(value)) return 'allow';
  if (['off', 'false', '0'].includes(value)) return 'off';
  throw new Error(`PUBLISHER_PACKAGE_DOWNLOADS must be "allow" or "off"; got ${value}`);
}

export function packageDownloadTimeoutMsFromEnv(env: PackageEnv = process.env): number {
  const value = env.PUBLISHER_PACKAGE_DOWNLOAD_TIMEOUT_MS?.trim();
  if (!value) return 120_000;
  const timeoutMs = Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`PUBLISHER_PACKAGE_DOWNLOAD_TIMEOUT_MS must be a positive integer number of milliseconds; got ${value}`);
  }
  return timeoutMs;
}

function readJson(path: string): Json {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function packagePath(cacheRoot: string, spec: PackageSpec): string {
  return join(cacheRoot, `${spec.name}#${spec.version}`, 'package');
}

function readPackage(cacheRoot: string, spec: PackageSpec, acquisition?: PackageAcquisition): ResolvedPackageContents | null {
  const dir = packagePath(cacheRoot, spec);
  const manifestPath = join(dir, 'package.json');
  if (!existsSync(manifestPath)) return null;
  const manifest = readJson(manifestPath);
  return {
    ...spec,
    dir,
    manifest,
    acquisition: acquisition || { source: 'cache', packageDir: dir },
  };
}

function normalizePackageSpec(name: string, version: string): PackageSpec {
  const cleanName = name.trim();
  const cleanVersion = String(version).trim();
  if (!cleanName || !cleanVersion) throw new Error(`Invalid FHIR package spec: ${name}#${version}`);
  return { name: cleanName, version: cleanVersion };
}

function corePackageForFhirVersion(fhirVersion: string): PackageSpec {
  if (fhirVersion.startsWith('3.0.')) return { name: 'hl7.fhir.r3.core', version: '3.0.2' };
  if (fhirVersion.startsWith('4.0.')) return { name: 'hl7.fhir.r4.core', version: '4.0.1' };
  if (fhirVersion.startsWith('4.3.')) return { name: 'hl7.fhir.r4b.core', version: '4.3.0' };
  if (fhirVersion.startsWith('5.')) return { name: 'hl7.fhir.r5.core', version: '5.0.0' };
  if (fhirVersion.startsWith('6.')) return { name: 'hl7.fhir.r6.core', version: fhirVersion };
  throw new Error(`No default FHIR core package mapping for fhirVersion=${fhirVersion}`);
}

function terminologyPackageForFhirVersion(fhirVersion: string, env: PackageEnv = process.env): PackageSpec | null {
  const name = env.FHIR_TERMINOLOGY_PACKAGE_NAME;
  const version = env.FHIR_TERMINOLOGY_PACKAGE_VERSION;
  if (name || version) return normalizePackageSpec(name || defaultTerminologyPackageName(fhirVersion), version || defaultTerminologyPackageVersion(fhirVersion));
  // Mirrors PublisherIGLoader.getUTGPackageName(): R6 currently uses the R5
  // THO package family; R3 uses the R3 family.
  if (fhirVersion.startsWith('3.0.')) return { name: 'hl7.terminology.r3', version: '7.1.0' };
  if (fhirVersion.startsWith('4.0.')) return { name: 'hl7.terminology.r4', version: '7.2.0' };
  if (fhirVersion.startsWith('4.3.')) return { name: 'hl7.terminology.r4', version: '7.2.0' };
  if (fhirVersion.startsWith('5.')) return { name: 'hl7.terminology.r5', version: '7.1.0' };
  if (fhirVersion.startsWith('6.')) return { name: 'hl7.terminology.r5', version: '7.1.0' };
  return null;
}

function defaultTerminologyPackageName(fhirVersion: string): string {
  if (fhirVersion.startsWith('3.0.')) return 'hl7.terminology.r3';
  if (fhirVersion.startsWith('5.') || fhirVersion.startsWith('6.')) return 'hl7.terminology.r5';
  return 'hl7.terminology.r4';
}

function defaultTerminologyPackageVersion(fhirVersion: string): string {
  if (fhirVersion.startsWith('3.0.') || fhirVersion.startsWith('5.') || fhirVersion.startsWith('6.')) return '7.1.0';
  return '7.2.0';
}

function extensionPackageForFhirVersion(fhirVersion: string, env: PackageEnv = process.env): PackageSpec | null {
  const name = env.FHIR_EXTENSION_PACKAGE_NAME;
  const version = env.FHIR_EXTENSION_PACKAGE_VERSION;
  if (name || version) return normalizePackageSpec(name || defaultExtensionPackageName(fhirVersion), version || defaultExtensionPackageVersion(fhirVersion));
  if (fhirVersion.startsWith('3.0.')) return { name: 'hl7.fhir.uv.extensions.r3', version: '5.3.0' };
  if (fhirVersion.startsWith('4.0.') || fhirVersion.startsWith('4.3.')) return { name: 'hl7.fhir.uv.extensions.r4', version: '5.3.0' };
  if (fhirVersion.startsWith('5.') || fhirVersion.startsWith('6.')) return { name: 'hl7.fhir.uv.extensions.r5', version: '5.3.0' };
  return null;
}

function defaultExtensionPackageName(fhirVersion: string): string {
  if (fhirVersion.startsWith('3.0.')) return 'hl7.fhir.uv.extensions.r3';
  if (fhirVersion.startsWith('5.') || fhirVersion.startsWith('6.')) return 'hl7.fhir.uv.extensions.r5';
  return 'hl7.fhir.uv.extensions.r4';
}

function defaultExtensionPackageVersion(_fhirVersion: string): string {
  return '5.3.0';
}

function toolingPackageForFhirVersion(fhirVersion: string, env: PackageEnv = process.env): PackageSpec | null {
  const name = env.FHIR_TOOLING_PACKAGE_NAME;
  const version = env.FHIR_TOOLING_PACKAGE_VERSION;
  if (name || version) return normalizePackageSpec(name || defaultToolingPackageName(fhirVersion), version || defaultToolingPackageVersion);
  if (fhirVersion.startsWith('3.0.')) return { name: 'hl7.fhir.uv.tools.r3', version: defaultToolingPackageVersion };
  if (fhirVersion.startsWith('4.0.') || fhirVersion.startsWith('4.3.')) return { name: 'hl7.fhir.uv.tools.r4', version: defaultToolingPackageVersion };
  if (fhirVersion.startsWith('5.') || fhirVersion.startsWith('6.')) return { name: 'hl7.fhir.uv.tools.r5', version: defaultToolingPackageVersion };
  return null;
}

function defaultToolingPackageName(fhirVersion: string): string {
  if (fhirVersion.startsWith('3.0.')) return 'hl7.fhir.uv.tools.r3';
  if (fhirVersion.startsWith('5.') || fhirVersion.startsWith('6.')) return 'hl7.fhir.uv.tools.r5';
  return 'hl7.fhir.uv.tools.r4';
}

function configDependencies(cfg: Json): PackageSpec[] {
  const deps = cfg.dependencies;
  if (!deps) return [];
  if (Array.isArray(deps)) {
    return deps.flatMap((d) => {
      if (typeof d === 'string' && d.includes('#')) {
        const [name, version] = d.split('#');
        return [normalizePackageSpec(name, version)];
      }
      if (d?.packageId && d?.version) return [normalizePackageSpec(d.packageId, d.version)];
      if (d?.id && d?.version) return [normalizePackageSpec(d.id, d.version)];
      return [];
    });
  }
  if (typeof deps === 'object') {
    return Object.entries(deps).map(([name, value]) => {
      if (typeof value === 'string') return normalizePackageSpec(name, value);
      if (value && typeof value === 'object' && 'version' in value) return normalizePackageSpec(name, String((value as any).version));
      throw new Error(`Unsupported dependency declaration for ${name}`);
    });
  }
  throw new Error('Unsupported sushi-config.yaml dependencies shape');
}

function packageGroup(name: string): string {
  if (['hl7.fhir.uv.extensions', 'hl7.fhir.uv.extensions.r3', 'hl7.fhir.uv.extensions.r4', 'hl7.fhir.uv.extensions.r5', 'hl7.fhir.uv.extensions.r6'].includes(name)) {
    return 'hl7.fhir.uv.extensions';
  }
  if (name.startsWith('hl7.terminology')) return 'hl7.terminology';
  if (['hl7.fhir.uv.tools', 'hl7.fhir.uv.tools.r3', 'hl7.fhir.uv.tools.r4', 'hl7.fhir.uv.tools.r5', 'hl7.fhir.uv.tools.r6'].includes(name)) {
    return 'hl7.fhir.uv.tools';
  }
  return name;
}

function hasPackageGroup(specs: PackageSpec[], group: string): boolean {
  return specs.some((spec) => packageGroup(spec.name) === group);
}

export function parsePackageSpecList(value: string | undefined, label: string): PackageSpec[] {
  if (!value?.trim()) return [];
  return value
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((token) => {
      const parts = token.split('#');
      if (parts.length !== 2) throw new Error(`${label} must contain pinned name#version package specs; got ${token}`);
      return normalizePackageSpec(parts[0], parts[1]);
    });
}

function extensionPrimitiveValue(ext: Json): string | null {
  for (const [key, value] of Object.entries(ext)) {
    if (!key.startsWith('value')) continue;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  }
  return null;
}

function parsePinnedPackageSpec(value: string, label: string): PackageSpec {
  const parts = value.split('#');
  if (parts.length !== 2) throw new Error(`${label} must contain a pinned name#version package spec; got ${value}`);
  return normalizePackageSpec(parts[0], parts[1]);
}

export function implementationGuidePackageContextSpecs(ig: Json | null | undefined): Array<{ spec: PackageSpec; role: 'ig-internal' | 'ig-link' }> {
  const extensions = Array.isArray(ig?.definition?.extension) ? ig.definition.extension : [];
  const out: Array<{ spec: PackageSpec; role: 'ig-internal' | 'ig-link' }> = [];
  for (const ext of extensions) {
    const value = extensionPrimitiveValue(ext);
    if (!value) continue;
    if (ext.url === IG_INTERNAL_DEPENDENCY_URL) {
      const spec = parsePinnedPackageSpec(value, IG_INTERNAL_DEPENDENCY_URL);
      if (packageGroup(spec.name) !== 'hl7.fhir.uv.tools') out.push({ spec, role: 'ig-internal' });
    } else if (ext.url === IG_LINK_DEPENDENCY_URL) {
      out.push({ spec: parsePinnedPackageSpec(value, IG_LINK_DEPENDENCY_URL), role: 'ig-link' });
    }
  }
  return out;
}

export function publisherAmbientPackageSpecs(fhirVersion: string, directDependencies: PackageSpec[], env: PackageEnv = process.env): PackageSpec[] {
  if (env.PUBLISHER_AMBIENT_PACKAGES === 'off') return [];
  if (env.PUBLISHER_AMBIENT_PACKAGES?.trim()) return parsePackageSpecList(env.PUBLISHER_AMBIENT_PACKAGES, 'PUBLISHER_AMBIENT_PACKAGES');

  const specs: PackageSpec[] = [];

  // Mirrors Java IG Publisher's worker-context bootstrap:
  // ig-publisher/.../PublisherIGLoader.java loadPubPack() loads these before
  // IG dependencies (CommonPackages.ID_PUBPACK/VER_PUBPACK and
  // CommonPackages.ID_XVER/VER_XVER). They are context/tooling packages, so
  // their dependencies are not followed unless an IG declares them itself.
  specs.push(defaultPubpackPackage, defaultXverPackage);

  // Mirrors Java IG Publisher's automatic dependencies:
  // ig-publisher/.../PublisherIGLoader.java adds the HL7 Extension Pack and
  // HL7 Terminology to source IGs that do not declare them (around lines
  // 985-1002 in the checked source tree).
  const extensionSpec = extensionPackageForFhirVersion(fhirVersion, env);
  if (extensionSpec && !hasPackageGroup(directDependencies, 'hl7.fhir.uv.extensions')) specs.push(extensionSpec);

  const terminologySpec = terminologyPackageForFhirVersion(fhirVersion, env);
  if (terminologySpec && !hasPackageGroup(directDependencies, 'hl7.terminology')) specs.push(terminologySpec);

  // Java IG Publisher also loads hl7.fhir.uv.tools as a tooling package for
  // Publisher extension definitions and related terminology. It is not an
  // IG-authored dependency, but it is part of the ambient package context needed
  // to resolve Publisher-defined extension URLs without the jar.
  const toolingSpec = toolingPackageForFhirVersion(fhirVersion, env);
  if (toolingSpec && !hasPackageGroup(directDependencies, 'hl7.fhir.uv.tools')) specs.push(toolingSpec);

  // Mirrors the FHIR spec Publisher's ambient terminology context:
  // kindling/.../PageProcessor.java setDefinitions() loads fhir.dicom and
  // ihe.formatcode.fhir alongside UTG so DICOM/IHE canonical references resolve
  // without relying on chance local cache state. These pinned packages are
  // context packages, not IG-authored dependencies.
  specs.push(defaultDicomPackage, defaultIheFormatCodePackage);

  return specs;
}

function extraPackageSpecs(env: PackageEnv = process.env): PackageSpec[] {
  return parsePackageSpecList(env.PUBLISHER_EXTRA_PACKAGES, 'PUBLISHER_EXTRA_PACKAGES');
}

async function downloadPackage(cacheRoot: string, spec: PackageSpec, env: PackageEnv): Promise<ResolvedPackageContents> {
  if (['current', 'dev', 'latest'].includes(spec.version)) {
    throw new Error(`FHIR package ${spec.name}#${spec.version} is not in ${cacheRoot} and cannot be downloaded reproducibly. Pin a concrete version or preinstall it.`);
  }

  const registry = (env.FHIR_PACKAGE_REGISTRY || defaultRegistry).replace(/\/+$/, '');
  const url = `${registry}/${encodeURIComponent(spec.name)}/${encodeURIComponent(spec.version)}`;
  const timeoutMs = packageDownloadTimeoutMsFromEnv(env);
  const targetRoot = dirname(packagePath(cacheRoot, spec));
  const tempDir = mkdtempSync(join(tmpdir(), 'fhir-package-'));
  const tgzPath = join(tempDir, `${spec.name}-${spec.version}.tgz`);

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const body = await response.arrayBuffer();
    const tarballSha256 = await sha256Hex(body);
    mkdirSync(targetRoot, { recursive: true });
    await Bun.write(tgzPath, body);
    const tar = Bun.spawnSync(['tar', '-xzf', tgzPath, '-C', targetRoot], { stdout: 'pipe', stderr: 'pipe' });
    if (!tar.success) {
      const stderr = new TextDecoder().decode(tar.stderr);
      throw new Error(`tar failed for ${spec.name}#${spec.version}: ${stderr.trim()}`);
    }
    const resolved = readPackage(cacheRoot, spec, {
      source: 'download',
      packageDir: packagePath(cacheRoot, spec),
      registryUrl: url,
      tarballSha256,
    });
    if (!resolved) throw new Error(`Downloaded package did not contain ${relative(cacheRoot, join(packagePath(cacheRoot, spec), 'package.json'))}`);
    return resolved;
  } catch (e) {
    rmSync(targetRoot, { recursive: true, force: true });
    throw new Error(`Unable to install FHIR package ${spec.name}#${spec.version} from ${url} using ${timeoutMs}ms fetch timeout: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function ensurePackage(cacheRoot: string, spec: PackageSpec, env: PackageEnv): Promise<ResolvedPackageContents> {
  const existing = readPackage(cacheRoot, spec);
  if (existing) return existing;
  if (packageDownloadPolicyFromEnv(env) === 'off') {
    throw new Error(
      `FHIR package ${spec.name}#${spec.version} is not installed in ${cacheRoot}; package downloads are disabled by PUBLISHER_PACKAGE_DOWNLOADS=off. ` +
      `Install the package into the cache or run with PUBLISHER_PACKAGE_DOWNLOADS=allow.`,
    );
  }
  mkdirSync(cacheRoot, { recursive: true });
  return downloadPackage(cacheRoot, spec, env);
}

function dependencySpecs(pkg: ResolvedPackage): PackageSpec[] {
  const deps = pkg.manifest.dependencies || {};
  return Object.entries(deps).map(([name, version]) => normalizePackageSpec(name, String(version)));
}

export function fhirVersionFromConfig(cfg: Json): string {
  const fhirVersion = Array.isArray(cfg.fhirVersion) ? cfg.fhirVersion[0] : cfg.fhirVersion;
  if (!fhirVersion) throw new Error('sushi-config.yaml must declare fhirVersion before packages can be resolved');
  return String(fhirVersion);
}

export async function resolvePackages(cfg: Json, cacheRoot: string, options: PackageResolutionOptions = {}): Promise<PackageResolution> {
  const env = options.env || process.env;
  const fhirVersion = fhirVersionFromConfig(cfg);
  const coreSpec = corePackageForFhirVersion(fhirVersion);
  const directDependencies = configDependencies(cfg);
  const ambientSpecs = publisherAmbientPackageSpecs(fhirVersion, directDependencies, env);
  const igContextSpecs = implementationGuidePackageContextSpecs(options.implementationGuide);
  const extraSpecs = extraPackageSpecs(env);
  const terminologySpec = ambientSpecs.find((spec) => packageGroup(spec.name) === 'hl7.terminology')
    || terminologyPackageForFhirVersion(fhirVersion, env);

  const queue: PackageQueueItem[] = [
    { spec: coreSpec, resolution: { role: 'core', loadDependencies: false } },
    ...directDependencies.map((spec): PackageQueueItem => ({ spec, resolution: { role: 'declared', loadDependencies: true } })),
    ...ambientSpecs.map((spec): PackageQueueItem => ({ spec, resolution: { role: 'ambient', loadDependencies: false } })),
    ...igContextSpecs.map(({ spec, role }): PackageQueueItem => ({ spec, resolution: { role, loadDependencies: role === 'ig-internal' } })),
    ...extraSpecs.map((spec): PackageQueueItem => ({ spec, resolution: { role: 'extra', loadDependencies: false } })),
  ];

  const resolved = new Map<string, ResolvedPackage>();
  for (let i = 0; i < queue.length; i++) {
    const { spec, resolution } = queue[i];
    const key = `${spec.name}#${spec.version}`;
    if (resolved.has(key)) continue;
    const pkg = { ...(await ensurePackage(cacheRoot, spec, env)), resolution };
    resolved.set(key, pkg);
    if (!resolution.loadDependencies) continue;
    for (const dep of dependencySpecs(pkg)) {
      const depKey = `${dep.name}#${dep.version}`;
      if (!resolved.has(depKey)) {
        queue.push({
          spec: dep,
          resolution: {
            role: 'transitive',
            loadDependencies: true,
            parent: key,
          },
        });
      }
    }
  }

  const packages = [...resolved.values()];
  const core = packages.find((p) => p.name === coreSpec.name && p.version === coreSpec.version);
  if (!core) throw new Error(`Resolved package graph is missing core package ${coreSpec.name}#${coreSpec.version}`);
  const terminology = terminologySpec ? packages.find((p) => p.name === terminologySpec.name && p.version === terminologySpec.version) : undefined;
  return { core, terminology, packages };
}

export function describePackage(pkg: ResolvedPackage): string {
  return `${pkg.name}#${pkg.version} (${basename(dirname(pkg.dir))})`;
}
