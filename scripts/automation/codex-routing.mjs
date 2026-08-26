import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { EXECUTION_POLICY } from './execution-profile.mjs';

export const CODEX_SERVICE_TIER = 'standard';
// Codex CLI 0.149.1's supported wire value for the standard pricing/performance
// tier is `default`. Literal `standard` is warned-and-omitted by the real CLI.
export const CODEX_CLI_SERVICE_TIER = 'default';
export const MAX_CODEX_WRITERS = 3;
export const CODEX_MODELS = Object.freeze({
  LOW: 'gpt-5.6-luna',
  MEDIUM: 'gpt-5.6-terra',
  HIGH: 'gpt-5.6-sol',
});

const SENSITIVE = [
  ['security/auth', /\b(?:security|auth(?:n|z)?|credential|permission)\b/i],
  ['durable recovery', /\b(?:durable|recovery|idempoten|checkpoint|state machine)\b/i],
  ['concurrency', /\b(?:concurr\w*|race|lock|atomic|single[- ]flight)\b/i],
  ['migration', /\b(?:migration|schema change|irreversible)\b/i],
  ['product safety', /\b(?:product safety|safety boundary|prohibited|fail[- ]closed)\b/i],
  ['tenant isolation', /\btenant isolation\b/i],
  ['cryptography', /\b(?:cryptograph|crypto|signing|private key)\b/i],
];

function unitText(units = []) {
  return units.map((u) => `${u.body ?? ''} ${(u.predictedWrites ?? []).join(' ')}`).join('\n');
}

export function classifyCodexLane(input = {}) {
  const requestedTier = input.complexityTier ? String(input.complexityTier).toUpperCase() : null;
  const risk = String(input.packageRisk ?? input.risk ?? requestedTier ?? 'MEDIUM').toUpperCase();
  const units = input.units ?? [];
  const taskIds = input.taskIds ?? units.map((u) => u.id).filter(Boolean);
  const text = `${unitText(units)} ${(input.files ?? []).join(' ')} ${(input.domains ?? []).join(' ')}`;
  let score = { LOW: 0, MEDIUM: 3, HIGH: 6, CRITICAL: 10 }[risk] ?? 3;
  const routingReasons = [`package risk ${risk}`];
  if (taskIds.length >= 3) {
    score += 2;
    routingReasons.push(`${taskIds.length} task ids`);
  }
  const acCount = new Set(units.flatMap((u) => u.acceptanceCriteria ?? [])).size;
  if (acCount >= 4) {
    score += 1;
    routingReasons.push(`${acCount} acceptance criteria`);
  }
  const paths = new Set(units.flatMap((u) => u.predictedWrites ?? []));
  if (paths.size >= 5) {
    score += 1;
    routingReasons.push(`${paths.size} affected paths`);
  }
  const forcedReasons = [];
  for (const [reason, re] of SENSITIVE) if (re.test(text)) forcedReasons.push(reason);
  if (risk === 'CRITICAL') forcedReasons.unshift('CRITICAL task');
  if (forcedReasons.length) routingReasons.push(...forcedReasons.map((r) => `forced HIGH: ${r}`));
  const complexityTier = forcedReasons.length
    ? 'HIGH'
    : requestedTier && ['LOW', 'MEDIUM', 'HIGH'].includes(requestedTier)
      ? requestedTier
      : score <= 2
        ? 'LOW'
        : score <= 7
          ? 'MEDIUM'
          : 'HIGH';
  return { score, complexityTier, routingReasons, forcedHigh: forcedReasons.length > 0 };
}

export function routeCodexLane(input = {}, availability = Object.values(CODEX_MODELS)) {
  const classification = classifyCodexLane(input);
  const model = CODEX_MODELS[classification.complexityTier];
  const availabilityList = availability?.availableModels ?? availability;
  const available = availabilityList instanceof Set ? availabilityList : new Set(availabilityList);
  if (!available.has(model))
    throw new Error(
      `${classification.complexityTier === 'HIGH' ? 'REQUIRED_HIGH_MODEL_UNAVAILABLE' : 'CODEX_MODEL_UNAVAILABLE'}: ${model}`,
    );
  const reasoning =
    classification.complexityTier === 'LOW'
      ? 'low'
      : classification.complexityTier === 'MEDIUM'
        ? 'medium'
        : classification.routingReasons.some((r) =>
              /CRITICAL|cryptography|tenant isolation/.test(r),
            )
          ? 'xhigh'
          : 'high';
  return {
    lane: input.lane ?? 'core',
    taskIds: [...(input.taskIds ?? (input.units ?? []).map((u) => u.id).filter(Boolean))],
    ...classification,
    model,
    reasoning,
    serviceTier: CODEX_SERVICE_TIER,
    cliServiceTier: CODEX_CLI_SERVICE_TIER,
    attempt: input.attempt ?? 1,
    escalation: input.escalation ?? 0,
  };
}

export function retryCodexRoute(route) {
  return {
    ...route,
    attempt: (route.attempt ?? 1) + 1,
    serviceTier: CODEX_SERVICE_TIER,
    cliServiceTier: CODEX_CLI_SERVICE_TIER,
  };
}

export function escalateCodexRoute(route, availability = Object.values(CODEX_MODELS)) {
  const next = route.complexityTier === 'LOW' ? 'MEDIUM' : 'HIGH';
  const model = CODEX_MODELS[next];
  if (!(availability instanceof Set ? availability : new Set(availability)).has(model))
    throw new Error(
      `${next === 'HIGH' ? 'REQUIRED_HIGH_MODEL_UNAVAILABLE' : 'CODEX_MODEL_UNAVAILABLE'}: ${model}`,
    );
  return {
    ...route,
    complexityTier: next,
    model,
    reasoning: next === 'MEDIUM' ? 'medium' : 'high',
    serviceTier: CODEX_SERVICE_TIER,
    cliServiceTier: CODEX_CLI_SERVICE_TIER,
    escalation: (route.escalation ?? 0) + 1,
  };
}

export function codexWriterCount(graph = {}) {
  const groups = graph.productShards ?? graph.shards ?? [];
  return Math.min(
    MAX_CODEX_WRITERS,
    groups.filter((g) => !Object.hasOwn(g, 'units') || g.units.length > 0).length,
  );
}

export function buildCodexExecArgs(route, { worktree }) {
  if (
    route.serviceTier !== CODEX_SERVICE_TIER ||
    (route.cliServiceTier !== undefined && route.cliServiceTier !== CODEX_CLI_SERVICE_TIER)
  )
    throw new Error('INVALID_CODEX_SERVICE_TIER');
  return [
    'codex',
    'exec',
    '--json',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--dangerously-bypass-approvals-and-sandbox',
    '-m',
    route.model,
    '-c',
    `model_reasoning_effort=${route.reasoning}`,
    '-c',
    `service_tier="${CODEX_CLI_SERVICE_TIER}"`,
    '-C',
    worktree,
    '-',
  ];
}

export function installedCodexModels(binary = 'codex') {
  const r = spawnSync(binary, ['debug', 'models'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`CODEX_MODEL_PROBE_FAILED: ${(r.stderr ?? '').slice(-200)}`);
  const parsed = JSON.parse(r.stdout);
  return new Set((parsed.models ?? []).map((m) => m.slug));
}

export function buildWaveRouting(
  graph,
  executionProfile,
  availability = Object.values(CODEX_MODELS),
) {
  const implementationEngine = executionProfile === 'CODEX_AGY' ? 'CODEX' : 'CLAUDE';
  const lanes = [];
  for (const shard of graph.shards ?? []) {
    const units = (shard.units ?? [])
      .map((id) => graph.units.find((u) => u.id === id))
      .filter(Boolean);
    if (implementationEngine === 'CODEX') {
      lanes.push({
        role: 'implementation',
        engine: 'CODEX',
        ...routeCodexLane(
          { lane: shard.id, taskIds: shard.units, units, packageRisk: graph.package?.risk },
          availability,
        ),
      });
    } else {
      lanes.push({
        lane: shard.id,
        role: 'implementation',
        taskIds: [...shard.units],
        engine: 'CLAUDE',
        complexityTier: graph.package?.risk === 'LOW' ? 'LOW' : 'HIGH',
        model: null,
        reasoning: null,
        serviceTier: null,
      });
    }
  }
  for (const testLane of graph.testLanes ?? [])
    lanes.push({
      lane: testLane.id,
      role: 'test',
      taskIds: [...testLane.units],
      engine: 'AGY',
      complexityTier: null,
      model: null,
      reasoning: null,
      serviceTier: null,
    });
  return {
    schema: 'foresift/wave-routing@1',
    routingPolicyVersion: EXECUTION_POLICY.routingPolicyVersion,
    executionProfile,
    implementationEngine,
    testEngine: 'AGY',
    maxCodexWriters: MAX_CODEX_WRITERS,
    codexWriterCount: implementationEngine === 'CODEX' ? codexWriterCount(graph) : 0,
    lanes,
  };
}

function cli() {
  const argv = process.argv.slice(2);
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (argv.includes('--build-wave')) {
    const graph = JSON.parse(readFileSync(value('--graph'), 'utf8'));
    const profile = value('--profile');
    const availability =
      profile === 'CODEX_AGY' ? installedCodexModels() : Object.values(CODEX_MODELS);
    const routing = buildWaveRouting(graph, profile, availability);
    const out = value('--out');
    if (out) writeFileSync(out, JSON.stringify(routing, null, 2) + '\n');
    process.stdout.write(JSON.stringify(routing) + '\n');
    return;
  }
  console.error(
    'usage: codex-routing.mjs --build-wave --graph file --profile PROFILE [--out file]',
  );
  process.exit(2);
}

if (process.argv[1]?.endsWith('codex-routing.mjs')) cli();
