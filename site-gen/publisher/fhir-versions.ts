import type { ResolvedPackage } from './packages';

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

export function fhirPublicationBaseForVersion(fhirVersion: string): string {
  if (fhirVersion.startsWith('3.0.')) return 'http://hl7.org/fhir/STU3/';
  if (fhirVersion.startsWith('4.0.')) return 'http://hl7.org/fhir/R4/';
  if (fhirVersion.startsWith('4.3.')) return 'http://hl7.org/fhir/R4B/';
  if (fhirVersion.startsWith('5.')) return 'http://hl7.org/fhir/R5/';
  if (fhirVersion.startsWith('6.')) return `http://hl7.org/fhir/${fhirVersion}/`;
  return ensureTrailingSlash(`http://hl7.org/fhir/${fhirVersion}`);
}

export function fhirPublicationBaseForCorePackage(pkg: Pick<ResolvedPackage, 'name' | 'version' | 'manifest'>): string | null {
  const manifestUrl = typeof pkg.manifest?.url === 'string' ? ensureTrailingSlash(pkg.manifest.url) : null;
  if (pkg.name === 'hl7.fhir.r3.core') return manifestUrl || 'http://hl7.org/fhir/STU3/';
  if (pkg.name === 'hl7.fhir.r4.core') return manifestUrl || 'http://hl7.org/fhir/R4/';
  if (pkg.name === 'hl7.fhir.r4b.core') return manifestUrl || 'http://hl7.org/fhir/R4B/';
  if (pkg.name === 'hl7.fhir.r5.core') return manifestUrl || 'http://hl7.org/fhir/R5/';
  if (pkg.name === 'hl7.fhir.r6.core') return manifestUrl || fhirPublicationBaseForVersion(pkg.version);
  return null;
}
