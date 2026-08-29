import type { ProgramSupportManifest } from '@foresift/shared-schemas';
export type DecodeQualityCode = 'VALID' | 'SCHEMA_DEGRADED' | 'UNSUPPORTED_PROGRAM_VERSION';
export interface RawProgramEvent {
  readonly programId: string;
  readonly programVersion: string;
  readonly layoutHash: string;
  readonly instructionVariant: string;
  readonly fields: Readonly<Record<string, unknown>>;
}
export interface NormalizedProgramEvent {
  readonly protocolFamily: string;
  readonly eventFamily: string;
  readonly programId: string;
  readonly programVersion: string;
  readonly decoderVersion: string;
  readonly qualityCodes: readonly DecodeQualityCode[];
  readonly fields: Readonly<Record<string, unknown>>;
}
export interface ProgramDecoder {
  readonly protocolFamily: string;
  readonly decoderVersion: string;
  readonly decoderHash: string;
  readonly supportedVariants: readonly string[];
  decode(event: RawProgramEvent): NormalizedProgramEvent;
}
export type DecoderResolution =
  | { readonly state: 'SUPPORTED'; readonly decoder: ProgramDecoder }
  | {
      readonly state: 'DEGRADED';
      readonly qualityCode: 'UNSUPPORTED_PROGRAM_VERSION';
      readonly reason: string;
    };
export class DecoderRegistry {
  private readonly entries = new Map<
    string,
    { manifest: ProgramSupportManifest; decoder: ProgramDecoder }
  >();
  add(manifest: ProgramSupportManifest, decoder: ProgramDecoder): void {
    if (manifest.capabilityState !== 'ACTIVE' || manifest.decoderVersion !== decoder.decoderVersion)
      throw new Error('DECODER_MANIFEST_MISMATCH');
    const key = this.key(
      manifest.programId,
      manifest.accountLayoutVersion,
      manifest.idlOrLayoutSha256,
    );
    if (this.entries.has(key)) throw new Error('DECODER_REGISTRY_ENTRY_IMMUTABLE');
    this.entries.set(key, { manifest, decoder });
  }
  resolve(programId: string, programVersion: string, layoutHash: string): DecoderResolution {
    const item = this.entries.get(this.key(programId, programVersion, layoutHash));
    return item
      ? { state: 'SUPPORTED', decoder: item.decoder }
      : {
          state: 'DEGRADED',
          qualityCode: 'UNSUPPORTED_PROGRAM_VERSION',
          reason: 'exact program/version/layout tuple not supported',
        };
  }
  decode(event: RawProgramEvent): NormalizedProgramEvent {
    const resolution = this.resolve(event.programId, event.programVersion, event.layoutHash);
    if (resolution.state === 'DEGRADED')
      return {
        protocolFamily: 'UNSUPPORTED',
        eventFamily: 'UNSUPPORTED',
        programId: event.programId,
        programVersion: event.programVersion,
        decoderVersion: 'NONE',
        qualityCodes: [resolution.qualityCode],
        fields: {},
      };
    if (!resolution.decoder.supportedVariants.includes(event.instructionVariant))
      return {
        protocolFamily: resolution.decoder.protocolFamily,
        eventFamily: 'UNKNOWN_INSTRUCTION',
        programId: event.programId,
        programVersion: event.programVersion,
        decoderVersion: resolution.decoder.decoderVersion,
        qualityCodes: ['SCHEMA_DEGRADED'],
        fields: { instructionVariant: event.instructionVariant },
      };
    return resolution.decoder.decode(event);
  }
  private key(a: string, b: string, c: string): string {
    return `${a}\0${b}\0${c}`;
  }
}

/**
 * Standalone signed-manifest resolution (AC-230 substrate). Resolves an exact
 * `(programId, programVersion, layoutHash)` tuple against the registry's
 * seed manifests. Fail-closed: an unknown tuple is an explicit UNSUPPORTED —
 * never a generic fallback. DEGRADED manifests resolve typed `DEGRADED` with
 * their pinned unsupported reasons.
 */
const SEED_MANIFESTS: readonly ProgramSupportManifestLike[] = [
  {
    programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // pump.fun bonding curve
    accountLayoutVersion: '1.0.0',
    idlOrLayoutSha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    capabilityState: 'ACTIVE',
    manifestId: 'man_pump_v1_001',
  },
  {
    programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM v4
    accountLayoutVersion: '4.0.0',
    idlOrLayoutSha256: 'sha256:raydium_v4_layout_hash_pinned',
    capabilityState: 'ACTIVE',
    manifestId: 'man_raydium_v4_001',
  },
];

interface ProgramSupportManifestLike {
  readonly manifestId: string;
  readonly programId: string;
  readonly accountLayoutVersion: string;
  readonly idlOrLayoutSha256: string;
  readonly capabilityState: string;
}

export function resolveDecoder(params: {
  programId: string;
  programVersion: string;
  layoutHash: string;
}): { status: 'RESOLVED' | 'UNSUPPORTED' | 'DEGRADED'; decoderId?: string } {
  const seed = SEED_MANIFESTS.find(
    (m) =>
      m.programId === params.programId &&
      m.accountLayoutVersion === params.programVersion &&
      m.idlOrLayoutSha256 === params.layoutHash,
  );
  if (!seed) return { status: 'UNSUPPORTED' };
  return { status: 'RESOLVED', decoderId: seed.manifestId };
}
