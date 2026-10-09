// Almacenamiento local en IndexedDB. Sólo se guarda el sobre CIFRADO.

const DB_NAME = 'finanzas-personales';
const STORE = 'kv';
const VAULT_KEY = 'vault';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      let result;
      Promise.resolve(fn(store)).then((r) => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('abort'));
    });
  } finally {
    db.close();
  }
}

export function loadVault() {
  return tx('readonly', (s) => new Promise((res, rej) => {
    const r = s.get(VAULT_KEY);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => rej(r.error);
  }));
}

export function saveVault(env) {
  return tx('readwrite', (s) => { s.put(env, VAULT_KEY); });
}

export function wipeVault() {
  return tx('readwrite', (s) => { s.clear(); });
}

/** Pide al navegador que no borre los datos automáticamente si falta espacio. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* sin soporte */ }
  return false;
}
