// Prueba de la sincronización en vivo con DOS móviles simulados y un servidor
// falso que imita las funciones de supabase/setup.sql.
// Uso: node tests/e2e-sync.mjs   (requiere playwright)
import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = fileURLToPath(new URL('./out/', import.meta.url));
await mkdir(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const PORT = 8766;

// --- servidor falso (mismas reglas que put_vault/get_vault/vault_rev) ---
const vaults = new Map();
let offline = false;
const vid = (code) => { if (!/^[A-Za-z0-9_-]{43}$/.test(code || '')) throw new Error('codigo'); return createHash('sha256').update(code).digest('hex'); };
const rpc = { 
  vault_rev: ({ p_code }) => (vaults.get(vid(p_code)) || { rev: 0 }).rev,
  get_vault: ({ p_code }) => { const v = vaults.get(vid(p_code)); return v ? [{ rev: v.rev, env: v.env }] : []; },
  put_vault: ({ p_code, p_base, p_env }) => {
    const id = vid(p_code); const cur = vaults.get(id);
    if (!p_env || p_env.app !== 'finanzas-personales' || !p_env.ct) throw new Error('formato');
    if ((cur ? cur.rev : 0) !== p_base) return -1;
    const rev = p_base + 1; vaults.set(id, { rev, env: p_env }); return rev;
  },
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      if (offline) { req.socket.destroy(); return; }
      assert.equal(req.headers.apikey, 'sb_publishable_test');
      let body = ''; for await (const c of req) body += c;
      const out = rpc[url.pathname.split('/').pop()](JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out)); return;
    }
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    if (p === '/js/config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(`export const SYNC = { url: 'http://localhost:${PORT}', key: 'sb_publishable_test' };`); return; }
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT)) throw new Error('fuera');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(500); res.end(String(e.message)); }
}).listen(PORT);

const browser = await chromium.launch();
const errors = [];
async function phone(name) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://localhost:${PORT}` }).catch(() => {});
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to fetch|ERR_|net::/.test(m.text())) errors.push(name + ': ' + m.text()); });
  const dlg = () => page.locator('dialog[open]');
  return {
    page, dlg,
    strip: async (label) => (await page.locator('.strip-cell', { hasText: label }).locator('b').textContent()).trim(),
    fill: async (label, value) => { await dlg().getByLabel(label, { exact: false }).first().fill(value); },
    submit: async (n = 'Guardar') => { await dlg().getByRole('button', { name: n, exact: true }).click(); await page.waitForTimeout(150); },
    tab: (n) => page.getByRole('button', { name: n, exact: true }).click(),
    shot: (n) => page.screenshot({ path: OUT + n + '.png', fullPage: true }),
  };
}
const until = async (fn, ms = 15000) => {
  const t = Date.now();
  for (;;) { try { if (await fn()) return; } catch { /* reintento */ } if (Date.now() - t > ms) throw new Error('timeout: ' + fn); await new Promise((r) => setTimeout(r, 250)); }
};
const PASS = 'nuestra clave compartida 2026';

// 1. Móvil A: crea sus datos y activa compartir
const A = await phone('A');
await A.page.goto(`http://localhost:${PORT}/`);
await A.page.getByLabel('Nueva contraseña').fill(PASS);
await A.page.getByLabel('Repite la contraseña').fill(PASS);
await A.page.getByRole('button', { name: 'Crear y empezar' }).click();
await A.page.locator('.tabbar').waitFor();
await A.tab('Ingresos');
await A.page.getByRole('button', { name: '+ Añadir ingreso' }).click();
await A.fill('Descripción', 'Salario'); await A.fill('Importe', '2500'); await A.submit();
assert.equal(await A.strip('Ingresos'), '$2,500.00');
await A.page.getByRole('button', { name: 'Ajustes' }).click();
await A.page.getByRole('button', { name: 'Activar y compartir' }).click();
await A.dlg().getByRole('button', { name: 'Activar' }).click();
await A.page.locator('pre.invite').waitFor();
const invite = await A.page.locator('pre.invite').textContent();
assert.match(invite, /Pega este código:\n[A-Za-z0-9_-]{43}\n/);
await A.shot('sync-01-invitar');
await A.dlg().getByRole('button', { name: 'Cerrar' }).click();
assert.equal(vaults.size, 1, 'el servidor tiene un sobre');
const stored = [...vaults.values()][0].env;
assert.ok(stored.ct && !JSON.stringify(stored).includes('Salario'), 'el servidor sólo ve datos cifrados');
await until(async () => /en vivo/.test(await A.page.locator('#save-state').textContent()));

// 2. Móvil B (esposa): se une con el código y la contraseña
const B = await phone('B');
await B.page.goto(`http://localhost:${PORT}/`);
await B.page.getByRole('button', { name: /Unirme a las finanzas de mi pareja/ }).click();
await B.fill('Código de invitación', invite);
await B.fill('Contraseña', 'otra clave mala');
await B.submit('Unirme');
await B.page.waitForTimeout(1500);
assert.equal(await B.page.locator('.tabbar').count(), 0, 'contraseña incorrecta: no entra');
await B.page.getByRole('button', { name: /Unirme a las finanzas de mi pareja/ }).click();
await B.fill('Código de invitación', invite);
await B.fill('Contraseña', PASS);
await B.submit('Unirme');
await B.page.locator('.tabbar').waitFor({ timeout: 15000 });
assert.equal(await B.strip('Ingresos'), '$2,500.00', 'B ve los datos de A');

// 3. A añade un gasto -> B lo ve sin hacer nada
await A.tab('Gastos');
await A.page.getByRole('button', { name: '+ Añadir gasto', exact: true }).click();
await A.fill('Nombre', 'Farmacia'); await A.fill('Importe real', '40'); await A.submit('Añadir');
await B.tab('Gastos');
await until(async () => (await B.page.locator('.cat-general').textContent()).includes('Farmacia'));

// 4. B marca la Renta pagada y la cambia -> A lo ve
await B.page.getByLabel('Importe de Renta').fill('1000'); await B.page.getByLabel('Importe de Renta').press('Enter');
await B.page.getByLabel('Pagado: Renta').check({ force: true });
await until(async () => (await A.page.getByLabel('Importe de Renta').inputValue()) === '1000.00' && await A.page.getByLabel('Pagado: Renta').isChecked());

// 5. Cambios casi a la vez en los dos móviles: no se pierde ninguno
await A.page.getByRole('button', { name: '+ Añadir gasto', exact: true }).click();
await A.fill('Nombre', 'Gasolina extra'); await A.fill('Importe real', '30');
await B.page.getByRole('button', { name: '+ Añadir gasto', exact: true }).click();
await B.fill('Nombre', 'Regalo'); await B.fill('Importe real', '25');
await Promise.all([A.submit('Añadir'), B.submit('Añadir')]);
for (const P of [A, B]) {
  await until(async () => { const t = await P.page.locator('.cat-general').textContent(); return t.includes('Gasolina extra') && t.includes('Regalo') && t.includes('Farmacia'); });
}
await until(async () => (await A.strip('Gastos')) === (await B.strip('Gastos')));
assert.equal(await A.strip('Gastos'), '$1,095.00');

// 6. Sin conexión: el cambio se guarda y se envía al volver
offline = true;
await B.page.getByRole('button', { name: '+ Añadir gasto', exact: true }).click();
await B.fill('Nombre', 'Taxi'); await B.fill('Importe real', '12'); await B.submit('Añadir');
await until(async () => /sin conexión/.test(await B.page.locator('#save-state').textContent()));
offline = false;
await until(async () => (await A.page.locator('.cat-general').textContent()).includes('Taxi'), 20000);
await B.shot('sync-02-gastos-B');

// 7. A cambia la contraseña -> B la pide y sigue sincronizando
await A.page.getByRole('button', { name: 'Ajustes' }).click();
await A.page.getByRole('button', { name: 'Cambiar contraseña' }).click();
await A.fill('Contraseña actual', PASS);
await A.fill('Nueva contraseña', PASS + '!'); await A.fill('Repite la nueva contraseña', PASS + '!');
await A.submit();
await A.tab('Gastos');
await A.page.getByRole('button', { name: '+ Añadir gasto', exact: true }).click();
await A.fill('Nombre', 'Pan'); await A.fill('Importe real', '3'); await A.submit('Añadir');
await B.dlg().getByText('La contraseña se cambió en el otro móvil').waitFor({ timeout: 20000 });
await B.fill('Contraseña nueva', PASS + '!'); await B.submit('Continuar');
await until(async () => (await B.page.locator('.cat-general').textContent()).includes('Pan'), 20000);

// 8. B bloquea y vuelve a entrar con la contraseña nueva; sigue en vivo
await B.page.getByRole('button', { name: 'Bloquear' }).click();
await B.page.getByLabel('Contraseña').fill(PASS + '!');
await B.page.getByRole('button', { name: 'Desbloquear' }).click();
await B.page.locator('.tabbar').waitFor();
await until(async () => /en vivo/.test(await B.page.locator('#save-state').textContent()));
await A.page.getByRole('button', { name: '+ Añadir gasto', exact: true }).click();
await A.fill('Nombre', 'Café'); await A.fill('Importe real', '4'); await A.submit('Añadir');
await until(async () => (await B.page.locator('.cat-general').textContent()).includes('Café'), 20000);
await A.shot('sync-03-gastos-A');

assert.deepEqual(errors, [], 'sin errores en consola');
await browser.close();
server.close();
console.log('E2E SYNC OK', { versions: [...vaults.values()].map((v) => v.rev) });
