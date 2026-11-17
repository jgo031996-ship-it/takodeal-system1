import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { proof, gitBlob } from './helpers/owner-pos-release.mjs';

const root = new URL('../', import.meta.url);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
test('the Owner POS release changes only its reviewed Cashier assets', () => {
  const changed = git('diff', '--name-only', proof.base, 'HEAD', '--', '.', ':!tests', ':!.github');
  assert.deepEqual(changed.split('\n').sort(), Object.keys(proof.files).sort());
  for (const [file,pin] of Object.entries(proof.files)) {
    assert.equal(gitBlob(readFileSync(new URL(file,root))),pin.after,file);
    if(pin.before) assert.equal(git('rev-parse',proof.base+':'+file),pin.before);
  }
  for(const file of ['sw.js','index.html','cashier-data.js']) assert.ok(readFileSync(new URL('Takodeal-POS/'+file,root),'utf8').includes(proof.release));
});
