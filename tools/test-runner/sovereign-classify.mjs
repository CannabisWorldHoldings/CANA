/**
 * SOVEREIGN CLASSIFICATION CONTRACT
 * =================================
 *
 * `./cana verify sovereign` refuses to collapse a fifteen-stage composition into a
 * single boolean. Every stage — and every unit inside a stage — carries exactly one
 * classification drawn from this closed vocabulary.
 *
 *   VERIFIED                    the stage ran to completion in a sufficient
 *                               environment and its property held.
 *   REAL_REGRESSION             the stage ran in a sufficient environment and the
 *                               property did NOT hold. This is the only class that
 *                               means "the code is wrong". It is the DEFAULT for an
 *                               unexplained failure — nothing is excused by accident.
 *   ENVIRONMENT_MISSING         the stage could not run because a required piece of
 *                               the environment is absent (docker, a PostgreSQL/PostGIS
 *                               server, node_modules, a browser binary, python3...).
 *                               NOT a pass. NOT a skip. An explicit "unproven here".
 *   HISTORICAL_CONTEXT_MISMATCH the stage ran but references history this checkout
 *                               does not contain (a branch or commit that exists only
 *                               in the canonical remote, a rev-parse of an unknown ref).
 *   OWNERSHIP_MANIFEST_CONTEXT  the stage failed against the changed-file ownership
 *                               manifest / owner-approved scope digest, i.e. the one
 *                               artifact the two sovereign lineages collide on.
 *   LIVE_LEDGER_CONTEXT         the stage failed because live `.cana-local` ledger
 *                               state (receipt sessions, declarations, durability
 *                               state) is not present. Verifier strictness about a
 *                               missing ledger is not evidence that the ledger exists.
 *   NOT_RUN                     the stage was never attempted, because an upstream
 *                               HARD gate came back REAL_REGRESSION and the composition
 *                               failed closed.
 *
 * PRECEDENCE. A failure text can match several rules. The order below is the
 * precedence order and it is deliberate: an environment fault outranks every
 * content explanation (if node_modules is missing, a test's opinion about the
 * ownership manifest is not trustworthy), and REAL_REGRESSION is the fallthrough,
 * never a match. There is no rule that can turn a failure into VERIFIED.
 *
 * CONDITIONAL EXCUSES. An ENVIRONMENT_MISSING rule may carry `onlyWhenAbsent`, a
 * predicate over the live environment probes. The excuse is granted ONLY when the
 * environment really is absent. In CI — where node_modules IS installed, PostgreSQL
 * IS reachable and the app IS being served — the same text falls through to
 * REAL_REGRESSION, which is the whole point: `Cannot find package 'x'` is an
 * environment fact on a bare container and a genuine defect once `npm ci` has run.
 * A rule with no predicate is unconditional (a missing binary is never ambiguous).
 */

export const CLASSIFICATIONS = Object.freeze([
  'VERIFIED',
  'REAL_REGRESSION',
  'ENVIRONMENT_MISSING',
  'HISTORICAL_CONTEXT_MISMATCH',
  'OWNERSHIP_MANIFEST_CONTEXT',
  'LIVE_LEDGER_CONTEXT',
  'NOT_RUN',
]);

export const NON_PASS = Object.freeze(
  CLASSIFICATIONS.filter((c) => c !== 'VERIFIED'),
);

/** Classes that mean "we learned the code is broken" and must abort a HARD gate. */
export const FAULT_CLASSES = Object.freeze(['REAL_REGRESSION']);

/**
 * Ordered rule table. Each rule is `{ classification, reason, patterns }`.
 * `patterns` are matched case-insensitively against the combined stdout+stderr.
 */
export const RULES = Object.freeze([
  {
    classification: 'ENVIRONMENT_MISSING',
    reason: 'a required executable is not installed on this machine',
    patterns: [
      /\b(docker|psql|pg_ctl|postgres|python3?|npx|npm|chromium|chrome)\s+failed to start/i,
      /spawnsync\s+\S*(docker|psql|postgres|python|chromium)\S*\s+enoent/i,
      /\benoent\b[^\n]*\b(docker|psql|postgres|python3|chromium|headless_shell)\b/i,
      /command not found[^\n]*\b(docker|psql|python3|chromium)\b/i,
    ],
  },
  {
    classification: 'ENVIRONMENT_MISSING',
    reason: 'a dependency tree (node_modules) required by this stage is not installed',
    onlyWhenAbsent: (env) => !env?.nodeModules?.root,
    patterns: [
      /\b(prisma|tsc|typescript|eslint|next|playwright)\b[^\n]{0,20}CLI not found/i,
      /could not determine executable to run/i,
      /ERR_MODULE_NOT_FOUND/,
      /Cannot find package '[^']+'/,
      /Cannot find module '[^']+'/,
      /MODULE_NOT_FOUND/,
      /\bnpm error\b[^\n]*\bENOENT\b/i,
      /prisma(client)?initializationerror/i,
      /@prisma\/client did not initialize/i,
      /did not initialize yet\. Please run "prisma generate"/i,
    ],
  },
  {
    classification: 'ENVIRONMENT_MISSING',
    reason: 'no reachable PostgreSQL/PostGIS server for this stage',
    onlyWhenAbsent: (env) => !env?.postgres?.present,
    patterns: [
      /DATABASE_URL[^\n]*(not set|required|missing|undefined)/i,
      /(not set|required|missing)[^\n]*DATABASE_URL/i,
      /ECONNREFUSED[^\n]*(5432|postgres)/i,
      /(5432|postgres)[^\n]*ECONNREFUSED/i,
      /could not connect to server/i,
      /connection refused[^\n]*postgres/i,
      /type "geography" does not exist/i,
      /extension "[^"]+" is not available/i,
      /could not open extension control file/i,
      /getaddrinfo\s+ENOTFOUND\s+(postgres|db|localhost)/i,
    ],
  },
  {
    classification: 'ENVIRONMENT_MISSING',
    reason: 'no application server is running for this court to talk to',
    onlyWhenAbsent: (env) => !env?.appServer?.present,
    patterns: [
      /server did not become ready/i,
      /ECONNREFUSED[^\n]*:300\d\b/i,
      /connect ECONNREFUSED 127\.0\.0\.1:3000/i,
      /fetch failed[^\n]*127\.0\.0\.1:3000/i,
    ],
  },
  {
    classification: 'ENVIRONMENT_MISSING',
    reason: 'no browser binary available to drive the rendered court',
    onlyWhenAbsent: (env) => !env?.chromium?.present,
    patterns: [
      /chromium[^\n]*(not found|missing|unavailable)/i,
      /(browserType\.launch|Executable doesn't exist)/i,
      /playwright[^\n]*is not installed/i,
    ],
  },
  {
    classification: 'OWNERSHIP_MANIFEST_CONTEXT',
    reason: 'the changed-file ownership manifest / owner-approved scope digest',
    patterns: [
      /ownership manifest/i,
      /owner-approved scope digest/i,
      /changed-file ownership/i,
      /CHANGED_FILE_OWNERSHIP/,
      /unknown or missing assignments/i,
      /prohibitedSourceChanged/,
    ],
  },
  {
    classification: 'HISTORICAL_CONTEXT_MISMATCH',
    reason: 'a git ref or commit that exists only in history this checkout does not carry',
    patterns: [
      /unknown revision or path not in the working tree/i,
      /ambiguous argument '[^']+': unknown revision/i,
      /fatal: Not a valid object name/i,
      /couldn't find remote ref/i,
      /no such branch/i,
      /bad revision/i,
    ],
  },
  {
    classification: 'LIVE_LEDGER_CONTEXT',
    reason: 'live .cana-local ledger / receipt-session state that this checkout does not carry',
    patterns: [
      /\.cana-local\b[^\n]*(missing|not found|ENOENT|does not exist)/i,
      /(ENOENT|no such file)[^\n]*\.cana-local\b/i,
      /invalid CANA receipt session/i,
      /CANA receipt directory does not match its session/i,
      /declarations\.jsonl[^\n]*(missing|ENOENT)/i,
      /no durability state/i,
    ],
  },
]);

/**
 * Classify a failure from its own output. Pure, deterministic, total.
 * Returns { classification, reason, matched } — `classification` is never VERIFIED.
 */
export function classifyFailure(output, {
  env = null,
  fallbackReason = 'the stage ran in a sufficient environment and the property did not hold',
} = {}) {
  const text = String(output ?? '');
  for (const rule of RULES) {
    // A conditional excuse is only granted when the environment really is absent.
    if (rule.onlyWhenAbsent && env && !rule.onlyWhenAbsent(env)) continue;
    for (const pattern of rule.patterns) {
      const match = text.match(pattern);
      if (match) {
        return {
          classification: rule.classification,
          reason: rule.reason,
          matched: match[0].slice(0, 200),
        };
      }
    }
  }
  return { classification: 'REAL_REGRESSION', reason: fallbackReason, matched: null };
}

/** Worst-of aggregation for a stage built from units. Order = severity order. */
const SEVERITY = Object.freeze({
  VERIFIED: 0,
  NOT_RUN: 1,
  LIVE_LEDGER_CONTEXT: 2,
  HISTORICAL_CONTEXT_MISMATCH: 3,
  OWNERSHIP_MANIFEST_CONTEXT: 4,
  ENVIRONMENT_MISSING: 5,
  REAL_REGRESSION: 6,
});

export function worstClassification(classifications) {
  let worst = 'VERIFIED';
  for (const c of classifications) {
    if (!(c in SEVERITY)) throw new Error(`unknown classification: ${c}`);
    if (SEVERITY[c] > SEVERITY[worst]) worst = c;
  }
  return worst;
}

export function severityOf(classification) {
  if (!(classification in SEVERITY)) throw new Error(`unknown classification: ${classification}`);
  return SEVERITY[classification];
}
