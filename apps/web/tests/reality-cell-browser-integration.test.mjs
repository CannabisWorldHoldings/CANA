import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(webRoot, 'scripts/reality-cell-0001-browser-court.mjs'), 'utf8');

test('Reality Cell browser court drives the actual CANA app instead of serving self-authored HTML', () => {
  assert.doesNotMatch(source, /previewHtml|http\.createServer/);
  assert.match(source, /baseUrl/);
  assert.match(source, /page\.goto/);
  assert.match(source, /data-experience-candidate-digest/);
  assert.match(source, /Yes, I'm 21 or older/);
  assert.match(source, /candidateSurface\.waitFor\(\{ state: 'visible' \}\)/);
  assert.match(source, /fixtureNotice\.isVisible\(\)/);
});
