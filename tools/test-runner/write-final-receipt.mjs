import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { receiptDirectory, sha256File } from './receipt.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = 'c953ebcd25c46ef33af0700d7913a899d839bce8';
const BASE_TREE = 'f7c56f6dad3875ccba10dfadbd2d953baf5c1509';
const AUTHORITATIVE_CHECKOUT = '/Users/Apple/Documents/New project/CANA-c953ebc/repo';
const ARCHIVE = '/Users/Apple/Downloads/CANA_CODEX_HANDOFF_c953ebc.zip';

function command(commandName, args, { cwd = ROOT, allowFailure = false } = {}) {
  const result = spawnSync(commandName, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error) throw new Error(`${commandName} failed to start: ${result.error.message}`);
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${commandName} ${args.join(' ')} exited ${result.status}\n${result.stderr || result.stdout}`);
  }
  return result;
}

function git(args, cwd = ROOT) {
  return command('git', args, { cwd }).stdout.trim();
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
}

function allReceipts() {
  return fs.readdirSync(receiptDirectory())
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(receiptDirectory(), name))
    .map((file) => {
      try {
        return { file, body: JSON.parse(fs.readFileSync(file, 'utf8')) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function latest(receipts, kind, predicate) {
  const candidates = receipts
    .filter(({ body }) => body.kind === kind && predicate(body))
    .sort((left, right) => String(left.body.recordedAt).localeCompare(String(right.body.recordedAt)));
  const selected = candidates.at(-1);
  if (!selected) throw new Error(`missing final receipt: ${kind}`);
  return {
    kind,
    file: selected.file,
    sha256: sha256File(selected.file),
    overall: selected.body.overall,
    recordedAt: selected.body.recordedAt,
  };
}

function sourceIdentity(cwd = ROOT) {
  return {
    commit: git(['rev-parse', 'HEAD'], cwd),
    tree: git(['rev-parse', 'HEAD^{tree}'], cwd),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
    status: git(['status', '--porcelain'], cwd),
  };
}

function changedFiles(commit) {
  return git(['diff', '--name-status', `${BASE}..${commit}`])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, ...names] = line.split('\t');
      const relative = names.at(-1);
      const absolute = path.join(ROOT, relative);
      return {
        status,
        path: relative,
        sha256: fs.existsSync(absolute) && fs.statSync(absolute).isFile()
          ? sha256File(absolute)
          : null,
      };
    });
}

function exactFinalReceipts(receipts, source) {
  const sameSource = (body) => body.source?.commit === source.commit && body.source?.tree === source.tree;
  const selected = [
    latest(receipts, 'verify-focused', sameSource),
    latest(receipts, 'verify-full', sameSource),
    latest(receipts, 'verify-clean-clone', sameSource),
    latest(receipts, 'verify-release', sameSource),
    latest(receipts, 'verify-maria', sameSource),
    latest(receipts, 'verify-cpanel', sameSource),
    latest(receipts, 'durability-build', sameSource),
    latest(receipts, 'durability-verify', sameSource),
    latest(
      receipts,
      'durability-restore',
      (body) => body.restored?.commit === source.commit && body.restored?.tree === source.tree,
    ),
    latest(
      receipts,
      'github-import-prepare',
      (body) => sameSource(body) && body.runtimeComparison?.status === 'PASS',
    ),
  ];
  if (selected.some((entry) => entry.overall !== 'PASS')) {
    throw new Error(`a required final receipt is not PASS: ${JSON.stringify(selected)}`);
  }
  return selected;
}

function historicalFalsification() {
  return [
    {
      scenario: 'full verifier archive omitted Git identity',
      receiptSha256: 'eda2e7b94f9b5829ad3bd029fe41004e9b3979eeee5f39337d11c73c292a362d',
      restored: true,
    },
    {
      scenario: 'full verifier lacked legacy paths and runtime secret',
      receiptSha256: '0b5647d854067016b46253b3c34b92327e7f7e350b2ac363aac0e0bc8a63acf7',
      restored: true,
    },
    {
      scenario: 'full verifier used the wrong legacy symlink shape',
      receiptSha256: '1ebd46cbae0b64f7a46d1e9a40802b263bbb33872d1db68501b6319ceab4dbfe',
      restored: true,
    },
    {
      scenario: 'MariaDB client had no registry egress',
      receiptSha256: 'ecc529dc9dfd7aad860efcff24cf95e87b5aba6e87ea96b5937cddc0dff56594',
      restored: true,
    },
    {
      scenario: 'cPanel activation compared non-canonical macOS paths',
      receiptSha256: 'be20c15d8c9b284c9e3cbfd131a62c2261bfa21805047e0b67526d6466a33029',
      restored: true,
    },
    {
      scenario: 'stale cPanel receipt did not equal the newer GitHub package SHA',
      receiptSha256: null,
      restored: true,
    },
  ];
}

export function writeFinalCandidateReceipt() {
  const source = sourceIdentity();
  if (source.status) throw new Error(`final receipt refuses a dirty source:\n${source.status}`);
  const authoritative = sourceIdentity(AUTHORITATIVE_CHECKOUT);
  if (
    authoritative.commit !== BASE ||
    authoritative.tree !== BASE_TREE ||
    authoritative.branch !== 'recover/competitive-ui-day-night' ||
    authoritative.status
  ) {
    throw new Error(`authoritative checkout changed: ${JSON.stringify(authoritative)}`);
  }
  const archive = {
    file: ARCHIVE,
    bytes: fs.statSync(ARCHIVE).size,
    sha256: sha256File(ARCHIVE),
  };
  const baseCorrection = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'tools', 'durability', 'base-remote-receipt.json'), 'utf8'),
  );
  if (
    archive.bytes !== baseCorrection.archive.size ||
    archive.sha256 !== baseCorrection.archive.sha256
  ) {
    throw new Error(`supplied handoff archive drifted: ${JSON.stringify(archive)}`);
  }
  const ownershipFile = path.join(ROOT, 'tools', 'test-runner', 'CODEX_CHANGED_FILE_OWNERSHIP.json');
  const ownership = JSON.parse(fs.readFileSync(ownershipFile, 'utf8'));
  const changed = changedFiles(source.commit);
  const prohibitedChanged = changed
    .filter((entry) => ownership.global_no_edit.includes(entry.path))
    .map((entry) => entry.path);
  if (prohibitedChanged.length) {
    throw new Error(`prohibited files changed: ${prohibitedChanged.join(', ')}`);
  }
  const receipts = exactFinalReceipts(allReceipts(), source);
  const commits = git([
    'log',
    '--reverse',
    '--format=%H%x09%s',
    `${BASE}..${source.commit}`,
  ]).split('\n').filter(Boolean).map((line) => {
    const [commit, subject] = line.split('\t');
    return { commit, subject };
  });
  const outputRoot = receiptDirectory();
  const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
  const changedManifestFile = path.join(outputRoot, `candidate-changed-files-${stamp}.json`);
  const changedManifest = {
    schemaVersion: 1,
    kind: 'candidate-changed-file-manifest',
    source,
    base: { commit: BASE, tree: BASE_TREE },
    ownershipManifest: {
      file: 'tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json',
      sha256: sha256File(ownershipFile),
    },
    count: changed.length,
    files: changed,
    prohibitedChanged,
  };
  writeJson(changedManifestFile, changedManifest);
  const laneReceiptFile = path.join(outputRoot, `candidate-lane-final-${stamp}.json`);
  const laneReceipt = {
    schemaVersion: 1,
    kind: 'CANA bottleneck-clearance final candidate receipt',
    recordedAt: new Date().toISOString(),
    overall: 'PASS',
    source,
    authoritative,
    baseCorrection: {
      historicalReceiptModified: false,
      driveFileId: baseCorrection.remote.driveFileId,
      remotelyDurableFrontier: baseCorrection.currentRemotelyDurableFrontier,
      localOnlyDurabilityGapAtBase: baseCorrection.localOnlyDurabilityGap,
      archive,
    },
    candidateDurability: {
      state: 'LOCAL_ONLY_CANDIDATE',
      remotelyDurable: false,
      reason: 'No owner-authorized upload/download/hash round trip was executed for the candidate.',
    },
    commits,
    changedFileManifest: {
      file: changedManifestFile,
      sha256: sha256File(changedManifestFile),
      count: changed.length,
    },
    ownershipManifest: {
      file: ownershipFile,
      sha256: sha256File(ownershipFile),
      prohibitedChanged,
    },
    finalReceipts: receipts,
    falsificationReceipts: historicalFalsification(),
    prohibitedAreaDefects: [
      {
        claim: 'No finite approved evidence-chain byte maximum exists because 64 links are capped but step/ref bytes are not.',
        file: 'apps/web/src/lib/demand-credits.mjs',
        sha256: sha256File(path.join(ROOT, 'apps/web/src/lib/demand-credits.mjs')),
        changed: false,
      },
    ],
    preExistingObservations: [
      {
        claim: 'Next build warns that collectSiteIntelligenceSnapshot is imported but not exported.',
        importer: {
          file: 'apps/web/src/app/admin/site-intelligence/page.tsx',
          sha256: sha256File(path.join(ROOT, 'apps/web/src/app/admin/site-intelligence/page.tsx')),
        },
        module: {
          file: 'apps/web/src/lib/site-intelligence.mjs',
          sha256: sha256File(path.join(ROOT, 'apps/web/src/lib/site-intelligence.mjs')),
        },
        changed: false,
      },
    ],
    rollback: {
      candidateGit: `git revert ${commits.map((entry) => entry.commit).reverse().join(' ')}`,
      abandonLane: `git branch -D codex/cana-bottleneck-clearance`,
      authoritativeBranch: 'No rollback required; it was never modified.',
      maria: 'Discard the candidate schema/SQL and ephemeral database; no provider flip was merged.',
      cpanelSimulation: 'Activate the previous immutable release; no real account was contacted.',
      durabilityRestore: 'Restore only to a new path from the verified candidate bundle.',
    },
    remainingUnprovenClaims: [
      'Candidate commits are not remotely durable.',
      'No finite business-approved evidence-chain byte maximum exists.',
      'MariaDB evidence is local simulation, not hosted production behavior.',
      'cPanel evidence is local simulation, not a live deployment.',
      'Canonical GitHub access, branch protection, pushes, pull request, merge, tags and release are unexecuted.',
      'GitHub Actions workflow is prepared locally but has not run on the canonical repository.',
      'Real merchant, payment, ranking, revenue and production behavior remain outside this lane.',
    ],
    ownerGatedActions: ownership.owner_gated_actions,
  };
  writeJson(laneReceiptFile, laneReceipt);
  process.stdout.write(`${JSON.stringify({
    receipt: laneReceiptFile,
    receiptSha256: sha256File(laneReceiptFile),
    changedFileManifest: changedManifestFile,
    changedFileManifestSha256: sha256File(changedManifestFile),
  }, null, 2)}\n`);
  return laneReceipt;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFinalCandidateReceipt();
}
