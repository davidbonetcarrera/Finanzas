// Prueba de Face ID con un autenticador virtual (WebAuthn + PRF) en Chromium.
// Uso: node tests/e2e-bio.mjs
import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
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
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end('no'); }
}).listen(8767);

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const cdp = await ctx.newCDPSession(page);
await cdp.send('WebAuthn.enable');
const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
  protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
  isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
const shot = (n) => page.screenshot({ path: OUT + n + '.png', fullPage: true });
const dlg = () => page.locator('dialog[open]');
const PASS = 'mi clave de prueba 2026';

await page.goto('http://localhost:8767/');
await page.getByLabel('Nueva contraseña').fill(PASS);
await page.getByLabel('Repite la contraseña').fill(PASS);
await page.getByRole('button', { name: 'Crear y empezar' }).click();
await page.locator('.tabbar').waitFor();

// Activar Face ID en Ajustes
await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
await page.getByRole('button', { name: 'Activar Face ID' }).click();
await dlg().locator('input[type=password]').first().fill(PASS);
await dlg().getByRole('button').filter({ hasText: /Activar|Continuar/ }).first().click();
await page.getByText('✓ Face ID activado').waitFor({ timeout: 10000 });
await shot('bio-01-ajustes');

// Volver a entrar: desbloquear con Face ID
await page.reload();
await page.getByRole('button', { name: 'Desbloquear con Face ID' }).waitFor();
await shot('bio-02-bloqueo');
await page.getByRole('button', { name: 'Desbloquear con Face ID' }).click();
await page.locator('.tabbar').waitFor({ timeout: 10000 });

// La contraseña sigue funcionando
await page.reload();
await page.getByLabel('Contraseña').fill(PASS);
await page.getByRole('button', { name: 'Desbloquear', exact: true }).click();
await page.locator('.tabbar').waitFor();

// Sin la huella/rostro correcto (credencial borrada) no entra y muestra aviso
await cdp.send('WebAuthn.clearCredentials', { authenticatorId });
await page.reload();
await page.getByRole('button', { name: 'Desbloquear con Face ID' }).click();
await page.getByText('No se pudo usar Face ID').waitFor({ timeout: 70000 });

// Desactivar
await page.getByLabel('Contraseña').fill(PASS);
await page.getByRole('button', { name: 'Desbloquear', exact: true }).click();
await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
await page.getByRole('button', { name: 'Desactivar Face ID' }).click();
await page.getByRole('button', { name: 'Activar Face ID' }).waitFor();
await page.reload();
await page.getByLabel('Contraseña').waitFor();
assert.equal(await page.getByRole('button', { name: 'Desbloquear con Face ID' }).count(), 0);

assert.deepEqual(errors, []);
console.log('OK Face ID e2e');
await browser.close(); server.close();
