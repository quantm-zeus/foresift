const TEST_PATH_PATTERNS = [
  /^tests\//,
  /(^|\/)__tests__\//,
  /(^|\/)test\//,
  /(^|\/)fixtures\//,
  /(^|\/)test-helpers?\//,
  /\.(?:test|spec)\.[^/]+$/,
];

export function classifyOwnedPath(path, { testOwnedPaths = [] } = {}) {
  const normalized = String(path ?? '').replace(/^\.\//, '');
  if (testOwnedPaths.includes(normalized) || TEST_PATH_PATTERNS.some((re) => re.test(normalized)))
    return 'TEST';
  return 'PRODUCT';
}

export function validateLaneOwnership({ engine, role, changedPaths = [], testOwnedPaths = [] }) {
  const classified = changedPaths.map((path) => ({
    path,
    ownership: classifyOwnedPath(path, { testOwnedPaths }),
  }));
  let violationCode = null;
  let violations = [];
  if (role === 'implementation') {
    violations = classified.filter((p) => p.ownership === 'TEST').map((p) => p.path);
    if (violations.length) violationCode = `${engine}_TEST_OWNERSHIP_VIOLATION`;
    if (engine === 'AGY' && changedPaths.length) {
      violationCode = 'AGY_PRODUCT_WRITES_DISABLED';
      violations = [...changedPaths];
    }
  } else if (role === 'test') {
    violations = classified.filter((p) => p.ownership === 'PRODUCT').map((p) => p.path);
    if (violations.length) violationCode = 'AGY_PRODUCT_OWNERSHIP_VIOLATION';
    if (engine !== 'AGY') {
      violationCode = 'TEST_ENGINE_AUTHORITY_VIOLATION';
      violations = [...changedPaths];
    }
  } else {
    violationCode = 'UNKNOWN_LANE_ROLE';
    violations = [...changedPaths];
  }
  return {
    ok: violationCode === null,
    valid: violationCode === null,
    role,
    engine,
    classified,
    violation: violationCode,
    code: violationCode,
    violationCode,
    violations: violationCode ? [violationCode, ...violations] : [],
    violatingPaths: violations,
  };
}
