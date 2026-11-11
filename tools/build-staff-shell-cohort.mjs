import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

// The VM parses imports without evaluating application/Firebase code.
if(typeof vm.SourceTextModule!=='function'){
 const child=spawnSync(process.execPath,['--experimental-vm-modules',...process.argv.slice(1)],{stdio:'inherit',env:{...process.env,NODE_NO_WARNINGS:'1'}});process.exit(child.status??1);
}
const root=path.resolve(fileURLToPath(new URL('../takodeal-staff/',import.meta.url))),worker=path.join(root,'sw.js'),source=readFileSync(worker,'utf8');
const sandbox={URL,self:{location:{href:'https://staff.invalid/sw.js'},addEventListener(){}}};
vm.runInNewContext(source+';globalThis.reviewedShell=[...SHELL];',sandbox);
const shell=[...new Set(sandbox.reviewedShell)],seen=new Set(),digest=value=>createHash('sha256').update(value).digest('hex');
function localFile(relative){const file=path.resolve(root,relative==='./'?'index.html':relative);if(!file.startsWith(root+path.sep))throw Error('Staff shell path leaves its app.');if(!existsSync(file)||!readdirSync(path.dirname(file)).includes(path.basename(file)))throw Error('Missing or case-mismatched Staff shell file: '+relative);return file;}
function visit(file){
 if(seen.has(file))return;seen.add(file);const code=readFileSync(file,'utf8'),module=new vm.SourceTextModule(code,{identifier:file});
 const dependencies=[...module.dependencySpecifiers,...Array.from(code.matchAll(/\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g),match=>match[1])];
 for(const dependency of dependencies){if(!dependency.startsWith('.'))continue;const target=path.resolve(path.dirname(file),dependency),relative='./'+path.relative(root,target).split(path.sep).join('/');localFile(relative);if(!shell.includes(relative))throw Error('Missing transitive Staff module in SHELL: '+relative);visit(target);}
}
visit(localFile('./app.js'));visit(localFile('./staff-phone.js'));
if(!shell.includes('./staff-startup.js'))throw Error('The independent startup recovery must be in the Staff shell.');
const integrity={};for(const relative of shell){const bytes=readFileSync(localFile(relative));integrity[relative]={sha256:digest(bytes),bytes:bytes.length};}
const hash=digest(JSON.stringify(integrity)),block='// BEGIN GENERATED STAFF COHORT\nconst SHELL_INTEGRITY = '+JSON.stringify(integrity,null,2)+';\nconst COHORT_HASH = '+JSON.stringify(hash)+';\n// END GENERATED STAFF COHORT';
const pattern=/\/\/ BEGIN GENERATED STAFF COHORT[\s\S]*?\/\/ END GENERATED STAFF COHORT/;
if(!pattern.test(source))throw Error('The Staff cohort generation boundary is missing.');
const generated=source.replace(pattern,block);
if(process.argv.includes('--check')){if(generated!==source)throw Error('Staff shell cohort hashes are stale. Run node tools/build-staff-shell-cohort.mjs after all app files are frozen.');}
else writeFileSync(worker,generated);
console.log(JSON.stringify({check:process.argv.includes('--check'),assets:shell.length,modules:seen.size,cohortHash:hash}));
