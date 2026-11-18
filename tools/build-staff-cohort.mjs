import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function staffCohort(root=resolve(dirname(fileURLToPath(import.meta.url)),'../takodeal-staff')) {
    const path=resolve(root,'sw.js'),source=readFileSync(path,'utf8');
    const before=source.split('// BEGIN GENERATED STAFF COHORT')[0];
    const {paths,release}=vm.runInNewContext(before+';({paths:SHELL,release:STAFF_RELEASE})');
    const integrity=Object.fromEntries([...new Set(paths)].map(key=>{
        if(!/^\.\/[a-zA-Z0-9._/-]*$/.test(key)||key.includes('..'))throw Error('Invalid shell path: '+key);
        const bytes=readFileSync(resolve(root,key==='./'?'index.html':key));
        return [key,{sha256:digest(bytes),bytes:bytes.length}];
    }));
    const cohortHash=digest(JSON.stringify({release,integrity}));
    const generated='// BEGIN GENERATED STAFF COHORT\nconst SHELL_INTEGRITY = '+JSON.stringify(integrity,null,2)+';\nconst COHORT_HASH = '+JSON.stringify(cohortHash)+';\n// END GENERATED STAFF COHORT';
    const output=source.replace(/\/\/ BEGIN GENERATED STAFF COHORT[\s\S]*?\/\/ END GENERATED STAFF COHORT/,generated);
    return {path,source,output,integrity,cohortHash,release};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
    const result=staffCohort();
    if(process.argv.includes('--check')){
        if(result.source!==result.output)throw Error('Staff release checksums are stale. Run node tools/build-staff-cohort.mjs before publishing.');
        console.log('Staff cohort verified:',Object.keys(result.integrity).length,'assets',result.release);
    }else{writeFileSync(result.path,result.output);console.log('Staff cohort generated:',Object.keys(result.integrity).length,'assets');}
}
