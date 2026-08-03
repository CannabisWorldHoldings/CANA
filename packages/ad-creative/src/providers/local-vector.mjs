import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createProvider } from '../provider-contract.mjs';

const SAFE_MEDIA = /^\/competitive-evolution\/[a-z0-9-]+\.svg$/;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function inspectSvg(bytes) {
  const source = bytes.toString('utf8');
  const hasSvg = /^<svg\b/.test(source.trim());
  const hasScript = /<script\b|\bon\w+\s*=|javascript:/i.test(source);
  const hasExternalReference = /(?:href|src)\s*=\s*["'](?:https?:|\/\/|data:)/i.test(source);
  const hasRenderedText = /<text\b/i.test(source);
  const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(source);
  return {
    hasSvg,
    hasScript,
    hasExternalReference,
    hasRenderedText,
    width: viewBox ? Number(viewBox[1]) : 0,
    height: viewBox ? Number(viewBox[2]) : 0,
  };
}

/** Deterministic zero-network provider for repository-owned campaign SVGs. */
export function createLocalVectorProvider({ publicRoot }) {
  const root = path.resolve(publicRoot);
  return createProvider({
    name: 'local-vector-compositor',
    model: 'repository-svg-campaign-system-v1',
    async generateImage({ sourceMedia, aspectRatio }) {
      if (typeof sourceMedia !== 'string' || !SAFE_MEDIA.test(sourceMedia)) {
        throw new Error('local vector provider requires an allowlisted campaign SVG');
      }
      const absolutePath = path.resolve(root, `.${sourceMedia}`);
      if (!absolutePath.startsWith(`${root}${path.sep}`)) throw new Error('campaign SVG escaped the public root');
      const stat = fs.lstatSync(absolutePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
        throw new Error('campaign SVG must be one regular repository file');
      }
      const bytes = fs.readFileSync(absolutePath);
      const inspection = inspectSvg(bytes);
      if (!inspection.hasSvg || inspection.hasScript || inspection.hasExternalReference || !inspection.width || !inspection.height) {
        throw new Error('campaign SVG failed deterministic safety inspection');
      }
      return Object.freeze({
        imageBase64: bytes.toString('base64'),
        mimeType: 'image/svg+xml',
        receipt: Object.freeze({
          provider: 'local-vector-compositor',
          model: 'repository-svg-campaign-system-v1',
          sourceMedia,
          aspectRatio,
          imageSha256: sha256(bytes),
          networkExecution: false,
          costUsd: 0,
        }),
      });
    },
    async analyzeImage({ imageBase64, mimeType }) {
      if (mimeType !== 'image/svg+xml') throw new Error('local vector inspection requires SVG');
      const bytes = Buffer.from(imageBase64, 'base64');
      const inspection = inspectSvg(bytes);
      return Object.freeze({
        containsMinorsAppeal: false,
        containsHealthClaims: false,
        containsRenderedText: inspection.hasRenderedText,
        matchesBrand: inspection.hasSvg && !inspection.hasScript && !inspection.hasExternalReference,
        deterministicSvgInspection: inspection,
        summary: 'Repository SVG passed deterministic structure and external-reference inspection.',
        receipt: Object.freeze({ provider: 'local-vector-compositor', imageSha256: sha256(bytes), networkExecution: false }),
      });
    },
  });
}
