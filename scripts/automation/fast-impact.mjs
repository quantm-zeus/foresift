// Deterministic FAST impact classifier (V2 task spec §7).
//
// Maps changed paths to conservative verification categories. A coherent slice
// containing no JS/TS file must NOT run the entire test suite merely because
// the old FAST tier could only express JS/TS checks — but UNKNOWN impact must
// always escalate FULL. Classification NEVER guesses dependency impact: any
// path whose blast radius is not provably narrow lands in ROOT_OR_UNKNOWN and
// escalates.
//
// Categories and their targeted checks (executed by package-fast-verify.mjs):
//   CODE_JS_TS          eslint(touched) + vitest related(touched) + pnpm typecheck
//   DATABASE            vitest related(touched) [+ full suite when nothing relates]
//   AUTHORITATIVE_SPEC  spec:verify (always run) + authority validators +
//                       schema/conformance test files
//   ARCHON_CONTROL_PLANE prettier --check(touched) + archon validate workflows
//   DOC_ONLY            prettier --check(touched)
//   ROOT_OR_UNKNOWN     FULL fail-closed escalation
//
// Pure functions only — no git, no filesystem. Deletions classify by path even
// though the file no longer exists (removing a TS module still needs tsc).

export const IMPACT_CATEGORIES = [
  'CODE_JS_TS',
  'DATABASE',
  'AUTHORITATIVE_SPEC',
  'ARCHON_CONTROL_PLANE',
  'DOC_ONLY',
  'ROOT_OR_UNKNOWN',
];

const norm = (p) => String(p).replaceAll('\\', '/').replace(/^\.\//, '');

const RE = {
  lockfile: /(^|\/)pnpm-lock\.yaml$/,
  rootManifests: [
    /(^|\/)package\.json$/,
    /(^|\/)tsconfig(\..*)?\.json$/,
    /(eslint|vitest|prettier)\.config\.[cm]?[jt]s$/,
    /(^|\/)\.nvmrc$/,
    /(^|\/)[^.]+rc\.(json|[cm]?[jt]s)$/, // .eslintrc.json style at any depth
  ],
  github: /(^|\/)\.github\//,
  authoritativeSpec: [/(^|\/)docs\/spec\//, /(^|\/)specs\/implementation\//],
  controlPlane: [/(^|\/)\.archon\//, /(^|\/)\.claude\//],
  database: [/(^|\/)migrations\//i, /\.sql$/i],
  codeJsTs: /\.(m|c)?[jt]sx?$/,
  docOnly: /\.(md|mdx|txt)$/,
};

/** Primary category for ONE path (root-level config first-match order). */
export function classifyPath(rawPath) {
  const p = norm(rawPath);
  if (RE.lockfile.test(p)) return 'ROOT_OR_UNKNOWN';
  if (RE.github.test(p)) return 'ROOT_OR_UNKNOWN';
  for (const re of RE.rootManifests) if (re.test(p)) return 'ROOT_OR_UNKNOWN';
  for (const re of RE.authoritativeSpec) if (re.test(p)) return 'AUTHORITATIVE_SPEC';
  for (const re of RE.controlPlane) if (re.test(p)) return 'ARCHON_CONTROL_PLANE';
  for (const re of RE.database) if (re.test(p)) return 'DATABASE';
  if (!p.includes('/') && !/\.[a-z0-9]+$/i.test(p)) return 'ROOT_OR_UNKNOWN'; // stray root file
  if (RE.codeJsTs.test(p)) return 'CODE_JS_TS';
  if (RE.docOnly.test(p)) return 'DOC_ONLY';
  return 'ROOT_OR_UNKNOWN'; // unknown extension/type ⇒ fail closed
}

/**
 * Classify a set of changed paths. Escalates FULL when ANY path is
 * ROOT_OR_UNKNOWN — mixed slices inherit the strongest requirement.
 */
export function classifyImpact(paths) {
  const buckets = Object.fromEntries(IMPACT_CATEGORIES.map((c) => [c, []]));
  for (const raw of paths ?? []) buckets[classifyPath(raw)].push(norm(raw));
  const escalated = buckets.ROOT_OR_UNKNOWN.length > 0;
  return {
    categories: buckets,
    escalateFull: escalated,
    reason: escalated ? `unknown/root-level impact: ${buckets.ROOT_OR_UNKNOWN.join(', ')}` : null,
  };
}

/**
 * Targeted check PLAN for the classified impact (execution lives in
 * package-fast-verify.mjs). Ordered deterministically; per-file lists are
 * filtered to existing files at execution time (deletions still trigger their
 * category-level checks).
 */
export function planFastChecks(classification) {
  // Escalation replaces targeted checks entirely — a caller can never combine
  // "unknown impact" with a narrow plan by accident.
  if (classification.escalateFull) return [];
  const c = classification.categories;
  const plan = [];
  if (c.CODE_JS_TS.length > 0) {
    plan.push({ kind: 'eslint', files: c.CODE_JS_TS });
    plan.push({ kind: 'vitest-related', files: [...c.CODE_JS_TS] });
    plan.push({ kind: 'typecheck' });
  }
  if (c.DATABASE.length > 0) {
    plan.push({ kind: 'vitest-related', files: c.DATABASE, database: true });
  }
  if (c.AUTHORITATIVE_SPEC.length > 0) {
    plan.push({ kind: 'authority-validate' });
    plan.push({ kind: 'conformance-tests' });
  }
  if (c.ARCHON_CONTROL_PLANE.length > 0) {
    plan.push({ kind: 'format-check', files: c.ARCHON_CONTROL_PLANE });
    plan.push({ kind: 'archon-validate' });
  }
  if (c.DOC_ONLY.length > 0) {
    plan.push({ kind: 'format-check', files: c.DOC_ONLY });
  }
  return plan;
}
