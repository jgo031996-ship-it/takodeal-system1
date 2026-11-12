import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
export function renderStaffStartupInline(before,runtime){
if(/<\/script/i.test(runtime))throw Error('Staff startup runtime contains an HTML script terminator. Refuse inline generation.');
const start='    <!-- BEGIN GENERATED STAFF STARTUP -->',end='    <!-- END GENERATED STAFF STARTUP -->';
const block=start+'\n    <script>'+runtime+'</script>\n'+end;
let generated=before;
if(before.includes(start)||before.includes(end)){
 const from=before.indexOf(start),to=before.indexOf(end);
 if(from<0||to<from||before.indexOf(start,from+1)!==-1||before.indexOf(end,to+1)!==-1)throw Error('Ambiguous Staff startup generation boundary.');
 generated=before.slice(0,from)+block+before.slice(to+end.length);
}else{
 const charset=/^    <meta charset="UTF-8">\r?$/m,match=charset.exec(before);
 if(!match||before.slice(0,match.index).includes('<link')||before.slice(0,match.index).includes('<script')||before.slice(0,match.index).includes('<style'))throw Error('Staff startup must follow the initial charset before all dependencies.');
 generated=before.slice(0,match.index+match[0].length)+'\n'+block+before.slice(match.index+match[0].length);
}
generated=generated.replace(/^    <script defer src="staff-startup\.js\?v=staff-startup-20261111-r[12]"><\/script>\r?\n/gm,'');
const from=generated.indexOf(start),prefix=generated.slice(0,from);
if(/<link\b|<style\b|<script\b/i.test(prefix)||/src=["']staff-startup\.js/.test(generated))throw Error('Staff startup must execute before every external dependency.');
return generated;
}
export function renderStaffSelfRepairInline(before,runtime){
if(/<\/script/i.test(runtime))throw Error('Staff repair runtime contains an HTML script terminator.');
const start='    <!-- BEGIN GENERATED STAFF SELF REPAIR -->',end='    <!-- END GENERATED STAFF SELF REPAIR -->',block=start+'\n    <script>'+runtime+'</script>\n'+end;
let generated=before;
if(before.includes(start)||before.includes(end)){
 const from=before.indexOf(start),to=before.indexOf(end);if(from<0||to<from||before.indexOf(start,from+1)!==-1||before.indexOf(end,to+1)!==-1)throw Error('Ambiguous Staff repair generation boundary.');generated=before.slice(0,from)+block+before.slice(to+end.length);
}else{
 const anchor='    <!-- END GENERATED STAFF STARTUP -->',at=before.indexOf(anchor);if(at<0||before.indexOf(anchor,at+1)!==-1)throw Error('Generate the independent Staff startup before repair.');generated=before.slice(0,at+anchor.length)+'\n'+block+before.slice(at+anchor.length);
}
const from=generated.indexOf(start),prefix=generated.slice(0,from),startupEnd=prefix.indexOf('    <!-- END GENERATED STAFF STARTUP -->');
if(startupEnd<0||/<link\b|<style\b/i.test(prefix)||/src=["']staff-self-repair\.js/.test(generated))throw Error('Staff repair must execute parser-inline before external dependencies.');
return generated;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
const root=new URL('../takodeal-staff/',import.meta.url),page=new URL('index.html',root),runtime=readFileSync(new URL('staff-startup.js',root),'utf8'),before=readFileSync(page,'utf8'),generated=renderStaffSelfRepairInline(renderStaffStartupInline(before,runtime),readFileSync(new URL('staff-self-repair.js',root),'utf8'));
if(process.argv.includes('--check')){if(generated!==before)throw Error('Inline Staff startup is stale. Run node tools/build-staff-startup-inline.mjs before building the shell cohort.');}
else writeFileSync(page,generated);
console.log(JSON.stringify({check:process.argv.includes('--check'),runtimeBytes:Buffer.byteLength(runtime),inlineBeforeDependencies:true}));
}
