import {ensureManagerLibrary} from './manager-libraries.js';
import {normalizeSopChecklist,paginateSopChecklistTasks,sopChecklistFilename,SOP_CHECKLIST_LIMITS} from './sop-checklist-model.js';

const style=(node,values)=>{Object.assign(node.style,values);return node;};
function element(d,tag,text,styles={}){const node=d.createElement(tag);if(text!==undefined)node.textContent=text;return style(node,{boxSizing:'border-box',margin:'0',...styles});}
async function assertCurrent(options){if(await options.assertCurrent?.()===false)throw Error('The selected branch or account changed. Reopen the checklist before downloading.');}
function line(d,label,value=''){
 const row=element(d,'div',undefined,{display:'flex',alignItems:'baseline',gap:'2mm',fontSize:'10pt',lineHeight:'1.5',minWidth:'0'});
 row.appendChild(element(d,'span',label,{fontWeight:'700',whiteSpace:'nowrap'}));row.appendChild(element(d,'span',value,{flex:'1',minWidth:'0',minHeight:'5mm',borderBottom:'0.25mm solid #333',overflowWrap:'anywhere'}));return row;
}
function taskRow(d,fragment){
 const row=element(d,'div',undefined,{display:'grid',gridTemplateColumns:'9mm minmax(0,1fr) 18mm',minHeight:'8mm',borderBottom:'0.2mm solid #777',breakInside:'avoid',pageBreakInside:'avoid',fontSize:'10.5pt',lineHeight:'1.34',color:'#111',background:'#fff'});row.className='sop-checklist-row';
 const number=element(d,'div',String(fragment.taskIndex+1),{padding:'1.7mm 1mm',borderRight:'0.2mm solid #777',fontWeight:'700',fontSize:'9pt'});
 if(fragment.continued)number.appendChild(element(d,'span','cont.',{display:'block',fontWeight:'400',fontSize:'7pt',lineHeight:'1.2'}));
 const text=element(d,'div',undefined,{padding:'1.7mm 2mm',whiteSpace:'pre-wrap',overflowWrap:'break-word',wordBreak:'normal',minWidth:'0'});text.className='sop-checklist-task-text';
 // html2canvas supports break-all for text bounds, whereas overflow-wrap:anywhere
 // can wrap in the browser but become one clipped canvas line. Restrict the
 // stronger rule to long tokens so ordinary words retain natural wrapping.
 const longTokens=[...fragment.text.matchAll(/\S{32,}/gu)];
 if(!longTokens.length)text.textContent=fragment.text;
 else {let start=0;for(const token of longTokens){if(token.index>start)text.appendChild(element(d,'span',fragment.text.slice(start,token.index)));const span=element(d,'span',token[0],{wordBreak:'break-all',overflowWrap:'break-word',whiteSpace:'pre-wrap'});span.className='sop-checklist-long-token';text.appendChild(span);start=token.index+token[0].length;}if(start<fragment.text.length)text.appendChild(element(d,'span',fragment.text.slice(start)));}
 const check=element(d,'div',undefined,{display:'flex',alignItems:'center',justifyContent:'center',borderLeft:'0.2mm solid #777',padding:'1mm'});
 check.appendChild(element(d,'span',undefined,{display:'block',width:'4mm',height:'4mm',border:'0.3mm solid #111',background:'#fff'}));row.appendChild(number);row.appendChild(text);row.appendChild(check);return row;
}
function createPage(d,branch,role,generatedAt){
 const page=element(d,'section',undefined,{display:'flex',flexDirection:'column',width:'180mm',height:'266mm',padding:'0',overflow:'visible',background:'#fff',color:'#111',fontFamily:'Arial, Helvetica, sans-serif',fontSize:'10pt',lineHeight:'1.35',textAlign:'left',breakAfter:'page',pageBreakAfter:'always'});page.className='sop-checklist-page';
 const header=element(d,'header',undefined,{flex:'0 0 auto',paddingBottom:'3mm'});
 header.appendChild(element(d,'h1','TAKODEÁL DAILY SOP CHECKLIST',{fontSize:'16pt',fontWeight:'700',lineHeight:'1.2',textAlign:'center',letterSpacing:'0.15mm',paddingBottom:'2mm'}));
 header.appendChild(element(d,'h2','Tasks for '+role,{fontSize:'12pt',fontWeight:'700',lineHeight:'1.25',textAlign:'center',overflowWrap:'anywhere',paddingBottom:'3mm'}));
 header.appendChild(line(d,'Branch:',branch));
 const details=element(d,'div',undefined,{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1mm 6mm',marginTop:'1mm'});details.appendChild(line(d,'Date:'));details.appendChild(line(d,'Employee:'));details.appendChild(line(d,'Supervisor:'));header.appendChild(details);
 header.appendChild(element(d,'p','Check each task only after completion. Write N/A in the check box when a task does not apply.',{fontSize:'9pt',lineHeight:'1.35',paddingTop:'3mm'}));
 page.appendChild(header);
 const columns=element(d,'div',undefined,{display:'grid',gridTemplateColumns:'9mm minmax(0,1fr) 18mm',border:'0.25mm solid #333',background:'#eee',fontWeight:'700',fontSize:'9pt',lineHeight:'1.2',flex:'0 0 auto'});
 for(const [index,title] of ['No.','Task','Check'].entries())columns.appendChild(element(d,'div',title,{padding:'1.7mm '+(index===1?'2mm':'1mm'),borderLeft:index?'0.2mm solid #777':'none',textAlign:index===2?'center':'left'}));page.appendChild(columns);
 const rows=element(d,'div',undefined,{flex:'1 1 0',minHeight:'0',borderLeft:'0.25mm solid #333',borderRight:'0.25mm solid #333',borderBottom:'0.25mm solid #333'});rows.className='sop-checklist-rows';page.appendChild(rows);
 const footer=element(d,'footer',undefined,{flex:'0 0 auto',paddingTop:'3mm',fontSize:'9pt',lineHeight:'1.3'});
 footer.appendChild(element(d,'div','Remarks / handover',{fontWeight:'700',paddingBottom:'1mm'}));
 for(let index=0;index<2;index++)footer.appendChild(element(d,'div',undefined,{height:'5mm',borderBottom:'0.2mm solid #777'}));
 const signatures=element(d,'div',undefined,{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8mm',paddingTop:'5mm'});
 for(const label of ['Employee signature','Supervisor signature'])signatures.appendChild(element(d,'div',label,{borderTop:'0.25mm solid #333',textAlign:'center',paddingTop:'1mm',fontSize:'8pt'}));footer.appendChild(signatures);
 const folio=element(d,'div',undefined,{display:'flex',justifyContent:'space-between',gap:'3mm',paddingTop:'3mm',fontSize:'8pt',lineHeight:'1.2',minHeight:'6mm'});
 folio.appendChild(element(d,'span',generatedAt?'Exported '+generatedAt:''));const pageNumber=element(d,'span','Page 1 of 1',{whiteSpace:'nowrap'});folio.appendChild(pageNumber);footer.appendChild(folio);page.appendChild(footer);
 return {page,rows,pageNumber};
}
function generatedLabel(value){if(value==null)return '';const date=value?.toDate?.()??new Date(value);if(!Number.isFinite(+date))throw Error('The export date is invalid.');return date.toLocaleString('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});}

export async function buildSopChecklistDocument(w,d,options={}){
 const input=normalizeSopChecklist(options);await assertCurrent(options);
 const root=element(d,'div',undefined,{all:'initial',display:'block',position:'fixed',left:'-20000px',top:'0',width:'180mm',background:'#fff',color:'#111',fontFamily:'Arial, Helvetica, sans-serif',zIndex:'-1',pointerEvents:'none'});root.className='sop-checklist-document';root.setAttribute('aria-hidden','true');
 const pages=[],generatedAt=generatedLabel(options.generatedAt);d.body.appendChild(root);
 const destroy=()=>root.remove();
 try{
  if(d.fonts?.ready)await d.fonts.ready;await assertCurrent(options);
  const measureHost=element(d,'div',undefined,{width:'180mm',fontFamily:'Arial, Helvetica, sans-serif'});root.appendChild(measureHost);
  for(const role of input.roles){
   await assertCurrent(options);const first=createPage(d,input.branch,role.name,generatedAt);root.appendChild(first.page);
   measureHost.style.width=first.rows.clientWidth+'px';
   const capacity=first.rows.getBoundingClientRect().height-1;
   const measure=(text,meta)=>{const row=taskRow(d,{...meta,text});measureHost.appendChild(row);try{return row.getBoundingClientRect().height;}finally{row.remove();}};
   const plans=paginateSopChecklistTasks(role.tasks,{capacity,measure,maxPages:SOP_CHECKLIST_LIMITS.pages-pages.length});
   for(let index=0;index<plans.length;index++){
    const current=index===0?first:createPage(d,input.branch,role.name,generatedAt);if(index)root.appendChild(current.page);
    if(plans[index].length)for(const fragment of plans[index])current.rows.appendChild(taskRow(d,fragment));
    else {const empty=element(d,'p','No saved tasks for this role.',{fontSize:'10pt',padding:'4mm',lineHeight:'1.4'});empty.className='sop-checklist-empty';current.rows.appendChild(empty);}
    pages.push({...current,role:role.name,rolePage:index+1,fragments:plans[index]});
   }
  }
  measureHost.remove();for(let index=0;index<pages.length;index++)pages[index].pageNumber.textContent='Page '+(index+1)+' of '+pages.length;
  await assertCurrent(options);return {element:root,pages,pageCount:pages.length,input,destroy};
 }catch(error){destroy();throw error;}
}

export async function downloadSopChecklistPDF(w,d,options={}){
 await assertCurrent(options);const input=normalizeSopChecklist(options),filename=sopChecklistFilename(input.branch,input.roles,options.filename);
 await ensureManagerLibrary('html2pdf',w,d);await assertCurrent(options);
 let built;
 try{
  built=await buildSopChecklistDocument(w,d,{...options,...input});
  const settings={margin:[15,15,15,15],filename,image:{type:'jpeg',quality:0.96},html2canvas:{scale:1.75,backgroundColor:'#ffffff',useCORS:false,logging:false,scrollX:0,scrollY:0},jsPDF:{unit:'mm',format:'a4',orientation:'portrait',compress:true},pagebreak:{mode:[]}};
  let pdf;
  for(let index=0;index<built.pages.length;index++){
   await assertCurrent(options);const page=built.pages[index].page;
   if(index===0){const worker=w.html2pdf().set(settings).from(page).toPdf();pdf=await worker.get('pdf');if(pdf.internal?.getNumberOfPages?.()!==1)throw Error('A checklist page did not fit A4. Reopen the checklist and try again.');const canvas=await worker.get('canvas');if(canvas){canvas.width=0;canvas.height=0;}}
   else {
    const worker=w.html2pdf().set(settings).from(page).toCanvas(),canvas=await worker.get('canvas');
    try{if(!canvas?.width||!canvas?.height)throw Error('A checklist page could not be rendered.');const image=canvas.toDataURL('image/jpeg',0.96);pdf.addPage('a4','portrait');pdf.addImage(image,'JPEG',15,15,180,canvas.height*180/canvas.width,undefined,'FAST');}
    finally{if(canvas){canvas.width=0;canvas.height=0;}}
   }
   await assertCurrent(options);page.remove();
  }
  const blob=pdf.output('blob');if(!blob||!Number.isFinite(blob.size)||blob.size<=0||blob.size>SOP_CHECKLIST_LIMITS.pdfBytes)throw Error('This PDF is too large for one download. Export fewer roles at a time.');
  await assertCurrent(options);if(options.save!==false)await pdf.save(filename);return blob;
 }finally{built?.destroy();}
}
