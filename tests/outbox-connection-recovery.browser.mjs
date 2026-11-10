import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
test('native IDB connection recovery preserves receipts across tabs, closure, aborts, deadlines and real versionchange', { timeout: 45000 }, async () => {
    const root = fileURLToPath(new URL('../', import.meta.url)), executable = process.env.OUTBOX_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    if (!existsSync(executable)) throw Error('A local Chromium browser is required for the explicit native test.');
    const profile = mkdtempSync(resolve(root, '../../outputs/outbox-native-profile-')); assert.ok(profile.startsWith(resolve(root, '../../outputs') + sep));
    const files = new Map(['/Takodeal-POS/pos-safety.js', '/tests/helpers/outbox-recovery-native-browser.js'].map(path => [path, readFileSync(resolve(root, '.' + path))]));
    let finish, browser; const result = new Promise(resolve => { finish = resolve; });
    const server = http.createServer((request, response) => {
        response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; frame-src 'self'; connect-src 'self'; base-uri 'none'");
        const path = new URL(request.url, 'http://127.0.0.1').pathname;
        if (path === '/result' && request.method === 'POST') { let body = ''; request.on('data', value => { body += value; if (body.length > 20000) request.destroy(); }); request.on('end', () => { try { finish(JSON.parse(body)); response.end('ok'); } catch { response.writeHead(400).end(); } }); return; }
        if (request.method !== 'GET') { response.writeHead(405).end(); return; }
        if (path === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><body><script type="module" src="/tests/helpers/outbox-recovery-native-browser.js"></script></body></html>'); return; }
        if (!files.has(path)) { response.writeHead(404).end(); return; } response.setHeader('Content-Type', 'text/javascript'); response.end(files.get(path));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); let timer, diagnostics = '';
    try {
        browser = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-background-networking', '--disable-component-update', '--disable-features=msEdgeSidebarV2,msImplicitSignin', '--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE 127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'http://127.0.0.1:' + server.address().port], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        for (const stream of [browser.stdout, browser.stderr]) stream.on('data', value => { diagnostics = (diagnostics + value).slice(-4000); });
        const report = await Promise.race([result, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Local test timed out: ' + diagnostics)), 35000); })]);
        assert.equal(report.passed, true, JSON.stringify(report)); assert.equal(report.nativeIndexedDB, true); assert.ok(report.checks.length >= 15); process.stdout.write('Native checks: ' + report.checks.length + '\n');
    } finally { clearTimeout(timer); browser?.kill(); await new Promise(resolve => server.close(resolve)); }
});
