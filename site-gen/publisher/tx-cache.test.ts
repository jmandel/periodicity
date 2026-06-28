import { afterEach, describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readOrFetchTx, txCachePath, txTimeoutMsFromEnv, type TxRequest } from './tx-cache';

const originalFetch = globalThis.fetch;
const originalErrorLog = process.env.PUBLISHER_TX_ERROR_LOG;
const originalTxTimeout = process.env.PUBLISHER_TX_TIMEOUT_MS;

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function request(server = 'https://tx.example.org/r4'): TxRequest {
  return {
    operation: 'ValueSet/$expand',
    fhirVersion: '4.0.1',
    server,
    parameters: {
      resourceType: 'Parameters',
      parameter: [
        {
          name: 'valueSet',
          resource: {
            resourceType: 'ValueSet',
            url: 'https://example.org/ValueSet/filter',
            compose: {
              include: [
                { system: 'http://snomed.info/sct', filter: [{ property: 'concept', op: 'is-a', value: '404684003' }] },
              ],
            },
          },
        },
      ],
    },
  };
}

function codeSystemRequest(server = 'https://tx.example.org/r4'): TxRequest {
  return {
    operation: 'CodeSystem?url',
    fhirVersion: '4.0.1',
    server,
    parameters: { url: 'http://standardterms.edqm.eu' },
  };
}

function valueSetValidateRequest(server = 'https://tx.example.org/r4'): TxRequest {
  return {
    operation: 'ValueSet/$validate-code',
    fhirVersion: '4.0.1',
    server,
    parameters: {
      resourceType: 'Parameters',
      parameter: [
        { name: 'url', valueUri: 'https://example.org/ValueSet/symptoms' },
        { name: 'system', valueUri: 'http://snomed.info/sct' },
        { name: 'code', valueCode: '25064002' },
      ],
    },
  };
}

function codeSystemValidateRequest(server = 'https://tx.example.org/r4'): TxRequest {
  return {
    operation: 'CodeSystem/$validate-code',
    fhirVersion: '4.0.1',
    server,
    parameters: {
      resourceType: 'Parameters',
      parameter: [
        { name: 'url', valueUri: 'http://snomed.info/sct' },
        { name: 'code', valueCode: '25064002' },
      ],
    },
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalErrorLog === undefined) delete process.env.PUBLISHER_TX_ERROR_LOG;
  else process.env.PUBLISHER_TX_ERROR_LOG = originalErrorLog;
  if (originalTxTimeout === undefined) delete process.env.PUBLISHER_TX_TIMEOUT_MS;
  else process.env.PUBLISHER_TX_TIMEOUT_MS = originalTxTimeout;
});

describe('terminology cache hygiene', () => {
  test('parses terminology fetch timeout', () => {
    expect(txTimeoutMsFromEnv({})).toBe(120_000);
    expect(txTimeoutMsFromEnv({ PUBLISHER_TX_TIMEOUT_MS: '30000' })).toBe(30_000);
    expect(() => txTimeoutMsFromEnv({ PUBLISHER_TX_TIMEOUT_MS: '0' })).toThrow('PUBLISHER_TX_TIMEOUT_MS');
    expect(() => txTimeoutMsFromEnv({ PUBLISHER_TX_TIMEOUT_MS: 'later' })).toThrow('PUBLISHER_TX_TIMEOUT_MS');
  });

  test('passes an abort signal to terminology server fetches', async () => {
    const dir = tempDir('tx-cache-signal-');
    process.env.PUBLISHER_TX_TIMEOUT_MS = '45000';
    const req = request();
    let receivedSignal = false;
    globalThis.fetch = async (_url, init) => {
      receivedSignal = init?.signal instanceof AbortSignal;
      return new Response(JSON.stringify({
        resourceType: 'ValueSet',
        expansion: { total: 0, contains: [] },
      }), { status: 200, statusText: 'OK' });
    };

    try {
      await readOrFetchTx(req, { cacheDir: dir, mode: 'online' });
      expect(receivedSignal).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('does not cache HTTP failures and records an error log entry', async () => {
    const dir = tempDir('tx-cache-http-error-');
    const errorLog = join(dir, 'errors.jsonl');
    process.env.PUBLISHER_TX_ERROR_LOG = errorLog;
    const req = request();
    globalThis.fetch = async () => new Response(JSON.stringify({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'exception', diagnostics: 'upstream timeout' }],
    }), { status: 504, statusText: 'Gateway Timeout' });

    try {
      await expect(readOrFetchTx(req, { cacheDir: dir, mode: 'online' })).rejects.toThrow('HTTP 504');
      expect(existsSync(txCachePath(dir, req))).toBe(false);
      const lines = readFileSync(errorLog, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0]);
      expect(entry.requestKey).toBeTruthy();
      expect(entry.status).toBe(504);
      expect(entry.message).toContain('upstream timeout');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('does not cache network failures and records an error log entry', async () => {
    const dir = tempDir('tx-cache-network-error-');
    const errorLog = join(dir, 'errors.jsonl');
    process.env.PUBLISHER_TX_ERROR_LOG = errorLog;
    process.env.PUBLISHER_TX_TIMEOUT_MS = '25000';
    const req = request();
    globalThis.fetch = async () => {
      throw new Error('socket closed');
    };

    try {
      await expect(readOrFetchTx(req, { cacheDir: dir, mode: 'online' })).rejects.toThrow('socket closed');
      expect(existsSync(txCachePath(dir, req))).toBe(false);
      const lines = readFileSync(errorLog, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0]);
      expect(entry.requestKey).toBeTruthy();
      expect(entry.message).toContain('Network error after 25000ms timeout');
      expect(entry.message).toContain('socket closed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('does not cache 200 OperationOutcome responses', async () => {
    const dir = tempDir('tx-cache-operation-outcome-');
    const errorLog = join(dir, 'errors.jsonl');
    process.env.PUBLISHER_TX_ERROR_LOG = errorLog;
    const req = request();
    globalThis.fetch = async () => new Response(JSON.stringify({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'not-supported', diagnostics: 'too-costly' }],
    }), { status: 200, statusText: 'OK' });

    try {
      await expect(readOrFetchTx(req, { cacheDir: dir, mode: 'online' })).rejects.toThrow('uncacheable');
      expect(existsSync(txCachePath(dir, req))).toBe(false);
      expect(readFileSync(errorLog, 'utf8')).toContain('too-costly');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects cached OperationOutcome responses without fetching', async () => {
    const dir = tempDir('tx-cache-poisoned-outcome-');
    const errorLog = join(dir, 'errors.jsonl');
    process.env.PUBLISHER_TX_ERROR_LOG = errorLog;
    const req = request();
    const cachePath = txCachePath(dir, req);
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify({
      request: req,
      response: {
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'not-supported', diagnostics: 'cached upstream failure' }],
      },
    }));
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount++;
      throw new Error('must not fetch when cache entry exists but is invalid');
    };

    try {
      await expect(readOrFetchTx(req, { cacheDir: dir, mode: 'cache' })).rejects.toThrow('Invalid terminology cache entry');
      expect(fetchCount).toBe(0);
      expect(readFileSync(errorLog, 'utf8')).toContain('cached upstream failure');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects cache entries whose embedded request does not match', async () => {
    const dir = tempDir('tx-cache-request-mismatch-');
    const errorLog = join(dir, 'errors.jsonl');
    process.env.PUBLISHER_TX_ERROR_LOG = errorLog;
    const req = request();
    const otherReq = request('https://tx.other.example.org/r4');
    const cachePath = txCachePath(dir, req);
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify({
      request: otherReq,
      response: {
        resourceType: 'ValueSet',
        expansion: { contains: [] },
      },
    }));

    try {
      await expect(readOrFetchTx(req, { cacheDir: dir, mode: 'cache' })).rejects.toThrow('request does not match');
      expect(readFileSync(errorLog, 'utf8')).toContain('request does not match');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('caches successful ValueSet expansions', async () => {
    const dir = tempDir('tx-cache-success-');
    process.env.PUBLISHER_TX_ERROR_LOG = join(dir, 'errors.jsonl');
    const req = request();
    globalThis.fetch = async () => new Response(JSON.stringify({
      resourceType: 'ValueSet',
      expansion: {
        total: 1,
        contains: [
          { system: 'http://snomed.info/sct', code: '25064002', display: 'Headache' },
        ],
      },
    }), { status: 200, statusText: 'OK' });

    try {
      const result = await readOrFetchTx(req, { cacheDir: dir, mode: 'online' });
      expect(result.source).toBe('online');
      expect(existsSync(txCachePath(dir, req))).toBe(true);
      expect(existsSync(process.env.PUBLISHER_TX_ERROR_LOG!)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('caches successful CodeSystem metadata searches', async () => {
    const dir = tempDir('tx-cache-codesystem-success-');
    process.env.PUBLISHER_TX_ERROR_LOG = join(dir, 'errors.jsonl');
    const req = codeSystemRequest();
    let requestedUrl = '';
    globalThis.fetch = async (url) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify({
        resourceType: 'Bundle',
        total: 1,
        entry: [
          {
            resource: {
              resourceType: 'CodeSystem',
              url: 'http://standardterms.edqm.eu',
              version: '5 February 2025',
              name: 'EDQM_Standard_Terms',
            },
          },
        ],
      }), { status: 200, statusText: 'OK' });
    };

    try {
      const result = await readOrFetchTx(req, { cacheDir: dir, mode: 'online' });
      expect(result.source).toBe('online');
      expect(requestedUrl).toContain('/CodeSystem?url=http%3A%2F%2Fstandardterms.edqm.eu');
      expect(existsSync(txCachePath(dir, req))).toBe(true);
      expect(existsSync(process.env.PUBLISHER_TX_ERROR_LOG!)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('does not cache empty CodeSystem metadata search results', async () => {
    const dir = tempDir('tx-cache-codesystem-empty-');
    const errorLog = join(dir, 'errors.jsonl');
    process.env.PUBLISHER_TX_ERROR_LOG = errorLog;
    const req = codeSystemRequest();
    globalThis.fetch = async () => new Response(JSON.stringify({
      resourceType: 'Bundle',
      total: 0,
      entry: [],
    }), { status: 200, statusText: 'OK' });

    try {
      await expect(readOrFetchTx(req, { cacheDir: dir, mode: 'online' })).rejects.toThrow('uncacheable');
      expect(existsSync(txCachePath(dir, req))).toBe(false);
      expect(readFileSync(errorLog, 'utf8')).toContain('expected exactly one CodeSystem entry');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('caches successful ValueSet validate-code results, including false results', async () => {
    const dir = tempDir('tx-cache-vs-validate-');
    process.env.PUBLISHER_TX_ERROR_LOG = join(dir, 'errors.jsonl');
    const req = valueSetValidateRequest();
    let requestedUrl = '';
    globalThis.fetch = async (url) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify({
        resourceType: 'Parameters',
        parameter: [
          { name: 'result', valueBoolean: false },
          { name: 'message', valueString: 'Code is not in the value set' },
        ],
      }), { status: 200, statusText: 'OK' });
    };

    try {
      const result = await readOrFetchTx(req, { cacheDir: dir, mode: 'online' });
      expect(result.source).toBe('online');
      expect(requestedUrl).toBe('https://tx.example.org/r4/ValueSet/$validate-code');
      expect(existsSync(txCachePath(dir, req))).toBe(true);
      expect(existsSync(process.env.PUBLISHER_TX_ERROR_LOG!)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('caches successful CodeSystem validate-code results', async () => {
    const dir = tempDir('tx-cache-cs-validate-');
    process.env.PUBLISHER_TX_ERROR_LOG = join(dir, 'errors.jsonl');
    const req = codeSystemValidateRequest();
    let requestedUrl = '';
    globalThis.fetch = async (url) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify({
        resourceType: 'Parameters',
        parameter: [
          { name: 'result', valueBoolean: true },
          { name: 'display', valueString: 'Headache' },
        ],
      }), { status: 200, statusText: 'OK' });
    };

    try {
      const result = await readOrFetchTx(req, { cacheDir: dir, mode: 'online' });
      expect(result.source).toBe('online');
      expect(requestedUrl).toBe('https://tx.example.org/r4/CodeSystem/$validate-code');
      expect(existsSync(txCachePath(dir, req))).toBe(true);
      expect(existsSync(process.env.PUBLISHER_TX_ERROR_LOG!)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('does not cache malformed validate-code responses', async () => {
    const dir = tempDir('tx-cache-validate-malformed-');
    const errorLog = join(dir, 'errors.jsonl');
    process.env.PUBLISHER_TX_ERROR_LOG = errorLog;
    const req = valueSetValidateRequest();
    globalThis.fetch = async () => new Response(JSON.stringify({
      resourceType: 'Parameters',
      parameter: [
        { name: 'message', valueString: 'missing result' },
      ],
    }), { status: 200, statusText: 'OK' });

    try {
      await expect(readOrFetchTx(req, { cacheDir: dir, mode: 'online' })).rejects.toThrow('uncacheable');
      expect(existsSync(txCachePath(dir, req))).toBe(false);
      expect(readFileSync(errorLog, 'utf8')).toContain('missing boolean Parameters.parameter[result]');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
