import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { EXECUTION_POLICY } from './execution-profile.mjs';

export const CODEX_SERVICE_TIER = 'standard';
// Codex CLI 0.149.1's supported wire value for the standard pricing/performance
// tier is `default`. Literal `standard` is warned-and-omitted by the real CLI.
export const CODEX_CLI_SERVICE_TIER = 'default';
export const MAX_CODEX_WRITERS = 3;
// Cost-aware adaptive policy (routingPolicyVersion codex-terra-sol-agy-gemini@3):
// ordinary implementation runs on gpt-5.6-terra; every sensitive/forced-HIGH
// category (security/auth, durable recovery, concurrency, migrations, product
// safety, tenant isolation, cryptography, CRITICAL risk) stays on gpt-5.6-sol.
// Reasoning is pinned to `medium` everywhere — the quality evidence in this
// repository does not justify `high`/`xhigh` burn, and the cheapest tier
// (gpt-5.6-luna) stays DISABLED for product writers until repository tests or
// landed waves demonstrate acceptable implementation quality for it. Enable
// Luna only by adding benchmark evidence, never by editing the map alone.
export const CODEX_MODELS = Object.freeze({
  LOW: 'gpt-5.6-terra',
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
  const model = CODEX_MODELS[classification.complexityTier] ?? 'gpt-5.6-sol';
  const availabilityList = availability?.availableModels ?? availability;
  const available = availabilityList instanceof Set ? availabilityList : new Set(availabilityList);
  if (!available.has(model)) throw new Error(`REQUIRED_HIGH_MODEL_UNAVAILABLE: ${model}`);
  const reasoning = 'medium';
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

// Escalation ladder (deterministic, monotone, model-before-reasoning):
//   terra (LOW/MEDIUM) -> sol (HIGH). Once at sol the route stays at sol and
// reasoning stays at medium — repeated sol failures must trigger better
// failure evidence, smaller task decomposition, TEST_DISPUTE, or maintainer
// escalation, never an automatic high/xhigh reasoning burn.
export const CODEX_ESCALATION_LADDER = Object.freeze({
  LOW: 'MEDIUM',
  MEDIUM: 'HIGH',
  HIGH: 'HIGH',
});

export function retryCodexRoute(route) {
  const nextTier = CODEX_ESCALATION_LADDER[route.complexityTier] ?? 'HIGH';
  const model = CODEX_MODELS[nextTier] ?? CODEX_MODELS.HIGH;
  return {
    ...route,
    attempt: (route.attempt ?? 1) + 1,
    complexityTier: nextTier,
    model,
    reasoning: 'medium',
    serviceTier: CODEX_SERVICE_TIER,
    cliServiceTier: CODEX_CLI_SERVICE_TIER,
  };
}

export function escalateCodexRoute(route, availability = Object.values(CODEX_MODELS)) {
  const next = CODEX_ESCALATION_LADDER[route.complexityTier] ?? 'HIGH';
  const model = CODEX_MODELS[next] ?? CODEX_MODELS.HIGH;
  const availabilityList = availability?.availableModels ?? availability;
  const available = availabilityList instanceof Set ? availabilityList : new Set(availabilityList);
  if (!available.has(model)) throw new Error(`REQUIRED_HIGH_MODEL_UNAVAILABLE: ${model}`);
  return {
    ...route,
    complexityTier: next,
    model,
    reasoning: 'medium',
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
  // `codex debug models` slugs carry a provider prefix ("Codex API/gpt-5.6-sol",
  // "B.AI/glm-5.3-flash"), but `codex exec -m` accepts the BARE slug. The wave
  // router reasons in bare slugs (CODEX_MODELS), so normalize every entry to
  // its last path segment and keep only entries the router can name exactly.
  // Normalization must be unambiguous: two entries sharing a final segment
  // collapse to one bare name, which is still correct for exec because the
  // CLI itself resolves a bare slug to one model.
  // (Observed live 2026-08-29: run d2e29f0c5ef6704287e693ba7cfaee38 prep died
  // with REQUIRED_HIGH_MODEL_UNAVAILABLE: gpt-5.6-sol because the probe
  // returned only prefixed slugs and availability was matched exactly.)
  return new Set(
    (parsed.models ?? [])
      .map((m) => String(m.slug ?? ''))
      .filter((slug) => Object.values(CODEX_MODELS).includes(slug) || slug.includes('/'))
      .map((slug) => (slug.includes('/') ? slug.split('/').at(-1) : slug)),
  );
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
      model: EXECUTION_POLICY.agyTestModel,
      reasoning: EXECUTION_POLICY.agyTestEffort,
      providerTimeout: EXECUTION_POLICY.agyPrintTimeout,
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
