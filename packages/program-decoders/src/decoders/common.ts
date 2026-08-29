import type {
  NormalizedProgramEvent,
  ProgramDecoder,
  RawProgramEvent,
} from '../decoder-registry.ts';
export interface FamilyDecoderDeclaration {
  readonly protocolFamily: string;
  readonly decoderVersion: string;
  readonly decoderHash: string;
  readonly variants: Readonly<Record<string, string>>;
  readonly requiredFields: Readonly<Record<string, readonly string[]>>;
}
export function familyDecoder(d: FamilyDecoderDeclaration): ProgramDecoder {
  return {
    protocolFamily: d.protocolFamily,
    decoderVersion: d.decoderVersion,
    decoderHash: d.decoderHash,
    supportedVariants: Object.keys(d.variants),
    decode(event: RawProgramEvent): NormalizedProgramEvent {
      const eventFamily = d.variants[event.instructionVariant];
      if (eventFamily === undefined) throw new Error('UNKNOWN_INSTRUCTION_VARIANT');
      const required = d.requiredFields[event.instructionVariant] ?? [];
      const missing = required.filter((f) => event.fields[f] === undefined);
      return {
        protocolFamily: d.protocolFamily,
        eventFamily,
        programId: event.programId,
        programVersion: event.programVersion,
        decoderVersion: d.decoderVersion,
        qualityCodes: missing.length === 0 ? ['VALID'] : ['SCHEMA_DEGRADED'],
        fields: missing.length === 0 ? event.fields : { ...event.fields, missingFields: missing },
      };
    },
  };
}
