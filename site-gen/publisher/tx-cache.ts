import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Json } from './packages';

export type TxOperation = 'ValueSet/$expand' | 'ValueSet/$validate-code' | 'CodeSystem/$validate-code' | 'CodeSystem?url';

export type TxRequest = {
  operation: TxOperation;
  fhirVersion: string;
  server: string;
  parameters: Json;
};

export type TxCacheEntry = {
  request: TxRequest;
  response: Json;
  fetchedAt?: string;
};

export type TxErrorEntry = {
  request: TxRequest;
  requestKey: string;
  cachePath: string;
  server: string;
  operationUrl: string;
  status?: number;
  statusText?: string;
  message: string;
  outcome?: Json;
  responseText?: string;
  recordedAt: string;
};

export function txTimeoutMsFromEnv(env: Record<string, string | undefined> = process.env): number {
  const value = env.PUBLISHER_TX_TIMEOUT_MS?.trim();
  if (!value) return 120_000;
  const timeoutMs = Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`PUBLISHER_TX_TIMEOUT_MS must be a positive integer number of milliseconds; got ${value}`);
  }
  return timeoutMs;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, sortJson(v)]),
  );
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function txRequestKey(request: TxRequest): string {
  return createHash('sha256').update(stableJson(request)).digest('hex');
}

export function txCachePath(cacheDir: string, request: TxRequest): string {
  const operationDir = request.operation.replace('/$', '-').replace(/[/$]/g, '-');
  return join(cacheDir, operationDir, `sha256-${txRequestKey(request)}.json`);
}

export function readTxCache(cacheDir: string, request: TxRequest): TxCacheEntry | null {
  const path = txCachePath(cacheDir, request);
  if (!existsSync(path)) return null;
  let entry: TxCacheEntry;
  try {
    entry = JSON.parse(readFileSync(path, 'utf8')) as TxCacheEntry;
  } catch (e: any) {
    recordCacheReadError(request, cacheDir, `Invalid terminology cache JSON: ${e?.message || e}`);
    throw new Error(`Invalid terminology cache entry ${path}: ${e?.message || e}`);
  }
  try {
    assertValidTxCacheEntry(request, entry);
  } catch (e: any) {
    recordCacheReadError(request, cacheDir, e?.message || String(e), entry?.response);
    throw new Error(`Invalid terminology cache entry ${path}: ${e?.message || e}`);
  }
  return entry;
}

export function writeTxCache(cacheDir: string, request: TxRequest, response: Json): string {
  assertCacheableTxResponse(request, response);
  const path = txCachePath(cacheDir, request);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${stableJson({ request, response, fetchedAt: new Date().toISOString() })}\n`);
  return path;
}

function operationOutcomeMessage(outcome: Json): string {
  const issues = Array.isArray(outcome.issue) ? outcome.issue : [];
  return issues
    .map((issue: Json) => [issue.severity, issue.code, issue.diagnostics].filter(Boolean).join(': '))
    .filter(Boolean)
    .join('; ') || 'OperationOutcome returned without issue details';
}

function txErrorLogPath(): string | null {
  if (process.env.PUBLISHER_TX_ERROR_LOG === 'off') return null;
  return process.env.PUBLISHER_TX_ERROR_LOG || join(process.cwd(), 'temp/site-gen/tx-errors.jsonl');
}

export function recordTxError(entry: Omit<TxErrorEntry, 'recordedAt'>): void {
  const path = txErrorLogPath();
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${stableJson({ ...entry, recordedAt: new Date().toISOString() })}\n`);
}

function assertCacheableTxResponse(request: TxRequest, response: Json): void {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error(`Refusing to cache terminology response for ${request.operation}: expected FHIR JSON object`);
  }
  if (response.resourceType === 'OperationOutcome') {
    throw new Error(`Refusing to cache terminology OperationOutcome for ${request.operation}: ${operationOutcomeMessage(response)}`);
  }
  if (request.operation === 'ValueSet/$expand') {
    if (response.resourceType !== 'ValueSet') {
      throw new Error(`Refusing to cache terminology response for ${request.operation}: expected ValueSet, got ${response.resourceType || 'non-FHIR JSON'}`);
    }
    if (!response.expansion || typeof response.expansion !== 'object') {
      throw new Error(`Refusing to cache terminology response for ${request.operation}: missing ValueSet.expansion`);
    }
  } else if (request.operation === 'CodeSystem?url') {
    if (response.resourceType === 'CodeSystem') return;
    if (response.resourceType === 'Bundle') {
      const requestedUrl = String(request.parameters.url || '');
      const codeSystems = (response.entry || [])
        .map((e: Json) => e.resource)
        .filter((resource: Json) => resource?.resourceType === 'CodeSystem' && (!requestedUrl || !resource.url || resource.url === requestedUrl));
      if (codeSystems.length > 0) return;
      throw new Error(`Refusing to cache terminology response for ${request.operation}: expected at least one matching CodeSystem entry, got ${codeSystems.length}`);
    }
    throw new Error(`Refusing to cache terminology response for ${request.operation}: expected Bundle or CodeSystem, got ${response.resourceType || 'non-FHIR JSON'}`);
  } else if (request.operation === 'ValueSet/$validate-code' || request.operation === 'CodeSystem/$validate-code') {
    if (response.resourceType !== 'Parameters') {
      throw new Error(`Refusing to cache terminology response for ${request.operation}: expected Parameters, got ${response.resourceType || 'non-FHIR JSON'}`);
    }
    const result = (response.parameter || []).find((p: Json) => p.name === 'result');
    if (typeof result?.valueBoolean !== 'boolean') {
      throw new Error(`Refusing to cache terminology response for ${request.operation}: missing boolean Parameters.parameter[result]`);
    }
  }
}

function assertValidTxCacheEntry(request: TxRequest, entry: TxCacheEntry): void {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error('Terminology cache entry must be a JSON object');
  }
  if (!entry.request || stableJson(entry.request) !== stableJson(request)) {
    throw new Error('Terminology cache entry request does not match the requested terminology operation');
  }
  assertCacheableTxResponse(request, entry.response);
}

function operationUrl(request: TxRequest): string {
  const server = request.server.replace(/\/+$/, '');
  switch (request.operation) {
    case 'ValueSet/$expand':
      return `${server}/ValueSet/$expand`;
    case 'ValueSet/$validate-code':
      return `${server}/ValueSet/$validate-code`;
    case 'CodeSystem/$validate-code':
      return `${server}/CodeSystem/$validate-code`;
    case 'CodeSystem?url':
      return `${server}/CodeSystem?url=${encodeURIComponent(String(request.parameters.url || ''))}`;
  }
}

function recordCacheReadError(request: TxRequest, cacheDir: string, message: string, response?: Json): void {
  const cachePath = txCachePath(cacheDir, request);
  recordTxError({
    request,
    requestKey: txRequestKey(request),
    cachePath,
    server: request.server,
    operationUrl: operationUrl(request),
    outcome: response?.resourceType === 'OperationOutcome' ? response : undefined,
    responseText: response && response.resourceType !== 'OperationOutcome' ? stableJson(response).slice(0, 2000) : undefined,
    message,
  });
}

function operationMethod(request: TxRequest): 'GET' | 'POST' {
  return request.operation === 'CodeSystem?url' ? 'GET' : 'POST';
}

async function callTerminologyServer(request: TxRequest, cacheDir: string): Promise<Json> {
  const url = operationUrl(request);
  const method = operationMethod(request);
  const timeoutMs = txTimeoutMsFromEnv();
  const cachePath = txCachePath(cacheDir, request);
  const baseError = {
    request,
    requestKey: txRequestKey(request),
    cachePath,
    server: request.server,
    operationUrl: url,
  };
  let response: Response;
  try {
    response = method === 'POST'
      ? await fetch(url, {
        method: 'POST',
        headers: {
          accept: 'application/fhir+json, application/json',
          'content-type': 'application/fhir+json',
        },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify(request.parameters),
      })
      : await fetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/fhir+json, application/json',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
  } catch (e: any) {
    recordTxError({ ...baseError, message: `Network error after ${timeoutMs}ms timeout: ${e?.message || e}` });
    throw e;
  }

  const text = await response.text();
  let json: Json;
  try {
    json = JSON.parse(text);
  } catch {
    recordTxError({
      ...baseError,
      status: response.status,
      statusText: response.statusText,
      responseText: text.slice(0, 2000),
      message: 'Terminology server returned non-JSON response',
    });
    throw new Error(`Terminology server ${url} returned non-JSON response: ${text.slice(0, 500)}`);
  }

  if (!response.ok) {
    const detail = json.resourceType === 'OperationOutcome' ? operationOutcomeMessage(json) : text.slice(0, 500);
    recordTxError({
      ...baseError,
      status: response.status,
      statusText: response.statusText,
      outcome: json.resourceType === 'OperationOutcome' ? json : undefined,
      responseText: json.resourceType === 'OperationOutcome' ? undefined : text.slice(0, 2000),
      message: `HTTP ${response.status} ${response.statusText}: ${detail}`,
    });
    throw new Error(`Terminology server ${url} failed: HTTP ${response.status} ${response.statusText}: ${detail}`);
  }

  try {
    assertCacheableTxResponse(request, json);
  } catch (e: any) {
    recordTxError({
      ...baseError,
      status: response.status,
      statusText: response.statusText,
      outcome: json.resourceType === 'OperationOutcome' ? json : undefined,
      responseText: json.resourceType === 'OperationOutcome' ? undefined : text.slice(0, 2000),
      message: e?.message || String(e),
    });
    throw new Error(`Terminology server ${url} returned an uncacheable response: ${e?.message || e}`);
  }
  return json;
}

export async function readOrFetchTx(
  request: TxRequest,
  options: { cacheDir: string; mode: 'cache' | 'online' | 'refresh' },
): Promise<{ response: Json; source: 'cache' | 'online'; cachePath: string }> {
  const cachePath = txCachePath(options.cacheDir, request);
  if (options.mode !== 'refresh') {
    const cached = readTxCache(options.cacheDir, request);
    if (cached) return { response: cached.response, source: 'cache', cachePath };
  }
  if (options.mode === 'cache') {
    throw new Error(`Missing terminology cache entry: ${cachePath}`);
  }
  const response = await callTerminologyServer(request, options.cacheDir);
  writeTxCache(options.cacheDir, request, response);
  return { response, source: 'online', cachePath };
}
