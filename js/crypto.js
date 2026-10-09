// Cifrado de los datos con una clave derivada de la contraseña del usuario.
// PBKDF2-SHA-256 (600.000 iteraciones) + AES-GCM de 256 bits (WebCrypto).
// La clave nunca se guarda: sólo existe en memoria mientras la app está desbloqueada.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const KDF_ITERATIONS = 600_000;
const AAD = enc.encode('finanzas-personales:v1');
export const MIN_PASSPHRASE = 8;

export function b64(bytes) {
  let s = '';
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(str) {
  const s = atob(str);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export async function deriveKey(passphrase, salt, iterations = KDF_ITERATIONS) {
  const base = await subtle.importKey('raw', enc.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false, // no exportable
    ['encrypt', 'decrypt'],
  );
}

/** Crea una "sesión" nueva (sal + clave) para una contraseña. */
export async function createSession(passphrase, iterations = KDF_ITERATIONS) {
  const salt = randomBytes(16);
  const key = await deriveKey(passphrase, salt, iterations);
  return { key, salt, iterations };
}

/** Cifra un objeto y devuelve un sobre JSON autocontenido. */
export async function seal(session, obj) {
  const iv = randomBytes(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, session.key, enc.encode(JSON.stringify(obj)));
  return {
    app: 'finanzas-personales',
    format: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: session.iterations, salt: b64(session.salt) },
    cipher: 'AES-GCM-256',
    iv: b64(iv),
    ct: b64(new Uint8Array(ct)),
    savedAt: new Date().toISOString(),
  };
}

export function isEnvelope(env) {
  return !!env && env.app === 'finanzas-personales' && env.format === 1 && env.kdf && typeof env.kdf.salt === 'string'
    && Number.isInteger(env.kdf.iterations) && env.kdf.iterations >= 100_000 && env.kdf.iterations <= 10_000_000
    && typeof env.iv === 'string' && typeof env.ct === 'string';
}

/** Abre un sobre con la contraseña. Lanza 'BAD_PASSWORD' si no es correcta. */
export async function open(env, passphrase) {
  if (!isEnvelope(env)) throw new Error('BAD_FORMAT');
  const salt = unb64(env.kdf.salt);
  const key = await deriveKey(passphrase, salt, env.kdf.iterations);
  const session = { key, salt, iterations: env.kdf.iterations };
  const data = await openWith(session, env);
  return { session, data };
}

export async function openWith(session, env) {
  try {
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv), additionalData: AAD }, session.key, unb64(env.ct));
    return JSON.parse(dec.decode(pt));
  } catch {
    throw new Error('BAD_PASSWORD');
  }
}
