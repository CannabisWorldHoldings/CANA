import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { ORDERWEEDDC_BRAND_ASSETS } from './orderweeddc-brand-assets.mjs';

const MAX_INPUT_BYTES = 50 * 1024 * 1024;
const MAX_INPUT_PIXELS = 100_000_000;

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function boundedSharp(buffer, label) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new TypeError(`${label} must be a non-empty Buffer`);
  }
  if (buffer.length > MAX_INPUT_BYTES) {
    throw new Error(`${label} exceeds the ${MAX_INPUT_BYTES}-byte input limit`);
  }
  return sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS });
}

export async function assertExactLogo({ logoBuffer, expectedSha256 }) {
  boundedSharp(logoBuffer, 'logoBuffer');
  const actualSha256 = digest(logoBuffer);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`logo hash mismatch: expected ${expectedSha256}, received ${actualSha256}`);
  }
  return actualSha256;
}

async function compositeExactLogo({
  sceneBuffer,
  logoBuffer,
  expectedLogoSha256,
  widthFraction = 0.24,
  marginFraction = 0.04,
}) {
  await assertExactLogo({ logoBuffer, expectedSha256: expectedLogoSha256 });
  const scene = boundedSharp(sceneBuffer, 'sceneBuffer');
  const metadata = await scene.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('scene dimensions are unavailable');
  }
  const logoWidth = Math.max(1, Math.round(metadata.width * widthFraction));
  const margin = Math.max(1, Math.round(metadata.width * marginFraction));
  const resizedLogo = await boundedSharp(logoBuffer, 'logoBuffer')
    .resize({ width: logoWidth })
    .png()
    .toBuffer();
  const logoMetadata = await boundedSharp(resizedLogo, 'resizedLogo').metadata();
  if (!logoMetadata.width || !logoMetadata.height) {
    throw new Error('logo dimensions are unavailable');
  }
  return scene
    .composite([
      {
        input: resizedLogo,
        left: Math.max(0, metadata.width - logoMetadata.width - margin),
        top: Math.max(0, metadata.height - logoMetadata.height - margin),
      },
    ])
    .png()
    .toBuffer();
}

export async function compositeOrderweeddcLogo({
  sceneBuffer,
  logoBuffer,
  brandAssetName,
  widthFraction,
  marginFraction,
}) {
  const brandAsset = ORDERWEEDDC_BRAND_ASSETS[brandAssetName];
  if (!brandAsset) {
    throw new Error(`unsupported ORDERWEEDDC brand asset: ${brandAssetName}`);
  }
  return compositeExactLogo({
    sceneBuffer,
    logoBuffer,
    expectedLogoSha256: brandAsset.sha256,
    widthFraction,
    marginFraction,
  });
}

export async function createResponsiveDerivatives({
  masterBuffer,
  widths,
  quality = 76,
}) {
  if (!Array.isArray(widths) || widths.length === 0) {
    throw new TypeError('responsive widths are required');
  }
  const source = boundedSharp(masterBuffer, 'masterBuffer');
  const metadata = await source.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('master dimensions are unavailable');
  }
  const derivatives = [];
  for (const width of [...new Set(widths)].sort((a, b) => a - b)) {
    if (!Number.isInteger(width) || width < 1 || width > metadata.width) {
      throw new Error(`invalid responsive width ${width}`);
    }
    const resized = boundedSharp(masterBuffer, 'masterBuffer').resize({
      width,
      withoutEnlargement: true,
    });
    const [avif, webp] = await Promise.all([
      resized.clone().avif({ quality }).toBuffer(),
      resized.clone().webp({ quality }).toBuffer(),
    ]);
    const height = Math.round((metadata.height / metadata.width) * width);
    derivatives.push(
      Object.freeze({
        width,
        height,
        avif,
        webp,
        avifSha256: digest(avif),
        webpSha256: digest(webp),
      }),
    );
  }
  return Object.freeze({
    masterSha256: digest(masterBuffer),
    source: Object.freeze({ width: metadata.width, height: metadata.height }),
    derivatives: Object.freeze(derivatives),
  });
}
