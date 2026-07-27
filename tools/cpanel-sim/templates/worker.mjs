import fs from 'node:fs';
import path from 'node:path';

const releaseRoot = process.env.CANA_RELEASE_ROOT;
const logs = process.env.CANA_SHARED_LOGS;
const spill = process.env.CANA_EVIDENCE_SPILL;
for (const [name, value] of Object.entries({ releaseRoot, logs, spill })) {
  if (!value) throw new Error(`missing ${name}`);
}
const release = JSON.parse(fs.readFileSync(path.join(releaseRoot, 'release.json'), 'utf8'));
const heartbeat = () => {
  const record = {
    event: 'worker-heartbeat',
    environment: 'CPANEL_SIMULATION',
    gitSha: release.gitSha,
    at: new Date().toISOString(),
  };
  fs.appendFileSync(path.join(logs, 'worker.jsonl'), `${JSON.stringify(record)}\n`);
  fs.writeFileSync(path.join(spill, `worker-${release.gitSha}.json`), `${JSON.stringify(record)}\n`);
};

heartbeat();
if (process.env.CANA_WORKER_ONCE !== '1') {
  const timer = setInterval(heartbeat, 30_000);
  process.on('SIGTERM', () => {
    clearInterval(timer);
    process.exit(0);
  });
}
