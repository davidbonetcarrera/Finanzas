// Aplicación principal: pantallas de bloqueo, Ingresos, Gastos, Totales y Ajustes.
import { h, formSheet, choose, confirmDanger, infoSheet, toast, saveFile, pickFile, todayISO, shortDate } from './dom.js';
import { fmt, toInput, parseAmount } from './money.js';
import {
  CATS, SAVINGS, REIMB, MONTH_NAMES, newState, monthKey, parseKey, shiftKey, keyLabel, yearKeys, newItem, newTx, newIncome,
  viewMonth, ensureMonth, latestBefore, normalizeState, uid,
} from './model.js';
import { itemCalc, monthCalc, periodCalc, closeBudgets, reopenBudgets, pendingReimbBefore } from './calc.js';
import { createSession, seal, open, openWith, isEnvelope, MIN_PASSPHRASE } from './crypto.js';
import { loadVault, saveVault, wipeVault, requestPersistence } from './store.js';
import { stackedBars, balanceBars, legend } from './charts.js';
import { workbookSheets, fileSlug } from './reports.js';
import { buildXlsx } from './xlsx.js';

const root = document.getElementById('app');
const now = new Date();

const app = {
  state: null,
  session: null,
  key: monthKey(now.getFullYear(), now.getMonth() + 1),
  tab: 'gastos',
  virtual: new Map(),
  open: new Set(['fixed', 'baby', 'general', 'savings', 'reimb']),
  totalsMode: 'month',
  totalsYear: now.getFullYear(),
  range: new Set(),
  lastActivity: Date.now(),
  hiddenAt: null,
};

// ---------------------------------------------------------------------------
// Guardado cifrado

let saveChain = Promise.resolve();
let saveTimer = null;
let dirty = false;

function queueSave() {
  dirty = true;
  setSaveIndicator('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 350);
}

function flushSave() {
  clearTimeout(saveTimer);
  if (!dirty || !app.session || !app.state) return saveChain;
  dirty = false;
  const snapshot = JSON.parse(JSON.stringify(app.state));
  const session = app.session;
  saveChain = saveChain.then(async () => {
    const env = await seal(session, snapshot);
    await saveVault(env);
    setSaveIndicator('saved');
  }).catch((e) => {
    console.error(e);
    dirty = true;
    setSaveIndicator('error');
    toast('No se pudo guardar. Revisa el espacio del dispositivo.', 'error');
  });
  return saveChain;
}

function setSaveIndicator(st) {
  const el = document.getElementById('save-state');
  if (!el) return;
  el.dataset.state = st;
  el.textContent = st === 'saving' ? 'Guardando…' : st === 'error' ? 'Error al guardar' : 'Guardado';
}

// ---------------------------------------------------------------------------
// Render con preservación del foco. Si el dedo está pulsando, se espera a que
// termine el toque para no "robar" el clic al reconstruir la pantalla.

let pointerDown = false;
let pendingRender = false;
document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
const release = () => {
  pointerDown = false;
  if (pendingRender) setTimeout(() => { if (pendingRender) render(); }, 0);
};
document.addEventListener('pointerup', release, true);
document.addEventListener('pointercancel', release, true);

function scheduleRender() {
  if (pointerDown) { pendingRender = true; return; }
  render();
}

function render() {
  pendingRender = false;
  if (!app.state) return;
  const fk = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fk : null;
  root.replaceChildren(shell());
  if (fk) {
    const el = root.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
    if (el) el.focus({ preventScroll: true });
  }
}

function mutate(fn) {
  const m = ensureMonth(app.state, app.key, app.virtual);
  fn(m);
  queueSave();
  scheduleRender();
}

function mutateState(fn) {
  fn(app.state);
  app.virtual.clear();
  queueSave();
  scheduleRender();
}

const month = () => viewMonth(app.state, app.key, app.virtual);
const defaultDate = () => (todayISO().startsWith(app.key) ? todayISO() : '');

// ---------------------------------------------------------------------------
// Estructura general

function shell() {
  const m = month();
  const c = monthCalc(m);
  return h('div', { class: 'shell' },
    h('header', { class: 'topbar' },
      h('div', { class: 'month-nav' },
        h('button', { class: 'icon-btn', 'aria-label': 'Mes anterior', onclick: () => goMonth(-1) }, '‹'),
        h('button', { class: 'month-label', onclick: monthPicker, 'aria-label': 'Elegir mes' },
          keyLabel(app.key), app.state.months[app.key] ? null : h('small', null, 'nuevo')),
        h('button', { class: 'icon-btn', 'aria-label': 'Mes siguiente', onclick: () => goMonth(1) }, '›'),
      ),
      h('div', { class: 'top-actions' },
        h('span', { id: 'save-state', 'data-state': 'saved' }, 'Guardado'),
        h('button', { class: 'icon-btn', 'aria-label': 'Bloquear', title: 'Bloquear', onclick: () => lock() }, iconLock()),
        h('button', { class: 'icon-btn' + (app.tab === 'ajustes' ? ' active' : ''), 'aria-label': 'Ajustes', title: 'Ajustes', onclick: () => setTab('ajustes') }, iconGear()),
      ),
    ),
    h('section', { class: 'strip' },
      stripCell('Ingresos', c.income, ''),
      stripCell('Gastos', c.committed, ''),
      stripCell('Pendiente', c.pending, c.pending > 0 ? 'warn' : ''),
      stripCell('Ahorro', c.savings, 'sav'),
      stripCell('Saldo', c.balance, c.balance < 0 ? 'neg' : 'pos'),
    ),
    h('main', { class: 'view' }, viewFor(m, c)),
    h('nav', { class: 'tabbar' },
      tabBtn('ingresos', 'Ingresos', iconIn()),
      tabBtn('gastos', 'Gastos', iconOut()),
      tabBtn('totales', 'Totales', iconChart()),
    ),
  );
}

const stripCell = (label, v, cls) => h('div', { class: 'strip-cell ' + cls }, h('span', null, label), h('b', null, fmt(v)));
const tabBtn = (id, label, icon) => h('button', { class: 'tab' + (app.tab === id ? ' active' : ''), onclick: () => setTab(id), 'aria-current': app.tab === id ? 'page' : null }, icon, h('span', null, label));

function setTab(t) {
  app.tab = t;
  render();
  window.scrollTo(0, 0);
}

function goMonth(d) {
  app.key = shiftKey(app.key, d);
  render();
}

function viewFor(m, c) {
  switch (app.tab) {
    case 'ingresos': return viewIncomes(m, c);
    case 'totales': return viewTotals(m, c);
    case 'ajustes': return viewSettings();
    default: return viewExpenses(m, c);
  }
}

function newMonthBanner() {
  if (app.state.months[app.key]) return null;
  const prev = latestBefore(app.state, app.key);
  const carried = app.state.settings.carryAmounts !== false && prev;
  return h('div', { class: 'banner' },
    h('p', null, carried
      ? `Mes nuevo: se han copiado los importes y presupuestos habituales de ${keyLabel(prev.key)} (sin pagos ni transacciones). No se guarda nada hasta que hagas un cambio.`
      : 'Mes nuevo creado a partir de tu plantilla. No se guarda nada hasta que hagas un cambio.'),
    carried ? h('button', { class: 'btn small ghost', onclick: () => mutate((mm) => {
      for (const cat of ['fixed', 'baby', 'savings']) for (const it of mm[cat]) { it.amount = 0; it.budget = 0; }
      for (const i of mm.incomes) i.amount = 0;
      toast('Importes del mes en blanco');
    }) }, 'Empezar con importes en blanco') : null,
  );
}

// ---------------------------------------------------------------------------
// INGRESOS

function viewIncomes(m, c) {
  return h('div', { class: 'stack' },
    newMonthBanner(),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Ingresos del mes'), h('b', { class: 'big pos' }, fmt(c.income))),
      m.incomes.length === 0 ? h('p', { class: 'empty' }, 'Aún no hay ingresos este mes.') : null,
      h('ul', { class: 'rows' }, m.incomes.map((i) => h('li', null,
        h('button', { class: 'row-btn', onclick: () => editIncome(i) },
          h('span', { class: 'row-main' }, h('span', { class: 'row-name' }, i.name || 'Ingreso'),
            h('small', null, [i.date ? shortDate(i.date) : null, i.tpl ? 'se repite cada mes' : null, i.notes || null].filter(Boolean).join(' · '))),
          h('span', { class: 'amount' }, fmt(i.amount)),
        )))),
      h('button', { class: 'btn add', onclick: () => editIncome(null) }, '+ Añadir ingreso'),
    ),
  );
}

async function editIncome(inc) {
  const v = await formSheet({
    title: inc ? 'Editar ingreso' : 'Nuevo ingreso',
    fields: [
      { name: 'name', label: 'Descripción', type: 'text', value: inc ? inc.name : '', required: true, placeholder: 'Salario, freelance…', autofocus: !inc },
      { name: 'amount', label: 'Importe', type: 'amount', value: inc ? inc.amount : 0 },
      { name: 'date', label: 'Fecha (opcional)', type: 'date', value: inc ? inc.date : defaultDate() },
      { name: 'notes', label: 'Observaciones (opcional)', type: 'textarea', value: inc ? inc.notes : '' },
      { name: 'recurring', label: 'Repetir en los próximos meses', type: 'checkbox', value: inc ? !!inc.tpl : false, hint: 'Aparecerá automáticamente en los meses nuevos.' },
    ],
    deleteLabel: inc ? 'Eliminar' : null,
  });
  if (!v) return;
  if (v === 'delete') {
    if (!(await confirmDanger('¿Eliminar ingreso?', `«${inc.name}» se eliminará de ${keyLabel(app.key)}.`))) return;
    mutate((mm) => { mm.incomes = mm.incomes.filter((x) => x.id !== inc.id); });
    if (inc.tpl && await choose({ title: '¿Dejar de repetirlo?', message: 'Este ingreso se repetía cada mes.', buttons: [{ label: 'Quitar también de los meses nuevos', value: true, class: 'primary' }, { label: 'Seguir repitiéndolo', value: null, class: 'ghost' }] })) {
      removeTemplate('income', inc.tpl);
    }
    return;
  }
  const tpls = app.state.templates.income;
  mutate((mm) => {
    let target = inc ? mm.incomes.find((x) => x.id === inc.id) : null;
    if (!target) { target = newIncome(); mm.incomes.push(target); }
    Object.assign(target, { name: v.name, amount: v.amount, date: v.date, notes: v.notes });
    if (v.recurring) {
      let t = target.tpl && tpls.find((x) => x.id === target.tpl);
      if (!t) { t = { id: uid(), name: '', amount: 0 }; tpls.push(t); target.tpl = t.id; }
      t.name = v.name; t.amount = v.amount;
    } else if (target.tpl) {
      app.state.templates.income = tpls.filter((x) => x.id !== target.tpl);
      target.tpl = null;
    }
  });
  app.virtual.clear();
}

function removeTemplate(kind, id) {
  mutateState((st) => { st.templates[kind] = st.templates[kind].filter((t) => t.id !== id); });
}

// ---------------------------------------------------------------------------
// GASTOS

function viewExpenses(m) {
  return h('div', { class: 'stack' },
    newMonthBanner(),
    CATS.map(({ key, label }) => categorySection(m, key, label)),
    categorySection(m, SAVINGS.key, SAVINGS.label),
    reimbSection(m),
  );
}

function categorySection(m, cat, label) {
  const items = m[cat];
  const isOpen = app.open.has(cat);
  let real = 0, pending = 0, budget = 0;
  for (const it of items) { const c = itemCalc(it); real += c.real; pending += c.pending; if (c.hasBudget) budget += c.budget; }
  const isSav = cat === 'savings';
  const addLabel = cat === 'fixed' ? '+ Añadir gasto fijo' : cat === 'baby' ? '+ Añadir partida del bebé' : isSav ? '+ Añadir ahorro' : '+ Añadir gasto';
  return h('section', { class: 'card cat cat-' + cat + (isOpen ? ' open' : '') },
    h('button', { class: 'cat-head', 'aria-expanded': String(isOpen), onclick: () => { isOpen ? app.open.delete(cat) : app.open.add(cat); render(); } },
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'),
      h('span', { class: 'cat-title' }, label, h('small', null,
        (isSav
          ? ['No es gasto: se resta aparte del saldo', pending ? `por apartar ${fmt(pending)}` : null]
          : [`${items.length} partida${items.length === 1 ? '' : 's'}`, budget ? `presup. ${fmt(budget)}` : null, pending ? `pend. ${fmt(pending)}` : null]).filter(Boolean).join(' · '))),
      h('b', { class: 'cat-total' }, fmt(real)),
    ),
    isOpen ? h('div', { class: 'cat-body' },
      items.length === 0 ? h('p', { class: 'empty' }, cat === 'baby' ? 'Sin partidas. Crea una (p. ej. «Pañales» con presupuesto, o una compra puntual).' : isSav ? 'Sin ahorros este mes. Añade lo que quieras apartar (p. ej. «Fondo de emergencia»).' : 'Sin gastos este mes.') : null,
      h('ul', { class: 'items' }, items.map((it) => (it.mode === 'tx' ? txItem(cat, it) : directItem(cat, it)))),
      h('button', { class: 'btn add', onclick: () => addItem(cat) }, addLabel),
    ) : null,
  );
}

function paidCheck(checked, onToggle, label, fk) {
  return h('label', { class: 'chk', title: label },
    h('input', { type: 'checkbox', checked, 'aria-label': label, 'data-fk': fk, onchange: (e) => onToggle(e.target.checked) }),
    h('span', { class: 'box', 'aria-hidden': 'true' }));
}

function directItem(cat, it) {
  const c = itemCalc(it);
  return h('li', { class: 'item direct' + (it.paid ? ' is-paid' : '') },
    paidCheck(it.paid, (val) => mutate((mm) => { const x = mm[cat].find((i) => i.id === it.id); if (x) x.paid = val; }), `Pagado: ${it.name}`, 'p-' + it.id),
    h('button', { class: 'item-name', onclick: () => editItem(cat, it) },
      h('span', null, it.name || 'Sin nombre'),
      h('small', null, it.paid ? h('span', { class: 'ok' }, cat === 'savings' ? '✓ OK apartado' : '✓ OK pagado') : (c.real ? (cat === 'savings' ? 'por apartar' : 'pendiente') : 'sin importe'), it.date ? ' · ' + shortDate(it.date) : '')),
    h('input', {
      class: 'amt', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00', value: toInput(it.amount),
      'aria-label': `Importe de ${it.name}`, 'data-fk': 'a-' + it.id, enterkeyhint: 'done',
      onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
      onchange: (e) => {
        const v = parseAmount(e.target.value);
        if (v === null) { toast('Importe no válido. Ejemplo: 475.50', 'error'); e.target.value = toInput(it.amount); return; }
        mutate((mm) => { const x = mm[cat].find((i) => i.id === it.id); if (x) x.amount = v; });
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// REEMBOLSOS: lo que pagáis vosotros y os tienen que devolver

function reimbSection(m) {
  const items = m.reimb || [];
  const isOpen = app.open.has('reimb');
  let total = 0, pending = 0;
  for (const it of items) { total += it.amount; if (!it.paid) pending += it.amount; }
  const older = pendingReimbBefore(app.state, app.key);
  const olderTotal = older.reduce((a, o) => a + o.item.amount, 0);
  const row = (it, key) => h('li', { class: 'item direct' + (it.paid ? ' is-paid' : '') },
    paidCheck(it.paid, (val) => setReimbPaid(key, it.id, val), `Reembolsado: ${it.name}`, 'r-' + it.id),
    h('button', { class: 'item-name', onclick: () => editReimb(it, key) },
      h('span', null, it.name || 'Reembolso'),
      h('small', null, it.paid ? h('span', { class: 'ok' }, '✓ OK reembolsado') : 'por cobrar',
        [key !== app.key ? keyLabel(key) : null, it.who ? 'de ' + it.who : null, it.date ? shortDate(it.date) : null].filter(Boolean).map((x) => ' · ' + x).join(''))),
    h('span', { class: 'amount' + (it.paid ? ' muted' : ' warn') }, fmt(it.amount)));
  return h('section', { class: 'card cat cat-reimb' + (isOpen ? ' open' : '') },
    h('button', { class: 'cat-head', 'aria-expanded': String(isOpen), onclick: () => { isOpen ? app.open.delete('reimb') : app.open.add('reimb'); render(); } },
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'),
      h('span', { class: 'cat-title' }, REIMB.label, h('small', null,
        ['No es gasto: os lo devuelven', pending ? `por cobrar ${fmt(pending)}` : null, olderTotal ? `+ ${fmt(olderTotal)} de meses anteriores` : null].filter(Boolean).join(' · '))),
      h('b', { class: 'cat-total' }, fmt(total)),
    ),
    isOpen ? h('div', { class: 'cat-body' },
      items.length === 0 ? h('p', { class: 'empty' }, 'Sin reembolsos este mes. Añade lo que paguéis y os tengan que devolver.') : null,
      h('ul', { class: 'items' }, items.map((it) => row(it, app.key))),
      h('button', { class: 'btn add', onclick: () => editReimb(null, app.key) }, '+ Añadir reembolso'),
      older.length ? h('div', { class: 'older' },
        h('h3', null, `Pendientes de meses anteriores · ${fmt(olderTotal)}`),
        h('ul', { class: 'items' }, older.map((o) => row(o.item, o.key)))) : null,
    ) : null,
  );
}

function setReimbPaid(key, id, val) {
  const apply = (mm) => {
    const x = (mm.reimb || []).find((i) => i.id === id);
    if (x) { x.paid = val; x.paidDate = val ? todayISO() : ''; }
  };
  if (key === app.key) mutate(apply);
  else mutateState((st) => apply(st.months[key]));
}

async function editReimb(it, key) {
  const v = await formSheet({
    title: it ? 'Editar reembolso' : 'Nuevo reembolso',
    fields: [
      { name: 'name', label: 'Concepto', type: 'text', value: it ? it.name : '', required: true, autofocus: !it, placeholder: 'Cena de trabajo, compra para mamá…' },
      { name: 'who', label: 'Quién lo devuelve (opcional)', type: 'text', value: it ? it.who : '', placeholder: 'Empresa, seguro, familiar…' },
      { name: 'amount', label: 'Importe pagado', type: 'amount', value: it ? it.amount : 0 },
      { name: 'date', label: 'Fecha del pago', type: 'date', value: it ? it.date : defaultDate() },
      { name: 'paid', label: 'Ya nos lo devolvieron', type: 'checkbox', value: it ? it.paid : false },
      { name: 'notes', label: 'Observaciones (opcional)', type: 'textarea', value: it ? it.notes : '' },
      it ? { type: 'note', name: 'n', label: 'Si al final no os lo devuelven, elimínalo y regístralo como gasto general.' } : null,
    ].filter(Boolean),
    deleteLabel: it ? 'Eliminar' : null,
    submitLabel: it ? 'Guardar' : 'Añadir',
    validate: (x) => (x.amount <= 0 ? 'El importe debe ser mayor que 0.' : null),
  });
  if (!v) return;
  const apply = (mm) => {
    mm.reimb = mm.reimb || [];
    if (v === 'delete') { mm.reimb = mm.reimb.filter((x) => x.id !== it.id); return; }
    let target = it ? mm.reimb.find((x) => x.id === it.id) : null;
    if (!target) { target = newItem({ mode: 'direct' }); mm.reimb.push(target); }
    const wasPaid = target.paid;
    Object.assign(target, { name: v.name, who: v.who, amount: v.amount, date: v.date, paid: v.paid, notes: v.notes });
    if (v.paid && !wasPaid) target.paidDate = todayISO();
    if (!v.paid) target.paidDate = '';
  };
  if (v === 'delete' && !(await confirmDanger('¿Eliminar reembolso?', `«${it.name}» · ${fmt(it.amount)}`))) return;
  if (key === app.key) mutate(apply); else mutateState((st) => apply(st.months[key]));
}

function txItem(cat, it) {
  const c = itemCalc(it);
  const k = 'tx-' + it.id;
  const isOpen = app.open.has(k);
  const pct = c.hasBudget ? Math.min(100, (c.real / c.budget) * 100) : 0;
  const sav = cat === 'savings';
  const status = c.hasBudget
    ? (sav
      ? (c.remaining > 0 ? h('span', null, 'Faltan ', h('b', null, fmt(c.remaining)), ' para la meta') : h('span', { class: 'pos' }, '✓ Meta cumplida', c.remaining < 0 ? ` (+${fmt(-c.remaining)})` : ''))
      : (c.remaining >= 0 ? h('span', null, 'Quedan ', h('b', null, fmt(c.remaining))) : h('span', { class: 'neg' }, 'Excedido por ', h('b', null, fmt(-c.remaining)))))
    : h('span', { class: 'muted' }, 'Sin presupuesto');
  return h('li', { class: 'item tx' + (isOpen ? ' open' : '') + (c.over ? ' over' : '') },
    h('button', { class: 'tx-head', 'aria-expanded': String(isOpen), onclick: () => { isOpen ? app.open.delete(k) : app.open.add(k); render(); } },
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'),
      h('span', { class: 'item-name' },
        h('span', null, it.name || 'Sin nombre', c.allPaid && c.real ? h('span', { class: 'ok badge' }, '✓ OK') : null),
        h('small', null, `${c.count} transacc.`, c.pending ? ` · pend. ${fmt(c.pending)}` : '')),
      h('span', { class: 'tx-amounts' }, h('b', null, fmt(c.real)), c.hasBudget ? h('small', null, 'de ' + fmt(c.budget)) : null),
    ),
    c.hasBudget ? h('div', { class: 'bar' + (c.over ? ' over' : '') }, h('i', { style: { width: pct + '%' } })) : null,
    h('div', { class: 'tx-status' }, status),
    isOpen ? h('div', { class: 'tx-body' },
      h('label', { class: 'budget-row' }, h('span', null, sav ? 'Meta mensual (opcional)' : 'Presupuesto mensual'),
        h('input', {
          class: 'amt', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00', value: toInput(it.budget),
          'data-fk': 'b-' + it.id, enterkeyhint: 'done', 'aria-label': `Presupuesto de ${it.name}`,
          onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
          onchange: (e) => {
            const v = parseAmount(e.target.value);
            if (v === null || v < 0) { toast('Importe no válido', 'error'); e.target.value = toInput(it.budget); return; }
            mutate((mm) => { const x = mm[cat].find((i) => i.id === it.id); if (x) x.budget = v; });
          },
        })),
      it.tx.length === 0 ? h('p', { class: 'empty small' }, 'Sin transacciones. El gasto real empieza en $0.00.') : null,
      h('ul', { class: 'tx-list' }, [...it.tx].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((t) => h('li', { class: t.paid ? 'is-paid' : '' },
        paidCheck(t.paid, (val) => mutate((mm) => { const x = mm[cat].find((i) => i.id === it.id); const tt = x && x.tx.find((q) => q.id === t.id); if (tt) tt.paid = val; }), 'Transacción pagada', 'tp-' + t.id),
        h('button', { class: 'tx-row', onclick: () => editTx(cat, it, t) },
          h('span', { class: 'tx-date' }, t.date ? shortDate(t.date) : '—'),
          h('span', { class: 'tx-desc' }, t.desc || (t.paid ? 'Pagado' : 'Pendiente')),
          h('span', { class: 'amount' }, fmt(t.amount)))))),
      h('div', { class: 'tx-actions' },
        h('button', { class: 'btn small primary', onclick: () => editTx(cat, it, null) }, '+ Transacción'),
        h('button', { class: 'btn small ghost', onclick: () => editItem(cat, it) }, 'Opciones'),
      ),
    ) : null,
  );
}

async function editTx(cat, it, t) {
  const v = await formSheet({
    title: t ? `Editar · ${it.name}` : `Nueva transacción · ${it.name}`,
    fields: [
      { name: 'amount', label: 'Importe real', type: 'amount', value: t ? t.amount : 0, autofocus: !t },
      { name: 'date', label: 'Fecha', type: 'date', value: t ? t.date : defaultDate() },
      { name: 'desc', label: 'Descripción (opcional)', type: 'text', value: t ? t.desc : '', placeholder: 'Compra semanal, recarga…' },
      { name: 'paid', label: 'Pagado', type: 'checkbox', value: t ? t.paid : true },
    ],
    deleteLabel: t ? 'Eliminar' : null,
    validate: (x) => (x.amount <= 0 ? 'El importe debe ser mayor que 0.' : null),
  });
  if (!v) return;
  if (v === 'delete') {
    if (!(await confirmDanger('¿Eliminar transacción?', `${fmt(t.amount)}${t.desc ? ' · ' + t.desc : ''}`))) return;
    mutate((mm) => { const x = mm[cat].find((i) => i.id === it.id); if (x) x.tx = x.tx.filter((q) => q.id !== t.id); });
    return;
  }
  mutate((mm) => {
    const x = mm[cat].find((i) => i.id === it.id);
    if (!x) return;
    let target = t ? x.tx.find((q) => q.id === t.id) : null;
    if (!target) { target = newTx(); x.tx.push(target); }
    Object.assign(target, { amount: v.amount, date: v.date, desc: v.desc, paid: v.paid });
  });
  app.open.add('tx-' + it.id);
}

async function addItem(cat) {
  const isGeneral = cat === 'general';
  const isSav = cat === 'savings';
  const v = await formSheet({
    title: cat === 'fixed' ? 'Nuevo gasto fijo' : cat === 'baby' ? 'Nueva partida del bebé' : isSav ? 'Nuevo ahorro' : 'Nuevo gasto general',
    fields: [
      { name: 'name', label: 'Nombre', type: 'text', required: true, autofocus: true, placeholder: cat === 'baby' ? 'Pañales, pediatra, cuna…' : isSav ? 'Fondo de emergencia, vacaciones…' : isGeneral ? 'Cena, ropa, regalo…' : 'Gimnasio, agua…' },
      { name: 'mode', label: 'Tipo', type: 'select', value: 'direct', options: [['direct', 'Importe directo (un solo importe)'], ['tx', isSav ? 'Meta + aportaciones' : 'Presupuesto + transacciones']] },
      { name: 'amount', label: isGeneral ? 'Importe real' : 'Importe del mes', type: 'amount', value: 0, show: (x) => x.mode !== 'tx' },
      { name: 'paid', label: isSav ? 'Ya está apartado' : 'Ya está pagado', type: 'checkbox', value: false, show: (x) => x.mode !== 'tx' },
      { name: 'budget', label: isSav ? 'Meta mensual (opcional)' : 'Presupuesto mensual (opcional)', type: 'amount', value: 0, show: (x) => x.mode === 'tx', hint: isSav ? 'El ahorro del mes será la suma de las aportaciones.' : 'Es una reserva, no un gasto. El gasto real será la suma de las transacciones.' },
      isGeneral ? { name: 'date', label: 'Fecha (opcional)', type: 'date', value: defaultDate(), show: (x) => x.mode !== 'tx' } : null,
      !isGeneral ? { name: 'recurring', label: 'Repetir en los próximos meses', type: 'checkbox', value: cat === 'fixed' || cat === 'savings', hint: 'Sólo afecta a los meses que se creen a partir de ahora.' } : null,
    ].filter(Boolean),
    submitLabel: 'Añadir',
  });
  if (!v || v === 'delete') return;
  mutate((mm) => {
    const it = newItem({ name: v.name, mode: v.mode, amount: v.mode === 'tx' ? 0 : v.amount, budget: v.mode === 'tx' ? v.budget : 0, paid: v.mode === 'tx' ? false : v.paid, date: v.date || '' });
    if (v.recurring) {
      const t = { id: uid(), name: v.name, mode: v.mode, amount: it.amount, budget: it.budget };
      app.state.templates[cat].push(t);
      it.tpl = t.id;
    }
    mm[cat].push(it);
    if (v.mode === 'tx') app.open.add('tx-' + it.id);
  });
  app.virtual.clear();
}

async function editItem(cat, it) {
  const hasTpl = cat !== 'general' && it.tpl && app.state.templates[cat].some((t) => t.id === it.tpl);
  const v = await formSheet({
    title: `Opciones · ${it.name}`,
    fields: [
      { name: 'name', label: 'Nombre', type: 'text', value: it.name, required: true },
      { name: 'mode', label: 'Tipo', type: 'select', value: it.mode, options: [['direct', 'Importe directo'], ['tx', 'Presupuesto + transacciones']] },
      { name: 'amount', label: 'Importe', type: 'amount', value: it.amount, show: (x) => x.mode !== 'tx' },
      { name: 'paid', label: cat === 'savings' ? 'Apartado' : 'Pagado', type: 'checkbox', value: it.paid, show: (x) => x.mode !== 'tx' },
      { name: 'budget', label: cat === 'savings' ? 'Meta mensual' : 'Presupuesto mensual', type: 'amount', value: it.budget, show: (x) => x.mode === 'tx' },
      { name: 'note1', type: 'note', label: it.tx.length ? `Tiene ${it.tx.length} transacciones. Si cambias a importe directo se conservan, pero no cuentan hasta que vuelvas a activar el desglose.` : '', show: (x) => x.mode !== 'tx' && it.tx.length > 0 },
      { name: 'date', label: 'Fecha (opcional)', type: 'date', value: it.date },
      { name: 'notes', label: 'Observaciones', type: 'textarea', value: it.notes },
      cat !== 'general' ? { name: 'recurring', label: 'Repetir en los próximos meses', type: 'checkbox', value: !!hasTpl, hint: 'Nombre, tipo e importe se usarán en los meses nuevos. Los meses anteriores no cambian.' } : null,
    ].filter(Boolean),
    deleteLabel: 'Eliminar',
  });
  if (!v) return;
  if (v === 'delete') {
    const choice = await choose({
      title: `¿Eliminar «${it.name}»?`,
      message: hasTpl ? 'Esta partida se repite cada mes.' : `Se eliminará de ${keyLabel(app.key)}${it.tx.length ? ' junto con sus ' + it.tx.length + ' transacciones' : ''}.`,
      buttons: hasTpl
        ? [{ label: 'Sólo de este mes', value: 'month', class: 'danger' }, { label: 'De este mes y de los meses nuevos', value: 'all', class: 'danger' }, { label: 'Cancelar', value: null, class: 'ghost' }]
        : [{ label: 'Eliminar', value: 'month', class: 'danger' }, { label: 'Cancelar', value: null, class: 'ghost' }],
    });
    if (!choice) return;
    mutate((mm) => {
      mm[cat] = mm[cat].filter((x) => x.id !== it.id);
      if (it.src === 'leftover') mm.budgetsClosed = false; // vuelve a reservar el presupuesto
    });
    if (choice === 'all') removeTemplate(cat, it.tpl);
    return;
  }
  mutate((mm) => {
    const x = mm[cat].find((i) => i.id === it.id);
    if (!x) return;
    Object.assign(x, { name: v.name, mode: v.mode, date: v.date, notes: v.notes });
    if (v.mode === 'tx') x.budget = v.budget; else { x.amount = v.amount; x.paid = v.paid; }
    if (cat === 'general') return;
    const tpls = app.state.templates[cat];
    if (v.recurring) {
      let t = x.tpl && tpls.find((q) => q.id === x.tpl);
      if (!t) { t = { id: uid() }; tpls.push(t); x.tpl = t.id; }
      Object.assign(t, { name: x.name, mode: x.mode, amount: x.amount, budget: x.budget });
    } else if (hasTpl) {
      app.state.templates[cat] = tpls.filter((q) => q.id !== x.tpl);
      x.tpl = null;
    }
  });
  app.virtual.clear();
}

// ---------------------------------------------------------------------------
// TOTALES

function viewTotals(m, c) {
  const seg = h('div', { class: 'segmented', role: 'tablist' },
    [['month', 'Mes'], ['year', 'Año'], ['range', 'Varios meses']].map(([id, label]) =>
      h('button', { class: app.totalsMode === id ? 'active' : '', role: 'tab', 'aria-selected': String(app.totalsMode === id), onclick: () => { app.totalsMode = id; if (id !== 'month') app.totalsYear = parseKey(app.key).year; render(); } }, label)));
  return h('div', { class: 'stack' }, seg, app.totalsMode === 'month' ? monthTotals(c) : periodTotals());
}

function kpi(label, v, cls = '', hint = null) {
  return h('div', { class: 'kpi ' + cls }, h('span', null, label), h('b', null, fmt(v)), hint ? h('small', null, hint) : null);
}

function monthTotals(c) {
  const m = month();
  const budgeted = [];
  for (const { key, label } of CATS) for (const it of m[key]) { const ic = itemCalc(it); if (ic.hasBudget) budgeted.push({ it, ic, label }); }
  return h('div', { class: 'stack' },
    h('section', { class: 'card' },
      h('h2', null, `Resumen · ${keyLabel(app.key)}`),
      h('div', { class: 'kpis' },
        kpi('Ingresos', c.income, 'pos'),
        kpi('Gastos', c.committed, '', c.reserved ? `Reales ${fmt(c.real)} + presupuesto por gastar ${fmt(c.reserved)}` : 'Gastos reales'),
        kpi('Ahorro', c.savings, 'sav', c.savingsPending ? `Por apartar ${fmt(c.savingsPending)}` : 'No es gasto'),
        kpi('Saldo libre', c.balance, c.balance < 0 ? 'neg big' : 'pos big', 'Ingresos − gastos − ahorro'),
        kpi('Pagado', c.paid, 'pos'),
        kpi('Pendiente de pago', c.pending, c.pending ? 'warn' : ''),
        kpi('Gastado de verdad', c.real, '', 'Sin contar presupuesto por gastar'),
        kpi('Disponible tras pagos', c.cashNow, '', c.reimbPending ? 'Ingresos − pagado − apartado − adelantado sin cobrar' : 'Ingresos − pagado − apartado'),
        c.reimb ? kpi('Reembolsos por cobrar', c.reimbPending, c.reimbPending ? 'warn' : 'pos', c.reimbPending ? `De ${fmt(c.reimb)} adelantados. No afecta al saldo` : '✓ Todo cobrado') : null,
      ),
      h('p', { class: 'explain' }, (c.pending + c.savingsPending) > 0
        ? `Hoy te quedan ${fmt(c.cashNow)} tras lo pagado${c.savings ? ' y lo ya apartado' : ''}. De eso, ${fmt(c.pending)} son pagos pendientes${c.savingsPending ? `, ${fmt(c.savingsPending)} ahorro por apartar` : ''}${c.reserved ? ` y ${fmt(c.reserved)} presupuesto aún por gastar` : ''}. Lo que de verdad te queda libre: ${fmt(c.balance)}.`
        : `Todo está pagado${c.savings ? ' y apartado' : ''}${c.reserved ? ` y quedan ${fmt(c.reserved)} de presupuesto por gastar` : ''}. Saldo libre del mes: ${fmt(c.balance)}.`),
    ),
    h('section', { class: 'card' },
      h('h2', null, 'Por categoría'),
      h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Real'), h('th', null, 'Pagado'), h('th', null, 'Pend.'))),
        h('tbody', null, CATS.map(({ key, label }) => h('tr', null, h('td', null, label.replace('Gastos ', '').replace(/^\w/, (x) => x.toUpperCase())),
          h('td', null, fmt(c.cats[key].real)), h('td', null, fmt(c.cats[key].paid)), h('td', null, fmt(c.cats[key].pending))))),
        h('tfoot', null, h('tr', null, h('td', null, 'Total gastos'), h('td', null, fmt(c.real)), h('td', null, fmt(c.paid)), h('td', null, fmt(c.pending))),
          h('tr', { class: 'sav-row' }, h('td', null, 'Ahorros'), h('td', null, fmt(c.savings)), h('td', null, fmt(c.savingsDone)), h('td', null, fmt(c.savingsPending))),
          c.reimb ? h('tr', { class: 'reimb-row' }, h('td', null, 'Reembolsos'), h('td', null, fmt(c.reimb)), h('td', null, fmt(c.reimbDone)), h('td', null, fmt(c.reimbPending))) : null)),
      (c.savings || c.reimb) ? h('p', { class: 'muted small' }, 'En ahorros, «Pagado» es lo ya apartado; en reembolsos, lo que ya os devolvieron.') : null,
    ),
    h('section', { class: 'card' },
      h('h2', null, 'Presupuestos'),
      budgeted.length === 0 ? h('p', { class: 'empty' }, 'No hay partidas con presupuesto asignado este mes.') : h('div', null,
        h('div', { class: 'kpis three' }, kpi('Asignado', c.budget), kpi('Gastado', c.budgetReal), kpi(c.budgetRemaining >= 0 ? 'Restante' : 'Exceso', Math.abs(c.budgetRemaining), c.budgetRemaining < 0 ? 'neg' : 'pos')),
        h('ul', { class: 'budget-list' }, budgeted.map(({ it, ic, label }) => h('li', null,
          h('div', { class: 'bl-top' }, h('span', null, it.name, h('small', null, ' · ' + label.replace('Gastos ', ''))), h('span', null, fmt(ic.real), h('small', null, ' / ' + fmt(ic.budget)))),
          h('div', { class: 'bar' + (ic.over ? ' over' : '') }, h('i', { style: { width: Math.min(100, (ic.real / ic.budget) * 100) + '%' } })),
          h('small', { class: ic.remaining < 0 ? 'neg' : 'muted' }, ic.remaining >= 0 ? `Quedan ${fmt(ic.remaining)}` : `Excedido por ${fmt(-ic.remaining)}`)))),
        budgetCloseControls(c),
      ),
    ),
    exportCard([app.key], keyLabel(app.key)),
  );
}

function budgetCloseControls(c) {
  if (c.budgetsClosed) {
    return h('div', { class: 'close-box' },
      h('p', { class: 'explain' }, '✓ Presupuestos cerrados: el sobrante ya está en Ahorros y el presupuesto dejó de reservarse.'),
      h('button', { class: 'btn small ghost', onclick: async () => {
        if (!(await confirmDanger('¿Reabrir presupuestos?', 'Se quitará el «Sobrante de presupuestos» de Ahorros y el presupuesto sin gastar volverá a restarse del saldo.', 'Reabrir'))) return;
        mutate((mm) => reopenBudgets(mm));
      } }, 'Reabrir presupuestos'));
  }
  if (c.unspent <= 0) return null;
  return h('div', { class: 'close-box' },
    h('p', { class: 'explain' }, `Los ${fmt(c.unspent)} de presupuesto que aún no has gastado ya están restados de tu saldo libre. A fin de mes, pásalos a Ahorros.`),
    h('button', { class: 'btn small primary', onclick: async () => {
      const ok = await choose({
        title: `¿Pasar ${fmt(c.unspent)} a Ahorros?`,
        message: ['Úsalo al terminar el mes. El sobrante de tus presupuestos se añade a Ahorros como «Sobrante de presupuestos» y tu saldo libre no cambia.', 'Si luego registras más compras de este mes, se restarán del saldo como gasto real. Puedes deshacerlo con «Reabrir presupuestos».'],
        buttons: [{ label: 'Pasar a Ahorros', value: true, class: 'primary' }, { label: 'Cancelar', value: null, class: 'ghost' }],
      });
      if (!ok) return;
      mutate((mm) => { closeBudgets(mm, newItem); });
      toast('Sobrante pasado a Ahorros');
    } }, `Pasar sobrante (${fmt(c.unspent)}) a Ahorros`));
}

function periodKeys() {
  if (app.totalsMode === 'year') return yearKeys(app.totalsYear);
  return [...app.range].sort();
}

function periodTotals() {
  const year = app.totalsYear;
  const yearNav = h('div', { class: 'year-nav' },
    h('button', { class: 'icon-btn', 'aria-label': 'Año anterior', onclick: () => { app.totalsYear--; render(); } }, '‹'),
    h('b', null, String(year)),
    h('button', { class: 'icon-btn', 'aria-label': 'Año siguiente', onclick: () => { app.totalsYear++; render(); } }, '›'));
  const chips = app.totalsMode === 'range' ? h('div', { class: 'chips' },
    yearKeys(year).map((k, i) => h('button', {
      class: 'chip' + (app.range.has(k) ? ' on' : '') + (app.state.months[k] ? ' has' : ''), 'aria-pressed': String(app.range.has(k)),
      onclick: () => { app.range.has(k) ? app.range.delete(k) : app.range.add(k); render(); },
    }, MONTH_NAMES[i].slice(0, 3))),
    h('button', { class: 'chip ghost', onclick: () => { app.range.clear(); render(); } }, 'Limpiar')) : null;

  const keys = periodKeys();
  const head = h('section', { class: 'card' }, yearNav, chips,
    app.totalsMode === 'range' ? h('p', { class: 'muted small' }, keys.length ? `${keys.length} mes${keys.length > 1 ? 'es' : ''} seleccionado${keys.length > 1 ? 's' : ''}${[...new Set(keys.map((k) => k.slice(0, 4)))].length > 1 ? ' (de varios años)' : ''}` : 'Toca los meses que quieras comparar (puedes cambiar de año).') : null);
  if (!keys.length) return head;

  const p = periodCalc(app.state, keys);
  const t = p.totals;
  const shortLbl = (k) => MONTH_NAMES[parseKey(k).month - 1].slice(0, 3) + (app.totalsMode === 'range' && [...new Set(keys.map((x) => x.slice(0, 4)))].length > 1 ? k.slice(2, 4) : '');
  const label = app.totalsMode === 'year' ? `Año ${year}` : 'Selección';

  return h('div', { class: 'stack' }, head,
    h('section', { class: 'card' },
      h('h2', null, `${label} · acumulado`),
      h('div', { class: 'kpis' },
        kpi('Ingresos', t.income, 'pos'),
        kpi('Gastos', t.committed, '', t.reserved ? `Reales ${fmt(t.real)} + reservado ${fmt(t.reserved)}` : 'Gastos reales'),
        kpi('Ahorro acumulado', t.savings, 'sav', `Media ${fmt(p.avg.savings)}/mes`),
        kpi('Saldo libre acumulado', t.balance, t.balance < 0 ? 'neg big' : 'pos big', `Media ${fmt(p.avg.balance)}/mes · ${p.monthsWithData} meses con datos`),
        kpi('Pagado', t.paid, 'pos'),
        kpi('Pendiente', t.pending, t.pending ? 'warn' : ''),
      ),
    ),
    h('section', { class: 'card' },
      h('h2', null, 'Gasto real y ahorro por mes'),
      stackedBars(p.months.map((mm) => ({
        label: shortLbl(mm.key), marker: mm.income,
        parts: [{ value: mm.cats.fixed.real, cls: 'c-fixed' }, { value: mm.cats.baby.real, cls: 'c-baby' }, { value: mm.cats.general.real, cls: 'c-general' }, { value: mm.reserved, cls: 'c-reserved' }, { value: mm.savings, cls: 'c-savings' }],
      }))),
      legend([['c-fixed', 'Fijos'], ['c-baby', 'Bebé'], ['c-general', 'Generales'], ['c-reserved', 'Presupuesto por gastar'], ['c-savings', 'Ahorro'], ['marker', 'Ingresos']]),
    ),
    h('section', { class: 'card' },
      h('h2', null, 'Evolución del saldo libre mensual'),
      balanceBars(p.months.map((mm) => ({ label: shortLbl(mm.key), value: mm.balance, empty: !mm.hasData }))),
    ),
    h('section', { class: 'card' },
      h('h2', null, 'Comparación entre meses'),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['Mes', 'Ingresos', 'Gastos', 'Ahorro', 'Saldo'].map((x) => h('th', null, x)))),
        h('tbody', null, p.months.map((mm) => h('tr', { class: mm.hasData ? '' : 'dim' },
          h('td', null, shortLbl(mm.key)), h('td', null, mm.hasData ? fmt(mm.income) : '—'), h('td', null, mm.hasData ? fmt(mm.committed) : '—'),
          h('td', null, mm.hasData ? fmt(mm.savings) : '—'), h('td', { class: mm.balance < 0 ? 'neg' : '' }, mm.hasData ? fmt(mm.balance) : '—')))),
        h('tfoot', null, h('tr', null, h('td', null, 'Total'), h('td', null, fmt(t.income)), h('td', null, fmt(t.committed)), h('td', null, fmt(t.savings)), h('td', { class: t.balance < 0 ? 'neg' : '' }, fmt(t.balance))))))),
    h('section', { class: 'card' },
      h('h2', null, 'Por categoría'),
      h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Total'), h('th', null, 'Promedio/mes'), h('th', null, '%'))),
        h('tbody', null, [['fixed', 'Fijos'], ['baby', 'Bebé'], ['general', 'Generales']].map(([k, lab]) => h('tr', null,
          h('td', null, lab), h('td', null, fmt(t[k])), h('td', null, fmt(p.avg[k])), h('td', null, t.real ? Math.round((t[k] / t.real) * 100) + '%' : '—')))),
        h('tfoot', null, h('tr', null, h('td', null, 'Total gastos'), h('td', null, fmt(t.real)), h('td', null, fmt(p.avg.real)), h('td', null, '')),
          h('tr', { class: 'sav-row' }, h('td', null, 'Ahorros'), h('td', null, fmt(t.savings)), h('td', null, fmt(p.avg.savings)), h('td', null, '')),
          t.reimb ? h('tr', { class: 'reimb-row' }, h('td', null, 'Reembolsos'), h('td', null, fmt(t.reimb)), h('td', { colspan: 2 }, t.reimbPending ? `por cobrar ${fmt(t.reimbPending)}` : 'todo cobrado')) : null)),
      h('p', { class: 'muted small' }, `Promedios calculados sólo con los ${p.monthsWithData} meses que tienen datos reales; los presupuestos no cuentan.`),
    ),
    h('section', { class: 'card' },
      h('h2', null, 'Presupuesto frente a gasto real'),
      p.budgets.length === 0 ? h('p', { class: 'empty' }, 'No hay partidas con presupuesto en este período.') : h('div', null,
        h('div', { class: 'kpis three' }, kpi('Presupuestado', t.budget), kpi('Gastado', t.budgetReal), kpi(t.budget - t.budgetReal >= 0 ? 'Por debajo' : 'Por encima', Math.abs(t.budget - t.budgetReal), t.budget - t.budgetReal >= 0 ? 'pos' : 'neg')),
        h('ul', { class: 'budget-list' }, p.budgets.map((e) => h('li', null,
          h('div', { class: 'bl-top' }, h('span', null, e.name, h('small', null, ` · ${e.catLabel.replace('Gastos ', '')} · ${e.months} m`)),
            h('span', { class: e.diff < 0 ? 'neg' : 'pos' }, e.diff < 0 ? `+${fmt(-e.diff)} más de lo previsto` : `${fmt(e.diff)} menos`)),
          h('div', { class: 'bar' + (e.real > e.budget ? ' over' : '') }, h('i', { style: { width: Math.min(100, (e.real / e.budget) * 100) + '%' } })),
          h('small', { class: 'muted' }, `Real ${fmt(e.real)} de ${fmt(e.budget)}${e.monthsOver ? ` · excedido en ${e.monthsOver} mes${e.monthsOver > 1 ? 'es' : ''}` : ''}`)))),
      ),
    ),
    p.topItems.length ? h('section', { class: 'card' },
      h('h2', null, 'Dónde se va el dinero'),
      h('ul', { class: 'rank' }, p.topItems.slice(0, 10).map((e) => h('li', null,
        h('span', null, e.name, h('small', null, ' · ' + e.catLabel.replace('Gastos ', ''))),
        h('span', null, fmt(e.real), h('small', null, ` · ${fmt(e.avg)}/mes`)))))) : null,
    exportCard(keys, label),
  );
}

function exportCard(keys, label) {
  return h('section', { class: 'card' },
    h('h2', null, 'Exportar informe'),
    h('p', { class: 'muted small' }, `${label}. Los archivos exportados NO están cifrados: guárdalos en un lugar seguro.`),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn primary', onclick: (e) => exportPdf(keys, e.currentTarget) }, 'Descargar PDF'),
      h('button', { class: 'btn', onclick: (e) => exportXlsx(keys, e.currentTarget) }, 'Descargar Excel'),
    ));
}

async function exportPdf(keys, btn) {
  btn.disabled = true;
  try {
    const { buildPdf } = await import('./pdf.js');
    const blob = await buildPdf(app.state, keys);
    await saveFile(blob, fileSlug(keys) + '.pdf');
  } catch (e) {
    console.error(e);
    toast('No se pudo generar el PDF', 'error');
  } finally { btn.disabled = false; }
}

async function exportXlsx(keys, btn) {
  btn.disabled = true;
  try {
    const bytes = buildXlsx(workbookSheets(app.state, keys));
    await saveFile(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileSlug(keys) + '.xlsx');
  } catch (e) {
    console.error(e);
    toast('No se pudo generar el Excel', 'error');
  } finally { btn.disabled = false; }
}

// ---------------------------------------------------------------------------
// Selector de mes

function monthPicker() {
  let year = parseKey(app.key).year;
  const body = h('div');
  const dlg = infoSheet('Elegir mes', body);
  const draw = () => {
    body.replaceChildren(
      h('div', { class: 'year-nav' },
        h('button', { class: 'icon-btn', 'aria-label': 'Año anterior', onclick: () => { year--; draw(); } }, '‹'),
        h('b', null, String(year)),
        h('button', { class: 'icon-btn', 'aria-label': 'Año siguiente', onclick: () => { year++; draw(); } }, '›')),
      h('div', { class: 'month-grid' }, MONTH_NAMES.map((n, i) => {
        const k = monthKey(year, i + 1);
        return h('button', {
          class: 'month-cell' + (k === app.key ? ' current' : '') + (app.state.months[k] ? ' has' : ''),
          onclick: () => { app.key = k; dlg.close(); render(); },
        }, n.slice(0, 3));
      })),
      h('p', { class: 'muted small' }, 'Los meses con punto ya tienen datos guardados.'),
      h('button', { class: 'btn ghost', onclick: () => { app.key = monthKey(now.getFullYear(), now.getMonth() + 1); dlg.close(); render(); } }, 'Ir al mes actual'),
    );
  };
  draw();
}

// ---------------------------------------------------------------------------
// AJUSTES

function viewSettings() {
  const st = app.state;
  const days = st.meta.lastBackup ? Math.floor((Date.now() - st.meta.lastBackup) / 86400000) : null;
  const tplList = (kind, title) => h('div', { class: 'tpl-group' },
    h('h3', null, title),
    st.templates[kind].length === 0 ? h('p', { class: 'muted small' }, 'Ninguna.') : null,
    h('ul', { class: 'rows' }, st.templates[kind].map((t) => h('li', null, h('button', { class: 'row-btn', onclick: () => editTemplate(kind, t) },
      h('span', { class: 'row-main' }, h('span', { class: 'row-name' }, t.name),
        h('small', null, kind === 'income' ? 'ingreso' : t.mode === 'tx' ? 'presupuesto + transacciones' : 'importe directo')),
      h('span', { class: 'amount muted' }, t.mode === 'tx' ? (t.budget ? fmt(t.budget) : '') : (t.amount ? fmt(t.amount) : '')))))),
    h('button', { class: 'btn small ghost', onclick: () => editTemplate(kind, null) }, '+ Añadir'));

  return h('div', { class: 'stack' },
    h('section', { class: 'card' },
      h('h2', null, 'Seguridad'),
      h('p', { class: 'muted small' }, 'Tus datos se guardan cifrados (AES-256) sólo en este dispositivo. La contraseña no se guarda en ningún sitio.'),
      h('label', { class: 'form-row inline' }, h('span', { class: 'form-label' }, 'Bloqueo automático tras'),
        h('select', { onchange: (e) => mutateState((s) => { s.settings.autoLockMin = Number(e.target.value); }) },
          [1, 2, 5, 10, 15, 30].map((n) => h('option', { value: n, selected: st.settings.autoLockMin === n }, `${n} min sin uso`)))),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn', onclick: () => lock() }, 'Bloquear ahora'),
        h('button', { class: 'btn ghost', onclick: changePassword }, 'Cambiar contraseña')),
    ),
    h('section', { class: 'card' + (days === null || days > 30 ? ' attention' : '') },
      h('h2', null, 'Copia de seguridad'),
      h('p', { class: 'small' }, days === null ? 'Todavía no has hecho ninguna copia. Si pierdes el teléfono o borras los datos del navegador, perderás la información.' : `Última copia: hace ${days} día${days === 1 ? '' : 's'}.`),
      h('p', { class: 'muted small' }, 'La copia es un archivo cifrado con tu contraseña actual. Guárdalo fuera del teléfono (correo, nube, ordenador). Sirve para restaurar o pasar los datos a otro dispositivo.'),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn primary', onclick: exportBackup }, 'Descargar copia cifrada'),
        h('button', { class: 'btn ghost', onclick: () => importBackup(false) }, 'Restaurar copia')),
    ),
    h('section', { class: 'card' },
      h('h2', null, 'Partidas que se repiten cada mes'),
      h('p', { class: 'muted small' }, 'Se usan al crear un mes nuevo. Cambiarlas no modifica los meses ya creados (para el mes actual, edítalo en Gastos o Ingresos).'),
      tplList('fixed', 'Gastos fijos'),
      tplList('baby', 'Gastos del bebé'),
      tplList('savings', 'Ahorros'),
      tplList('income', 'Ingresos'),
      h('label', { class: 'form-check' },
        h('input', { type: 'checkbox', checked: st.settings.carryAmounts !== false, onchange: (e) => mutateState((s) => { s.settings.carryAmounts = e.target.checked; }) }),
        h('span', { class: 'box', 'aria-hidden': 'true' }),
        h('span', null, 'Copiar importes y presupuestos del mes anterior al crear un mes', h('small', null, 'Los pagos y las transacciones nunca se copian.'))),
    ),
    h('section', { class: 'card' },
      h('h2', null, 'Apariencia'),
      h('div', { class: 'segmented' }, [['dark', 'Tierra oscuro'], ['light', 'Arena claro']].map(([id, lab]) =>
        h('button', { class: st.settings.theme === id ? 'active' : '', onclick: () => { mutateState((s) => { s.settings.theme = id; }); applyTheme(id); } }, lab))),
    ),
    h('section', { class: 'card' },
      h('h2', null, 'Instalar en el móvil'),
      installHelp(),
    ),
    h('section', { class: 'card danger-zone' },
      h('h2', null, 'Borrar datos'),
      h('p', { class: 'muted small' }, 'Elimina todos los datos de este dispositivo. No se puede deshacer: descarga antes una copia.'),
      h('button', { class: 'btn danger', onclick: wipeAll }, 'Borrar todo'),
    ),
    h('p', { class: 'muted small center' }, 'Finanzas personales · v1.3 · funciona sin conexión'),
  );
}

async function editTemplate(kind, t) {
  const isIncome = kind === 'income';
  const v = await formSheet({
    title: t ? `Plantilla · ${t.name}` : 'Nueva partida recurrente',
    fields: [
      { type: 'note', name: 'n', label: 'Sólo afecta a los meses que se creen a partir de ahora.' },
      { name: 'name', label: 'Nombre', type: 'text', value: t ? t.name : '', required: true, autofocus: !t },
      isIncome ? null : { name: 'mode', label: 'Tipo', type: 'select', value: t ? t.mode : 'direct', options: [['direct', 'Importe directo'], ['tx', 'Presupuesto + transacciones']] },
      { name: 'amount', label: 'Importe habitual', type: 'amount', value: t ? t.amount : 0, show: (x) => isIncome || x.mode !== 'tx' },
      isIncome ? null : { name: 'budget', label: 'Presupuesto habitual', type: 'amount', value: t ? t.budget : 0, show: (x) => x.mode === 'tx' },
    ].filter(Boolean),
    deleteLabel: t ? 'Quitar' : null,
  });
  if (!v) return;
  if (v === 'delete') { removeTemplate(kind, t.id); toast('Quitada de los meses nuevos'); return; }
  mutateState((s) => {
    let target = t ? s.templates[kind].find((x) => x.id === t.id) : null;
    if (!target) { target = { id: uid() }; s.templates[kind].push(target); }
    target.name = v.name; target.amount = v.amount || 0;
    if (!isIncome) { target.mode = v.mode; target.budget = v.budget || 0; }
  });
}

function installHelp() {
  return h('div', { class: 'help small' },
    h('p', null, h('b', null, 'iPhone (Safari): '), 'abre la dirección de la app en Safari → botón Compartir (cuadrado con flecha) → «Añadir a pantalla de inicio» → Añadir.'),
    h('p', null, h('b', null, 'Android (Chrome): '), 'abre la dirección en Chrome → menú ⋮ → «Instalar aplicación» o «Añadir a pantalla de inicio» → Instalar.'),
    h('p', { class: 'muted' }, 'Los datos de la app instalada y los del navegador pueden estar separados en iPhone: instálala primero y crea tu contraseña desde el icono.'));
}

// ---------------------------------------------------------------------------
// Copias de seguridad

async function exportBackup() {
  await flushSave();
  app.state.meta.lastBackup = Date.now();
  const env = await seal(app.session, app.state);
  queueSave();
  const d = todayISO();
  await saveFile(new Blob([JSON.stringify(env)], { type: 'application/json' }), `finanzas-copia-cifrada-${d}.json`);
  toast('Copia cifrada creada');
  render();
}

async function readBackupFile() {
  const file = await pickFile('.json,application/json');
  if (!file) return null;
  if (file.size > 20 * 1024 * 1024) { toast('El archivo es demasiado grande', 'error'); return null; }
  let env;
  try { env = JSON.parse(await file.text()); } catch { env = null; }
  if (!isEnvelope(env)) { toast('Ese archivo no es una copia de esta app', 'error'); return null; }
  return env;
}

/** fromSetup: restaurar en un dispositivo nuevo (la contraseña de la copia pasa a ser la de la app). */
async function importBackup(fromSetup) {
  const env = await readBackupFile();
  if (!env) return;
  const v = await formSheet({
    title: 'Restaurar copia',
    fields: [
      { type: 'note', name: 'n', label: `Copia del ${env.savedAt ? new Date(env.savedAt).toLocaleString('es-PA') : '—'}. Escribe la contraseña con la que se creó.` },
      { name: 'pass', label: 'Contraseña de la copia', type: 'password', required: true, autofocus: true },
    ],
    submitLabel: 'Abrir copia',
  });
  if (!v || v === 'delete') return;
  let opened;
  try {
    toast('Comprobando…');
    opened = await open(env, v.pass);
  } catch {
    toast('Contraseña incorrecta o archivo dañado', 'error');
    return;
  }
  let data;
  try { data = normalizeState(opened.data); } catch { toast('El contenido de la copia no es válido', 'error'); return; }
  const n = Object.keys(data.months).length;
  if (!fromSetup) {
    const ok = await choose({
      title: '¿Reemplazar los datos actuales?',
      message: [`La copia contiene ${n} mes${n === 1 ? '' : 'es'} con datos.`, 'Todos los datos actuales de este dispositivo se sustituirán por los de la copia. Tu contraseña actual se mantiene.'],
      buttons: [{ label: 'Reemplazar', value: true, class: 'danger' }, { label: 'Cancelar', value: null, class: 'ghost' }],
    });
    if (!ok) return;
    app.state = data;
  } else {
    app.state = data;
    app.session = opened.session;
  }
  app.virtual.clear();
  dirty = true;
  await flushSave();
  applyTheme(app.state.settings.theme);
  toast(`Copia restaurada (${n} meses)`);
  startSessionUi();
}

// ---------------------------------------------------------------------------
// Bloqueo, contraseña y arranque

async function changePassword() {
  const v = await formSheet({
    title: 'Cambiar contraseña',
    fields: [
      { name: 'old', label: 'Contraseña actual', type: 'password', required: true, autofocus: true },
      { name: 'p1', label: 'Nueva contraseña', type: 'password', required: true, autocomplete: 'new-password', hint: `Mínimo ${MIN_PASSPHRASE} caracteres. Mejor una frase de 4 o más palabras.` },
      { name: 'p2', label: 'Repite la nueva contraseña', type: 'password', required: true, autocomplete: 'new-password' },
    ],
    validate: (x) => (x.p1.length < MIN_PASSPHRASE ? `La nueva contraseña debe tener al menos ${MIN_PASSPHRASE} caracteres.` : x.p1 !== x.p2 ? 'Las contraseñas nuevas no coinciden.' : null),
  });
  if (!v || v === 'delete') return;
  await flushSave();
  try { await open(await loadVault(), v.old); } catch { toast('La contraseña actual no es correcta', 'error'); return; }
  app.session = await createSession(v.p1);
  dirty = true;
  await flushSave();
  toast('Contraseña cambiada. Descarga una copia nueva: las anteriores siguen usando la contraseña antigua.');
}

async function wipeAll() {
  const v = await formSheet({
    title: 'Borrar todos los datos',
    fields: [{ type: 'note', name: 'n', label: 'Se eliminarán todos los meses, partidas y ajustes de este dispositivo. Escribe BORRAR para confirmar.' },
      { name: 'w', label: 'Confirmación', type: 'text', required: true }],
    submitLabel: 'Borrar definitivamente',
    validate: (x) => (x.w !== 'BORRAR' ? 'Escribe BORRAR en mayúsculas.' : null),
  });
  if (!v || v === 'delete') return;
  clearTimeout(saveTimer); dirty = false;
  await wipeVault();
  app.state = null; app.session = null;
  location.reload();
}

async function lock() {
  if (!app.state) return;
  await flushSave();
  app.state = null;
  app.session = null;
  app.virtual.clear();
  document.querySelectorAll('dialog').forEach((d) => d.close());
  showLock();
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('theme', theme); } catch { /* sin almacenamiento */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#efe4d2' : '#1f1915');
}

// Intentos fallidos (disuasión local; la protección real es el cifrado)
function failInfo() {
  try { return JSON.parse(localStorage.getItem('unlock-fails') || '{"n":0,"until":0}'); } catch { return { n: 0, until: 0 }; }
}
function setFailInfo(f) { try { localStorage.setItem('unlock-fails', JSON.stringify(f)); } catch { /* */ } }

function lockScreen(content) {
  root.replaceChildren(h('div', { class: 'lock' },
    h('img', { src: 'icons/icon-192.png', alt: '', class: 'lock-logo', width: 72, height: 72 }),
    h('h1', null, 'Finanzas personales'),
    content));
}

async function showLock() {
  let vault = null;
  try { vault = await loadVault(); } catch (e) { console.error(e); }
  if (!vault) return showSetup();
  const err = h('p', { class: 'form-error', role: 'alert' });
  const pass = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Contraseña', 'aria-label': 'Contraseña', enterkeyhint: 'go' });
  const btn = h('button', { type: 'submit', class: 'btn primary block' }, 'Desbloquear');
  const form = h('form', { class: 'lock-form', onsubmit: async (e) => {
    e.preventDefault();
    const f = failInfo();
    if (f.until > Date.now()) { err.textContent = `Demasiados intentos. Espera ${Math.ceil((f.until - Date.now()) / 1000)} s.`; return; }
    if (!pass.value) return;
    btn.disabled = true; btn.textContent = 'Abriendo…'; err.textContent = '';
    try {
      const { session, data } = await open(vault, pass.value);
      setFailInfo({ n: 0, until: 0 });
      app.session = session;
      app.state = normalizeState(data);
      startSessionUi();
    } catch {
      f.n += 1;
      if (f.n >= 5) f.until = Date.now() + Math.min(15 * 60, 30 * 2 ** (f.n - 5)) * 1000;
      setFailInfo(f);
      err.textContent = f.n >= 5 ? `Contraseña incorrecta. Espera ${Math.ceil((f.until - Date.now()) / 1000)} s antes de reintentar.` : 'Contraseña incorrecta.';
      btn.disabled = false; btn.textContent = 'Desbloquear';
      pass.select();
    }
  } }, pass, btn, err);
  lockScreen([
    h('p', { class: 'muted' }, 'Tus datos están cifrados en este dispositivo.'),
    form,
    h('button', { class: 'link', onclick: forgotPassword }, '¿Olvidaste la contraseña?'),
  ]);
  setTimeout(() => pass.focus(), 50);
}

async function forgotPassword() {
  const r = await choose({
    title: 'Contraseña olvidada',
    message: ['Por seguridad, la contraseña no se puede recuperar: sin ella nadie (ni tú) puede descifrar los datos.',
      'Opciones: recordar la contraseña, o borrar los datos de este dispositivo y restaurar una copia de seguridad (necesitarás la contraseña con la que se hizo la copia).'],
    buttons: [{ label: 'Borrar datos de este dispositivo', value: 'wipe', class: 'danger' }, { label: 'Volver', value: null, class: 'ghost' }],
  });
  if (r === 'wipe') {
    const ok = await confirmDanger('¿Seguro?', 'Se eliminarán todos los datos cifrados de este dispositivo.', 'Borrar');
    if (ok) { await wipeVault(); setFailInfo({ n: 0, until: 0 }); location.reload(); }
  }
}

function strength(p) {
  let score = 0;
  if (p.length >= 8) score++;
  if (p.length >= 12) score++;
  if (p.length >= 16) score++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score++;
  if (/\d/.test(p) && /[^\w]/.test(p)) score++;
  if (/^(.)\1+$/.test(p) || /^(1234|abcd|qwer|pass|contr)/i.test(p)) score = Math.min(score, 1);
  return Math.min(4, score);
}

function showSetup() {
  const err = h('p', { class: 'form-error', role: 'alert' });
  const p1 = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Nueva contraseña', 'aria-label': 'Nueva contraseña' });
  const p2 = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Repite la contraseña', 'aria-label': 'Repite la contraseña' });
  const meter = h('div', { class: 'meter', 'data-s': '0' }, h('i'));
  const meterLabel = h('small', { class: 'muted' }, ' ');
  p1.addEventListener('input', () => {
    const sc = p1.value ? strength(p1.value) : 0;
    meter.dataset.s = String(sc);
    meterLabel.textContent = p1.value ? ['Muy débil', 'Débil', 'Aceptable', 'Buena', 'Muy buena'][sc] : ' ';
  });
  const btn = h('button', { type: 'submit', class: 'btn primary block' }, 'Crear y empezar');
  const form = h('form', { class: 'lock-form', onsubmit: async (e) => {
    e.preventDefault();
    if (p1.value.length < MIN_PASSPHRASE) { err.textContent = `Usa al menos ${MIN_PASSPHRASE} caracteres (mejor una frase de varias palabras).`; return; }
    if (p1.value !== p2.value) { err.textContent = 'Las contraseñas no coinciden.'; return; }
    btn.disabled = true; btn.textContent = 'Preparando cifrado…';
    app.session = await createSession(p1.value);
    app.state = newState();
    dirty = true;
    await flushSave();
    requestPersistence();
    startSessionUi();
    toast('Listo. Recuerda descargar copias de seguridad.');
  } }, p1, meter, meterLabel, p2, btn, err);
  lockScreen([
    h('p', null, 'Crea una contraseña para cifrar tus datos en este dispositivo.'),
    h('p', { class: 'muted small' }, 'Importante: no se puede recuperar si la olvidas. Guarda copias de seguridad desde Ajustes.'),
    form,
    h('button', { class: 'link', onclick: () => importBackup(true) }, 'Tengo una copia de seguridad (cambio de teléfono)'),
  ]);
  setTimeout(() => p1.focus(), 50);
}

function startSessionUi() {
  app.lastActivity = Date.now();
  applyTheme(app.state.settings.theme);
  render();
}

// Bloqueo automático por inactividad o al volver tras un tiempo en segundo plano
['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => { app.lastActivity = Date.now(); }, { passive: true, capture: true }));
setInterval(() => {
  if (app.state && Date.now() - app.lastActivity > app.state.settings.autoLockMin * 60000) lock();
}, 10000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { flushSave(); app.hiddenAt = Date.now(); return; }
  if (app.state && app.hiddenAt && Date.now() - app.hiddenAt > app.state.settings.autoLockMin * 60000) lock();
  app.hiddenAt = null;
});
window.addEventListener('pagehide', () => { flushSave(); });

// Iconos (SVG en línea, sin dependencias)
function icon(paths) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'ico');
  for (const d of paths) { const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); svg.append(p); }
  return svg;
}
const iconLock = () => icon(['M7 11V8a5 5 0 0 1 10 0v3', 'M5 11h14v10H5z']);
const iconGear = () => icon(['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z']);
const iconIn = () => icon(['M12 19V5', 'M5 12l7-7 7 7']);
const iconOut = () => icon(['M12 5v14', 'M19 12l-7 7-7-7']);
const iconChart = () => icon(['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2']);

// Service worker (funcionamiento sin conexión) y aviso de actualización
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = (w) => {
      const bar = h('div', { class: 'update-bar' }, 'Hay una versión nueva de la app.',
        h('button', { class: 'btn small primary', onclick: async () => { await flushSave(); w.postMessage('skipWaiting'); } }, 'Actualizar'));
      document.body.append(bar);
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
  }).catch((e) => console.warn('SW', e));
  // Recargar sólo cuando una versión nueva sustituye a otra (no en la primera instalación)
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloading) { reloading = true; location.reload(); } });
}

// Arranque
try { applyTheme(localStorage.getItem('theme') === 'light' ? 'light' : 'dark'); } catch { applyTheme('dark'); }
if (!globalThis.crypto || !globalThis.crypto.subtle || !window.indexedDB) {
  lockScreen(h('p', { class: 'form-error' }, 'Este navegador no permite el cifrado seguro. Abre la app desde una dirección HTTPS en un navegador actualizado (Safari o Chrome).'));
} else {
  showLock();
}

// Exponer para pruebas automáticas (no contiene datos).
window.__finanzas = { get unlocked() { return !!app.state; } };
