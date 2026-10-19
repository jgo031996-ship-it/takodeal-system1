import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSopChecklist,paginateSopChecklistTasks,sopChecklistFilename,SOP_CHECKLIST_LIMITS} from '../takodeal-manager/sop-checklist-model.js';
import {buildSopChecklistDocument,downloadSopChecklistPDF} from '../takodeal-manager/sop-checklist-pdf.js';

test('checklist input preserves every saved role and task string without sharing mutable arrays',()=>{
 const input={branch:'Agdao',roles:[{name:'Kitchen',tasks:['  Saved task\nwith its punctuation.  ','第二道作業 🐙']},{name:'New role',tasks:[]}]},copy=normalizeSopChecklist(input);
 assert.deepEqual(copy,input);copy.roles[0].tasks.push('Other');assert.equal(input.roles[0].tasks.length,2);assert.equal(copy.roles[1].tasks.length,0);
 for(const bad of [{branch:'',roles:input.roles},{branch:'Agdao',roles:[]},{branch:'Agdao',roles:[{name:'Kitchen',tasks:[' ']}]},{branch:'Agdao',roles:[{name:'Kitchen',tasks:[{text:'Task'}]}]}])assert.throws(()=>normalizeSopChecklist(bad));
 assert.throws(()=>normalizeSopChecklist({branch:'Agdao',roles:[{name:'Kitchen',tasks:['a'.repeat(SOP_CHECKLIST_LIMITS.characters+1)]}]}),/too large/);
});

test('whole tasks move intact to the next page whenever they fit a complete page',()=>{
 const pages=paginateSopChecklistTasks(['first','second','third'],{capacity:60,measure:text=>text==='first'?32:45});
 assert.deepEqual(pages.map(page=>page.map(row=>row.text)),[['first'],['second'],['third']]);assert.ok(pages.flat().every(row=>row.partIndex===0&&!row.continued));
});

test('long Unicode, whitespace and unbroken tasks split into readable bounded rows with exact reconstruction',()=>{
 const tasks=['Normal saved task.','🍣🐙漢字é '.repeat(450)+'\n\n  Final words.\n','UNBROKEN'.repeat(800)];
 const measure=text=>12+Math.max(1,Math.ceil(Array.from(text).length/28))*12;
 const pages=paginateSopChecklistTasks(tasks,{capacity:108,measure});assert.ok(pages.length>10);
 for(const page of pages)assert.ok(page.reduce((sum,row)=>sum+row.height,0)<=108);
 tasks.forEach((task,index)=>assert.equal(pages.flat().filter(row=>row.taskIndex===index).map(row=>row.text).join(''),task));
 for(const row of pages.flat()){assert.equal(/[\uD800-\uDBFF]$/.test(row.text),false);assert.equal(/^[\uDC00-\uDFFF]/.test(row.text),false);assert.equal(row.continued,row.partIndex>0);}
});

test('empty roles retain a page and impossible, invalid or excessive pagination fails explicitly',()=>{
 assert.deepEqual(paginateSopChecklistTasks([],{capacity:50,measure:()=>20}),[[]]);
 assert.throws(()=>paginateSopChecklistTasks(['Task'],{capacity:20,measure:()=>30}),/no room/);
 assert.throws(()=>paginateSopChecklistTasks(['Task'],{capacity:20,measure:()=>NaN}),/could not be measured/);
 assert.throws(()=>paginateSopChecklistTasks(['One','Two'],{capacity:20,measure:()=>20,maxPages:1}),/too many pages/);
});

test('download filenames cannot contain a path and keep a single PDF suffix',()=>{
 assert.equal(sopChecklistFilename('Agdao',[{name:'Kitchen'}]),'TAKODEAL-SOP-Agdao-Kitchen.pdf');
 assert.equal(sopChecklistFilename('Agdao',[{},{}],'../../bad\\name:?.PDF'),'..-..-bad-name--.PDF');
 assert.ok(sopChecklistFilename('x',[{}],'x'.repeat(250)).length<=179);
});

function domHarness({onPdf,renderError,bytes}={}){
 class Node{
  constructor(tag){this.tagName=tag.toUpperCase();this.style={};this.children=[];this.attributes={};this.className='';this.value='';this.ownText='';this.clientWidth=678;}
  set textContent(value){this.ownText=String(value);this.children=[];}get textContent(){return this.ownText+this.children.map(node=>node.textContent).join('');}
  appendChild(node){node.remove();node.parentElement=this;this.children.push(node);return node;}
  setAttribute(name,value){this.attributes[name]=value;}
  remove(){if(this.parentElement){const list=this.parentElement.children;list.splice(list.indexOf(this),1);this.parentElement=null;}}
  getBoundingClientRect(){if(this.className==='sop-checklist-rows')return {width:680,height:600};if(this.className==='sop-checklist-row'){const text=this.children[1].textContent;return {width:678,height:Math.max(32,12+Math.ceil(Array.from(text).length/65)*18+(text.match(/\n/g)||[]).length*18)};}return {width:680,height:1005};}
 }
 const d={createElement:tag=>new Node(tag),body:new Node('body'),fonts:{ready:Promise.resolve()}},calls=[],canvases=[],saved=[];
 let count=1;const pdf={internal:{getNumberOfPages:()=>count},addPage:(...args)=>{count++;calls.push(['addPage',...args]);},addImage:(...args)=>calls.push(['addImage',...args]),output:type=>{calls.push(['output',type]);return bytes?{size:bytes}:new Blob(['sample-pdf-bytes'],{type:'application/pdf'});},save:name=>saved.push(name)};
 const w={html2pdf(){let source,settings;const canvas={width:680,height:1005,toDataURL:(...args)=>{calls.push(['dataURL',...args]);return 'data:image/jpeg;base64,sample';}};canvases.push(canvas);const worker={set(value){settings=value;calls.push(['settings',value]);return this;},from(value){source=value;calls.push(['from',value]);return this;},toPdf(){calls.push(['toPdf',source]);return this;},toCanvas(){calls.push(['toCanvas',source]);return this;},async get(key){if(renderError)throw Error('Render failed');if(key==='pdf'){onPdf?.();return pdf;}if(key==='canvas')return canvas;throw Error('Unexpected worker property');}};return worker;}};
 return {w,d,calls,canvases,saved,pdf};
}

test('actual document builder uses safe saved text, A4 content dimensions and repeats writing/signoff fields per page',async()=>{
 const h=domHarness(),options={branch:'Agdao <branch>',roles:[{name:'Kitchen',tasks:['<img src=x onerror=alert(1)>','Saved task. '.repeat(500)]},{name:'No duties yet',tasks:[]}],assertCurrent:()=>true};
 const built=await buildSopChecklistDocument(h.w,h.d,options);assert.ok(built.pageCount>=3);assert.equal(built.pages[0].page.style.width,'180mm');assert.equal(built.pages[0].page.style.height,'266mm');
 assert.equal(built.pages.at(-1).role,'No duties yet');assert.match(built.pages.at(-1).page.textContent,/No saved tasks for this role/);
 for(const [index,page] of built.pages.entries()){
  const text=page.page.textContent;for(const label of ['TAKODEÁL DAILY SOP CHECKLIST','Tasks for '+page.role,'Branch:Agdao <branch>','Date:','Employee:','Supervisor:','Remarks / handover','Employee signature','Supervisor signature','Page '+(index+1)+' of '+built.pageCount])assert.ok(text.includes(label),label);
 }
 assert.ok(built.pages[0].page.textContent.includes(options.roles[0].tasks[0]));assert.equal(h.d.body.children.length,1);built.destroy();assert.equal(h.d.body.children.length,0);
});

test('long unbroken task tokens use canvas-compatible breaking while retaining the exact saved text and normal word wrapping',async()=>{
 const h=domHarness(),token='TRACEABILITY_'+'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(10),saved='Keep this ordinary wording. '+token+'\nThen retain this Unicode token: '+'漢字🐙'.repeat(40)+' and the final words.';
 const built=await buildSopChecklistDocument(h.w,h.d,{branch:'Agdao',roles:[{name:'Kitchen',tasks:[saved]}]});
 const descend=node=>[node,...node.children.flatMap(descend)],texts=built.pages.flatMap(page=>descend(page.page).filter(node=>node.className==='sop-checklist-task-text'));
 assert.equal(texts.map(node=>node.textContent).join(''),saved);
 const tokens=texts.flatMap(descend).filter(node=>node.className==='sop-checklist-long-token');assert.ok(tokens.length>=2);assert.ok(tokens.every(node=>node.style.wordBreak==='break-all'&&node.style.whiteSpace==='pre-wrap'));
 assert.ok(texts.every(node=>node.style.wordBreak==='normal'));assert.ok(tokens.some(node=>node.textContent===token));built.destroy();
});

test('export renders separate page canvases, assembles A4 PDF pages and returns a Blob without saving in review mode',async()=>{
 const h=domHarness(),blob=await downloadSopChecklistPDF(h.w,h.d,{branch:'Agdao',roles:[{name:'Kitchen',tasks:['Saved first task']},{name:'Cashier',tasks:['Saved second task']}],save:false,assertCurrent:()=>true});
 assert.ok(blob instanceof Blob);assert.equal(blob.type,'application/pdf');assert.equal(h.saved.length,0);assert.equal(h.calls.filter(row=>row[0]==='toPdf').length,1);assert.equal(h.calls.filter(row=>row[0]==='toCanvas').length,1);assert.equal(h.calls.filter(row=>row[0]==='addPage').length,1);
 const settings=h.calls.find(row=>row[0]==='settings')[1];assert.deepEqual(settings.margin,[15,15,15,15]);assert.equal(settings.jsPDF.orientation,'portrait');assert.equal(settings.jsPDF.format,'a4');assert.deepEqual(settings.pagebreak.mode,[]);
 for(const canvas of h.canvases){assert.equal(canvas.width,0);assert.equal(canvas.height,0);}assert.equal(h.d.body.children.length,0);
});

test('normal download saves once after every current-account check and cleans up printable data',async()=>{
 const h=domHarness();let checks=0;const blob=await downloadSopChecklistPDF(h.w,h.d,{branch:'Agdao',roles:[{name:'Kitchen',tasks:[]}],assertCurrent:()=>{checks++;}});
 assert.ok(blob.size>0);assert.deepEqual(h.saved,['TAKODEAL-SOP-Agdao-Kitchen.pdf']);assert.ok(checks>=7);assert.equal(h.d.body.children.length,0);
});

test('an account or branch change during rendering cannot download or retain the checklist DOM',async()=>{
 let current=true;const h=domHarness({onPdf:()=>{current=false;}});await assert.rejects(downloadSopChecklistPDF(h.w,h.d,{branch:'Agdao',roles:[{name:'Kitchen',tasks:['Saved task']}],assertCurrent:()=>current}),/account changed/);
 assert.equal(h.saved.length,0);assert.equal(h.d.body.children.length,0);
});

test('render failures and oversized output never save a file and remove all temporary content',async()=>{
 for(const options of [{renderError:true},{bytes:SOP_CHECKLIST_LIMITS.pdfBytes+1}]){const h=domHarness(options);await assert.rejects(downloadSopChecklistPDF(h.w,h.d,{branch:'Agdao',roles:[{name:'Kitchen',tasks:['Saved task']}],assertCurrent:()=>true}),/Render failed|too large/);assert.equal(h.saved.length,0);assert.equal(h.d.body.children.length,0);}
});
