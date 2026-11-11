import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const directory=new URL('../fixtures/prep-recovery-live-b206/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('manifest.json',directory),'utf8'));
if(manifest.base!=='b206f51d7963925ea9bc34825d46b4a39bb782ad'||manifest.files.length!==2)throw Error('Use only the exact reviewed old prep revision.');
// Fixture bytes are unmodified git blobs. Only import specifier locations are
// relocated for execution; unchanged shared dependencies remain production code.
async function load(name){const path='functions/cash-remittance-review/'+name,source=readFileSync(new URL(name,directory)),proof=manifest.files.find(row=>row.path===path);if(!proof||createHash('sha256').update(source).digest('hex')!==proof.sha256)throw Error('Old prep fixture changed: '+name);const relocated=source.toString().replace(/from '([^']+)'/g,(_match,specifier)=>{if(!specifier.startsWith('.'))return "from '"+specifier+"'";return "from '"+new URL('../../functions/cash-remittance-review/'+specifier,import.meta.url).href+"'";});return import('data:text/javascript;base64,'+Buffer.from(relocated).toString('base64'));}
export const {createPrepHandler:createLegacyPrepHandler}=await load('prep-handler.mjs');
export const {createPrepStore:createLegacyPrepStore}=await load('prep-store.mjs');
