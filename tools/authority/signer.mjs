// tools/authority/signer.mjs — ROOT OF TRUST. Provider-neutral signer interface + a DEV-ONLY impl.
//
// OWNER DECISION (settled): provider-neutral signer interface. The DEV signer must be UNMISTAKABLY
// DEV_ONLY (key files named DEV_ONLY, signatures tagged dev-only, refuses to load when
// CANA_ENV=production). Production signer configuration absent => production authorization REFUSED
// (fail closed). No real KMS is integrated here — interface + dev impl + courts only.
//
// The authority process holds ONLY the VERIFY side of the owner root key plus a signing ORACLE it
// does not own (mirrors the archaeology's Court-13 fix: "the authority must not hold the key it
// verifies against"). Ed25519 for the owner root; the DEV signer additionally tags every signature
// so a dev-only proof can never be mistaken for a production one.

import {
  generateKeyPairSync, sign as edSign, verify as edVerify,
  createPublicKey, createPrivateKey,
} from 'node:crypto';
import {
  writeFileSync, readFileSync, existsSync, mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { AuthorityError, sha256hex } from './canon.mjs';

// The signature envelope. `trust_label` makes the provenance of a proof self-describing: a DEV
// proof carries DEV_ONLY forever, so a verifier can refuse to treat it as production authority.
export const DEV_TRUST_LABEL = 'DEV_ONLY';
export const PROD_TRUST_LABEL = 'PRODUCTION_WITNESSED';

function isProductionEnv(env = process.env) {
  return String(env.CANA_ENV ?? '').toLowerCase() === 'production';
}

// ── The provider-neutral interface ─────────────────────────────────────────
// A signer is { keyId, identity, trustLabel, sign(bytes)->{sig,trust_label,key_id,identity},
//               verify(bytes, proof)->bool }.
// Any provider (DEV file signer here; a KMS/HSM+witness in production) implements this shape.

// Provision an owner root keypair OUT OF BAND (as an owner would, before any authority runs). The
// private key file is named with DEV_ONLY so it is impossible to mistake for a production key on disk.
export function provisionDevOwnerRoot(rootDir, { env = process.env } = {}) {
  if (isProductionEnv(env)) {
    throw new AuthorityError('DEV_SIGNER_REFUSED_IN_PRODUCTION',
      'the DEV owner root may not be provisioned when CANA_ENV=production');
  }
  mkdirSync(rootDir, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  const keyId = sha256hex(Buffer.from(spki, 'base64'));
  // PUBLIC key — safe in the authority's view; this is all reconstruction needs.
  writeFileSync(join(rootDir, 'owner-root.pub.json'),
    JSON.stringify({ keyId, spki, trust_label: DEV_TRUST_LABEL }));
  // PRIVATE key — lives with the external signer ONLY; DEV_ONLY in the name is deliberate.
  writeFileSync(join(rootDir, 'owner-root.DEV_ONLY.key.json'),
    JSON.stringify({ keyId, pkcs8, trust_label: DEV_TRUST_LABEL }));
  return { keyId, spki };
}

// The DEV signing oracle. Holds the private key; exposes sign() only. NEVER hand this to a process
// that also executes work — it is the owner's out-of-band signer stand-in.
export function devOwnerSigner(rootDir, { env = process.env } = {}) {
  if (isProductionEnv(env)) {
    throw new AuthorityError('DEV_SIGNER_REFUSED_IN_PRODUCTION',
      'DevOwnerSigner refuses to load when CANA_ENV=production (fail closed)');
  }
  const keyPath = join(rootDir, 'owner-root.DEV_ONLY.key.json');
  if (!existsSync(keyPath)) {
    throw new AuthorityError('OWNER_ROOT_ABSENT', `no DEV owner root at ${keyPath}`);
  }
  const { keyId, pkcs8 } = JSON.parse(readFileSync(keyPath, 'utf8'));
  const privateKey = createPrivateKey({ key: Buffer.from(pkcs8, 'base64'), format: 'der', type: 'pkcs8' });
  return {
    keyId,
    identity: 'DEV_OWNER_SIGNER',
    trustLabel: DEV_TRUST_LABEL,
    // Returns a self-describing proof, not a bare signature. The label rides WITH the bytes.
    sign(bytes) {
      return {
        sig: edSign(null, Buffer.from(bytes), privateKey).toString('base64'),
        key_id: keyId,
        identity: 'DEV_OWNER_SIGNER',
        trust_label: DEV_TRUST_LABEL,
      };
    },
  };
}

// The verify half — this is what authorize() holds. PUBLIC key only. It is the SINGLE gate that turns
// a proof into authority, so it enforces the environment policy: in production, a DEV_ONLY proof is
// refused outright, and if no production signer is configured, verification fails closed.
export function ownerRootVerifier(rootDir, { env = process.env } = {}) {
  const pubPath = join(rootDir, 'owner-root.pub.json');
  const production = isProductionEnv(env);
  let material = null;
  if (existsSync(pubPath)) material = JSON.parse(readFileSync(pubPath, 'utf8'));

  // FAIL CLOSED IN PRODUCTION: a production run demands a production signer. The DEV root's label is
  // DEV_ONLY, so in production there is (by construction) no admissible verifier here.
  const prodSignerConfigured = production
    && material != null
    && material.trust_label === PROD_TRUST_LABEL;

  let publicKey = null;
  if (material) {
    try {
      publicKey = createPublicKey({ key: Buffer.from(material.spki, 'base64'), format: 'der', type: 'spki' });
    } catch {
      publicKey = null;
    }
  }

  return {
    keyId: material?.keyId ?? null,
    trustLabel: material?.trust_label ?? null,
    production,
    // A single reason string when verification cannot even be attempted (fail-closed conditions).
    unavailableReason() {
      if (production && !prodSignerConfigured) {
        return material == null
          ? 'PRODUCTION_SIGNER_ABSENT'
          : 'PRODUCTION_SIGNER_REQUIRED'; // a DEV_ONLY root is present but not admissible in prod
      }
      if (publicKey == null) return 'OWNER_ROOT_ABSENT';
      return null;
    },
    verify(bytes, proof) {
      // Fail closed: no admissible verifier => never true.
      if (production && !prodSignerConfigured) return false;
      if (publicKey == null) return false;
      if (!proof || typeof proof !== 'object') return false;
      // In production a DEV_ONLY proof is inadmissible even if a prod key were present.
      if (production && proof.trust_label !== PROD_TRUST_LABEL) return false;
      if (proof.key_id !== material.keyId) return false;
      try {
        return edVerify(null, Buffer.from(bytes), publicKey, Buffer.from(proof.sig ?? '', 'base64'));
      } catch {
        return false;
      }
    },
  };
}

export { isProductionEnv };
