import { familyDecoder } from './common.ts';
export function createPumpDecoder(decoderVersion: string, decoderHash: string) {
  return familyDecoder({
    protocolFamily: 'PUMP',
    decoderVersion,
    decoderHash,
    variants: {
      CREATE: 'LAUNCH_CREATED',
      CURVE_PROGRESS: 'STATE_PROGRESS',
      MIGRATE_TO_PUMPSWAP: 'MIGRATION',
      PUMPSWAP_LIQUIDITY: 'LIQUIDITY_CHANGED',
      SET_AUTHORITY: 'AUTHORITY_CHANGED',
      ECONOMIC_FLOW: 'ECONOMIC_FLOW',
    },
    requiredFields: {
      CREATE: ['mint', 'curve'],
      CURVE_PROGRESS: ['virtualBaseReserves', 'virtualQuoteReserves'],
      MIGRATE_TO_PUMPSWAP: ['sourcePool', 'destinationPool'],
      PUMPSWAP_LIQUIDITY: ['pool', 'liquidity'],
      SET_AUTHORITY: ['authority'],
      ECONOMIC_FLOW: ['inputAmount', 'outputAmount'],
    },
  });
}
