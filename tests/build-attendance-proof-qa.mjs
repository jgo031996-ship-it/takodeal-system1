import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),work=path.dirname(source);
const destinations=[path.join(work,'staff-proof-qa'),path.join(work,'tablet-attendance-stock-qa','staff-proof-review')];
const module=path.join(source,'takodeal-staff','attendance-proof.js');
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'none'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; worker-src 'none'; object-src 'none'; form-action 'none'"><title>LOCAL SAMPLE · Older-phone screenshot upload</title><script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script><style>*{box-sizing:border-box}body{margin:0;color:#173f32;background:#f5f8f2;font:16px/1.5 system-ui}main{max-width:540px;margin:auto;padding:20px}h1{font-size:25px}button,select{min-height:46px;width:100%;padding:10px;border:1px solid #b5cdc3;border-radius:10px;font:inherit;margin:8px 0}button{background:#173f32;color:white;font-weight:700}pre{font:12px/1.5 monospace;white-space:pre-wrap;overflow-wrap:anywhere}img{max-width:100%;max-height:320px;display:block;margin:auto}.notice{padding:12px;background:#e6efe8;border-radius:10px}label{display:block;font-weight:700}.swal2-popup{font-family:system-ui}.swal2-cancel{min-height:44px!important}</style></head><body><main><p class="notice">LOCAL SAMPLE · Synthetic screenshot and upload only. No employee account, real attendance, Firebase connection or saved record.</p><h1>Screenshot upload for older phones</h1><p>The real image-preparation and upload controls run here. Transfer timing and server confirmation are simulated.</p><label for="sampleMode">Sample connection</label><select id="sampleMode"><option value="fast">Fast upload</option><option value="slow">Slow upload · try Cancel</option><option value="stalled">Upload stops responding · 6-second sample timeout</option><option value="url-fail">Upload finishes but confirmation fails</option></select><button id="sampleUpload">Upload sample screenshot</button><p id="sampleStatus" role="status">Ready for a sample check.</p><p id="sampleSize"></p><img id="samplePreview" alt="Prepared synthetic screenshot" hidden><pre id="sampleLedger"></pre></main><script type="module" src="sample-proof.js"></script></body></html>`;
const script=String.raw`
import {installAttendanceProofUploader,prepareAttendanceProof,createProofUpload} from './attendance-proof.js';
const el=id=>document.getElementById(id),ledger={sampleOnly:true,cloudRequests:0,productionWrites:0,uploads:0,cancellations:0,confirmed:0};
const report=message=>{el('sampleStatus').textContent=message;el('sampleLedger').textContent=JSON.stringify(ledger,null,2);};
let selectedMode='fast',previewURL=null;
async function sampleFile(){
    const canvas=document.createElement('canvas');canvas.width=2400;canvas.height=3600;const ctx=canvas.getContext('2d');
    ctx.fillStyle='#f1f5f1';ctx.fillRect(0,0,2400,3600);ctx.fillStyle='#173f32';ctx.fillRect(0,0,2400,360);ctx.fillStyle='#fff';ctx.font='bold 86px system-ui';ctx.fillText('SYNTHETIC MESSAGE · SAMPLE ONLY',100,220);
    ctx.fillStyle='#ffffff';ctx.fillRect(150,570,2100,2300);ctx.fillStyle='#173f32';ctx.font='72px system-ui';
    ['Hello, this is a local sample message.','The screenshot shows a late-arrival reason.','No real staff member or private message','is included in this test.','','The app prepares a smaller JPG before','uploading on a slow connection.','','Reason: Sample transport delay.','Staff: Sample reviewer only.'].forEach((line,i)=>ctx.fillText(line,240,780+i*170));
    return new Promise(resolve=>canvas.toBlob(blob=>{canvas.width=canvas.height=0;resolve(new File([blob],'synthetic-message.png',{type:'image/png'}));},'image/png'));
}
function fakeUpload(reference,blob){
    ledger.uploads++;let observer=null,timer=null,bytes=0,stopped=false;
    const task={snapshot:{ref:reference,bytesTransferred:0,totalBytes:blob.size},cancel(){if(stopped)return false;stopped=true;clearTimeout(timer);ledger.cancellations++;observer?.error(Object.assign(Error('Sample cancelled'),{code:'storage/canceled'}));return true;},on(event,progress,error,complete){if(event!=='state_changed')throw Error('Unexpected sample event');observer={progress,error,complete};progress(task.snapshot);if(selectedMode!=='stalled')advance();return()=>{observer=null;};}};
    function advance(){timer=setTimeout(()=>{if(stopped)return;bytes=Math.min(blob.size,bytes+Math.max(1,Math.ceil(blob.size/(selectedMode==='slow'?100:4))));task.snapshot={ref:reference,bytesTransferred:bytes,totalBytes:blob.size};observer?.progress(task.snapshot);if(bytes===blob.size){stopped=true;observer?.complete();}else advance();},selectedMode==='slow'?500:200);}
    return task;
}
installAttendanceProofUploader(window,document,{Swal,uploadBytesResumable:fakeUpload,ref:(_storage,path)=>({path}),getStorage:()=>({sample:true}),getDownloadURL:async()=>{if(selectedMode==='url-fail')throw Error('Synthetic server confirmation failure.');ledger.confirmed++;return 'https://example.invalid/sample-only-proof.jpg';},
    prepare:async(file,options)=>{const result=await prepareAttendanceProof(file,options);el('sampleSize').textContent='Actual sample size: '+file.size.toLocaleString()+' bytes → '+result.uploadBytes.toLocaleString()+' bytes ('+Math.round(100-result.uploadBytes/file.size*100)+'% smaller).';if(previewURL)URL.revokeObjectURL(previewURL);previewURL=URL.createObjectURL(result.blob);el('samplePreview').src=previewURL;el('samplePreview').hidden=false;return result;},
    createUpload:options=>createProofUpload({...options,timeoutMs:selectedMode==='slow'?90000:6000,stallMs:selectedMode==='slow'?90000:6000,urlTimeoutMs:3000})});
window.storage={sample:true};
el('sampleUpload').onclick=async()=>{if(el('sampleUpload').disabled)return;el('sampleUpload').disabled=true;selectedMode=el('sampleMode').value;report('Preparing the synthetic screenshot…');try{const file=await sampleFile();const result=await window.uploadAttendanceProof({file,path:'staff_requests/late_sample-only.jpg'});report('Sample screenshot confirmed. No attendance or other production record was written.');}catch(error){report(error.message+' This local sample changed no production records.');}finally{el('sampleUpload').disabled=false;el('sampleLedger').textContent=JSON.stringify(ledger,null,2);}};
window.addEventListener('pagehide',()=>{if(previewURL)URL.revokeObjectURL(previewURL);});report('Ready for a sample check.');
`;
for(const destination of destinations){
    const relative=path.relative(work,destination);if(relative.startsWith('..')||path.isAbsolute(relative)||!path.relative(source,destination).startsWith('..'))throw Error('Sample must stay outside the source checkout and inside work.');
    await mkdir(destination,{recursive:true});
    await copyFile(module,path.join(destination,'attendance-proof.js'));
    await writeFile(path.join(destination,'index.html'),html);
    await writeFile(path.join(destination,'phone.html'),'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>LOCAL SAMPLE · Staff phone upload review</title></head><body style="font:16px system-ui;background:#f4f7f1;padding:20px"><h1 style="font-size:22px">Actual upload controls · 390 px phone</h1><p>Synthetic screenshot and transport only. No real attendance record.</p><iframe id="proofPhone" title="Phone upload preview" src="index.html" style="width:390px;height:844px;border:1px solid #bdcdc5;border-radius:12px"></iframe></body></html>');
    await writeFile(path.join(destination,'sample-proof.js'),script);
    await writeFile(path.join(destination,'source-manifest.json'),JSON.stringify({sampleOnly:true,productionWrites:0,moduleSHA256:createHash('sha256').update(await readFile(module)).digest('hex'),syntheticTransportTimeoutMs:6000,productionTransportTimeoutMs:180000},null,2)+'\n');
}
console.log(JSON.stringify({sampleDirectories:destinations,productionWrites:0}));
