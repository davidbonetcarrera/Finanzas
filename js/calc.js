// Cálculos financieros (puros, sin DOM). Todos los importes en centavos.
//
// Reglas:
//  - Partida "directa": gasto real = importe; pagado = importe si está marcada.
//  - Partida "con desglose": gasto real = suma de transacciones; pagado = suma
//    de transacciones pagadas. El presupuesto NUNCA cuenta como gasto real.
//  - Pendiente = gasto real − pagado.
//  - Restante = presupuesto − gasto real (negativo = exceso).

import { CATS } from './model.js';

export function itemCalc(item) {
  if (item.mode === 'tx') {
    let real = 0, paid = 0;
    for (const t of item.tx) { real += t.amount; if (t.paid) paid += t.amount; }
    const budget = item.budget || 0;
    const hasBudget = budget > 0;
    return {
      mode: 'tx', real, paid, pending: real - paid, budget, hasBudget,
      remaining: hasBudget ? budget - real : null,
      over: hasBudget && real > budget ? real - budget : 0,
      count: item.tx.length,
      allPaid: item.tx.length > 0 && paid === real && item.tx.every((t) => t.paid),
    };
  }
  const real = item.amount || 0;
  const paid = item.paid ? real : 0;
  return {
    mode: 'direct', real, paid, pending: real - paid, budget: 0, hasBudget: false,
    remaining: null, over: 0, count: 0, allPaid: !!item.paid,
  };
}

export function categoryCalc(items) {
  const r = { real: 0, paid: 0, pending: 0, budget: 0, budgetReal: 0, remaining: 0, unspent: 0, over: 0, count: items.length };
  for (const it of items) {
    const c = itemCalc(it);
    r.real += c.real; r.paid += c.paid; r.pending += c.pending;
    if (c.hasBudget) {
      r.budget += c.budget; r.budgetReal += c.real; r.remaining += c.remaining;
      if (c.remaining > 0) r.unspent += c.remaining;
      r.over += c.over;
    }
  }
  return r;
}

export function monthCalc(month) {
  const income = month ? month.incomes.reduce((a, i) => a + (i.amount || 0), 0) : 0;
  const cats = {};
  for (const { key } of CATS) cats[key] = categoryCalc(month ? month[key] : []);
  const real = cats.fixed.real + cats.baby.real + cats.general.real;
  const paid = cats.fixed.paid + cats.baby.paid + cats.general.paid;
  const pending = real - paid;
  const budget = cats.fixed.budget + cats.baby.budget + cats.general.budget;
  const budgetReal = cats.fixed.budgetReal + cats.baby.budgetReal + cats.general.budgetReal;
  const unspent = cats.fixed.unspent + cats.baby.unspent + cats.general.unspent;
  const over = cats.fixed.over + cats.baby.over + cats.general.over;
  // Ahorros: no son gasto; se restan aparte. "Apartado" = ya transferido/guardado.
  const sv = categoryCalc(month && month.savings ? month.savings : []);
  const savings = sv.real, savingsDone = sv.paid, savingsPending = sv.pending;
  return {
    income, cats, real, paid, pending,
    savings, savingsDone, savingsPending, savingsCat: sv,
    spendBalance: income - real,               // ingresos − gastos reales
    balance: income - real - savings,          // saldo libre (ingresos − gastos reales − ahorro)
    cashNow: income - paid - savingsDone,      // dinero que queda tras lo ya pagado y apartado
    budget, budgetReal, budgetRemaining: budget - budgetReal, unspent, over,
    projected: income - real - savings - unspent, // estimación si se agota el presupuesto restante
    hasData: income !== 0 || real !== 0 || savings !== 0,
  };
}

const norm = (s) => s.trim().toLowerCase();

/** Resumen de varios meses (año completo o selección). Sólo usa meses guardados. */
export function periodCalc(state, keys) {
  const sorted = [...keys].sort();
  const months = sorted.map((key) => ({ key, ...monthCalc(state.months[key] || null) }));
  const withData = months.filter((m) => m.hasData);
  const n = withData.length;
  const tot = { income: 0, real: 0, paid: 0, pending: 0, balance: 0, savings: 0, savingsDone: 0, spendBalance: 0, budget: 0, budgetReal: 0, unspent: 0, over: 0, fixed: 0, baby: 0, general: 0 };
  for (const m of months) {
    tot.income += m.income; tot.real += m.real; tot.paid += m.paid; tot.pending += m.pending;
    tot.balance += m.balance; tot.savings += m.savings; tot.savingsDone += m.savingsDone; tot.spendBalance += m.spendBalance;
    tot.budget += m.budget; tot.budgetReal += m.budgetReal;
    tot.unspent += m.unspent; tot.over += m.over;
    for (const { key } of CATS) tot[key] += m.cats[key].real;
  }
  const avg = {};
  for (const k of ['income', 'real', 'paid', 'pending', 'balance', 'savings', 'fixed', 'baby', 'general']) {
    avg[k] = n ? Math.round(tot[k] / n) : 0;
  }

  // Presupuesto frente a gasto real por partida (sólo meses con presupuesto asignado)
  const byItem = new Map();
  for (const key of sorted) {
    const month = state.months[key];
    if (!month) continue;
    for (const { key: cat, label } of CATS) {
      for (const it of month[cat]) {
        const c = itemCalc(it);
        if (!c.hasBudget) continue;
        const k = cat + '|' + norm(it.name);
        if (!byItem.has(k)) byItem.set(k, { cat, catLabel: label, name: it.name.trim(), budget: 0, real: 0, months: 0, monthsOver: 0 });
        const e = byItem.get(k);
        e.budget += c.budget; e.real += c.real; e.months += 1; if (c.over > 0) e.monthsOver += 1;
      }
    }
  }
  const budgets = [...byItem.values()].map((e) => ({ ...e, diff: e.budget - e.real }))
    .sort((a, b) => a.diff - b.diff);

  // Gasto real por partida en el período (para ver dónde se gasta más)
  const spend = new Map();
  for (const key of sorted) {
    const month = state.months[key];
    if (!month) continue;
    for (const { key: cat, label } of CATS) {
      for (const it of month[cat]) {
        const c = itemCalc(it);
        if (!c.real) continue;
        const k = cat + '|' + norm(it.name);
        if (!spend.has(k)) spend.set(k, { cat, catLabel: label, name: it.name.trim(), real: 0, months: 0 });
        const e = spend.get(k); e.real += c.real; e.months += 1;
      }
    }
  }
  const topItems = [...spend.values()].map((e) => ({ ...e, avg: n ? Math.round(e.real / n) : 0 }))
    .sort((a, b) => b.real - a.real);

  return { months, monthsWithData: n, totals: tot, avg, budgets, topItems };
}
