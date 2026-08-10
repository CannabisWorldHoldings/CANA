import fs from 'node:fs';
import path from 'node:path';

const FORBIDDEN_FILE_PATTERNS = [
  /^\.env(?:\.|$)/i,
  /^\.?(?:credentials?|secrets?)(?:\.[^.]+)?$/i,
  /\.(?:key|pem|p12|pfx)$/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)$/i,
];

const CREDENTIAL_PATTERNS = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  [
    'credential-bearing database URL',
    /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^/\s:@]+:[^@\s/]+@/i,
  ],
];

function walkFiles(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walkFiles(target, output);
    else if (entry.isFile()) output.push(target);
  }
  return output;
}

export function auditArtifactExclusions(artifactRoot) {
  const files = walkFiles(artifactRoot);
  const forbiddenFiles = files
    .filter((file) => FORBIDDEN_FILE_PATTERNS.some((pattern) => pattern.test(path.basename(file))))
    .map((file) => path.relative(artifactRoot, file));
  const credentialFindings = [];

  for (const file of files) {
    const contents = fs.readFileSync(file);
    if (contents.includes(0)) continue;
    const text = contents.toString('utf8');
    for (const [label, pattern] of CREDENTIAL_PATTERNS) {
      if (pattern.test(text)) {
        credentialFindings.push({
          file: path.relative(artifactRoot, file),
          pattern: label,
        });
      }
    }
  }

  return {
    passed: forbiddenFiles.length === 0 && credentialFindings.length === 0,
    filesScanned: files.length,
    forbiddenFiles,
    credentialFindings,
  };
}
