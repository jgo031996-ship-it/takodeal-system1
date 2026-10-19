export const SOP_CHECKLIST_LIMITS=Object.freeze({roles:60,tasks:5000,characters:240000,pages:120,pdfBytes:25*1024*1024});

export function normalizeSopChecklist({branch,roles}={}){
 if(typeof branch!=='string'||!branch.trim()||branch.length>180)throw Error('Choose a branch before downloading its checklist.');
 if(!Array.isArray(roles)||!roles.length||roles.length>SOP_CHECKLIST_LIMITS.roles)throw Error('Choose at least one role, or export a smaller group of roles.');
 let count=0,characters=0;
 const clean=roles.map(role=>{
  if(!role||typeof role.name!=='string'||!role.name.trim()||role.name.length>180||!Array.isArray(role.tasks))throw Error('A saved role name and its task list are required.');
  const tasks=role.tasks.map(task=>{
   if(typeof task!=='string'||!task.trim())throw Error('A checklist has an empty or invalid task. Review its saved tasks before downloading.');
   count++;characters+=task.length;return task;
  });
  return {name:role.name,tasks};
 });
 if(count>SOP_CHECKLIST_LIMITS.tasks||characters>SOP_CHECKLIST_LIMITS.characters)throw Error('This checklist is too large for one download. Export fewer roles at a time.');
 return {branch,roles:clean};
}

// Text is retained exactly: fragments concatenate back to the saved task. A row
// that fits on one page moves intact; only a task taller than a whole page splits.
export function paginateSopChecklistTasks(tasks,{capacity,measure,maxPages=SOP_CHECKLIST_LIMITS.pages}={}){
 if(!Array.isArray(tasks)||tasks.some(task=>typeof task!=='string'||!task.trim()))throw Error('Saved checklist tasks are required.');
 if(!Number.isFinite(capacity)||capacity<=0||typeof measure!=='function'||!Number.isSafeInteger(maxPages)||maxPages<1)throw Error('The printable checklist area could not be measured.');
 const pages=[[]];let used=0;
 const height=(text,meta)=>{const value=measure(text,meta);if(!Number.isFinite(value)||value<=0)throw Error('A checklist task could not be measured.');return value;};
 const nextPage=()=>{if(pages.length>=maxPages)throw Error('This checklist has too many pages. Export fewer roles at a time.');pages.push([]);used=0;};
 const add=(text,meta,size)=>{pages.at(-1).push({...meta,text,height:size});used+=size;};
 for(let taskIndex=0;taskIndex<tasks.length;taskIndex++){
  let remaining=tasks[taskIndex],partIndex=0;
  while(remaining.length){
   const meta={taskIndex,partIndex,continued:partIndex>0},whole=height(remaining,meta),room=capacity-used;
   if(whole<=room){add(remaining,meta,whole);break;}
   if(whole<=capacity){nextPage();add(remaining,meta,whole);break;}
   const points=Array.from(remaining);
   if(height(points[0],meta)>room){if(!pages.at(-1).length)throw Error('The checklist layout leaves no room for a task.');nextPage();continue;}
   let low=1,high=points.length,best=1;
   while(low<=high){const mid=Math.floor((low+high)/2);if(height(points.slice(0,mid).join(''),meta)<=room){best=mid;low=mid+1;}else high=mid-1;}
   // Prefer a nearby word boundary without dropping spaces or line breaks.
   let end=best;for(let index=best-1;index>=Math.floor(best*0.65);index--)if(/\s/u.test(points[index])){end=index+1;break;}
   const fragment=points.slice(0,end).join('');add(fragment,meta,height(fragment,meta));remaining=points.slice(end).join('');partIndex++;
   if(remaining)nextPage();
  }
 }
 return pages;
}

export function sopChecklistFilename(branch,roles,requested){
 const base=requested||'TAKODEAL-SOP-'+branch+'-'+(roles.length===1?roles[0].name:'All-roles');
 const clean=String(base).replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/\s+/g,' ').replace(/[. ]+$/g,'').slice(0,175)||'TAKODEAL-SOP';
 return /\.pdf$/i.test(clean)?clean:clean+'.pdf';
}
