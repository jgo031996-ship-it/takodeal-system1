import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const proof=JSON.parse(readFileSync(new URL('../fixtures/manual-missing-backend-inverse.json',import.meta.url),'utf8'));
const hash=source=>createHash('sha256').update(source).digest('hex');
export function restoreManualMissingSource(path,source){
 const row=proof.runtimeFiles.find(row=>row.path===path);if(!row)return source;
 if(hash(source)===row.baseSha256)return source;
 if(hash(source)!==row.sha256)throw Error('Manual missing source changed outside its exact reviewed proof: '+path);
 let restored=source.toString();for(const edit of row.inverse){if(restored.split(edit.from).length!==2)throw Error('Manual missing inverse hunk changed: '+path);restored=restored.replace(edit.from,()=>edit.to);}
 if(hash(restored)!==row.baseSha256)throw Error('Manual missing inverse changed an original source guard: '+path);return restored;
}
export function isProvedManualMissingDelta(path){const row=proof.runtimeFiles.find(row=>row.path===path);if(!row)return false;const source=readFileSync(new URL('../../'+path,import.meta.url));if(hash(source)!==row.sha256)throw Error('Only the exact reviewed manual source delta may precede history: '+path);restoreManualMissingSource(path,source);return true;}
