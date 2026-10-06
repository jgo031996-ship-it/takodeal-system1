import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
function cachedAssets(app, name) {
  const script = source(app + '/sw.js');
  const literal = script.match(new RegExp('const ' + name + '\\s*=\\s*(\\[[^;]+\\]);'))?.[1];
  assert.ok(literal, 'static shell list exists');
  const assets = vm.runInNewContext(literal);
  for (const match of script.matchAll(new RegExp(name + '\\.push\\(([^;]+)\\);', 'g'))) {
    assets.push(...vm.runInNewContext('[' + match[1] + ']'));
  }
  return assets;
}

test('new Manager and Franchise dependencies are available in the installed offline shell', () => {
  for (const [app, name, dependency] of [
    ['takodeal-manager', 'CORE_ASSETS', 'logistics-feed.js'],
    ['takodeal-franchise', 'CORE', 'franchise-reads.js']
  ]) {
    const paths = cachedAssets(app, name).map(path => path.replace(/^\.\//, ''));
    assert.ok(paths.includes(dependency), dependency + ' is cached');
    for (const path of paths) {
      assert.ok(existsSync(new URL('../' + app + '/' + (path || 'index.html'), import.meta.url)), app + '/' + path + ' is deployable');
    }
  }
});

function riderWorker({ offline = false } = {}) {
  const listeners = {}, calls = [], jobs = [];
  const response = new Response('current app');
  const cache = {
    put: async (...args) => calls.push(['put', ...args]),
    match: async (...args) => { calls.push(['match', ...args]); return response; },
    addAll: async () => {}
  };
  const context = {
    URL, Response,
    self: { location: { href: 'https://rider.example/sw.js' }, clients: { claim: async () => {} }, addEventListener: (name, handler) => { listeners[name] = handler; } },
    caches: {
      open: async name => { calls.push(['open', name]); return cache; },
      keys: async () => ['rider-app-v1', 'rider-app-v2-read-budget', 'other-app-cache'],
      delete: async name => { calls.push(['delete', name]); return true; }
    },
    fetch: async request => { calls.push(['fetch', request.url]); if (offline) throw new Error('offline'); return response; }
  };
  vm.runInNewContext(source('takodeal-delivery/sw.js'), context);
  return {
    calls,
    async request(url, method = 'GET') {
      let handled;
      listeners.fetch({ request: new Request(url, { method }), respondWith: result => { handled = result; }, waitUntil: result => jobs.push(result) });
      if (!handled) return null;
      const result = await handled;
      await Promise.all(jobs);
      return result;
    },
    async activate() { listeners.activate({ waitUntil: result => jobs.push(result) }); await Promise.all(jobs); }
  };
}

test('Rider business/auth requests remain online and are never handled as app files', async () => {
  const worker = riderWorker();
  for (const url of [
    'https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel',
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup',
    'https://rider.example/api/deliveries'
  ]) assert.equal(await worker.request(url), null);
  assert.equal(await worker.request('https://rider.example/main.js', 'POST'), null);
  assert.deepEqual(worker.calls, []);
});

test('Rider static updates use the network before the current offline cache', async () => {
  const worker = riderWorker();
  assert.equal(await (await worker.request('https://rider.example/main.js?v=new')).text(), 'current app');
  assert.deepEqual(worker.calls.map(call => call[0]), ['open', 'fetch', 'put']);
});

test('Rider offline fallback reads only the current version and tolerates the app version query', async () => {
  const worker = riderWorker({ offline: true });
  assert.equal(await (await worker.request('https://rider.example/main.js?v=new')).text(), 'current app');
  assert.equal(worker.calls[0][1], 'rider-app-v2-read-budget');
  assert.equal(worker.calls.find(call => call[0] === 'match')[2].ignoreSearch, true);
});

test('Rider activation retires only earlier Rider static shells', async () => {
  const worker = riderWorker();
  await worker.activate();
  assert.deepEqual(worker.calls.filter(call => call[0] === 'delete'), [['delete', 'rider-app-v1']]);
});
