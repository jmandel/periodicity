import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertFreshGeneratedResources, freshnessReport, fshCompilerInputFiles } from './staleness';

function touch(path: string, iso: string) {
  const d = new Date(iso);
  utimesSync(path, d, d);
}

describe('generated resource freshness checks', () => {
  test('collects SUSHI compiler inputs from config, ignore files, and input/fsh', () => {
    const root = mkdtempSync(join(tmpdir(), 'publisher-stale-inputs-'));
    try {
      mkdirSync(join(root, 'input/fsh/nested'), { recursive: true });
      mkdirSync(join(root, 'outside'), { recursive: true });
      writeFileSync(join(root, 'sushi-config.yaml'), 'fhirVersion: 4.0.1\n');
      writeFileSync(join(root, 'sushi-ignoreWarnings.txt'), 'warning\n');
      writeFileSync(join(root, 'input/fsh/A.fsh'), 'Profile: A\n');
      writeFileSync(join(root, 'input/fsh/nested/B.fsh'), 'Profile: B\n');
      writeFileSync(join(root, 'outside/C.fsh'), 'Profile: C\n');
      symlinkSync(join(root, 'outside'), join(root, 'input/fsh/link'));

      const files = fshCompilerInputFiles(root, join(root, 'sushi-config.yaml'))
        .map((p) => p.slice(root.length + 1));
      expect(files).toEqual([
        'input/fsh/A.fsh',
        'input/fsh/nested/B.fsh',
        'sushi-config.yaml',
        'sushi-ignoreWarnings.txt',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('passes when generated resources are newer than FSH inputs', () => {
    const root = mkdtempSync(join(tmpdir(), 'publisher-stale-pass-'));
    try {
      mkdirSync(join(root, 'input/fsh'), { recursive: true });
      mkdirSync(join(root, 'fsh-generated/resources'), { recursive: true });
      const source = join(root, 'input/fsh/A.fsh');
      const generated = join(root, 'fsh-generated/resources/StructureDefinition-A.json');
      writeFileSync(source, 'Profile: A\n');
      writeFileSync(generated, '{}\n');
      touch(source, '2026-01-01T00:00:00.000Z');
      touch(generated, '2026-01-01T00:00:01.000Z');

      const report = assertFreshGeneratedResources({
        generatedDir: join(root, 'fsh-generated/resources'),
        generatedFiles: [generated],
        inputDir: join(root, 'input/fsh'),
        inputFiles: [source],
        labelRoot: root,
      });
      expect(report.stale).toBe(false);
      expect(report.generated.count).toBe(1);
      expect(report.inputs.count).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('fails when SUSHI is skipped and generated resources are older than FSH inputs', () => {
    const root = mkdtempSync(join(tmpdir(), 'publisher-stale-fail-'));
    try {
      mkdirSync(join(root, 'input/fsh'), { recursive: true });
      mkdirSync(join(root, 'fsh-generated/resources'), { recursive: true });
      const source = join(root, 'input/fsh/A.fsh');
      const generated = join(root, 'fsh-generated/resources/StructureDefinition-A.json');
      writeFileSync(source, 'Profile: A\n');
      writeFileSync(generated, '{}\n');
      touch(source, '2026-01-01T00:00:02.000Z');
      touch(generated, '2026-01-01T00:00:01.000Z');

      expect(() => assertFreshGeneratedResources({
        generatedDir: join(root, 'fsh-generated/resources'),
        generatedFiles: [generated],
        inputDir: join(root, 'input/fsh'),
        inputFiles: [source],
        labelRoot: root,
      })).toThrow('Generated FHIR resources are stale');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('does not report stale for projects with no FSH compiler inputs', () => {
    const report = freshnessReport({
      generatedFiles: [],
      inputFiles: [],
    });
    expect(report.stale).toBe(false);
    expect(report.inputs.count).toBe(0);
    expect(report.generated.count).toBe(0);
  });
});
