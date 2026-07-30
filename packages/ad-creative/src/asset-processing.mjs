import { createHash } from 'node:crypto';
import sharp from 'sharp';

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function assertExactLogo({ logoBuffer, expectedSha256 }) {
  const actualSha256 = digest(logoBuffer);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`logo hash mismatch: expected ${expectedSha256}, received ${actualSha256}`);
  }
  return actualSha256;
}

export async function compositeExactLogo({
  sceneBuffer,
  logoBuffer,
  expectedLogoSha256,
  widthFraction = 0.24,
  marginFraction = 0.04,
}) {
  await assertExactLogo({ logoBuffer, expectedSha256: expectedLogoSha256 });
  const scene = sharp(sceneBuffer);
  const metadata = await scene.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('scene dimensions are unavailable');
  }
  const logoWidth = Math.max(1, Math.round(metadata.width * widthFraction));
  const margin = Math.max(1, Math.round(metadata.width * marginFraction));
  const resizedLogo = await sharp(logoBuffer).resize({ width: logoWidth }).png().toBuffer();
  const logoMetadata = await sharp(resizedLogo).metadata();
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

export async function createResponsiveDerivatives({
  masterBuffer,
  widths,
  quality = 76,
}) {
  if (!Array.isArray(widths) || widths.length === 0) {
    throw new TypeError('responsive widths are required');
  }
  const source = sharp(masterBuffer);
  const metadata = await source.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('master dimensions are unavailable');
  }
  const derivatives = [];
  for (const width of [...new Set(widths)].sort((a, b) => a - b)) {
    if (!Number.isInteger(width) || width < 1 || width > metadata.width) {
      throw new Error(`invalid responsive width ${width}`);
    }
    const resized = sharp(masterBuffer).resize({ width, withoutEnlargement: true });
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
