// Modelo de datos: estado, plantillas y generación de meses.
// Cada mes guarda una COPIA independiente de sus partidas: cambiar un mes
// o una plantilla nunca modifica los meses ya creados.

export const SCHEMA_VERSION = 1;

export const CATS = [
  { key: 'fixed', label: 'Gastos fijos' },
  { key: 'baby', label: 'Gastos del bebé' },
  { key: 'general', label: 'Gastos generales' },
];

export const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// [nombre, modo] — 'tx' = presupuesto + desglose de transacciones, 'direct' = importe directo
export const FIXED_SEED = [
  ['Renta', 'direct'], ['Inversion', 'direct'], ['Luz', 'tx'], ['Internet', 'direct'],
  ['Super', 'tx'], ['Letra BMW', 'direct'], ['Letra Suzuki', 'direct'], ['IFARU', 'direct'],
  ['Deuda muebles', 'direct'], ['Seguro coche', 'direct'], ['Seguro salud', 'direct'],
  ['Gasolina', 'tx'], ['Panapass', 'tx'], ['Ginecologo', 'tx'], ['Limpieza casa', 'direct'],
];

export function uid() {
  return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

export function newState() {
  return {
    v: SCHEMA_VERSION,
    settings: { autoLockMin: 5, theme: 'dark', carryAmounts: true },
    meta: { created: Date.now(), lastBackup: null },
    templates: {
      income: [],
      fixed: FIXED_SEED.map(([name, mode], i) => ({ id: 'fx' + (i + 1), name, mode, amount: 0, budget: 0 })),
      baby: [],
    },
    months: {},
  };
}

export function monthKey(year, month1) {
  return `${year}-${String(month1).padStart(2, '0')}`;
}
export function parseKey(key) {
  const [y, m] = key.split('-').map(Number);
  return { year: y, month: m };
}
export function shiftKey(key, delta) {
  const { year, month } = parseKey(key);
  const d = (year * 12 + (month - 1)) + delta;
  return monthKey(Math.floor(d / 12), (d % 12) + 1);
}
export function keyLabel(key) {
  const { year, month } = parseKey(key);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}
export function yearKeys(year) {
  return Array.from({ length: 12 }, (_, i) => monthKey(year, i + 1));
}
export function isValidKey(key) {
  return typeof key === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(key);
}

export function newItem({ name = '', mode = 'direct', amount = 0, budget = 0, tpl = null, paid = false, date = '', notes = '' } = {}) {
  return { id: uid(), tpl, name, mode, amount, paid, budget, date, notes, tx: [] };
}
export function newTx({ date = '', desc = '', amount = 0, paid = false } = {}) {
  return { id: uid(), date, desc, amount, paid };
}
export function newIncome({ name = '', amount = 0, date = '', notes = '', tpl = null } = {}) {
  return { id: uid(), tpl, name, amount, date, notes };
}

/** Mes guardado más reciente anterior a `key` (para arrastrar importes habituales). */
export function latestBefore(state, key) {
  const keys = Object.keys(state.months).filter((k) => k < key).sort();
  return keys.length ? state.months[keys[keys.length - 1]] : null;
}

/**
 * Genera un mes nuevo a partir de las plantillas. Los importes/presupuestos
 * se toman del mes anterior más reciente (si existe) o de la plantilla.
 * Estados de pago y transacciones empiezan siempre vacíos.
 */
export function buildMonth(state, key) {
  const prev = state.settings.carryAmounts === false ? null : latestBefore(state, key);
  const carry = (t, list) => {
    const p = list ? list.find((i) => i.tpl === t.id) : null;
    return newItem({
      tpl: t.id, name: t.name, mode: t.mode,
      amount: p ? p.amount : (t.amount || 0),
      budget: p ? p.budget : (t.budget || 0),
    });
  };
  return {
    key,
    created: Date.now(),
    incomes: state.templates.income.map((t) => {
      const p = prev ? prev.incomes.find((i) => i.tpl === t.id) : null;
      return newIncome({ tpl: t.id, name: t.name, amount: p ? p.amount : (t.amount || 0) });
    }),
    fixed: state.templates.fixed.map((t) => carry(t, prev && prev.fixed)),
    baby: state.templates.baby.map((t) => carry(t, prev && prev.baby)),
    general: [],
  };
}

/**
 * Devuelve el mes para mostrarlo. Si no existe aún se genera de forma
 * "virtual" (no se guarda hasta que el usuario cambie algo).
 */
export function viewMonth(state, key, virtual) {
  if (state.months[key]) return state.months[key];
  if (!virtual.has(key)) virtual.set(key, buildMonth(state, key));
  return virtual.get(key);
}

/** Devuelve el mes guardado, creándolo (a partir del virtual si existe). */
export function ensureMonth(state, key, virtual) {
  if (!state.months[key]) {
    state.months[key] = (virtual && virtual.get(key)) || buildMonth(state, key);
    if (virtual) virtual.delete(key);
  }
  return state.months[key];
}

export function findItem(month, cat, id) {
  return month[cat].find((i) => i.id === id) || null;
}

// ---------------------------------------------------------------------------
// Normalización: reconstruye el estado sólo con campos conocidos y tipos
// correctos. Se usa al descifrar y al importar copias (evita datos corruptos
// o manipulados, p. ej. claves "__proto__").

const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const cents = (v) => (Number.isFinite(v) ? Math.max(-99_999_999_999, Math.min(99_999_999_999, Math.round(v))) : 0);
const bool = (v) => v === true;
const date = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
const mode = (v) => (v === 'tx' ? 'tx' : 'direct');
const id = (v) => (typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : uid());
const tplId = (v) => (typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : null);
const arr = (v, max = 5000) => (Array.isArray(v) ? v.slice(0, max) : []);

function normTx(t) {
  t = t || {};
  return { id: id(t.id), date: date(t.date), desc: str(t.desc), amount: cents(t.amount), paid: bool(t.paid) };
}
function normItem(i) {
  i = i || {};
  return {
    id: id(i.id), tpl: tplId(i.tpl), name: str(i.name, 80), mode: mode(i.mode),
    amount: cents(i.amount), paid: bool(i.paid), budget: cents(i.budget),
    date: date(i.date), notes: str(i.notes, 500), tx: arr(i.tx).map(normTx),
  };
}
function normIncome(i) {
  i = i || {};
  return { id: id(i.id), tpl: tplId(i.tpl), name: str(i.name, 80), amount: cents(i.amount), date: date(i.date), notes: str(i.notes, 500) };
}
function normTpl(t, withMode = true) {
  t = t || {};
  const o = { id: id(t.id), name: str(t.name, 80), amount: cents(t.amount) };
  if (withMode) { o.mode = mode(t.mode); o.budget = cents(t.budget); }
  return o;
}

export function normalizeState(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== SCHEMA_VERSION || !raw.templates || !raw.months) {
    throw new Error('Formato de datos no reconocido');
  }
  const s = newState();
  const set = raw.settings || {};
  s.settings.autoLockMin = [1, 2, 5, 10, 15, 30].includes(set.autoLockMin) ? set.autoLockMin : 5;
  s.settings.theme = set.theme === 'light' ? 'light' : 'dark';
  s.settings.carryAmounts = set.carryAmounts !== false;
  const meta = raw.meta || {};
  s.meta.created = Number.isFinite(meta.created) ? meta.created : Date.now();
  s.meta.lastBackup = Number.isFinite(meta.lastBackup) ? meta.lastBackup : null;
  s.templates.income = arr(raw.templates.income, 200).map((t) => normTpl(t, false));
  s.templates.fixed = arr(raw.templates.fixed, 200).map((t) => normTpl(t));
  s.templates.baby = arr(raw.templates.baby, 200).map((t) => normTpl(t));
  s.months = Object.create(null);
  for (const k of Object.keys(raw.months)) {
    if (!isValidKey(k)) continue;
    const m = raw.months[k] || {};
    s.months[k] = {
      key: k,
      created: Number.isFinite(m.created) ? m.created : Date.now(),
      incomes: arr(m.incomes).map(normIncome),
      fixed: arr(m.fixed).map(normItem),
      baby: arr(m.baby).map(normItem),
      general: arr(m.general).map(normItem),
    };
  }
  return s;
}
