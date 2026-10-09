import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {dirname, resolve, delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

// Local-only launcher: requires the isolated test tools/runtime prepared outside
// the production checkout. It never selects or authenticates a real project.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tools = resolve(process.env.STAFF_DOCUMENT_TEST_TOOLS || resolve(root, '../staff-nextlevel-tools'));
const runtime = JSON.parse(readFileSync(resolve(tools, 'runtime.json'), 'utf8'));
const cli = process.env.STAFF_DOCUMENT_FIREBASE_CLI || resolve(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib/bin/firebase.js');
if (!existsSync(runtime.java) || !existsSync(cli)) throw Error('The isolated Java 21 runtime or Firebase CLI is missing.');
mkdirSync(resolve(tools, 'config'), {recursive: true});
const configPath = resolve(tools, 'staff-document-emulators.json');
writeFileSync(configPath, JSON.stringify({
    firestore: {rules: resolve(root, 'firestore.rules')},
    storage: {rules: resolve(root, 'docs/staff-document-storage.rules.snippet')},
    emulators: {firestore: {host: '127.0.0.1', port: 8787}, storage: {host: '127.0.0.1', port: 9797},
        hub: {host: '127.0.0.1', port: 4797}, logging: {host: '127.0.0.1', port: 4897}, ui: {enabled: false}, singleProjectMode: true}
}, null, 2));
const child = spawn(process.execPath, [cli, '--config', configPath, '--project', 'demo-staff-document-vault',
    'emulators:exec', '--only', 'firestore,storage', '--non-interactive', 'node --test tests/staff-document-authorization.emulator.mjs'], {
    cwd: root, stdio: 'inherit', windowsHide: true,
    env: {...process.env, PATH: dirname(runtime.java) + delimiter + process.env.PATH,
        XDG_CONFIG_HOME: resolve(tools, 'config'), FIREBASE_EMULATORS_PATH: resolve(tools, 'emulators'),
        STAFF_DOCUMENT_TEST_TOOLS: tools, NO_UPDATE_NOTIFIER: '1', FIREBASE_CLI_DISABLE_UPDATE_CHECK: '1'}
});
child.on('error', error => {throw error;});
child.on('exit', code => {process.exitCode = code || 0;});
