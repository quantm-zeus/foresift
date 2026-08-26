// Package entrypoint — the Shared Tool Core (PRD §16): registry + exact
// 24-stage execution pipeline + result envelope, with quota/cost and license
// semantics behind stable dependency-injection seams implemented OUTSIDE this
// package (FR-CORE-001…008). This file is THE public surface.
export { createToolCore } from './engine.ts';
export type { ToolCore, ToolCoreConfig, ToolRouteBinding } from './engine.ts';

export { ToolCoreRegistry } from './registry.ts';
export type { RegisteredTool, RegistryEntry, RegistrySnapshot } from './registry.ts';
export { RUNTIME_STAGE_SEQUENCE, PipelineOrchestrator } from './pipeline.ts';
export type { PipelineHandlers, PipelineRunState, StageHandler } from './pipeline.ts';
export type {
  ToolExecutionRequest,
  ToolAuthorizationEnvelope,
  DeterministicAcquisitionDecision,
  ActorIdentity,
  BlockedExit,
  RefusedAcquisitionState,
  StageJournalEntry,
  ToolRunContext,
} from './run-context.ts';
export type {
  AuthnPrimitive,
  AuthzPrimitive,
  AuthnStageDeps,
  AuthorizeStageDeps,
} from './stages/authn.ts';
export { DenyClosedAuthn, DenyClosedAuthz } from './stages/authn.ts';
export type {
  OperationRoute,
  ReadOnlyOperationAdapter,
  NormalizedObservation,
  NormalizedResult,
  PayloadNormalizer,
  ProviderCallRequest,
  ProviderRawResponse,
  SchemaLike,
} from './provider-contract.ts';
export type { LicensePolicySource, LicenseQuery } from './license-contract.ts';
export { UnverifiableRightsRefusedSource } from './license-contract.ts';
export type {
  QuotaReservationAdapter,
  QuotaEstimate,
  QuotaEstimateRequest,
  QuotaAdmissionDecision,
  ReservationRequest,
} from './quota-contract.ts';
export type { BackpressureDecision, BackpressurePolicy } from './stages/quota.ts';
export { defaultBackpressurePolicy } from './stages/quota.ts';
export type { EgressAuthorizer, ExecutionGate, ExecutionGateInput } from './stages/dispatch.ts';
export { ProhibitedCapabilityScreen } from './prohibited.ts';
export type {
  ProhibitedRefusalEvent,
  ProhibitedRefusalSink,
  ScreenVerdict,
  ScreenedDefinitionText,
} from './prohibited.ts';
