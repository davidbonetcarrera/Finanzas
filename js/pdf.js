// Informe PDF (jsPDF + AutoTable, incluidos localmente en /vendor).
import { reportData } from './reports.js';
import { fmt } from './money.js';
import { shortDate } from './dom.js';

let loading = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src; el.onload = resolve; el.onerror = () => reject(new Error('No se pudo cargar ' + src));
    document.head.append(el);
  });
}
export function loadPdfLib() {
  if (!loading) loading = loadScript('vendor/jspdf.umd.min.js').then(() => loadScript('vendor/jspdf.plugin.autotable.min.js'));
  return loading;
}

const C = {
  brown: [74, 52, 38], terra: [168, 92, 62], sand: [236, 224, 205], beige: [248, 242, 232],
  olive: [92, 107, 52], red: [170, 60, 45], text: [40, 30, 24], muted: [120, 104, 90],
};
const money = (c) => fmt(c);
// Las fuentes estándar del PDF sólo cubren Latin-1: se sustituyen el resto de caracteres.
const latin = (str) => String(str ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—−]/g, '-').replace(/…/g, '...').replace(/[^\x00-\xFF]/g, '');
const signed = (c) => (c < 0 ? 'Exceso ' + fmt(-c) : fmt(c));

export async function buildPdf(state, keys) {
  await loadPdfLib();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const autoTable = (opts) => (typeof doc.autoTable === 'function' ? doc.autoTable(opts) : window.jspdf_autotable.autoTable(doc, opts));
  const r = reportData(state, keys);
  const pageW = doc.internal.pageSize.getWidth();
  const M = 36;
  let y = 0;

  // Cabecera
  doc.setFillColor(...C.brown); doc.rect(0, 0, pageW, 64, 'F');
  doc.setTextColor(...C.sand); doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
  doc.text(r.title, M, 30);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`Finanzas personales · generado el ${new Date().toLocaleString('es-PA')} · importes en USD`, M, 48);
  y = 84;

  const base = {
    margin: { left: M, right: M, bottom: 40 },
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 3.5, textColor: C.text, lineColor: [225, 214, 198], lineWidth: 0.4 },
    headStyles: { fillColor: C.terra, textColor: [255, 255, 255], fontStyle: 'bold' },
    footStyles: { fillColor: C.sand, textColor: C.text, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: C.beige },
  };
  const section = (title) => {
    if (y > doc.internal.pageSize.getHeight() - 90) { doc.addPage(); y = 44; }
    doc.setTextColor(...C.brown); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    doc.text(title, M, y); y += 8;
  };
  const table = (opts) => {
    const hook = opts.didParseCell;
    const didParseCell = (d) => { d.cell.text = d.cell.text.map(latin); if (hook) hook(d); };
    autoTable({ ...base, startY: y, ...opts, didParseCell, columnStyles: opts.columnStyles || {} });
    y = doc.lastAutoTable.finalY + 20;
  };
  const right = (cols) => Object.fromEntries(cols.map((i) => [i, { halign: 'right' }]));

  if (r.single) {
    const m = r.months[0];
    const c = m.calc;
    section('Resumen del mes');
    table({
      head: [['Concepto', 'Importe']],
      body: [
        ['Total de ingresos', money(c.income)],
        ['Gastos fijos (reales)', money(c.cats.fixed.real)],
        ['Gastos del bebé (reales)', money(c.cats.baby.real)],
        ['Gastos generales (reales)', money(c.cats.general.real)],
        ['Gasto real total', money(c.real)],
        ['Pagado', money(c.paid)],
        ['Pendiente de pago', money(c.pending)],
        ['Ingresos - gasto real', money(c.spendBalance)],
        ['Ahorro del mes', money(c.savings)],
        ['Saldo libre (ingresos - gastos - ahorro)', money(c.balance)],
        ['Disponible tras pagos y ahorro apartado', money(c.cashNow)],
        ['Presupuestos asignados', money(c.budget)],
        ['Gastado en partidas con presupuesto', money(c.budgetReal)],
        ['Presupuesto restante (- = exceso)', money(c.budgetRemaining)],
      ],
      columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
      tableWidth: 330,
    });

    section('Ingresos');
    table({
      head: [['Descripción', 'Fecha', 'Observaciones', 'Importe']],
      body: m.incomes.length ? m.incomes.map((i) => [i.name, shortDate(i.date), i.notes, money(i.amount)]) : [['Sin ingresos registrados', '', '', '']],
      foot: [['Total', '', '', money(c.income)]],
      columnStyles: right([3]),
    });

    for (const cat of m.cats) {
      section(`${cat.label} · real ${money(cat.calc.real)}`);
      table({
        head: [['Partida', 'Tipo', 'Presupuesto', 'Gasto real', 'Pagado', 'Pendiente', 'Restante', 'Estado']],
        body: cat.items.length ? cat.items.map((it) => [
          it.name, it.mode === 'tx' ? `Desglose (${it.calc.count})` : 'Directo',
          it.calc.hasBudget ? money(it.calc.budget) : '—', money(it.calc.real), money(it.calc.paid), money(it.calc.pending),
          it.calc.hasBudget ? signed(it.calc.remaining) : '—', it.status,
        ]) : [['Sin partidas', '', '', '', '', '', '', '']],
        foot: [['Subtotal', '', cat.calc.budget ? money(cat.calc.budget) : '—', money(cat.calc.real), money(cat.calc.paid), money(cat.calc.pending), cat.calc.budget ? signed(cat.calc.remaining) : '—', '']],
        columnStyles: right([2, 3, 4, 5, 6]),
        didParseCell: (d) => { if (d.section === 'body' && d.column.index === 6 && String(d.cell.raw).startsWith('Exceso')) d.cell.styles.textColor = C.red; },
      });
      const txRows = [];
      for (const it of cat.items) for (const t of it.tx) txRows.push([it.name, shortDate(t.date), t.desc, money(t.amount), t.paid ? 'Sí' : 'No']);
      if (txRows.length) {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(...C.muted);
        doc.text(`Transacciones de ${cat.label.toLowerCase()} (ya incluidas en el gasto real de arriba)`, M, y - 6);
        y += 4;
        table({ head: [['Partida', 'Fecha', 'Descripción', 'Importe', 'Pagado']], body: txRows, columnStyles: right([3]), headStyles: { fillColor: C.olive, textColor: [255, 255, 255] } });
      }
    }

    const sv = m.savings;
    section(`Ahorros · ${money(sv.calc.real)} (no es gasto; se resta aparte)`);
    table({
      head: [['Partida', 'Tipo', 'Meta', 'Ahorro', 'Apartado', 'Por apartar', 'Estado']],
      body: sv.items.length ? sv.items.map((it) => [
        it.name, it.mode === 'tx' ? `Desglose (${it.calc.count})` : 'Directo', it.calc.hasBudget ? money(it.calc.budget) : '—',
        money(it.calc.real), money(it.calc.paid), money(it.calc.pending), it.status,
      ]) : [['Sin ahorros registrados', '', '', '', '', '', '']],
      foot: [['Total', '', '', money(sv.calc.real), money(sv.calc.paid), money(sv.calc.pending), '']],
      columnStyles: right([2, 3, 4, 5]),
      headStyles: { fillColor: [150, 118, 64], textColor: [255, 255, 255] },
    });
  } else {
    const t = r.period.totals;
    const a = r.period.avg;
    section('Resumen del período');
    table({
      head: [['Concepto', 'Acumulado', `Promedio mensual (${r.period.monthsWithData} meses con datos)`]],
      body: [
        ['Ingresos', money(t.income), money(a.income)],
        ['Gastos fijos', money(t.fixed), money(a.fixed)],
        ['Gastos del bebé', money(t.baby), money(a.baby)],
        ['Gastos generales', money(t.general), money(a.general)],
        ['Gasto real total', money(t.real), money(a.real)],
        ['Pagado', money(t.paid), money(a.paid)],
        ['Pendiente de pago', money(t.pending), money(a.pending)],
        ['Ahorro', money(t.savings), money(a.savings)],
        ['Saldo libre (ingresos - gastos - ahorro)', money(t.balance), money(a.balance)],
        ['Presupuestos asignados', money(t.budget), ''],
        ['Gastado en partidas con presupuesto', money(t.budgetReal), ''],
      ],
      columnStyles: right([1, 2]),
    });

    // Gráfico simple: ingresos vs gasto real por mes
    section('Ingresos frente a gasto real por mes');
    const chartH = 120, chartW = pageW - 2 * M;
    const max = Math.max(1, ...r.months.map((m) => Math.max(m.calc.income, m.calc.real)));
    const slot = chartW / r.months.length;
    const bw = Math.min(12, slot / 3);
    const base0 = y + chartH;
    doc.setDrawColor(200, 190, 175); doc.setLineWidth(0.5); doc.line(M, base0, M + chartW, base0);
    r.months.forEach((m, i) => {
      const x = M + slot * i + slot / 2;
      const hi = (m.calc.income / max) * (chartH - 10);
      const hr = (m.calc.real / max) * (chartH - 10);
      doc.setFillColor(...C.olive); doc.rect(x - bw - 1, base0 - hi, bw, hi, 'F');
      doc.setFillColor(...C.terra); doc.rect(x + 1, base0 - hr, bw, hr, 'F');
      doc.setFontSize(7); doc.setTextColor(...C.muted); doc.setFont('helvetica', 'normal');
      doc.text(m.short, x, base0 + 10, { align: 'center' });
    });
    doc.setFillColor(...C.olive); doc.rect(M, base0 + 18, 8, 8, 'F'); doc.text('Ingresos', M + 12, base0 + 25);
    doc.setFillColor(...C.terra); doc.rect(M + 60, base0 + 18, 8, 8, 'F'); doc.text('Gasto real', M + 72, base0 + 25);
    y = base0 + 48;

    section('Comparación mensual');
    table({
      head: [['Mes', 'Ingresos', 'Fijos', 'Bebé', 'Generales', 'Gasto real', 'Pagado', 'Pendiente', 'Ahorro', 'Saldo libre']],
      body: r.months.map((m) => [m.label, money(m.calc.income), money(m.calc.cats.fixed.real), money(m.calc.cats.baby.real), money(m.calc.cats.general.real), money(m.calc.real), money(m.calc.paid), money(m.calc.pending), money(m.calc.savings), money(m.calc.balance)]),
      foot: [['Total', money(t.income), money(t.fixed), money(t.baby), money(t.general), money(t.real), money(t.paid), money(t.pending), money(t.savings), money(t.balance)]],
      columnStyles: right([1, 2, 3, 4, 5, 6, 7, 8, 9]),
      styles: { ...base.styles, fontSize: 7, cellPadding: 2.5 },
      didParseCell: (d) => { if (d.section === 'body' && d.column.index === 9 && String(d.cell.raw).startsWith('-')) d.cell.styles.textColor = C.red; },
    });

    section('Presupuesto frente a gasto real');
    table({
      head: [['Categoría', 'Partida', 'Meses', 'Presupuesto', 'Gasto real', 'Diferencia', 'Meses con exceso']],
      body: r.period.budgets.length ? r.period.budgets.map((e) => [e.catLabel, e.name, e.months, money(e.budget), money(e.real), e.diff < 0 ? 'Exceso ' + money(-e.diff) : 'Ahorro ' + money(e.diff), e.monthsOver])
        : [['Sin partidas con presupuesto en el período', '', '', '', '', '', '']],
      columnStyles: right([2, 3, 4, 5, 6]),
      didParseCell: (d) => { if (d.section === 'body' && d.column.index === 5 && String(d.cell.raw).startsWith('Exceso')) d.cell.styles.textColor = C.red; },
    });

    section('Gasto por partida');
    table({
      head: [['Categoría', 'Partida', 'Gasto real', 'Promedio mensual', 'Meses con gasto']],
      body: r.period.topItems.length ? r.period.topItems.map((e) => [e.catLabel, e.name, money(e.real), money(e.avg), e.months]) : [['Sin gastos', '', '', '', '']],
      columnStyles: right([2, 3, 4]),
    });
  }

  doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(...C.muted);
  if (y > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); y = 44; }
  doc.text(doc.splitTextToSize('Los presupuestos no se cuentan como gasto. En partidas con desglose, el gasto real es la suma de sus transacciones. El ahorro se resta aparte.', pageW - 2 * M), M, y);

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.muted);
    doc.text(`Página ${i} de ${pages}`, pageW - M, doc.internal.pageSize.getHeight() - 18, { align: 'right' });
  }
  return doc.output('blob');
}
