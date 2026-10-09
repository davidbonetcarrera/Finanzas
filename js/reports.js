// Datos de informes (mensual / anual / varios meses) y libro Excel.
// Regla: en partidas con desglose, el gasto real ES la suma de sus
// transacciones; las hojas lo indican para no sumar dos veces.

import { CATS, SAVINGS, keyLabel, parseKey, MONTH_NAMES } from './model.js';
import { itemCalc, monthCalc, periodCalc } from './calc.js';
import { toNumber } from './money.js';

export function itemStatus(c) {
  if (c.real === 0) return c.mode === 'tx' ? 'Sin gasto' : 'Sin importe';
  if (c.pending === 0) return 'Pagado';
  if (c.paid === 0) return 'Pendiente';
  return 'Pago parcial';
}

export function savingStatus(c) {
  if (c.real === 0) return 'Sin importe';
  if (c.pending === 0) return 'Apartado';
  if (c.paid === 0) return 'Por apartar';
  return 'Apartado en parte';
}

export function periodTitle(keys) {
  const sorted = [...keys].sort();
  if (sorted.length === 1) return `Informe mensual · ${keyLabel(sorted[0])}`;
  const years = [...new Set(sorted.map((k) => parseKey(k).year))];
  if (years.length === 1 && sorted.length === 12) return `Informe anual ${years[0]}`;
  if (sorted.length <= 4) return `Informe · ${sorted.map((k) => keyLabel(k)).join(', ')}`;
  return `Informe · ${keyLabel(sorted[0])} a ${keyLabel(sorted[sorted.length - 1])} (${sorted.length} meses)`;
}

export function fileSlug(keys) {
  const sorted = [...keys].sort();
  if (sorted.length === 1) return `finanzas-${sorted[0]}`;
  const years = [...new Set(sorted.map((k) => parseKey(k).year))];
  if (years.length === 1 && sorted.length === 12) return `finanzas-anual-${years[0]}`;
  return `finanzas-${sorted[0]}_a_${sorted[sorted.length - 1]}`;
}

export function reportData(state, keys) {
  const sorted = [...keys].sort();
  const months = sorted.map((key) => {
    const month = state.months[key] || null;
    const calc = monthCalc(month);
    const cats = CATS.map(({ key: cat, label }) => ({
      key: cat, label,
      items: month ? month[cat].map((it) => {
        const c = itemCalc(it);
        return { name: it.name, mode: it.mode, date: it.date, notes: it.notes, calc: c, status: itemStatus(c),
          tx: it.mode === 'tx' ? [...it.tx].sort((a, b) => (a.date || '').localeCompare(b.date || '')) : [] };
      }) : [],
      calc: calc.cats[cat],
    }));
    const mapItem = (it) => {
      const c = itemCalc(it);
      return { name: it.name, mode: it.mode, date: it.date, notes: it.notes, calc: c, status: savingStatus(c),
        tx: it.mode === 'tx' ? [...it.tx].sort((a, b) => (a.date || '').localeCompare(b.date || '')) : [] };
    };
    const savings = { key: SAVINGS.key, label: SAVINGS.label, items: month && month.savings ? month.savings.map(mapItem) : [], calc: calc.savingsCat };
    return { savings, key, label: keyLabel(key), short: MONTH_NAMES[parseKey(key).month - 1].slice(0, 3) + ' ' + String(parseKey(key).year).slice(2), month, calc, cats,
      incomes: month ? month.incomes : [] };
  });
  return { keys: sorted, single: sorted.length === 1, title: periodTitle(sorted), months, period: periodCalc(state, sorted) };
}

const M = (cents) => ({ v: toNumber(cents), t: 'money' });
const MB = (cents) => ({ v: toNumber(cents), t: 'money', bold: true });

function colLetter(i) { return String.fromCharCode(65 + i); }

export function workbookSheets(state, keys, now = new Date()) {
  const r = reportData(state, keys);
  const sheets = [];

  // --- Resumen ---
  const head = ['Mes', 'Ingresos', 'Gastos fijos', 'Gastos bebé', 'Gastos generales', 'Gasto real total',
    'Pagado', 'Pendiente de pago', 'Presupuesto por gastar (reservado)', 'Ahorro', 'Saldo libre (ingresos − gastos − reservado − ahorro)', 'Disponible tras pagos y ahorro apartado',
    'Presupuesto asignado', 'Gasto real en partidas con presupuesto', 'Presupuesto restante (− = exceso)'];
  const rows = [
    [{ v: r.title, title: true }],
    [`Generado el ${now.toLocaleDateString('es-PA')} · importes en USD`],
    ['El gasto real de las partidas con desglose es la suma de sus transacciones (hoja Transacciones). Los presupuestos no se cuentan como gasto. El saldo libre resta el presupuesto completo: lo que aún no se ha gastado aparece como «Presupuesto por gastar (reservado)» hasta pasarlo a Ahorros. El ahorro no es gasto, pero también se resta.'],
    [],
    head,
  ];
  const first = rows.length + 1;
  for (const m of r.months) {
    const c = m.calc;
    rows.push([m.label, M(c.income), M(c.cats.fixed.real), M(c.cats.baby.real), M(c.cats.general.real), M(c.real),
      M(c.paid), M(c.pending), M(c.reserved), M(c.savings), M(c.balance), M(c.cashNow), M(c.budget), M(c.budgetReal), M(c.budgetRemaining)]);
  }
  const last = rows.length;
  const t = r.period.totals;
  const totVals = [t.income, t.fixed, t.baby, t.general, t.real, t.paid, t.pending, t.reserved, t.savings, t.balance, t.income - t.paid - t.savingsDone, t.budget, t.budgetReal, t.budget - t.budgetReal];
  rows.push([{ v: 'TOTAL', bold: true }, ...totVals.map((v, i) => ({ f: `SUM(${colLetter(i + 1)}${first}:${colLetter(i + 1)}${last})`, v: toNumber(v), t: 'money', bold: true }))]);
  if (!r.single) {
    const a = r.period.avg;
    rows.push([{ v: `Promedio mensual (${r.period.monthsWithData} meses con datos)`, bold: true },
      MB(a.income), MB(a.fixed), MB(a.baby), MB(a.general), MB(a.real), MB(a.paid), MB(a.pending), MB(a.reserved), MB(a.savings), MB(a.balance)]);
  }
  sheets.push({ name: 'Resumen', rows, header: 4, widths: [30, 14, 14, 14, 16, 16, 14, 16, 18, 14, 24, 24, 18, 22, 22] });

  // --- Ingresos ---
  const inc = [['Mes', 'Descripción', 'Fecha', 'Importe', 'Observaciones']];
  for (const m of r.months) for (const i of m.incomes) inc.push([m.key, i.name, i.date, M(i.amount), i.notes]);
  sheets.push({ name: 'Ingresos', rows: inc, header: 0, filter: true, widths: [10, 30, 12, 14, 40] });

  // --- Gastos (una fila por partida) ---
  const g = [['Mes', 'Categoría', 'Partida', 'Tipo', 'Presupuesto', 'Gasto real', 'Pagado', 'Pendiente',
    'Restante (− = exceso)', 'Nº transacciones', 'Estado', 'Fecha', 'Observaciones']];
  for (const m of r.months) for (const cat of m.cats) for (const it of cat.items) {
    const c = it.calc;
    g.push([m.key, cat.label, it.name, it.mode === 'tx' ? 'Con desglose' : 'Importe directo',
      c.hasBudget ? M(c.budget) : null, M(c.real), M(c.paid), M(c.pending),
      c.hasBudget ? M(c.remaining) : null, it.mode === 'tx' ? c.count : null, it.status, it.date, it.notes]);
  }
  sheets.push({ name: 'Gastos', rows: g, header: 0, filter: true, widths: [10, 18, 24, 16, 14, 14, 14, 14, 18, 10, 14, 12, 30] });

  // --- Ahorros ---
  const sv = [['Mes', 'Partida', 'Tipo', 'Meta', 'Ahorro', 'Apartado', 'Por apartar', 'Estado', 'Fecha', 'Observaciones']];
  for (const m of r.months) for (const it of m.savings.items) {
    const c = it.calc;
    sv.push([m.key, it.name, it.mode === 'tx' ? 'Con desglose' : 'Importe directo', c.hasBudget ? M(c.budget) : null,
      M(c.real), M(c.paid), M(c.pending), it.status, it.date, it.notes]);
  }
  sheets.push({ name: 'Ahorros', rows: sv, header: 0, filter: true, widths: [10, 24, 16, 14, 14, 14, 14, 16, 12, 30] });

  // --- Transacciones ---
  const tx = [['Mes', 'Categoría', 'Partida', 'Fecha', 'Descripción', 'Importe', 'Pagado']];
  for (const m of r.months) for (const cat of [...m.cats, m.savings]) for (const it of cat.items) for (const x of it.tx) {
    tx.push([m.key, cat.label, it.name, x.date, x.desc, M(x.amount), x.paid ? 'Sí' : 'No']);
  }
  sheets.push({ name: 'Transacciones', rows: tx, header: 0, filter: true, widths: [10, 18, 20, 12, 30, 14, 9] });

  // --- Presupuesto vs real ---
  const b = [['Categoría', 'Partida', 'Meses con presupuesto', 'Presupuesto acumulado', 'Gasto real', 'Diferencia (+ ahorro / − exceso)', 'Meses con exceso']];
  for (const e of r.period.budgets) b.push([e.catLabel, e.name, e.months, M(e.budget), M(e.real), M(e.diff), e.monthsOver]);
  sheets.push({ name: 'Presupuesto vs real', rows: b, header: 0, filter: true, widths: [18, 24, 12, 18, 14, 22, 12] });

  // --- Por partida (comparación) ---
  const p = [['Categoría', 'Partida', 'Gasto real del período', 'Promedio mensual', 'Meses con gasto']];
  for (const e of r.period.topItems) p.push([e.catLabel, e.name, M(e.real), M(e.avg), e.months]);
  sheets.push({ name: 'Por partida', rows: p, header: 0, filter: true, widths: [18, 24, 18, 16, 12] });

  return sheets;
}
