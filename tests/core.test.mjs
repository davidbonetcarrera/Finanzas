// Pruebas de cálculos, modelo, cifrado y Excel. Ejecutar: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, fmt } from '../js/money.js';
import { newState, newItem, newTx, newIncome, ensureMonth, viewMonth, buildMonth, normalizeState, FIXED_SEED } from '../js/model.js';
import { itemCalc, categoryCalc, monthCalc, periodCalc, closeBudgets, reopenBudgets } from '../js/calc.js';
import { createSession, seal, open } from '../js/crypto.js';
import { workbookSheets } from '../js/reports.js';
import { buildXlsx, crc32 } from '../js/xlsx.js';

const byName = (m, cat, name) => m[cat].find((i) => i.name === name);

test('parseAmount entiende formatos habituales', () => {
  assert.equal(parseAmount('475.50'), 47550);
  assert.equal(parseAmount('475,50'), 47550);
  assert.equal(parseAmount('1,075.50'), 107550);
  assert.equal(parseAmount('1.075,50'), 107550);
  assert.equal(parseAmount('$600'), 60000);
  assert.equal(parseAmount('3,000'), 300000);
  assert.equal(parseAmount('0.1'), 10);
  assert.equal(parseAmount(''), 0);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('12.345.6'), null);
  assert.equal(fmt(107550), '$1,075.50');
  assert.equal(fmt(-2000), '-$20.00');
  assert.equal(fmt(5), '$0.05');
});

test('la plantilla inicial tiene los 15 gastos fijos con el modo correcto', () => {
  const s = newState();
  assert.equal(s.templates.fixed.length, 15);
  const tx = s.templates.fixed.filter((t) => t.mode === 'tx').map((t) => t.name).sort();
  assert.deepEqual(tx, ['Gasolina', 'Ginecologo', 'Luz', 'Panapass', 'Super']);
  assert.deepEqual(s.templates.fixed.map((t) => t.name), FIXED_SEED.map((f) => f[0]));
});

test('presupuesto $600 con compras $475.50: gasto real $475.50, no se suma el presupuesto', () => {
  const s = newState();
  const m = ensureMonth(s, '2026-10');
  const sup = byName(m, 'fixed', 'Super');
  sup.budget = 60000;
  let c = itemCalc(sup);
  assert.equal(c.real, 0, 'sin transacciones el gasto real es 0');
  assert.equal(c.remaining, 60000);
  for (const a of [12000, 15050, 9000, 11500]) sup.tx.push(newTx({ amount: a, date: '2026-10-05' }));
  c = itemCalc(sup);
  assert.equal(c.real, 47550);
  assert.equal(c.remaining, 12450);
  assert.equal(c.over, 0);
  const mc = monthCalc(m);
  assert.equal(mc.real, 47550, 'el gasto real no incluye el presupuesto');
  assert.equal(mc.cats.fixed.budget, 60000);
  assert.equal(mc.reserved, 12450, 'lo que queda del presupuesto se reserva');
  assert.equal(mc.committed, 60000, 'se resta el presupuesto completo, sin duplicar');
  assert.equal(mc.balance, -60000);
  // exceso
  sup.tx.push(newTx({ amount: 15000 }));
  c = itemCalc(sup);
  assert.equal(c.remaining, -2550);
  assert.equal(c.over, 2550);
});

test('ejemplo del enunciado: ingresos 3000, gastos 2000, pagado 1200', () => {
  const s = newState();
  const m = ensureMonth(s, '2026-10');
  m.incomes.push(newIncome({ name: 'Salario', amount: 250000 }), newIncome({ name: 'Extra', amount: 50000 }));
  const renta = byName(m, 'fixed', 'Renta'); renta.amount = 100000; renta.paid = true;
  const super_ = byName(m, 'fixed', 'Super'); super_.budget = 90000;
  super_.tx.push(newTx({ amount: 20000, paid: true }), newTx({ amount: 30000, paid: false }));
  m.general.push(newItem({ name: 'Cena', amount: 50000, paid: false }));
  const c = monthCalc(m);
  assert.equal(c.income, 300000);
  assert.equal(c.real, 200000);
  assert.equal(c.paid, 120000);
  assert.equal(c.pending, 80000);
  assert.equal(c.spendBalance, 100000, 'ingresos − gastos reales');
  assert.equal(c.cashNow, 180000);
  assert.equal(c.unspent, 40000, 'presupuesto sin gastar de Super');
  assert.equal(c.balance, 60000, 'el saldo libre ya resta el presupuesto del súper ($900)');
  // fin de mes: el sobrante pasa a ahorros sin restarse dos veces
  assert.equal(closeBudgets(m, newItem), 40000);
  const c2 = monthCalc(m);
  assert.equal(c2.reserved, 0);
  assert.equal(c2.savings, 40000);
  assert.equal(c2.real, 200000);
  assert.equal(c2.balance, 60000, 'el saldo no cambia al pasar el sobrante a ahorros');
  assert.equal(closeBudgets(m, newItem), 0, 'no se puede cerrar dos veces');
  reopenBudgets(m);
  assert.equal(monthCalc(m).savings, 0);
  assert.equal(monthCalc(m).balance, 60000);
});

test('gastos directos: importe y estado de pago', () => {
  const it = newItem({ name: 'Internet', amount: 4599 });
  assert.deepEqual([itemCalc(it).real, itemCalc(it).paid, itemCalc(it).pending], [4599, 0, 4599]);
  it.paid = true;
  assert.deepEqual([itemCalc(it).real, itemCalc(it).paid, itemCalc(it).pending], [4599, 4599, 0]);
  assert.equal(itemCalc(it).hasBudget, false);
});

test('bebé: partidas mixtas sin doble conteo', () => {
  const items = [
    newItem({ name: 'Cuna', amount: 25000, paid: true }),
    Object.assign(newItem({ name: 'Pañales', mode: 'tx', budget: 8000 }), {
      tx: [newTx({ amount: 2599, paid: true }), newTx({ amount: 3150 })],
    }),
    Object.assign(newItem({ name: 'Higiene', mode: 'tx', budget: 0, amount: 99999 }), { tx: [newTx({ amount: 1000, paid: true })] }),
  ];
  const c = categoryCalc(items);
  assert.equal(c.real, 25000 + 5749 + 1000, 'el importe directo de una partida con desglose se ignora');
  assert.equal(c.paid, 25000 + 2599 + 1000);
  assert.equal(c.pending, 3150);
  assert.equal(c.budget, 8000, 'sólo cuenta presupuestos asignados');
  assert.equal(c.remaining, 8000 - 5749);
});

test('cualquier cantidad de transacciones se suma exactamente', () => {
  const it = newItem({ name: 'Gasolina', mode: 'tx', budget: 100000 });
  let expected = 0, paid = 0;
  for (let i = 0; i < 2000; i++) {
    const a = 1 + ((i * 7919) % 9999);
    const p = i % 3 === 0;
    it.tx.push(newTx({ amount: a, paid: p }));
    expected += a; if (p) paid += a;
  }
  const c = itemCalc(it);
  assert.equal(c.real, expected);
  assert.equal(c.paid, paid);
  assert.equal(c.pending, expected - paid);
  assert.equal(c.count, 2000);
});

test('los meses son independientes', () => {
  const s = newState();
  const virtual = new Map();
  const oct = ensureMonth(s, '2026-10', virtual);
  byName(oct, 'fixed', 'Renta').amount = 80000;
  byName(oct, 'fixed', 'Renta').paid = true;
  byName(oct, 'fixed', 'Super').budget = 60000;
  byName(oct, 'fixed', 'Super').tx.push(newTx({ amount: 1000, paid: true }));
  // noviembre arrastra importes habituales pero no pagos ni transacciones
  const nov = ensureMonth(s, '2026-11', virtual);
  assert.equal(byName(nov, 'fixed', 'Renta').amount, 80000);
  assert.equal(byName(nov, 'fixed', 'Renta').paid, false);
  assert.equal(byName(nov, 'fixed', 'Super').budget, 60000);
  assert.equal(byName(nov, 'fixed', 'Super').tx.length, 0);
  // cambiar noviembre no altera octubre
  byName(nov, 'fixed', 'Renta').amount = 85000;
  byName(nov, 'fixed', 'Renta').paid = true;
  byName(nov, 'fixed', 'Super').tx.push(newTx({ amount: 5000 }));
  byName(nov, 'fixed', 'Renta').name = 'Alquiler';
  assert.equal(byName(oct, 'fixed', 'Renta').amount, 80000);
  assert.equal(byName(oct, 'fixed', 'Super').tx.length, 1);
  assert.notEqual(oct.fixed[0], nov.fixed[0]);
  // cambiar la plantilla no altera meses guardados
  s.templates.fixed[0].name = 'Renta casa';
  s.templates.fixed.push({ id: 'x1', name: 'Gimnasio', mode: 'direct', amount: 3000, budget: 0 });
  assert.equal(oct.fixed.length, 15);
  assert.ok(byName(oct, 'fixed', 'Renta'));
  // los meses nuevos sí usan la plantilla
  const dic = buildMonth(s, '2026-12');
  assert.equal(dic.fixed.length, 16);
  assert.equal(dic.fixed[0].name, 'Renta casa');
  assert.equal(dic.fixed[0].amount, 85000, 'arrastra el importe del mes anterior');
});

test('el mes virtual no se guarda hasta que se edita', () => {
  const s = newState();
  const virtual = new Map();
  const v = viewMonth(s, '2027-01', virtual);
  assert.equal(s.months['2027-01'], undefined);
  const id = v.fixed[0].id;
  const m = ensureMonth(s, '2027-01', virtual);
  assert.equal(m.fixed[0].id, id, 'los ids se mantienen al materializar');
});

test('resumen anual: promedios sólo con meses con datos, presupuestos aparte', () => {
  const s = newState();
  const jan = ensureMonth(s, '2026-01');
  jan.incomes.push(newIncome({ amount: 300000 }));
  byName(jan, 'fixed', 'Renta').amount = 100000;
  byName(jan, 'fixed', 'Super').budget = 60000;
  byName(jan, 'fixed', 'Super').tx.push(newTx({ amount: 70000 }));
  const feb = ensureMonth(s, '2026-02');
  feb.incomes.push(newIncome({ amount: 300000 }));
  byName(feb, 'fixed', 'Renta').amount = 100000; byName(feb, 'fixed', 'Renta').paid = true;
  byName(feb, 'fixed', 'Super').budget = 60000;
  byName(feb, 'fixed', 'Super').tx.push(newTx({ amount: 40000, paid: true }));
  s.settings.carryAmounts = false;
  ensureMonth(s, '2026-03'); // mes creado sin datos reales (sin arrastrar importes)
  s.settings.carryAmounts = true;
  const keys = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);
  const p = periodCalc(s, keys);
  assert.equal(p.monthsWithData, 2);
  assert.equal(p.totals.income, 600000);
  assert.equal(p.totals.real, 310000);
  assert.equal(p.totals.paid, 140000);
  assert.equal(p.totals.pending, 170000);
  assert.equal(p.totals.spendBalance, 290000);
  assert.equal(p.totals.reserved, 20000, 'febrero aún reserva $200 del súper');
  assert.equal(p.totals.balance, 270000);
  assert.equal(p.avg.real, 155000);
  assert.equal(p.avg.fixed, 155000);
  assert.equal(p.totals.budget, 120000);
  const sup = p.budgets.find((b) => b.name === 'Super');
  assert.deepEqual([sup.budget, sup.real, sup.diff, sup.monthsOver], [120000, 110000, 10000, 1]);
  assert.equal(p.months.length, 12);
});

test('cifrado: ida y vuelta, contraseña incorrecta y manipulación', async () => {
  const s = newState();
  ensureMonth(s, '2026-10').incomes.push(newIncome({ name: 'Salario', amount: 123456 }));
  const sess = await createSession('una contraseña larga', 100_000);
  const env = await seal(sess, s);
  assert.ok(!JSON.stringify(env).includes('Salario'), 'el sobre no contiene texto en claro');
  const { data } = await open(env, 'una contraseña larga');
  assert.equal(normalizeState(data).months['2026-10'].incomes[0].amount, 123456);
  await assert.rejects(open(env, 'otra contraseña'), /BAD_PASSWORD/);
  const bad = { ...env, ct: env.ct.slice(0, -4) + (env.ct.endsWith('AAAA') ? 'BBBB' : 'AAAA') };
  await assert.rejects(open(bad, 'una contraseña larga'), /BAD_PASSWORD/);
});

test('normalizeState descarta campos desconocidos y claves peligrosas', () => {
  const raw = JSON.parse(JSON.stringify(newState()));
  raw.months['__proto__'] = { evil: 1 };
  raw.months['2026-10'] = { incomes: [{ name: 'A', amount: 100.7, hack: '<img>' }], fixed: [{ name: 'X', mode: 'weird', tx: [{ amount: 'x' }] }], baby: 'no', general: [] };
  const s = normalizeState(raw);
  assert.deepEqual(Object.keys(s.months), ['2026-10']);
  assert.equal(s.months['2026-10'].incomes[0].amount, 101);
  assert.equal(s.months['2026-10'].incomes[0].hack, undefined);
  assert.equal(s.months['2026-10'].fixed[0].mode, 'direct');
  assert.equal(s.months['2026-10'].fixed[0].tx[0].amount, 0);
  assert.deepEqual(s.months['2026-10'].baby, []);
  assert.throws(() => normalizeState({ v: 99 }));
});

test('Excel: estructura y CRC válidos', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  const s = newState();
  const m = ensureMonth(s, '2026-10');
  m.incomes.push(newIncome({ name: 'Salario', amount: 300000 }));
  byName(m, 'fixed', 'Super').budget = 60000;
  byName(m, 'fixed', 'Super').tx.push(newTx({ amount: 47550, desc: 'Compra <semanal> & "más"' }));
  const sheets = workbookSheets(s, ['2026-10']);
  assert.deepEqual(sheets.map((x) => x.name), ['Resumen', 'Ingresos', 'Gastos', 'Ahorros', 'Reembolsos', 'Transacciones', 'Presupuesto vs real', 'Por partida']);
  const bytes = buildXlsx(sheets);
  assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4B);
});

test('ahorros: no son gasto, se restan aparte del saldo', () => {
  const s = newState();
  const m = ensureMonth(s, '2026-10');
  m.incomes.push(newIncome({ amount: 300000 }));
  byName(m, 'fixed', 'Renta').amount = 100000; byName(m, 'fixed', 'Renta').paid = true;
  m.savings.push(newItem({ name: 'Fondo de emergencia', amount: 30000, paid: true }));
  m.savings.push(Object.assign(newItem({ name: 'Vacaciones', mode: 'tx', budget: 20000 }), { tx: [newTx({ amount: 5000, paid: true }), newTx({ amount: 5000 })] }));
  const c = monthCalc(m);
  assert.equal(c.real, 100000, 'el ahorro no cuenta como gasto');
  assert.equal(c.pending, 0, 'el ahorro no es un pago pendiente');
  assert.equal(c.savings, 40000);
  assert.equal(c.savingsDone, 35000);
  assert.equal(c.savingsPending, 5000);
  assert.equal(c.spendBalance, 200000);
  assert.equal(c.balance, 160000, 'saldo libre = ingresos − gastos − ahorro');
  assert.equal(c.cashNow, 300000 - 100000 - 35000);
  assert.equal(c.budget, 0, 'la meta de ahorro no es presupuesto de gasto');
  // recurrente: se arrastra al mes siguiente sin el estado
  s.templates.savings.push({ id: 'sv1', name: 'Fondo', mode: 'direct', amount: 30000, budget: 0 });
  m.savings[0].tpl = 'sv1';
  const nov = ensureMonth(s, '2026-11');
  assert.equal(nov.savings.length, 1);
  assert.equal(nov.savings[0].amount, 30000);
  assert.equal(nov.savings[0].paid, false);
  const p = periodCalc(s, ['2026-10', '2026-11']);
  assert.equal(p.totals.savings, 70000);
  assert.equal(p.totals.real, 100000 + 100000, 'renta arrastrada');
  // datos antiguos sin ahorros siguen cargando
  const raw = JSON.parse(JSON.stringify(s));
  delete raw.templates.savings; delete raw.months['2026-10'].savings;
  const n = normalizeState(raw);
  assert.deepEqual(n.months['2026-10'].savings, []);
  assert.deepEqual(n.templates.savings, []);
});

test('reembolsos: el pago ya está en gastos; al cobrarlo se suma al saldo', async () => {
  const { pendingReimbBefore } = await import('../js/calc.js');
  const s = newState();
  const m = ensureMonth(s, '2026-10');
  m.incomes.push(newIncome({ amount: 300000 }));
  byName(m, 'fixed', 'Renta').amount = 100000; byName(m, 'fixed', 'Renta').paid = true;
  m.reimb.push(newItem({ name: 'Cena de trabajo', amount: 8000 }), newItem({ name: 'Farmacia mamá', amount: 2000, paid: true }));
  const c = monthCalc(m);
  assert.equal(c.real, 100000, 'los reembolsos no se cuentan otra vez como gasto');
  assert.equal(c.balance, 200000 + 2000, 'sólo lo cobrado se suma al saldo');
  assert.equal(c.reimb, 10000);
  assert.equal(c.reimbDone, 2000);
  assert.equal(c.reimbPending, 8000);
  assert.equal(c.cashNow, 300000 - 100000 + 2000, 'lo cobrado vuelve al disponible');
  ensureMonth(s, '2026-11');
  const pend = pendingReimbBefore(s, '2026-11');
  assert.deepEqual(pend.map((p) => p.item.name), ['Cena de trabajo']);
  pend[0].item.paid = true;
  assert.equal(monthCalc(m).reimbPending, 0);
  assert.equal(monthCalc(m).balance, 210000, 'al cobrarlo desde otro mes se suma al saldo de su mes');
  const raw = JSON.parse(JSON.stringify(s)); delete raw.months['2026-11'].reimb;
  assert.deepEqual(normalizeState(raw).months['2026-11'].reimb, []);
});
