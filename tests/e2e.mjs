// Prueba de extremo a extremo en un navegador móvil simulado (Chromium + Playwright).
// Uso: node tests/e2e.mjs   (requiere playwright; sirve la carpeta en http://localhost:8765)
import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = fileURLToPath(new URL('./out/', import.meta.url));
await mkdir(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT)) throw new Error('fuera');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('no'); }
}).listen(8765);

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const shot = (name) => page.screenshot({ path: OUT + name + '.png', fullPage: true });
const dlg = () => page.locator('dialog[open]');
const strip = async (label) => (await page.locator('.strip-cell', { hasText: label }).locator('b').textContent()).trim();
const fill = async (label, value) => { await dlg().getByLabel(label, { exact: false }).first().fill(value); };
const submit = async (name = 'Guardar') => { await dlg().getByRole('button', { name, exact: true }).click(); await page.waitForTimeout(150); };
const PASS = 'mi clave de prueba 2026';

await page.goto('http://localhost:8765/');
// 1. Crear contraseña
await page.getByLabel('Nueva contraseña').fill(PASS);
await page.getByLabel('Repite la contraseña').fill(PASS);
await shot('01-crear-clave');
await page.getByRole('button', { name: 'Crear y empezar' }).click();
await page.locator('.tabbar').waitFor();
const key = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });

// 2. Ingresos
await page.getByRole('button', { name: 'Ingresos', exact: true }).click();
for (const [n, a] of [['Salario', '2500'], ['Extra', '500']]) {
  await page.getByRole('button', { name: '+ Añadir ingreso' }).click();
  await fill('Descripción', n); await fill('Importe', a);
  if (n === 'Salario') await dlg().getByText('Repetir en los próximos meses').click();
  await submit();
}
assert.equal(await strip('Ingresos'), '$3,000.00');

// 3. Gastos fijos directos
await page.getByRole('button', { name: 'Gastos', exact: true }).click();
assert.equal(await page.locator('.cat-fixed .item').count(), 15, '15 gastos fijos iniciales');
const renta = page.getByLabel('Importe de Renta');
await renta.fill('1000'); await renta.press('Enter');
await page.getByLabel('Pagado: Renta').check({ force: true });
await page.waitForTimeout(100);
assert.match(await page.locator('.item.direct', { hasText: 'Renta' }).textContent(), /OK pagado/);
const internet = page.getByLabel('Importe de Internet');
await internet.fill('45,99'); await internet.press('Enter');

// 4. Super: presupuesto 600 + 4 compras = 475.50
await page.locator('.tx-head', { hasText: 'Super' }).click();
const pres = page.getByLabel('Presupuesto de Super');
await pres.fill('600'); await pres.press('Enter');
await page.waitForTimeout(100);
assert.match(await page.locator('.item.tx', { hasText: 'Super' }).textContent(), /\$0\.00de \$600\.00/);
for (const [a, paid] of [['120', true], ['150.50', true], ['90', false], ['115', false]]) {
  await page.locator('.item.tx', { hasText: 'Super' }).getByRole('button', { name: '+ Transacción' }).click();
  await fill('Importe real', a); await fill('Descripción', 'Compra semanal');
  const box = dlg().getByLabel('Pagado');
  if (!paid) await dlg().locator('.form-check', { hasText: 'Pagado' }).click();
  assert.equal(await box.isChecked(), paid);
  await submit();
}
const superTxt = await page.locator('.item.tx', { hasText: 'Super' }).textContent();
assert.match(superTxt, /\$475\.50de \$600\.00/);
assert.match(superTxt, /Quedan \$124\.50/);
assert.match(superTxt, /pend\. \$205\.00/);
await shot('02-gastos-super');

// 5. Bebé: partida con presupuesto y una compra puntual
await page.getByRole('button', { name: '+ Añadir partida del bebé' }).click();
await fill('Nombre', 'Pañales');
await dlg().getByLabel('Tipo').selectOption('tx');
await fill('Presupuesto mensual', '80');
await submit('Añadir');
await page.locator('.item.tx', { hasText: 'Pañales' }).getByRole('button', { name: '+ Transacción' }).click();
await fill('Importe real', '95'); await submit();
assert.match(await page.locator('.item.tx', { hasText: 'Pañales' }).textContent(), /Excedido por \$15\.00/);
await page.getByRole('button', { name: '+ Añadir partida del bebé' }).click();
await fill('Nombre', 'Cuna'); await fill('Importe del mes', '250'); await dlg().getByText('Ya está pagado').click();
await submit('Añadir');

// 6. General
await page.getByRole('button', { name: '+ Añadir gasto', exact: true }).click();
await fill('Nombre', 'Cena'); await fill('Importe real', '50'); await submit('Añadir');

// Totales esperados: ingresos 3000; reales = 1000 + 45.99 + 475.50 + 95 + 250 + 50 = 1916.49
// pagado = 1000 + 270.50 + 95 + 250 = 1615.50 ; pendiente = 300.99 ; saldo = 1083.51
assert.equal(await strip('Gasto real'), '$1,916.49');
assert.equal(await strip('Pendiente'), '$300.99');
assert.equal(await strip('Saldo'), '$1,083.51');
await page.locator('.cat-fixed .cat-head').scrollIntoViewIfNeeded();
await shot('03-gastos');

await page.getByRole('button', { name: 'Totales', exact: true }).click();
const tot = await page.locator('.view').textContent();
for (const s of ['$3,000.00', '$1,916.49', '$1,083.51', '$1,615.50', '$300.99', '$1,384.50', '$680.00']) assert.ok(tot.includes(s), 'Totales contiene ' + s);
await shot('04-totales-mes');

// 7. Exportaciones del mes
const dl = async (name) => {
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name }).click()]);
  const path = OUT + d.suggestedFilename();
  await d.saveAs(path);
  return path;
};
const pdfMonth = await dl('Descargar PDF');
const xlsxMonth = await dl('Descargar Excel');

// 8. Mes siguiente: independiente
await page.getByRole('button', { name: 'Gastos', exact: true }).click();
await page.getByRole('button', { name: 'Mes siguiente' }).click();
assert.equal(await page.getByLabel('Importe de Renta').inputValue(), '1000.00', 'arrastra el importe habitual');
assert.equal(await page.getByLabel('Pagado: Renta').isChecked(), false, 'el pago no se arrastra');
assert.equal(await strip('Ingresos'), '$2,500.00', 'sólo el ingreso recurrente');
assert.match(await page.locator('.item.tx', { hasText: 'Super' }).textContent(), /0 transacc\./);
await shot('05-mes-siguiente');
const r2 = page.getByLabel('Importe de Renta');
await r2.fill('1100'); await r2.press('Enter');
await page.getByLabel('Pagado: Renta').check({ force: true });
await page.getByRole('button', { name: 'Mes anterior' }).click();
assert.equal(await page.getByLabel('Importe de Renta').inputValue(), '1000.00', 'el mes anterior no cambia');
assert.equal(await strip('Gasto real'), '$1,916.49');

// 9. Totales anuales
await page.getByRole('button', { name: 'Totales', exact: true }).click();
await page.getByRole('tab', { name: 'Año' }).click();
await page.waitForTimeout(100);
const year = await page.locator('.view').textContent();
if (!key.endsWith('-12')) { // el mes siguiente cae en el mismo año
  assert.ok(year.includes('$5,500.00'), 'ingresos acumulados 3000 + 2500');
  assert.ok(year.includes('$3,062.48'), 'gasto acumulado 1916.49 + (1100 renta + 45.99 internet arrastrado)');
}
await shot('06-totales-anio');
const pdfYear = await dl('Descargar PDF');
const xlsxYear = await dl('Descargar Excel');

// 10. Persistencia y bloqueo
await page.reload();
await page.getByLabel('Contraseña').fill('incorrecta');
await page.getByRole('button', { name: 'Desbloquear' }).click();
await page.getByText('Contraseña incorrecta').waitFor();
await shot('07-bloqueo');
await page.getByLabel('Contraseña').fill(PASS);
await page.getByRole('button', { name: 'Desbloquear' }).click();
await page.locator('.tabbar').waitFor();
assert.equal(await strip('Gasto real'), '$1,916.49', 'los datos persisten tras recargar');
await page.getByRole('button', { name: 'Bloquear' }).click();
await page.getByRole('button', { name: 'Desbloquear' }).waitFor();
const stored = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('finanzas-personales'); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('vault'); g.onsuccess = () => res(JSON.stringify(g.result)); };
}));
assert.ok(!stored.includes('Salario') && !stored.includes('Pañales'), 'IndexedDB sólo contiene datos cifrados');

// 11. Copia de seguridad y restauración en "otro dispositivo"
await page.getByLabel('Contraseña').fill(PASS);
await page.getByRole('button', { name: 'Desbloquear' }).click();
await page.getByRole('button', { name: 'Ajustes' }).click();
await shot('08-ajustes');
const backup = await dl('Descargar copia cifrada');
const backupText = await readFile(backup, 'utf8');
assert.ok(!backupText.includes('Salario'), 'la copia está cifrada');
const ctx2 = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
const p2 = await ctx2.newPage();
await p2.goto('http://localhost:8765/');
const [chooser] = await Promise.all([p2.waitForEvent('filechooser'), p2.getByRole('button', { name: /Tengo una copia/ }).click()]);
await chooser.setFiles(backup);
await p2.locator('dialog[open]').getByLabel('Contraseña de la copia').fill(PASS);
await p2.locator('dialog[open]').getByRole('button', { name: 'Abrir copia' }).click();
await p2.locator('.tabbar').waitFor();
assert.equal((await p2.locator('.strip-cell', { hasText: 'Gasto real' }).locator('b').textContent()).trim(), '$1,916.49', 'restaurado en el otro dispositivo');
await p2.screenshot({ path: OUT + '09-restaurado-android.png', fullPage: true });

// 12. Tema claro
await page.getByRole('button', { name: 'Arena claro' }).click();
await page.getByRole('button', { name: 'Gastos', exact: true }).click();
await shot('10-tema-claro');
await page.getByRole('button', { name: 'Ajustes' }).click();
await page.getByRole('button', { name: 'Tierra oscuro' }).click();

// 13. Sin conexión: el service worker sirve la app
await page.waitForTimeout(500);
const swReady = await page.evaluate(async () => !!(await navigator.serviceWorker.ready).active);
assert.ok(swReady, 'service worker activo');
await ctx.setOffline(true);
await page.reload();
await page.getByRole('button', { name: 'Desbloquear' }).waitFor();
await ctx.setOffline(false);

await writeFile(OUT + 'files.json', JSON.stringify({ key, pdfMonth, xlsxMonth, pdfYear, xlsxYear }));
assert.deepEqual(errors.filter((e) => !/favicon/.test(e)), [], 'sin errores en consola');
console.log('E2E OK', { key, pdfMonth, xlsxMonth, pdfYear, xlsxYear });
await browser.close();
server.close();
