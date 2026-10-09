// Genera un Excel de ejemplo (tests/out/ejemplo.xlsx) para validarlo con openpyxl.
import { writeFileSync, mkdirSync } from 'node:fs';
import { newState, ensureMonth, newIncome, newTx, newItem } from '../js/model.js';
import { workbookSheets } from '../js/reports.js';
import { buildXlsx } from '../js/xlsx.js';
const s = newState();
for (const k of ['2026-01', '2026-02']) {
  const m = ensureMonth(s, k);
  m.incomes.push(newIncome({ name: 'Salario', amount: 300000, date: k + '-15' }));
  const sup = m.fixed.find((i) => i.name === 'Super'); sup.budget = 60000;
  sup.tx.push(newTx({ date: k + '-03', desc: 'Compra <semanal> & "más"', amount: 47550, paid: true }), newTx({ amount: 10000 }));
  m.fixed.find((i) => i.name === 'Renta').amount = 100000;
  m.general.push(newItem({ name: '=CMD()', amount: 1234 }));
}
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
writeFileSync(new URL('./out/ejemplo.xlsx', import.meta.url), buildXlsx(workbookSheets(s, ['2026-01', '2026-02'])));
