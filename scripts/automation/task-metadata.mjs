// Explicit task executor/kind metadata (Hyperdrive H3, P0/P1-5).
//
// Tasks are markdown checkbox units in specs/<package>/tasks.md. The marker
// `[executor: X]` in the task line — matching the existing `[P]` marker
// style — declares WHO executes the task:
//
//   [executor: PRODUCT]      an AI product writer lane (codex/claude)
//   [executor: TEST]         an AI test-author lane (agy)
//   [executor: COORDINATOR]  zero-AI mechanical bookkeeping performed by the
//                            wave coordinator (kind = MECHANICAL_BOOKKEEPING)
//
// Body-string matching ("does the body name the manifest path?") is REMOVED
// as the classifier: an explicit marker fails closed — a task with an
// UNRECOGNIZED executor value (or a kind value the vocabulary does not know)
// is a hard error at graph build time, never silently routed to a writer.
// A missing marker defaults to PRODUCT for backward compatibility with
// already-landed plans.
//
// Zero AI: classification is deterministic token parsing.

export const TASK_EXECUTORS = Object.freeze(['PRODUCT', 'TEST', 'COORDINATOR']);
export const TASK_KINDS = Object.freeze([
  'MECHANICAL_BOOKKEEPING',
  'IMPLEMENTATION',
  'TEST_AUTHORING',
]);

/**
 * Non-file task-completion evidence kinds (Hyperdrive H3 mission item 10).
 *
 * The P0-1 completion protocol evidences a task through its predicted WRITES:
 * a task whose unit declares no predicted paths can never be completed by a
 * diff — it would stay open forever even when genuinely done (live examples
 * in g0-traceability-conformance: "run the generator to produce
 * docs/generated/**", "run the full gate", "close the traceability matrix").
 *
 * A task may declare `[evidence: KIND]` to opt into a non-file proof:
 *
 *   VERIFICATION_ONLY        completion proof = a named verification command
 *                            exiting 0 on the canonical tree (gate runs)
 *   COORDINATOR_ARTIFACT     completion proof = a coordinator-generated
 *                            artifact existing/up-to-date (manifest regen,
 *                            generated docs)
 *   NO_OP_ALREADY_SATISFIED  completion proof = the deliverable already
 *                            exists and satisfies the task (dedupe with a
 *                            landed sibling); requires an explicit reason
 *
 * FILE_OUTPUT (the default, implicit) and TEST_PROOF (testWrites exist in
 * the lane diff) are the P0-1 file-truth kinds — they stay the default and
 * need no marker. SHARED_SURFACE_OUTPUT is expressed through the exact-lease
 * manager, not a marker. An UNKNOWN evidence value fails closed at graph
 * build time; the completion validator treats a task with an unrecognized
 * (or missing) evidence requirement exactly like today: OPEN, never
 * completed by model text.
 */
export const TASK_EVIDENCE_KINDS = Object.freeze([
  'FILE_OUTPUT',
  'TEST_PROOF',
  'VERIFICATION_ONLY',
  'COORDINATOR_ARTIFACT',
  'NO_OP_ALREADY_SATISFIED',
  'SHARED_SURFACE_OUTPUT',
]);

const EVIDENCE_MARKER = /\[evidence:\s*([A-Za-z_-]+)\]/;

const EXECUTOR_MARKER = /\[executor:\s*([A-Za-z_-]+)\]/;
const KIND_MARKER = /\[kind:\s*([A-Za-z_-]+)\]/;

/**
 * Parse the executor/kind markers from a raw task line. Returns
 * { executor, kind, raw } where executor/kind are null when absent —
 * callers decide the default and whether absence is legal.
 */
export function parseTaskMetadata(taskLine) {
  const text = String(taskLine ?? '');
  const executorMatch = EXECUTOR_MARKER.exec(text);
  const kindMatch = KIND_MARKER.exec(text);
  const evidenceMatch = EVIDENCE_MARKER.exec(text);
  return {
    executor: executorMatch ? executorMatch[1].toUpperCase() : null,
    kind: kindMatch ? kindMatch[1].toUpperCase() : null,
    evidence: evidenceMatch ? evidenceMatch[1].toUpperCase() : null,
    raw: text,
  };
}

/**
 * Validate + normalize a parsed unit's metadata (fail-closed):
 *   - unknown executor value ⇒ throws TASK_EXECUTOR_UNKNOWN
 *   - unknown kind value ⇒ throws TASK_KIND_UNKNOWN
 *   - a COORDINATOR task MUST declare kind MECHANICAL_BOOKKEEPING and may
 *     never be dispatched to an AI lane;
 *   - a non-COORDINATOR task with MECHANICAL_BOOKKEEPING kind ⇒ throws
 *     (kind is meaningless for AI-executed tasks);
 *   - absent executor defaults to PRODUCT (legacy plans); an absent kind is
 *     derived (COORDINATOR ⇒ MECHANICAL_BOOKKEEPING; TEST ⇒ TEST_AUTHORING;
 *     PRODUCT ⇒ IMPLEMENTATION).
 */
export function resolveTaskMetadata(taskLine) {
  const parsed = parseTaskMetadata(taskLine);
  const executor = parsed.executor ?? 'PRODUCT';
  if (!TASK_EXECUTORS.includes(executor))
    throw new Error(`TASK_EXECUTOR_UNKNOWN: ${parsed.executor} (in: ${parsed.raw.slice(0, 120)})`);
  let kind = parsed.kind;
  if (kind && !TASK_KINDS.includes(kind))
    throw new Error(`TASK_KIND_UNKNOWN: ${kind} (in: ${parsed.raw.slice(0, 120)})`);
  // Evidence kind: unknown values fail closed at graph build; absent means
  // FILE_OUTPUT (the P0-1 predicted-write proof). COORDINATOR_ARTIFACT is
  // legal only for coordinator tasks; an AI lane cannot claim it.
  let evidence = parsed.evidence;
  if (evidence && !TASK_EVIDENCE_KINDS.includes(evidence))
    throw new Error(`TASK_EVIDENCE_UNKNOWN: ${parsed.evidence} (in: ${parsed.raw.slice(0, 120)})`);
  if (!evidence) evidence = 'FILE_OUTPUT';
  if (executor === 'COORDINATOR') {
    if (kind && kind !== 'MECHANICAL_BOOKKEEPING')
      throw new Error(
        `TASK_KIND_INVALID_FOR_COORDINATOR: ${kind} — coordinator tasks are MECHANICAL_BOOKKEEPING (zero AI)`,
      );
    kind = 'MECHANICAL_BOOKKEEPING';
  } else if (kind === 'MECHANICAL_BOOKKEEPING') {
    throw new Error(
      `TASK_KIND_INVALID_FOR_EXECUTOR: MECHANICAL_BOOKKEEPING requires [executor: COORDINATOR] (${parsed.raw.slice(0, 120)})`,
    );
  } else if (!kind) {
    kind = executor === 'TEST' ? 'TEST_AUTHORING' : 'IMPLEMENTATION';
  }
  if (evidence === 'COORDINATOR_ARTIFACT' && executor !== 'COORDINATOR')
    throw new Error(
      `TASK_EVIDENCE_INVALID_FOR_EXECUTOR: COORDINATOR_ARTIFACT requires [executor: COORDINATOR] (${parsed.raw.slice(0, 120)})`,
    );
  return { executor, kind, evidence };
}

/** Is this unit zero-AI coordinator work? (never dispatched to a writer) */
export function isCoordinatorTask(unit) {
  return unit?.executor === 'COORDINATOR';
}

/**
 * Resolve a unit's evidence kind from its FULL task block (checkbox line plus
 * every wrapped continuation line), in document order.
 *
 * The checkbox-line-only parse (resolveTaskMetadata) misses a marker carried
 * on a wrapped continuation line — live run 4e59191b (g1-outcome-evaluation
 * T020, 2026-09-10): the block's `[evidence: NO_OP_ALREADY_SATISFIED]`
 * reservation sat on a wrapped body line, the unit classified as
 * PRODUCT/FILE_OUTPUT, and the launch graph dispatched it to BOTH the CODEX
 * core lane and the AGY test lane before any provider spend. Both lanes
 * reported zero completed units and the wave died integration_empty.
 *
 * Resolution law (fail-closed):
 *   - an UNKNOWN evidence kind ANYWHERE in the block throws
 *     TASK_EVIDENCE_UNKNOWN — a misspelled no-op marker must never silently
 *     become product work;
 *   - NO_OP_ALREADY_SATISFIED ANYWHERE in the block dominates: a unit
 *     reserved as already-satisfied is never provider-dispatched, even when
 *     its title line claims other evidence. (A prose cross-reference that
 *     pastes another unit's no-op marker halts visibly as unscheduled-open
 *     work, never as silent provider spend — the safe direction.)
 *   - otherwise the title-line marker keeps authority, then the first body
 *     marker; absent everywhere means FILE_OUTPUT (legacy default).
 *   - COORDINATOR_ARTIFACT for a non-coordinator executor throws
 *     TASK_EVIDENCE_INVALID_FOR_EXECUTOR (mirrors resolveTaskMetadata).
 *
 * @param blockText full task block text (checkbox remainder + continuations)
 * @param opts { unitId?, executor? } — executor enables the cross-check
 */
export function resolveBlockEvidence(blockText, opts = {}) {
  const text = String(blockText ?? '');
  const unitId = opts.unitId ?? '?';
  const found = [...text.matchAll(new RegExp(EVIDENCE_MARKER.source, 'g'))].map((m) =>
    String(m[1]).toUpperCase(),
  );
  for (const kind of found) {
    if (!TASK_EVIDENCE_KINDS.includes(kind))
      throw new Error(
        `TASK_EVIDENCE_UNKNOWN: unit ${unitId} block carries unknown evidence kind '${kind}' (legal: ${TASK_EVIDENCE_KINDS.join('/')})`,
      );
  }
  const evidence = found.includes('NO_OP_ALREADY_SATISFIED')
    ? 'NO_OP_ALREADY_SATISFIED'
    : (found[0] ?? 'FILE_OUTPUT');
  if (evidence === 'COORDINATOR_ARTIFACT' && opts.executor && opts.executor !== 'COORDINATOR')
    throw new Error(
      `TASK_EVIDENCE_INVALID_FOR_EXECUTOR: COORDINATOR_ARTIFACT requires [executor: COORDINATOR] (unit ${unitId})`,
    );
  return evidence;
}
