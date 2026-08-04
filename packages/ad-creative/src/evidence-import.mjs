import { createHash } from 'node:crypto';
import { posix } from 'node:path';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/**
 * Validate an already-enumerated evidence directory without reading, executing,
 * or following imported content. The caller remains responsible for bounded
 * byte reads after this manifest gate passes.
 */
export function validateCreativeEvidenceImportManifest({ entries, maxFileBytes = 5_000_000 }) {
  if (!Array.isArray(entries) || entries.length === 0) throw new TypeError('evidence import entries are required');
  if (!Number.isInteger(maxFileBytes) || maxFileBytes < 1) throw new TypeError('maxFileBytes must be positive');
  const admitted = [];
  const seen = new Set();
  for (const entry of entries) {
    const rawPath = entry?.path;
    if (typeof rawPath !== 'string' || rawPath.length === 0 || rawPath.includes('\\')) {
      throw new Error('evidence path must be a non-empty POSIX relative path');
    }
    const normalized = posix.normalize(rawPath);
    if (normalized !== rawPath || posix.isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../')) {
      throw new Error(`evidence path traversal or non-canonical path refused: ${rawPath}`);
    }
    const segments = normalized.split('/');
    if (segments.includes('__MACOSX') || segments.some((segment) => segment.startsWith('._'))) {
      throw new Error(`AppleDouble or __MACOSX evidence member refused: ${rawPath}`);
    }
    if (seen.has(normalized)) throw new Error(`duplicate evidence member refused: ${rawPath}`);
    seen.add(normalized);
    if (!['FILE', 'DIRECTORY'].includes(entry.type)) {
      throw new Error(`non-regular evidence member refused: ${rawPath} (${entry.type ?? 'UNKNOWN'})`);
    }
    if (entry.type === 'FILE' && (!Number.isInteger(entry.size) || entry.size < 0 || entry.size > maxFileBytes)) {
      throw new Error(`evidence member size refused: ${rawPath}`);
    }
    admitted.push(Object.freeze({ path: normalized, type: entry.type, size: entry.size ?? 0 }));
  }
  const body = {
    schema_version: 'cana.creative-evidence-import-manifest/1.0.0',
    status: 'ADMITTED_UNTRUSTED_EVIDENCE_MANIFEST',
    entries: admitted,
    imported_instruction_authority: 'NONE',
    imported_files_executed: false,
    symlinks_followed: false,
    archive_metadata_admitted: false,
  };
  return Object.freeze({ ...body, manifest_digest: digest(body) });
}
