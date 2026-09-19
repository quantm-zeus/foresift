import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { LoadedManifest, ManifestAudit, RequirementManifest } from './types.ts';

export const SPEC_BASENAME = 'crypto_intelligence_agent_gateway_PRD_FINAL_v6.0';

/** Load the authoritative four-file artifact set without weakening validation. */
export async function loadRequirementManifest(rootDir = process.cwd()): Promise<LoadedManifest> {
  const specDir = path.join(rootDir, 'docs/spec');
  const manifestPath = path.join(specDir, `${SPEC_BASENAME}.requirements.json`);
  const auditPath = path.join(specDir, `${SPEC_BASENAME}.audit.json`);
  const documentPath = path.join(specDir, `${SPEC_BASENAME}.md`);
  const checksumsPath = path.join(specDir, 'SHA256SUMS');
  const [manifestJson, auditJson, documentText, checksumsText] = await Promise.all([
    readFile(manifestPath, 'utf8'),
    readFile(auditPath, 'utf8'),
    readFile(documentPath, 'utf8'),
    readFile(checksumsPath, 'utf8'),
  ]);
  return {
    rootDir,
    specDir,
    manifestPath,
    auditPath,
    documentPath,
    checksumsPath,
    manifest: JSON.parse(manifestJson) as RequirementManifest,
    audit: JSON.parse(auditJson) as ManifestAudit,
    documentText,
    checksumsText,
  };
}

export const loadManifest = loadRequirementManifest;
