import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export type TimestampedFile = {
  path: string;
  mtimeMs: number;
  mtime: string;
};

export type FileSetSummary = {
  dir?: string;
  count: number;
  oldestMtime: string | null;
  oldestPath: string | null;
  newestMtime: string | null;
  newestPath: string | null;
};

export type FreshnessReport = {
  generated: FileSetSummary;
  inputs: FileSetSummary;
  stale: boolean;
};

function collectFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const stat = statSync(root);
  if (stat.isFile()) return [root];
  if (!stat.isDirectory()) return [];

  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

export function fshCompilerInputFiles(sushiProject: string, configPath: string): string[] {
  const candidates = [
    configPath,
    join(sushiProject, 'sushi-ignoreWarnings.txt'),
    join(sushiProject, 'sushi-ignoreErrors.txt'),
    join(sushiProject, 'input/sushi-ignoreWarnings.txt'),
    join(sushiProject, 'input/sushi-ignoreErrors.txt'),
    join(sushiProject, 'input/fsh'),
  ];
  return [...new Set(candidates.flatMap(collectFiles))].sort((a, b) => a.localeCompare(b));
}

export function timestampedFiles(files: string[]): TimestampedFile[] {
  return files.map((path) => {
    const stat = statSync(path);
    return {
      path,
      mtimeMs: stat.mtimeMs,
      mtime: stat.mtime.toISOString(),
    };
  }).sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path));
}

export function summarizeTimestampedFiles(files: TimestampedFile[], dir?: string): FileSetSummary {
  const oldest = files[0] ?? null;
  const newest = files.at(-1) ?? null;
  return {
    ...(dir ? { dir } : {}),
    count: files.length,
    oldestMtime: oldest?.mtime ?? null,
    oldestPath: oldest?.path ?? null,
    newestMtime: newest?.mtime ?? null,
    newestPath: newest?.path ?? null,
  };
}

export function freshnessReport(args: {
  generatedFiles: string[];
  generatedDir?: string;
  inputDir?: string;
  inputFiles: string[];
}): FreshnessReport {
  const generated = timestampedFiles(args.generatedFiles);
  const inputs = timestampedFiles(args.inputFiles);
  const newestGenerated = generated.at(-1);
  const newestInput = inputs.at(-1);
  return {
    generated: summarizeTimestampedFiles(generated, args.generatedDir),
    inputs: summarizeTimestampedFiles(inputs, args.inputDir),
    stale: inputs.length > 0 && (!newestGenerated || newestInput!.mtimeMs > newestGenerated.mtimeMs),
  };
}

export function assertFreshGeneratedResources(args: {
  generatedFiles: string[];
  generatedDir: string;
  inputFiles: string[];
  inputDir: string;
  labelRoot?: string;
}): FreshnessReport {
  const report = freshnessReport(args);
  if (!report.stale) return report;

  const labelRoot = args.labelRoot ?? process.cwd();
  const newestInput = report.inputs.newestPath ? relative(labelRoot, report.inputs.newestPath) : '(no input)';
  const newestGenerated = report.generated.newestPath ? relative(labelRoot, report.generated.newestPath) : '(no generated resource)';
  throw new Error([
    'Generated FHIR resources are stale while PUBLISHER_RUN_SUSHI=0.',
    `Newest FSH/compiler input: ${newestInput} at ${report.inputs.newestMtime ?? 'unknown'}.`,
    `Newest generated resource: ${newestGenerated} at ${report.generated.newestMtime ?? 'none'}.`,
    'Run with integrated SUSHI enabled or regenerate fsh-generated/resources before building package.db.',
  ].join(' '));
}
