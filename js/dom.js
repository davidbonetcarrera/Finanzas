// Utilidades de interfaz. Todo el texto se inserta con textContent (nunca
// innerHTML), así ningún dato escrito por el usuario puede inyectar código.

import { parseAmount, toInput } from './money.js';

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  setProps(el, props);
  append(el, children);
  return el;
}

const SVGNS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  append(el, children);
  return el;
}

function setProps(el, props) {
  if (!props) return;
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export function shortDate(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${Number(d)} ${MES_CORTO[Number(m) - 1]}`;
}

// ---------------------------------------------------------------------------
// Hojas modales (formularios) basadas en <dialog>

function makeDialog(className = '') {
  const dlg = h('dialog', { class: 'sheet ' + className });
  document.body.append(dlg);
  dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 50));
  // cerrar tocando fuera
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close('cancel'); });
  return dlg;
}

/**
 * Formulario en una hoja inferior. Devuelve una promesa con los valores,
 * 'delete' si se pulsa Eliminar, o null si se cancela.
 * field: { name, label, type: text|amount|date|textarea|checkbox|select|password|note, value, options, required, hint, placeholder, show(values) }
 */
export function formSheet({ title, fields, submitLabel = 'Guardar', deleteLabel = null, onChange = null, validate = null }) {
  return new Promise((resolve) => {
    const dlg = makeDialog();
    const inputs = {};
    const rows = {};
    const errorBox = h('p', { class: 'form-error', role: 'alert' });
    const form = h('form', { method: 'dialog', novalidate: true });

    const values = () => {
      const v = {};
      for (const f of fields) {
        const el = inputs[f.name];
        if (!el) continue;
        if (f.type === 'checkbox') v[f.name] = el.checked;
        else if (f.type === 'amount') v[f.name] = parseAmount(el.value);
        else v[f.name] = el.value.trim();
      }
      return v;
    };
    const refreshVisibility = () => {
      const v = values();
      for (const f of fields) if (f.show && rows[f.name]) rows[f.name].hidden = !f.show(v);
    };

    for (const f of fields) {
      let row;
      if (f.type === 'note') {
        row = h('p', { class: 'form-note' }, f.label);
      } else if (f.type === 'checkbox') {
        const el = h('input', { type: 'checkbox', checked: !!f.value, name: f.name });
        inputs[f.name] = el;
        row = h('label', { class: 'form-check' }, el, h('span', { class: 'box', 'aria-hidden': 'true' }), h('span', null, f.label, f.hint ? h('small', null, f.hint) : null));
      } else {
        let el;
        if (f.type === 'textarea') el = h('textarea', { rows: 2, name: f.name, maxlength: 500, placeholder: f.placeholder || '' });
        else if (f.type === 'select') el = h('select', { name: f.name }, f.options.map(([val, lab]) => h('option', { value: val, selected: val === f.value }, lab)));
        else if (f.type === 'amount') el = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', name: f.name, placeholder: f.placeholder || '0.00', class: 'amount-input' });
        else if (f.type === 'date') el = h('input', { type: 'date', name: f.name });
        else if (f.type === 'password') el = h('input', { type: 'password', name: f.name, autocomplete: f.autocomplete || 'current-password' });
        else el = h('input', { type: 'text', name: f.name, maxlength: 80, autocomplete: 'off', placeholder: f.placeholder || '' });
        if (f.type !== 'select') el.value = f.type === 'amount' ? toInput(f.value) : (f.value ?? '');
        inputs[f.name] = el;
        row = h('label', { class: 'form-row' }, h('span', { class: 'form-label' }, f.label), el, f.hint ? h('small', { class: 'form-hint' }, f.hint) : null);
      }
      rows[f.name] = row;
      form.append(row);
    }
    form.addEventListener('input', () => { refreshVisibility(); if (onChange) onChange(values(), inputs); });
    form.addEventListener('change', () => { refreshVisibility(); if (onChange) onChange(values(), inputs); });

    const actions = h('div', { class: 'sheet-actions' },
      deleteLabel ? h('button', { type: 'button', class: 'btn danger ghost', onclick: () => { dlg.close(); resolve('delete'); } }, deleteLabel) : null,
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => { dlg.close(); resolve(null); } }, 'Cancelar'),
      h('button', { type: 'submit', class: 'btn primary' }, submitLabel),
    );
    form.append(errorBox, actions);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = values();
      for (const f of fields) {
        if (rows[f.name] && rows[f.name].hidden) continue;
        if (f.type === 'amount' && v[f.name] === null) { errorBox.textContent = `${f.label}: importe no válido. Ejemplo: 475.50`; inputs[f.name].focus(); return; }
        if (f.required && !v[f.name]) { errorBox.textContent = `${f.label}: campo obligatorio.`; inputs[f.name].focus(); return; }
      }
      const err = validate ? validate(v) : null;
      if (err) { errorBox.textContent = err; return; }
      dlg.close();
      resolve(v);
    });
    dlg.addEventListener('cancel', () => resolve(null));
    dlg.append(h('div', { class: 'sheet-grip', 'aria-hidden': 'true' }), h('h2', { class: 'sheet-title' }, title), form);
    refreshVisibility();
    dlg.showModal();
    const firstField = fields.find((f) => f.autofocus);
    if (firstField) setTimeout(() => inputs[firstField.name].focus(), 60);
  });
}

/** Diálogo de confirmación con botones. Devuelve el `value` del botón pulsado o null. */
export function choose({ title, message, buttons }) {
  return new Promise((resolve) => {
    const dlg = makeDialog('small');
    const done = (v) => { dlg.close(); resolve(v); };
    dlg.addEventListener('cancel', () => resolve(null));
    dlg.append(
      h('h2', { class: 'sheet-title' }, title),
      message ? (Array.isArray(message) ? message.map((m) => h('p', { class: 'sheet-msg' }, m)) : h('p', { class: 'sheet-msg' }, message)) : null,
      h('div', { class: 'sheet-actions column' }, buttons.map((b) => h('button', { type: 'button', class: 'btn ' + (b.class || ''), onclick: () => done(b.value) }, b.label))),
    );
    dlg.showModal();
  });
}

export function confirmDanger(title, message, label = 'Eliminar') {
  return choose({ title, message, buttons: [{ label, value: true, class: 'danger' }, { label: 'Cancelar', value: null, class: 'ghost' }] });
}

/** Panel informativo a pantalla completa con contenido arbitrario. */
export function infoSheet(title, content) {
  const dlg = makeDialog();
  dlg.append(h('div', { class: 'sheet-grip' }), h('h2', { class: 'sheet-title' }, title), h('div', { class: 'sheet-body' }, content),
    h('div', { class: 'sheet-actions' }, h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'btn primary', onclick: () => dlg.close() }, 'Cerrar')));
  dlg.showModal();
  return dlg;
}

let toastTimer;
export function toast(msg, kind = '') {
  let el = document.getElementById('toast');
  if (!el) { el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(el); }
  el.textContent = msg;
  el.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 2600);
}

/** Guarda un archivo: en iPhone/iPad usa el menú Compartir; en el resto, descarga. */
export async function saveFile(blob, filename) {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS && navigator.canShare) {
    try {
      const file = new File([blob], filename, { type: blob.type });
      if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: filename }); return; }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}
