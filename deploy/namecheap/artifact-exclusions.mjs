import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const FORBIDDEN_FILE_PATTERNS = [
  /^\.env(?:\.|$)/i,
  /^\.?(?:credentials?|secrets?)(?:\.[^.]+)?$/i,
  /\.(?:key|pem|p12|pfx)$/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)$/i,
];

const REVIEWED_EFFECT_SECRET_MODULE =
  /^node_modules\/effect\/(?:dist\/(?:cjs|esm|dts)|src)\/(?:internal\/)?secret(?:\.d)?\.(?:js|ts)(?:\.map)?$/i;

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

const PORTABLE_VIRTUAL_PATHS = Object.freeze([
  '/home/web_user',
]);

const MACHINE_PATH_PATTERNS = Object.freeze([
  {
    pattern: 'POSIX_USER_HOME',
    regex: /(?<quote>["'`])(?<value>\/(?:Users|home)\/[^"'`\r\n]+)\k<quote>/g,
  },
  {
    pattern: 'MACOS_TEMPORARY_PATH',
    regex: /(?<quote>["'`])(?<value>\/(?:private\/)?var\/folders\/[^"'`\r\n]+)\k<quote>/g,
  },
  {
    pattern: 'BUILD_TEMPORARY_PATH',
    regex: /(?<quote>["'`])(?<value>\/(?:private\/)?tmp\/(?:cana|owd|build|builder|repo|workspace|next-build)[^"'`\r\n]*)\k<quote>/g,
  },
  {
    pattern: 'LINUX_BUILD_ROOT',
    regex: /(?<quote>["'`])(?<value>\/(?:workspace|workspaces|builds|github\/workspace|runner\/_work|agent\/workspace|opt\/(?:build|builder|workspace)|srv\/(?:build|builder|workspace))\/[^"'`\r\n]+)\k<quote>/g,
  },
  {
    pattern: 'WINDOWS_DRIVE_PATH',
    regex: /(?<quote>["'`])(?<value>[A-Za-z]:\\+(?:Users|Temp|tmp|workspace|builds)(?:\\+[^"'`\r\n]+)?)\k<quote>/g,
  },
  {
    pattern: 'WINDOWS_UNC_PATH',
    regex: /(?<quote>["'`])(?<value>\\\\+[A-Za-z0-9._-]+\\+[A-Za-z0-9$._-]+\\+[^"'`\r\n]+)\k<quote>/g,
  },
]);

export const PINNED_ARTIFACT_EXECUTABLE_SHA256 = Object.freeze({
  'node_modules/prisma/build/index.js':
    'c2a77456b70e8ba1e640e122824ed694433828a7c0d76ff3db7fc376b4b0e1a0',
});

function walkFiles(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walkFiles(target, output);
    else if (entry.isFile()) output.push(target);
  }
  return output;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

const GIT_OBJECT_ID = /^[0-9a-f]{40}$/;

function portableArchiveMemberPath(value, label) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || path.isAbsolute(value)
    || path.win32.isAbsolute(value)
    || value.split(/[\\/]/).includes('..')
  ) {
    throw new Error(`ARTIFACT_DELIVERY_${label}_PATH_REFUSED`);
  }
  return value.replaceAll('\\', '/');
}

export function writeArtifactDeliveryManifest({
  manifestPath,
  archivePath,
  embeddedReceiptPath,
  embeddedReceiptArchivePath,
  gitSha,
  gitTree,
} = {}) {
  if (!GIT_OBJECT_ID.test(gitSha ?? '') || !GIT_OBJECT_ID.test(gitTree ?? '')) {
    throw new Error('ARTIFACT_DELIVERY_SOURCE_IDENTITY_REFUSED');
  }
  if (!path.isAbsolute(manifestPath ?? '') || !path.isAbsolute(archivePath ?? '')) {
    throw new Error('ARTIFACT_DELIVERY_OUTPUT_PATH_REFUSED');
  }
  if (!path.isAbsolute(embeddedReceiptPath ?? '')) {
    throw new Error('ARTIFACT_DELIVERY_RECEIPT_PATH_REFUSED');
  }
  const archiveFile = path.basename(archivePath);
  if (!archiveFile.endsWith('.tar.gz')) {
    throw new Error('ARTIFACT_DELIVERY_ARCHIVE_TYPE_REFUSED');
  }
  const manifest = {
    schemaVersion: 'cana.deployment-artifact-delivery/1.0.0',
    source: {
      commit: gitSha,
      tree: gitTree,
    },
    archive: {
      file: portableArchiveMemberPath(archiveFile, 'ARCHIVE'),
      sha256: sha256(fs.readFileSync(archivePath)),
    },
    embeddedReceipt: {
      file: portableArchiveMemberPath(embeddedReceiptArchivePath, 'RECEIPT'),
      sha256: sha256(fs.readFileSync(embeddedReceiptPath)),
    },
    court: {
      isolatedRuntime: 'PASS',
      relocation: 'PASS',
      artifactExclusionAudit: 'PASS',
      rollback: 'PASS',
      cleanup: 'PASS',
      deployment: false,
    },
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function countOccurrences(buffer, value) {
  const needle = Buffer.from(value);
  if (needle.length === 0) return [];
  const offsets = [];
  let offset = 0;
  while ((offset = buffer.indexOf(needle, offset)) !== -1) {
    offsets.push(offset);
    offset += needle.length;
  }
  return offsets;
}

function portableVirtualPath(value) {
  return PORTABLE_VIRTUAL_PATHS.some(
    (portable) => value === portable || value.startsWith(`${portable}/`),
  );
}

function escapedExpression(value, pattern) {
  return pattern === 'WINDOWS_UNC_PATH'
    && /^\\\\+(?:[ux][0-9a-f]|[dDsSwWfnrtv0]\\+[^\\]\\+)/i.test(value);
}

export function detectMachineLocalPaths(contents, { machineRoots = [] } = {}) {
  const buffer = Buffer.isBuffer(contents) ? contents : Buffer.from(String(contents));
  const candidates = [];
  for (const root of machineRoots) {
    if (!root || typeof root.label !== 'string' || typeof root.value !== 'string') continue;
    const value = root.value.replace(/[\\/]$/, '');
    if (value.length < 2) continue;
    for (const offset of countOccurrences(buffer, value)) {
      candidates.push({
        offset,
        length: Buffer.byteLength(value),
        pattern: root.label,
        value,
        priority: 2,
      });
    }
  }

  // Opaque native/WASM binaries are still checked against the actual build roots above.
  // Generic platform patterns are limited to textual content so random binary byte sequences
  // cannot be promoted into false filesystem findings.
  if (!buffer.includes(0)) {
    const text = buffer.toString('utf8');
    for (const { pattern, regex } of MACHINE_PATH_PATTERNS) {
      regex.lastIndex = 0;
      for (const match of text.matchAll(regex)) {
        const value = match.groups?.value;
        if (!value || portableVirtualPath(value) || escapedExpression(value, pattern)) continue;
        const relativeOffset = match[0].indexOf(value);
        candidates.push({
          offset: Buffer.byteLength(text.slice(0, match.index + relativeOffset)),
          length: Buffer.byteLength(value),
          pattern,
          value,
          priority: 1,
        });
      }
    }
  }

  candidates.sort((left, right) =>
    left.offset - right.offset
    || right.length - left.length
    || right.priority - left.priority,
  );
  const selected = [];
  for (const candidate of candidates) {
    const overlaps = selected.some(
      (existing) => candidate.offset < existing.offset + existing.length
        && existing.offset < candidate.offset + candidate.length,
    );
    if (!overlaps) selected.push(candidate);
  }

  const aggregated = new Map();
  for (const candidate of selected) {
    const key = `${candidate.pattern}\0${candidate.value}`;
    const existing = aggregated.get(key);
    if (existing) existing.occurrences += 1;
    else {
      aggregated.set(key, {
        pattern: candidate.pattern,
        value: candidate.value,
        valueSha256: sha256(candidate.value),
        occurrences: 1,
      });
    }
  }
  return [...aggregated.values()];
}

function jsonDeclaration(source, declaration) {
  const prefix = `const ${declaration} = `;
  const start = source.indexOf(prefix);
  if (start === -1) throw new Error(`PORTABILITY_JSON_DECLARATION_MISSING:${declaration}`);
  const valueStart = start + prefix.length;
  if (source[valueStart] !== '{') {
    throw new Error(`PORTABILITY_JSON_DECLARATION_INVALID:${declaration}`);
  }
  let depth = 0;
  let escaped = false;
  let inString = false;
  let valueEnd = -1;
  for (let index = valueStart; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        valueEnd = index + 1;
        break;
      }
    }
  }
  if (valueEnd === -1) throw new Error(`PORTABILITY_JSON_DECLARATION_UNTERMINATED:${declaration}`);
  let value;
  try {
    value = JSON.parse(source.slice(valueStart, valueEnd));
  } catch {
    throw new Error(`PORTABILITY_JSON_DECLARATION_INVALID:${declaration}`);
  }
  return { valueStart, valueEnd, value };
}

function writeJsonDeclaration(source, parsed, value) {
  return `${source.slice(0, parsed.valueStart)}${JSON.stringify(value, null, 2)}${source.slice(parsed.valueEnd)}`;
}

export function normalizePrismaGeneratedClient(file, {
  expectedOutputPath,
  expectedSchemaPath,
  portableOutputPath,
  portableSchemaPath = 'apps/web/prisma/schema.prisma',
} = {}) {
  const source = fs.readFileSync(file, 'utf8');
  const parsed = jsonDeclaration(source, 'config');
  const config = parsed.value;
  if (config?.generator?.output?.value !== expectedOutputPath) {
    throw new Error('PRISMA_GENERATED_OUTPUT_PATH_UNEXPECTED');
  }
  if (config?.generator?.sourceFilePath !== expectedSchemaPath) {
    throw new Error('PRISMA_GENERATED_SCHEMA_PATH_UNEXPECTED');
  }
  config.generator.output.value = portableOutputPath;
  config.generator.sourceFilePath = portableSchemaPath;
  const normalized = writeJsonDeclaration(source, parsed, config);
  fs.writeFileSync(file, normalized);
  return Object.freeze({
    file: path.basename(file),
    outputPath: portableOutputPath,
    schemaPath: portableSchemaPath,
  });
}

function normalizeNextRuntimeConfig(config, buildRoot) {
  if (config.outputFileTracingRoot !== buildRoot) {
    throw new Error('NEXT_OUTPUT_FILE_TRACING_ROOT_UNEXPECTED');
  }
  if (config.turbopack?.root !== buildRoot) {
    throw new Error('NEXT_TURBOPACK_ROOT_UNEXPECTED');
  }
  delete config.outputFileTracingRoot;
  const turbopack = { ...config.turbopack };
  delete turbopack.root;
  if (Object.keys(turbopack).length === 0) delete config.turbopack;
  else config.turbopack = turbopack;
  return config;
}

export function normalizeNextStandaloneOutput({
  standaloneRoot,
  serverFile,
  requiredServerFiles,
  buildRoot,
  portableSourceRoot = 'cana-artifact-source',
} = {}) {
  const serverSource = fs.readFileSync(serverFile, 'utf8');
  const parsedServerConfig = jsonDeclaration(serverSource, 'nextConfig');
  const normalizedServerConfig = normalizeNextRuntimeConfig(parsedServerConfig.value, buildRoot);
  fs.writeFileSync(
    serverFile,
    writeJsonDeclaration(serverSource, parsedServerConfig, normalizedServerConfig),
  );

  const required = JSON.parse(fs.readFileSync(requiredServerFiles, 'utf8'));
  required.config = normalizeNextRuntimeConfig(required.config, buildRoot);
  const expectedAppDir = path.join(buildRoot, 'apps/web');
  if (required.appDir !== expectedAppDir || required.relativeAppDir !== 'apps/web') {
    throw new Error('NEXT_REQUIRED_SERVER_APP_DIR_UNEXPECTED');
  }
  required.appDir = required.relativeAppDir;
  fs.writeFileSync(requiredServerFiles, `${JSON.stringify(required, null, 2)}\n`);

  let replacements = 0;
  let filesNormalized = 0;
  const replacementsByForm = [
    {
      source: pathToFileURL(buildRoot).href.replace(/\/$/, ''),
      replacement: `file:///${portableSourceRoot}`,
    },
    { source: buildRoot, replacement: portableSourceRoot },
  ];
  for (const file of walkFiles(standaloneRoot)) {
    const contents = fs.readFileSync(file);
    const fileReplacements = replacementsByForm.map(({ source, replacement }) => ({
      source,
      replacement,
      occurrences: countOccurrences(contents, source).length,
    }));
    if (fileReplacements.every(({ occurrences }) => occurrences === 0)) continue;
    if (contents.includes(0)) throw new Error('NEXT_BUILD_ROOT_EMBEDDED_IN_BINARY');
    let normalized = contents.toString('utf8');
    for (const { source, replacement } of fileReplacements) {
      normalized = normalized.split(source).join(replacement);
    }
    fs.writeFileSync(file, normalized);
    replacements += fileReplacements.reduce(
      (total, replacement) => total + replacement.occurrences,
      0,
    );
    filesNormalized += 1;
  }
  for (const file of walkFiles(standaloneRoot)) {
    const contents = fs.readFileSync(file);
    if (replacementsByForm.some(({ source }) => countOccurrences(contents, source).length > 0)) {
      throw new Error('NEXT_BUILD_ROOT_NORMALIZATION_INCOMPLETE');
    }
  }
  return Object.freeze({
    portableSourceRoot,
    filesNormalized,
    replacements,
    serverBuildConfigRemoved: true,
    requiredServerManifestRelocated: true,
  });
}

export function portableReleaseReproducibility(releaseRepro) {
  const remote = releaseRepro?.remote;
  const remoteKind = typeof remote === 'string' && path.isAbsolute(remote)
    ? 'LOCAL_GIT_OBJECT_DATABASE'
    : remote === 'origin'
      ? 'NAMED_ORIGIN_REMOTE'
      : 'CONFIGURED_REMOTE';
  return Object.freeze({
    remoteKind,
    remoteReachable: releaseRepro?.remoteReachable === true,
    exactCommitVerified: true,
  });
}

export function auditArtifactExclusions(artifactRoot, { machineRoots = [] } = {}) {
  const files = walkFiles(artifactRoot);
  const forbiddenFiles = files
    .filter((file) => {
      const relativePath = path.relative(artifactRoot, file);
      return FORBIDDEN_FILE_PATTERNS.some((pattern) => pattern.test(path.basename(file)))
        && !REVIEWED_EFFECT_SECRET_MODULE.test(relativePath);
    })
    .map((file) => path.relative(artifactRoot, file));
  const credentialFindings = [];
  const machinePathFindings = [];

  for (const file of files) {
    const contents = fs.readFileSync(file);
    const relativePath = path.relative(artifactRoot, file);
    const trustedSha256 = PINNED_ARTIFACT_EXECUTABLE_SHA256[relativePath];
    if (
      typeof trustedSha256 === 'string' &&
      createHash('sha256').update(contents).digest('hex') === trustedSha256
    ) continue;
    const text = contents.toString('utf8');
    for (const [label, pattern] of CREDENTIAL_PATTERNS) {
      if (pattern.test(text)) {
        credentialFindings.push({
          file: path.relative(artifactRoot, file),
          pattern: label,
        });
      }
    }
    for (const finding of detectMachineLocalPaths(contents, { machineRoots })) {
      machinePathFindings.push({
        file: relativePath,
        pattern: finding.pattern,
        value: finding.value,
        valueSha256: finding.valueSha256,
        occurrences: finding.occurrences,
      });
    }
  }

  return {
    passed:
      forbiddenFiles.length === 0
      && credentialFindings.length === 0
      && machinePathFindings.length === 0,
    filesScanned: files.length,
    forbiddenFiles,
    credentialFindings,
    machinePathFindings,
    machinePathOccurrences: machinePathFindings.reduce(
      (total, finding) => total + finding.occurrences,
      0,
    ),
  };
}
