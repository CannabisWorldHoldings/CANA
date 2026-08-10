const RETIREMENT_CODE = 'CANA_LEGACY_ABCA_PATH_RETIRED';
const RETIREMENT_MESSAGE =
  `${RETIREMENT_CODE}: Legacy ABCA import paths are retired. Use the canonical Phase B compile/court commands: ` +
  'node apps/web/scripts/compile-market-reality.mjs and node apps/web/scripts/verify-market-reality.mjs.';

console.error(RETIREMENT_MESSAGE);
process.exitCode = 1;
