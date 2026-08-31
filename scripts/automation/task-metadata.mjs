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
  return {
    executor: executorMatch ? executorMatch[1].toUpperCase() : null,
    kind: kindMatch ? kindMatch[1].toUpperCase() : null,
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
  return { executor, kind };
}

/** Is this unit zero-AI coordinator work? (never dispatched to a writer) */
export function isCoordinatorTask(unit) {
  return unit?.executor === 'COORDINATOR';
}
