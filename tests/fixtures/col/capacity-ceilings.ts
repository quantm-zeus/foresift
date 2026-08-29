export interface CollectorCeilingSetFixture {
  readonly ceilingSetId: string;
  readonly cpuCoreLimit: number;
  readonly memoryMbLimit: number;
  readonly networkBandwidthMbps: number;
  readonly activeSubscriptionLimit: number;
  readonly eventRatePerSecLimit: number;
  readonly rawStorageDailyMbLimit: number;
  readonly retryMaxPerHour: number;
  readonly monthlyCreditQuota: number;
  readonly sustainableContractId: string;
}

export const VALID_COLLECTOR_CEILINGS: CollectorCeilingSetFixture = {
  ceilingSetId: 'ceil_col_prod_001',
  cpuCoreLimit: 4,
  memoryMbLimit: 4096,
  networkBandwidthMbps: 100,
  activeSubscriptionLimit: 50,
  eventRatePerSecLimit: 10000,
  rawStorageDailyMbLimit: 50000,
  retryMaxPerHour: 120,
  monthlyCreditQuota: 500000,
  sustainableContractId: 'scc_prod_2026_q3',
};

export const BREACHED_COLLECTOR_CEILINGS: CollectorCeilingSetFixture = {
  ...VALID_COLLECTOR_CEILINGS,
  ceilingSetId: 'ceil_col_breached_001',
  monthlyCreditQuota: 1000, // Artificially low to induce credit quota breach
};
