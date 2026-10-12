// Sincronización en vivo entre dispositivos (opcional).
// El servidor guarda un único sobre cifrado por hogar, con número de versión.
// Cada dispositivo sube sus cambios cifrados y, si otro guardó antes, combina
// ambos cambios (fusión a tres bandas) antes de volver a subir.

import { SYNC } from './config.js';
import { b64 } from './crypto.js';

export const syncConfigured = () => !!(SYNC.url && SYNC.key);

const CODE_RE = /[A-Za-z0-9_-]{43}/;
export const isCode = (c) => typeof c === 'string' && /^[A-Za-z0-9_-]{43}$/.test(c);

/** Código secreto del hogar: 256 bits aleatorios (base64url). */
export function newCode() {
  return b64(globalThis.crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Extrae el código de un texto pegado (mensaje de invitación completo o sólo el código). */
export function extractCode(text) {
  const m = String(text || '').match(CODE_RE);
  return m ? m[0] : null;
}

async function rpc(fn, body) {
  const headers = { 'Content-Type': 'application/json', apikey: SYNC.key };
  if (!SYNC.key.startsWith('sb_')) headers.Authorization = 'Bearer ' + SYNC.key;
  const r = await fetch(`${SYNC.url.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store', referrerPolicy: 'no-referrer',
  });
  if (!r.ok) throw new Error('SYNC_HTTP_' + r.status);
  return r.json();
}

export async function remoteRev(code) {
  return Number(await rpc('vault_rev', { p_code: code })) || 0;
}
export async function remoteGet(code) {
  const rows = await rpc('get_vault', { p_code: code });
  const row = Array.isArray(rows) ? rows[0] : rows;
  return row && row.env ? { rev: Number(row.rev), env: row.env } : null;
}
/** Devuelve la versión nueva, o -1 si otro dispositivo guardó antes (conflicto). */
export async function remotePut(code, baseRev, env) {
  return Number(await rpc('put_vault', { p_code: code, p_base: baseRev, p_env: env }));
}

// ---------------------------------------------------------------------------
// Fusión a tres bandas: base = última versión común; local y remoto = cambios
// de cada lado. Las listas de objetos con "id" se combinan elemento a elemento
// (lo añadido en cualquiera de los dos lados se conserva; lo borrado, se borra).
// Si los dos cambian el mismo dato, gana el de este dispositivo.

const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isIdList = (v) => Array.isArray(v) && v.every((x) => isObj(x) && typeof x.id === 'string');

export function merge3(base, local, remote) {
  if (same(local, remote)) return local;
  if (same(local, base)) return remote;
  if (same(remote, base)) return local;
  if (isIdList(local) && isIdList(remote) && (base === undefined || isIdList(base))) return mergeList(base || [], local, remote, base === undefined);
  if (isObj(local) && isObj(remote) && (base === undefined || isObj(base))) {
    const out = {};
    for (const k of new Set([...Object.keys(remote), ...Object.keys(local)])) {
      const v = merge3(base ? base[k] : undefined, local[k], remote[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return local; // conflicto en un mismo dato
}

function mergeList(base, local, remote, noBase) {
  const B = new Map(base.map((x) => [x.id, x]));
  const L = new Map(local.map((x) => [x.id, x]));
  const R = new Map(remote.map((x) => [x.id, x]));
  // Un mes creado a la vez en los dos móviles genera las mismas partidas de
  // plantilla con ids distintos: se emparejan por plantilla para no duplicarlas.
  const alias = new Map();
  const remoteNewByTpl = new Map(remote.filter((x) => !B.has(x.id) && x.tpl).map((x) => [x.tpl, x.id]));
  for (const x of local) {
    if (!B.has(x.id) && !R.has(x.id) && x.tpl && remoteNewByTpl.has(x.tpl)) {
      alias.set(remoteNewByTpl.get(x.tpl), x);
      remoteNewByTpl.delete(x.tpl);
    }
  }
  const usedLocal = new Set([...alias.values()].map((x) => x.id));
  const out = [];
  for (const r of remote) {
    const b = B.get(r.id);
    const l = L.get(r.id) || alias.get(r.id);
    if (b && !l) continue;               // borrado aquí
    out.push(l ? merge3(noBase ? undefined : b, l, r) : r);
  }
  for (const l of local) {
    if (R.has(l.id) || usedLocal.has(l.id)) continue;
    if (B.has(l.id)) continue;           // borrado en el otro dispositivo
    out.push(l);                         // nuevo aquí
  }
  return out;
}
