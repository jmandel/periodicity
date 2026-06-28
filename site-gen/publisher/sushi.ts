import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const sushi = require('fsh-sushi');
const { IGExporter, loadPredefinedResources } = require('fsh-sushi/dist/ig');
const { DiskBasedPackageCache } = require('fhir-package-loader');

const { fhirdefs, sushiExport, utils } = sushi;

export type SushiBuildOptions = {
  config?: Record<string, string>;
  logLevel?: 'error' | 'warn' | 'info' | 'debug';
  out?: string;
  preprocessed?: boolean;
  projectPath?: string;
  packageCacheRoot?: string;
  snapshot?: boolean;
  summary?: boolean;
};

export type SushiBuildResult = {
  inputDir: string;
  outDir: string;
  projectPath: string;
  resourcesDir: string;
  snapshot: boolean;
  version: string;
  counts: {
    codeSystems: number;
    errors: number;
    extensions: number;
    instances: number;
    logicals: number;
    profiles: number;
    resources: number;
    valueSets: number;
    warnings: number;
  };
};

export function getSushiVersion(): string {
  return utils.getLocalSushiVersion?.() ?? 'unknown';
}

function getIgnoredMessages(input: string, fileName: string): string | null {
  const rootIgnoreFilePath = path.join(input, fileName);
  const nestedIgnoreFilePath = path.join(input, 'input', fileName);
  if (existsSync(rootIgnoreFilePath)) {
    if (existsSync(nestedIgnoreFilePath)) {
      utils.logger.warn([
        `Found ${fileName} files in both locations:`,
        `- ${rootIgnoreFilePath}`,
        `- ${nestedIgnoreFilePath}`,
        `Only ${rootIgnoreFilePath} will be processed.`,
      ].join('\n'));
    }
    return readFileSync(rootIgnoreFilePath, 'utf8');
  }
  if (existsSync(nestedIgnoreFilePath)) return readFileSync(nestedIgnoreFilePath, 'utf8');
  return null;
}

function printSummary(result: SushiBuildResult): void {
  console.log('');
  console.log('SUSHI build summary');
  console.log(`  Profiles:    ${result.counts.profiles}`);
  console.log(`  Extensions:  ${result.counts.extensions}`);
  console.log(`  Logicals:    ${result.counts.logicals}`);
  console.log(`  Resources:   ${result.counts.resources}`);
  console.log(`  ValueSets:   ${result.counts.valueSets}`);
  console.log(`  CodeSystems: ${result.counts.codeSystems}`);
  console.log(`  Instances:   ${result.counts.instances}`);
  console.log(`  Errors:      ${result.counts.errors}`);
  console.log(`  Warnings:    ${result.counts.warnings}`);
  console.log('');
}

export async function runSushiBuild(options: SushiBuildOptions = {}): Promise<SushiBuildResult> {
  const configOverrides = options.config ?? {};
  const projectPath = path.resolve(options.projectPath ?? '.');
  const packageCacheRoot = options.packageCacheRoot || process.env.FHIR_PACKAGE_CACHE;
  const snapshot = options.snapshot ?? true;

  utils.stats.reset();
  utils.errorsAndWarnings.reset();
  if (options.logLevel) utils.logger.level = options.logLevel;

  const version = getSushiVersion();
  utils.logger.info(`Running SUSHI v${version} programmatically`);
  utils.logger.info('Arguments:');
  if (options.logLevel) utils.logger.info(`  --log-level ${options.logLevel}`);
  if (options.preprocessed) utils.logger.info('  --preprocessed');
  if (snapshot) utils.logger.info('  --snapshot');
  if (options.out) utils.logger.info(`  --out ${path.resolve(options.out)}`);
  if (packageCacheRoot) utils.logger.info(`  FHIR_PACKAGE_CACHE=${path.resolve(packageCacheRoot)}`);
  for (const [key, value] of Object.entries(configOverrides)) utils.logger.info(`  --config ${key}:${value}`);
  utils.logger.info(`  ${projectPath}`);

  let input = utils.ensureInputDir(projectPath);
  const ignoredWarnings = getIgnoredMessages(input, 'sushi-ignoreWarnings.txt');
  if (ignoredWarnings != null) utils.setIgnoredWarnings(ignoredWarnings);
  const ignoredErrors = getIgnoredMessages(input, 'sushi-ignoreErrors.txt');
  if (ignoredErrors != null) utils.setIgnoredErrors(ignoredErrors);

  const originalInput = input;
  input = utils.findInputDir(input);
  const inputFshFolder = path.basename(input) === 'fsh' && path.basename(path.dirname(input)) === 'input';
  if (!inputFshFolder) {
    throw new Error('SUSHI requires the current project layout with FSH files under input/fsh.');
  }

  const outDir = utils.ensureOutputDir(input, options.out);
  const rawFSH = existsSync(input) ? utils.getRawFSHes(input) : [];
  const hasConfig = existsSync(path.join(originalInput, 'sushi-config.yaml')) || existsSync(path.join(originalInput, 'sushi-config.yml'));
  if (rawFSH.length === 0 && !hasConfig) {
    utils.logger.info('No FSH files or sushi-config.yaml present.');
    return {
      inputDir: input,
      outDir,
      projectPath,
      resourcesDir: path.join(outDir, 'fsh-generated', 'resources'),
      snapshot,
      version,
      counts: {
        codeSystems: 0,
        errors: utils.stats.numError,
        extensions: 0,
        instances: 0,
        logicals: 0,
        profiles: 0,
        resources: 0,
        valueSets: 0,
        warnings: utils.stats.numWarn,
      },
    };
  }

  const config = utils.readConfig(originalInput);
  utils.updateConfig(config, { config: configOverrides });
  const tank = utils.fillTank(rawFSH, config);
  tank.checkDuplicateNameEntities();

  const defs = await fhirdefs.createFHIRDefinitions(packageCacheRoot
    ? { packageCache: new DiskBasedPackageCache(path.resolve(packageCacheRoot)) }
    : undefined);
  await utils.loadExternalDependencies(defs, config);
  await loadPredefinedResources(defs, path.resolve(input, '..'), path.resolve(originalInput), config.parameters);
  defs.optimize();

  const structDef = defs.fishForFHIR('StructureDefinition', utils.Type.Resource);
  if (structDef == null || !utils.isSupportedFHIRVersion(structDef.version)) {
    throw new Error('Valid StructureDefinition resource was not found in the FHIR package cache.');
  }

  utils.logger.info('Converting FSH to FHIR resources...');
  const outPackage = sushiExport.exportFHIR(tank, defs);
  const { skippedResources } = utils.writeFHIRResources(outDir, outPackage, defs, snapshot);
  utils.writeFSHIndex(outDir, outPackage, input, skippedResources);
  if (options.preprocessed) {
    utils.logger.info('Writing preprocessed FSH...');
    utils.writePreprocessedFSH(outDir, input, tank);
  }

  if (config.FSHOnly) {
    utils.logger.info('Exporting FSH definitions only. No IG related content will be exported.');
  } else {
    const igFilesPath = path.resolve(input, '..', '..');
    utils.logger.info('Assembling Implementation Guide sources...');
    const igExporter = new IGExporter(outPackage, defs, igFilesPath);
    igExporter.export(outDir);
    utils.logger.info('Assembled Implementation Guide sources; ready for IG Publisher.');
    if (!readdirSync(outDir).some((file) => file.startsWith('_build'))) {
      utils.logger.info('The _build script hosted at https://github.com/HL7/ig-publisher-scripts is useful for downloading and running the IG Publisher.');
    }
  }

  const result: SushiBuildResult = {
    inputDir: input,
    outDir,
    projectPath,
    resourcesDir: path.join(outDir, 'fsh-generated', 'resources'),
    snapshot,
    version,
    counts: {
      codeSystems: outPackage.codeSystems.length,
      errors: utils.stats.numError,
      extensions: outPackage.extensions.length,
      instances: outPackage.instances.length,
      logicals: outPackage.logicals.length,
      profiles: outPackage.profiles.length,
      resources: outPackage.resources.length,
      valueSets: outPackage.valueSets.length,
      warnings: utils.stats.numWarn,
    },
  };

  if (options.summary !== false) printSummary(result);
  if (result.counts.errors > 0) throw new Error(`SUSHI completed with ${result.counts.errors} error(s).`);
  return result;
}
