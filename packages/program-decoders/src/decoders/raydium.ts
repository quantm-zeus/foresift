import { familyDecoder } from './common.ts';
export function createRaydiumDecoder(decoderVersion: string, decoderHash: string) {
  return familyDecoder({
    protocolFamily: 'RAYDIUM',
    decoderVersion,
    decoderHash,
    variants: {
      AMM_V4_CREATE: 'POOL_CREATED',
      CPMM_CREATE: 'POOL_CREATED',
      CLMM_CREATE: 'POOL_CREATED',
      STABLE_CREATE: 'POOL_CREATED',
      LAUNCHLAB_CREATE: 'LAUNCH_CREATED',
      LAUNCHLAB_PROGRESS: 'STATE_PROGRESS',
      LAUNCHLAB_MIGRATE: 'MIGRATION',
      LIQUIDITY_CHANGE: 'LIQUIDITY_CHANGED',
      CONFIG_CHANGE: 'CONFIG_CHANGED',
      ECONOMIC_FLOW: 'ECONOMIC_FLOW',
    },
    requiredFields: {
      AMM_V4_CREATE: ['pool'],
      CPMM_CREATE: ['pool'],
      CLMM_CREATE: ['pool', 'tickSpacing'],
      STABLE_CREATE: ['pool', 'amplification'],
      LAUNCHLAB_CREATE: ['mint'],
      LAUNCHLAB_PROGRESS: ['progress'],
      LAUNCHLAB_MIGRATE: ['sourcePool', 'destinationPool'],
      LIQUIDITY_CHANGE: ['pool', 'liquidity'],
      CONFIG_CHANGE: ['config'],
      ECONOMIC_FLOW: ['inputAmount', 'outputAmount'],
    },
  });
}
