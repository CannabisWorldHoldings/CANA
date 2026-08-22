import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function custodyFailure(failureClass, detail = {}) {
  const error = new Error(`${failureClass} ${JSON.stringify(detail)}`);
  error.failureClass = failureClass;
  error.failureDetail = detail;
  return error;
}

function isInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function canonicalProspectivePath(candidate) {
  const missing = [];
  let cursor = path.resolve(candidate);
  while (!existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) throw custodyFailure('VISUAL_PATH_CANONICALIZATION_FAILED', { PATH: candidate });
    missing.unshift(path.basename(cursor));
    cursor = parent;
  }
  return path.join(realpathSync(cursor), ...missing);
}

function requireOutsideSource(candidate, sourceRoot, failureClass) {
  if (isInside(candidate, sourceRoot)) {
    throw custodyFailure(failureClass, { CANONICAL_PATH: candidate, CANONICAL_SOURCE_ROOT: sourceRoot });
  }
  return candidate;
}

function validateRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath === '' || path.isAbsolute(relativePath)) {
    throw custodyFailure('OUTPUT_WRITE_REFUSED', { RELATIVE_PATH: relativePath });
  }
  const components = relativePath.split('/');
  if (components.some(
    (component) => component === ''
      || component === '.'
      || component === '..'
      || component.includes('\\')
      || component.includes(path.sep),
  )) {
    throw custodyFailure('OUTPUT_WRITE_REFUSED', { RELATIVE_PATH: relativePath });
  }
  return components.join('/');
}

export function createOutputCustody(outputRoot, {
  sourceRoot,
  tempRoot = os.tmpdir(),
  makeTemp = mkdtempSync,
  writer = null,
} = {}) {
  if (!sourceRoot) throw new Error('output custody requires sourceRoot');
  const canonicalSource = realpathSync(sourceRoot);
  const requestedOutput = outputRoot
    ? path.resolve(outputRoot)
    : makeTemp(path.join(canonicalProspectivePath(tempRoot), 'cana-visual-court-'));
  const prospectiveOutput = canonicalProspectivePath(requestedOutput);
  requireOutsideSource(prospectiveOutput, canonicalSource, 'VISUAL_OUTPUT_INSIDE_SOURCE');
  mkdirSync(requestedOutput, { recursive: true, mode: 0o700 });
  const canonicalOutput = requireOutsideSource(
    realpathSync(requestedOutput),
    canonicalSource,
    'VISUAL_OUTPUT_INSIDE_SOURCE',
  );
  const outputStat = lstatSync(canonicalOutput);
  if (!outputStat.isDirectory() || outputStat.isSymbolicLink() || (outputStat.mode & 0o077) !== 0) {
    throw custodyFailure('OUTPUT_ROOT_NOT_PRIVATE', { OUTPUT: canonicalOutput });
  }
  if (readdirSync(canonicalOutput).length !== 0) {
    throw custodyFailure('OUTPUT_ROOT_NOT_EMPTY', { OUTPUT: canonicalOutput });
  }
  const descriptor = openSync(canonicalOutput, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const binding = fstatSync(descriptor, { bigint: true });
  let closed = false;

  function assertBound() {
    if (closed) throw custodyFailure('OUTPUT_CUSTODY_CLOSED', { OUTPUT: canonicalOutput });
    const held = fstatSync(descriptor, { bigint: true });
    if (held.dev !== binding.dev || held.ino !== binding.ino || held.nlink === 0n) {
      throw custodyFailure('OUTPUT_BINDING_LOST', { OUTPUT: canonicalOutput });
    }
    let current;
    try {
      current = lstatSync(canonicalOutput, { bigint: true });
    } catch (error) {
      throw custodyFailure('OUTPUT_BINDING_LOST', { OUTPUT: canonicalOutput, CODE: error.code ?? null });
    }
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== binding.dev || current.ino !== binding.ino) {
      throw custodyFailure('OUTPUT_BINDING_LOST', { OUTPUT: canonicalOutput });
    }
    return held;
  }

  return {
    displayPath: canonicalOutput,
    binding: { device: binding.dev, inode: binding.ino },
    assertBound,
    writeArtifact(relativePath, bytes) {
      const safeRelative = validateRelativePath(relativePath);
      assertBound();
      if (!writer?.write) {
        throw custodyFailure('OUTPUT_CUSTODY_PROOF_UNAVAILABLE', { PLATFORM: process.platform });
      }
      const result = writer.write({
        rootPath: canonicalOutput,
        device: binding.dev,
        inode: binding.ino,
        relativePath: safeRelative,
        bytes,
      });
      assertBound();
      return result;
    },
    close() {
      if (closed) return;
      let bindingError = null;
      try {
        assertBound();
      } catch (error) {
        bindingError = error;
      }
      closed = true;
      closeSync(descriptor);
      if (bindingError) throw bindingError;
    },
  };
}

export { canonicalProspectivePath, custodyFailure, requireOutsideSource };
