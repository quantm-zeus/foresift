export const MAINTAINER_ACTIONS = Object.freeze([
  'RETRY_CODEX',
  'ESCALATE_CODEX',
  'RETRY_AGY_TEST',
  'REPAIR_CONTROL_PLANE',
  'SWITCH_TO_CLAUDE_AGY',
  'BLOCKED_OPERATOR_REQUIRED',
]);

const INCIDENT_TYPES = new Set([
  'retry_exhausted',
  'paused_fatal',
  'stuck_execution',
  'duplicate_authoritative_run',
  'stale_run',
  'branch_adoption_conflict',
  'dirty_worktree',
  'result_contract_violation',
  'ownership_violation',
  'codex_unavailable',
  'required_model_unavailable',
  'agy_unavailable',
  'repeated_fast_red',
  'full_red',
  'ci_red',
  'checkpoint_corruption',
  'impossible_state',
  'control_plane_invariant_violation',
]);

export function classifyWatcherEvent(event = {}) {
  const incident = INCIDENT_TYPES.has(event.type);
  return {
    incident,
    isIncident: incident,
    invokeClaude: incident,
    action: incident ? undefined : 'NONE',
    reason: incident ? event.type : 'healthy_event',
  };
}

export function createIncidentCapsule(input = {}) {
  return {
    schema: 'foresift/incident-capsule@1',
    eventId: input.eventId ?? null,
    package: input.package ?? null,
    generation: input.generation ?? 0,
    runId: input.runId ?? null,
    workflow: input.workflow ?? null,
    executionProfile: input.executionProfile ?? null,
    node: input.node ?? null,
    engine: input.engine ?? null,
    model: input.model ?? null,
    reasoning: input.reasoning ?? null,
    serviceTier: input.serviceTier ?? null,
    testEngine: input.testEngine ?? null,
    baseHead: input.baseHead ?? null,
    currentHead: input.currentHead ?? null,
    attempts: input.attempts ?? 0,
    failureClassification: input.failureClassification ?? input.type ?? 'UNKNOWN',
    failedGate: input.failedGate ?? null,
    logTail: Array.isArray(input.logTail) ? input.logTail.slice(-40) : (input.logTail ?? ''),
    diffSummary: input.diffSummary ?? null,
    artifactPointers: Array.isArray(input.artifactPointers) ? input.artifactPointers : [],
  };
}

function recommendedAction(event) {
  if (event.action && MAINTAINER_ACTIONS.includes(event.action)) return event.action;
  if (event.type === 'agy_unavailable') return 'RETRY_AGY_TEST';
  if (event.type === 'required_model_unavailable') return 'BLOCKED_OPERATOR_REQUIRED';
  if (event.type === 'codex_unavailable') return 'RETRY_CODEX';
  if (event.type === 'retry_exhausted') return 'ESCALATE_CODEX';
  if (event.type === 'control_plane_invariant_violation') return 'REPAIR_CONTROL_PLANE';
  return 'BLOCKED_OPERATOR_REQUIRED';
}

export function registerIncidentAction(state = {}, event = {}) {
  const requestedAction = event.action;
  if (requestedAction && !MAINTAINER_ACTIONS.includes(requestedAction))
    throw new Error(`INVALID_MAINTAINER_ACTION: ${requestedAction}`);
  const classification = requestedAction ? { incident: true } : classifyWatcherEvent(event);
  const seen =
    state.seenEventIds instanceof Set ? state.seenEventIds : new Set(state.seenIncidentIds ?? []);
  if (!classification.incident) return { state, invokeClaude: false, capsule: null, action: null };
  const id = event.eventId ?? `${event.type}:${event.runId ?? ''}:${event.node ?? ''}`;
  if (seen.has(id))
    return { state, invokeClaude: false, duplicate: true, capsule: null, action: null };
  seen.add(id);
  const capsule = createIncidentCapsule({ ...event, eventId: id });
  const action = recommendedAction(event);
  state.seenEventIds = seen;
  state.seenIncidentIds = [...seen];
  state.actions ??= [];
  state.actions.push({ eventId: id, action, timestamp: event.timestamp ?? Date.now() });
  return {
    state,
    invokeClaude: true,
    capsule,
    action,
  };
}
