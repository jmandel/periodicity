type Json = Record<string, any>;

export function missingStructureDefinitionSnapshots(resources: Json[]): string[] {
  return resources
    .filter((r) => r.resourceType === 'StructureDefinition')
    .filter((r) => !Array.isArray(r.snapshot?.element) || r.snapshot.element.length === 0)
    .map((r) => `${r.id || '(no id)'}${r.url ? ` <${r.url}>` : ''}`);
}

export function assertStructureDefinitionSnapshots(resources: Json[]): void {
  const missing = missingStructureDefinitionSnapshots(resources);
  if (missing.length) {
    throw new Error([
      'StructureDefinition snapshots are required for a publisher-grade package.db.',
      'site-gen renders profile pages from Resources.Json.snapshot.element; reconstructing snapshots in the renderer is intentionally unsupported.',
      'Run the publisher with integrated SUSHI enabled, or provide snapshot-bearing StructureDefinitions with PUBLISHER_RUN_SUSHI=0.',
      `Missing snapshots: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? `, ... ${missing.length - 12} more` : ''}`,
    ].join('\n'));
  }
}
