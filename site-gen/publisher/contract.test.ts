import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { assertPackageDbContract, packageDbContractErrors } from './contract';
import { createPackageDbSchema } from './schema';

describe('package DB contract', () => {
  test('accepts the Bun publisher schema', () => {
    const db = new Database(':memory:');
    createPackageDbSchema(db);
    expect(packageDbContractErrors(db)).toEqual([]);
    expect(() => assertPackageDbContract(db)).not.toThrow();
  });

  test('reports a missing required table', () => {
    const db = new Database(':memory:');
    expect(packageDbContractErrors(db)).toContain('missing table Resources');
  });

  test('reports missing required columns', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE Resources (Key INTEGER)');
    const errors = packageDbContractErrors(db);
    expect(errors).toContain('missing column Resources.Type');
    expect(errors).toContain('missing column Resources.Json');
  });
});
