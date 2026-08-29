import { familyDecoder } from './common.ts';
export function createMeteoraDecoder(decoderVersion: string, decoderHash: string) {
  return familyDecoder({
    protocolFamily: 'METEORA',
    decoderVersion,
    decoderHash,
    variants: {
      DLMM_CREATE: 'POOL_CREATED',
      DAMM_V1_CREATE: 'POOL_CREATED',
      DAMM_V2_CREATE: 'POOL_CREATED',
      DBC_CREATE: 'LAUNCH_CREATED',
      DBC_PROGRESS: 'STATE_PROGRESS',
      DBC_MIGRATE: 'MIGRATION',
      LIQUIDITY_CHANGE: 'LIQUIDITY_CHANGED',
      SET_CONFIG: 'CONFIG_CHANGED',
      ECONOMIC_FLOW: 'ECONOMIC_FLOW',
    },
    requiredFields: {
      DLMM_CREATE: ['pool', 'binStep'],
      DAMM_V1_CREATE: ['pool'],
      DAMM_V2_CREATE: ['pool'],
      DBC_CREATE: ['mint', 'curve'],
      DBC_PROGRESS: ['progress'],
      DBC_MIGRATE: ['sourcePool', 'destinationPool'],
      LIQUIDITY_CHANGE: ['pool', 'liquidity'],
      SET_CONFIG: ['config'],
      ECONOMIC_FLOW: ['inputAmount', 'outputAmount'],
    },
  });
}
