import { familyDecoder } from './common.ts';
export function createOrcaWhirlpoolsDecoder(decoderVersion: string, decoderHash: string) {
  return familyDecoder({
    protocolFamily: 'ORCA_WHIRLPOOLS',
    decoderVersion,
    decoderHash,
    variants: {
      INITIALIZE_POOL: 'POOL_CREATED',
      INITIALIZE_TICK_ARRAY: 'STATE_PROGRESS',
      LIQUIDITY_CHANGE: 'LIQUIDITY_CHANGED',
      SET_CONFIG: 'CONFIG_CHANGED',
      ECONOMIC_FLOW: 'ECONOMIC_FLOW',
    },
    requiredFields: {
      INITIALIZE_POOL: ['pool', 'tickSpacing', 'sqrtPrice'],
      INITIALIZE_TICK_ARRAY: ['pool', 'startTick'],
      LIQUIDITY_CHANGE: ['pool', 'liquidity', 'tickLower', 'tickUpper'],
      SET_CONFIG: ['config'],
      ECONOMIC_FLOW: ['inputAmount', 'outputAmount', 'sqrtPrice'],
    },
  });
}
