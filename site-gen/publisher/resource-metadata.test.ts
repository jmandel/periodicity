import { describe, expect, test } from 'bun:test';
import { applyGlobalResourceMetadata, canonicalUrlForResource, configuredContact } from './resource-metadata';

describe('publisher resource metadata enrichment', () => {
  const cfg = {
    canonical: 'http://example.org/ig',
    version: '1.2.3',
    publisher: {
      name: 'Example Publisher',
      url: 'https://example.org/team',
    },
    contact: [{
      telecom: [{ system: 'url', value: 'https://example.org/contact' }],
    }],
    parameters: {
      'apply-publisher': true,
      'apply-contact': true,
    },
  };

  test('derives canonical URLs for canonical resources with an id', () => {
    expect(canonicalUrlForResource({ resourceType: 'Questionnaire', id: 'rxterms' }, cfg)).toBe('http://example.org/ig/Questionnaire/rxterms');
    expect(canonicalUrlForResource({ resourceType: 'Patient', id: 'example' }, cfg)).toBeNull();
  });

  test('applies Publisher-style common metadata to canonical resources', () => {
    const enriched = applyGlobalResourceMetadata(
      { resourceType: 'CodeSystem', id: 'answer-constraint', status: 'active' },
      cfg,
      new Date('2026-01-02T03:04:05Z'),
    );

    expect(enriched).toMatchObject({
      resourceType: 'CodeSystem',
      id: 'answer-constraint',
      url: 'http://example.org/ig/CodeSystem/answer-constraint',
      version: '1.2.3',
      publisher: 'Example Publisher',
      status: 'active',
      contact: cfg.contact,
    });
    expect(enriched.date).toMatch(/^2026-01-0[12]T/);
  });

  test('enriches resources with canonical URLs even when the resource type is newer than the local type list', () => {
    const enriched = applyGlobalResourceMetadata(
      { resourceType: 'ActorDefinition', id: 'server', url: 'http://example.org/ActorDefinition/server', version: '2.0' },
      cfg,
      new Date('2026-01-02T03:04:05Z'),
    );

    expect(enriched.version).toBe('1.2.3');
    expect(enriched.publisher).toBe('Example Publisher');
    expect(enriched.url).toBe('http://example.org/ActorDefinition/server');
  });

  test('uses explicit config contact before deriving contact from publisher metadata', () => {
    expect(configuredContact(cfg)).toEqual(cfg.contact);
    expect(configuredContact({ publisher: cfg.publisher })).toEqual([{
      name: 'Example Publisher',
      telecom: [{ system: 'url', value: 'https://example.org/team' }],
    }]);
  });
});
