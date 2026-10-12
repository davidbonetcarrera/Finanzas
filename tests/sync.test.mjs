import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merge3, newCode, extractCode, isCode } from '../js/sync.js';

const item = (id, o = {}) => ({ id, tpl: null, name: id, amount: 0, paid: false, tx: [], ...o });

test('fusión: cambios distintos en cada móvil se conservan los dos', () => {
  const base = { months: { '2026-10': { general: [item('a', { amount: 100 })], incomes: [] } }, settings: { theme: 'dark' } };
  const local = structuredClone(base); local.months['2026-10'].general.push(item('b', { amount: 50 }));
  const remote = structuredClone(base); remote.months['2026-10'].general[0].paid = true; remote.settings.theme = 'light';
  const m = merge3(base, local, remote);
  assert.deepEqual(m.months['2026-10'].general.map((x) => [x.id, x.paid]), [['a', true], ['b', false]]);
  assert.equal(m.settings.theme, 'light');
});

test('fusión: borrados y transacciones nuevas en ambos lados', () => {
  const base = { l: [item('a', { tx: [{ id: 't1', amount: 1 }] }), item('b'), item('c')] };
  const local = structuredClone(base); local.l = local.l.filter((x) => x.id !== 'b'); local.l[0].tx.push({ id: 't2', amount: 2 });
  const remote = structuredClone(base); remote.l = remote.l.filter((x) => x.id !== 'c'); remote.l[0].tx.push({ id: 't3', amount: 3 });
  const m = merge3(base, local, remote);
  assert.deepEqual(m.l.map((x) => x.id), ['a']);
  assert.deepEqual(m.l[0].tx.map((x) => x.id), ['t1', 't3', 't2']);
});

test('fusión: mismo dato cambiado en los dos -> gana este móvil; mes creado a la vez no duplica partidas', () => {
  const base = { months: {} };
  const local = { months: { '2026-11': { fixed: [item('x1', { tpl: 'fx1', amount: 100, paid: true })], general: [item('g1')] } } };
  const remote = { months: { '2026-11': { fixed: [item('y1', { tpl: 'fx1', amount: 100 })], general: [item('g2')] } } };
  const m = merge3(base, local, remote);
  assert.equal(m.months['2026-11'].fixed.length, 1);
  assert.equal(m.months['2026-11'].fixed[0].paid, true);
  assert.deepEqual(m.months['2026-11'].general.map((x) => x.id).sort(), ['g1', 'g2']);
  assert.equal(merge3({ a: 1 }, { a: 2 }, { a: 3 }).a, 2);
});

test('código del hogar: 256 bits, se extrae del mensaje de invitación', () => {
  const c = newCode();
  assert.ok(isCode(c));
  assert.notEqual(c, newCode());
  assert.equal(extractCode(`Te invito...\n3) Pega este código:\n${c}\n(La contraseña...)`), c);
  assert.equal(extractCode('hola'), null);
});
