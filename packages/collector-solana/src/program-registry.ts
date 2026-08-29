import { canonicalJson, sha256Text } from '@foresift/persistence';
import {
  ProgramSupportManifestSchema,
  type ProgramSupportManifest,
} from '@foresift/shared-schemas';
export interface ManifestSignatureVerifier {
  verify(payload: string, approvalArtifactId: string): boolean | Promise<boolean>;
}
export interface LiveChainVerifier {
  verify(programId: string, slot: string, hash: string): boolean | Promise<boolean>;
}
export interface ProgramResolution {
  readonly state: 'SUPPORTED' | 'DEGRADED';
  readonly manifest?: ProgramSupportManifest;
  readonly qualityCode?: 'UNSUPPORTED_PROGRAM_VERSION';
  readonly reason?: string;
}
function contentPayload(manifest: ProgramSupportManifest): Record<string, unknown> {
  const { contentHash, ...payload } = manifest;
  void contentHash;
  return payload;
}
export class ProgramRegistry {
  private readonly manifests = new Map<string, ProgramSupportManifest>();
  constructor(
    private readonly signatures: ManifestSignatureVerifier,
    private readonly chain: LiveChainVerifier,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async add(value: unknown): Promise<ProgramSupportManifest> {
    const manifest = ProgramSupportManifestSchema.parse(value);
    const actual = sha256Text(canonicalJson(contentPayload(manifest)));
    if (actual !== manifest.contentHash) throw new Error('PROGRAM_MANIFEST_CONTENT_HASH_MISMATCH');
    if (
      !(await this.signatures.verify(
        canonicalJson(contentPayload(manifest)),
        manifest.approvalArtifactId,
      ))
    )
      throw new Error('PROGRAM_MANIFEST_SIGNATURE_INVALID');
    if (
      !(await this.chain.verify(
        manifest.programId,
        manifest.liveChainVerificationSlot,
        manifest.liveChainVerificationHash,
      ))
    )
      throw new Error('PROGRAM_MANIFEST_LIVE_CHAIN_INVALID');
    this.manifests.set(
      `${manifest.programId}\0${manifest.accountLayoutVersion}\0${manifest.idlOrLayoutSha256}`,
      manifest,
    );
    return manifest;
  }
  resolve(programId: string, programVersion: string, layoutHash: string): ProgramResolution {
    const manifest = this.manifests.get(`${programId}\0${programVersion}\0${layoutHash}`);
    const at = this.now().getTime();
    if (
      !manifest ||
      manifest.capabilityState !== 'ACTIVE' ||
      Date.parse(manifest.validFrom) > at ||
      (manifest.validUntil !== undefined && Date.parse(manifest.validUntil) <= at)
    )
      return {
        state: 'DEGRADED',
        qualityCode: 'UNSUPPORTED_PROGRAM_VERSION',
        reason: 'no current verified manifest for exact identifiers',
      };
    return { state: 'SUPPORTED', manifest };
  }
}
