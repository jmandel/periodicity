import { describe, expect, test } from 'bun:test';
import { fhirPublicationBaseForCorePackage, fhirPublicationBaseForVersion, publicationBaseForPackage } from './fhir-versions';

describe('FHIR version publication paths', () => {
  test('maps FHIR versions to publication bases', () => {
    expect(fhirPublicationBaseForVersion('3.0.2')).toBe('http://hl7.org/fhir/STU3/');
    expect(fhirPublicationBaseForVersion('4.0.1')).toBe('http://hl7.org/fhir/R4/');
    expect(fhirPublicationBaseForVersion('4.3.0')).toBe('http://hl7.org/fhir/R4B/');
    expect(fhirPublicationBaseForVersion('5.0.0')).toBe('http://hl7.org/fhir/R5/');
    expect(fhirPublicationBaseForVersion('6.0.0-ballot3')).toBe('http://hl7.org/fhir/6.0.0-ballot3/');
  });

  test('uses package manifest URL when available for core package paths', () => {
    expect(fhirPublicationBaseForCorePackage({
      name: 'hl7.fhir.r5.core',
      version: '5.0.0',
      manifest: { url: 'http://hl7.org/fhir/R5' },
    })).toBe('http://hl7.org/fhir/R5/');
    expect(fhirPublicationBaseForCorePackage({
      name: 'hl7.fhir.r6.core',
      version: '6.0.0-ballot3',
      manifest: {},
    })).toBe('http://hl7.org/fhir/6.0.0-ballot3/');
    expect(fhirPublicationBaseForCorePackage({
      name: 'example.ig',
      version: '1.0.0',
      manifest: { url: 'https://example.org' },
    })).toBeNull();
  });

  test('uses package manifest URL for non-core IG packages', () => {
    expect(publicationBaseForPackage({
      name: 'hl7.fhir.us.core',
      version: '7.0.0',
      manifest: { url: 'http://hl7.org/fhir/us/core/STU7' },
    })).toBe('http://hl7.org/fhir/us/core/STU7/');
    expect(publicationBaseForPackage({
      name: 'example.ig',
      version: '1.0.0',
      manifest: {},
    })).toBeNull();
  });
});
