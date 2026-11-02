// Desbloqueo con Face ID / Touch ID mediante una llave de acceso (WebAuthn)
// con la extensión PRF. La llave vive en el chip seguro del iPhone y sólo se
// usa tras Face ID; de ella sale un secreto que cifra la contraseña de la app
// en este dispositivo. Sin Face ID ese dato cifrado no sirve de nada.

import { randomBytes, b64, unb64 } from './crypto.js';

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
const INFO = enc.encode('finanzas-personales:face-id:v1');

export const bioAvailable = () => !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);

export async function bioPlatformReady() {
  try { return bioAvailable() && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch { return false; }
}

async function wrapKey(prfOut) {
  const base = await subtle.importKey('raw', prfOut, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: INFO }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function prfGet(rawId, salt) {
  const a = await navigator.credentials.get({ publicKey: {
    challenge: randomBytes(32), rpId: location.hostname, timeout: 60000, userVerification: 'required',
    allowCredentials: [{ type: 'public-key', id: rawId }],
    extensions: { prf: { eval: { first: salt } } },
  } });
  const r = a.getClientExtensionResults();
  const out = r.prf && r.prf.results && r.prf.results.first;
  if (!out) throw new Error('NO_PRF');
  return out;
}

/** Crea la llave de acceso y guarda la contraseña cifrada con ella. Devuelve el registro a guardar. */
export async function bioCreate(passphrase) {
  const salt = randomBytes(32);
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: randomBytes(32),
    rp: { name: 'Finanzas personales', id: location.hostname },
    user: { id: randomBytes(16), name: 'Finanzas', displayName: 'Finanzas' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
    timeout: 60000,
    extensions: { prf: { eval: { first: salt } } },
  } });
  const ext = cred.getClientExtensionResults();
  if (!ext.prf || ext.prf.enabled === false) throw new Error('NO_PRF');
  let out = ext.prf.results && ext.prf.results.first;
  if (!out) out = await prfGet(cred.rawId, salt); // algunos sistemas sólo lo dan al usar la llave
  const iv = randomBytes(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, await wrapKey(out), enc.encode(passphrase));
  return { v: 1, id: b64(new Uint8Array(cred.rawId)), salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

/** Pide Face ID y devuelve la contraseña guardada. */
export async function bioUnlock(rec) {
  const out = await prfGet(unb64(rec.id), unb64(rec.salt));
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, await wrapKey(out), unb64(rec.ct));
  return dec.decode(pt);
}
