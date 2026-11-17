import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const proof = JSON.parse(readFileSync(new URL('../fixtures/owner-pos-release.json', import.meta.url)));
const originals = new Map();
export function gitBlob(value) {
  const bytes = Buffer.from(value);
  return createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
}
function original(file) {
  if (!originals.has(file)) {
    const bytes = execFileSync('git', ['show', proof.base + ':' + file], { cwd: root, maxBuffer: 8e6 });
    assert.equal(gitBlob(bytes), proof.files[file].before);
    originals.set(file, bytes);
  }
  return originals.get(file);
}
export function previousSource(value, path) {
  const name = path instanceof URL ? fileURLToPath(path) : String(path);
  const file = name.startsWith(root) ? relative(root, name).split(sep).join('/') : name;
  const pin = proof.files[file];
  if (!pin?.before || gitBlob(value) !== pin.after) return value;
  return typeof value === 'string' ? original(file).toString() : original(file);
}
export function previousNames(value, command, args) {
  if (args?.[0] === '-C') args = args.slice(2);
  if (command !== 'git' || !(args[0] === 'diff' && args.includes('--name-only') || args[0] === 'ls-files' && args.includes('--others'))) return value;
  const base = args.find(arg => /^[a-f0-9]{40}$/.test(arg));
  const files = value.toString().split(/\r?\n/).filter(Boolean).filter(file => {
    const pin = proof.files[file];
    if (!pin) return true;
    assert.equal(gitBlob(readFileSync(new URL('../../' + file, import.meta.url))), pin.after, file);
    if (!pin.before) return false;
    if (!base) return true;
    try { return execFileSync('git', ['rev-parse', '--verify', base + ':' + file], { cwd: root, encoding:'utf8', stdio:['ignore','pipe','ignore'] }).trim() !== pin.before; }
    catch { return true; }
  });
  const result = files.join('\n') + (files.length ? '\n' : '');
  return typeof value === 'string' ? result : Buffer.from(result);
}
