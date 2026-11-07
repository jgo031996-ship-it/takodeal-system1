import {AI_BOARD_DIRECTORS,isAIBoardSessionOwner} from './ai-board-model.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const prompts={finance:'Review recorded sales and cash outflows. What needs my attention?',audit:'What reconciliation and data-quality checks should I review?',inventory:'What stock and count-variance issues should I investigate?',hr:'Review attendance processes and staffing evidence gaps.',operations:'Review branch performance and shift-control signals.',marketing:'What can channel sales and discounts tell us, and what evidence is missing?',mentor:'Give me a decision brief on the most important business priorities supported by this evidence.'};
export function renderBoardReport({packet,report,model,requestId}) {
  const list=items=>`<ul>${items.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`;
  const number=e=>e.value===null?'Unavailable':new Intl.NumberFormat('en-PH',{...(e.unit==='PHP'?{style:'currency',currency:'PHP'}:{maximumFractionDigits:2})}).format(e.value);
  return `<header class="board-report-head"><div><span class="board-eyebrow">${esc(packet.branch)} · ${esc(packet.period.start)} — ${esc(packet.period.end)}</span><h3>Your director’s report</h3><p>As of ${esc(new Date(packet.asOf).toLocaleString('en-PH',{timeZone:'Asia/Manila'}))} Philippine time</p></div><span class="board-badge">Confidence: ${esc(report.confidence)}</span></header>
    <p class="board-notice ${packet.partial?'board-warning':''}">${packet.partial?'Partial evidence: some sources were capped or unavailable. Figures are samples and must not be treated as complete totals.':'All requested queries completed within their limits. Coverage is limited to uploaded records with the queried date fields.'}</p>
    <p>${esc(report.summary)}</p><h4>Calculated evidence</h4><div class="board-metrics">${packet.evidence.map(e=>`<article id="board-evidence-${esc(e.id)}"><small>${esc(e.label)}${e.complete?'':' · sample'}</small><strong>${esc(number(e))}</strong><span>${esc(e.id)} · ${esc(e.source)}</span><p>${esc(e.note)}</p></article>`).join('')}</div>
    <h4>Findings</h4>${report.findings.map(f=>`<article class="board-finding"><h4>${esc(f.title)}</h4><p>${esc(f.explanation)}</p><div class="board-evidence-links">${f.evidenceIds.map(id=>`<a href="#board-evidence-${esc(id)}">${esc(id)}</a>`).join(' ')}</div></article>`).join('')}
    <div class="board-report-grid"><section><h4>Assumptions & unknowns</h4>${list(report.assumptions)}</section><section><h4>Counterargument</h4><p>${esc(report.counterargument)}</p></section><section><h4>Options</h4>${list(report.options)}</section><section><h4>Recommendation</h4><p>${esc(report.recommendation)}</p></section></div><h4>Next steps for your review</h4>${list(report.nextSteps)}
    <details open><summary>Source coverage & limitations</summary><div class="board-table-wrap"><table><thead><tr><th>Source</th><th>Records</th><th>Coverage</th><th>Basis</th></tr></thead><tbody>${packet.coverage.map(c=>`<tr><td>${esc(c.source)}</td><td>${c.records??'—'}</td><td>${c.error?'Unavailable':c.complete?'Within cap':'Capped sample'}</td><td>${esc(c.error||c.basis)}</td></tr>`).join('')}</tbody></table></div><p>${esc(packet.dateBasis)}</p>${list(packet.limitations)}</details><footer class="board-report-footer">Advisory only · ${esc(model)} · Reference ${esc(requestId)}<br>No operational records were changed. Reports are not saved after leaving this view.</footer>`;
}
export function installAIBoard(w=window,d=document) {
  const allowed=()=>isAIBoardSessionOwner(w.auth?.currentUser,w.sessionUser);
  if(!allowed()||d.getElementById('nav-ai-board'))return;
  const menu=d.querySelector('.sidebar .nav-menu'),anchor=d.getElementById('view-dashboard');
  if(!menu||!anchor)return;
  const css=d.createElement('link');css.rel='stylesheet';css.href=new URL('./ai-board.css',import.meta.url).href;d.head.append(css);
  const nav=d.createElement('a');nav.id='nav-ai-board';nav.className='nav-item';nav.href='#ai-board';nav.innerHTML='<span class="nav-icon">✦</span><span class="nav-text">AI Board of Directors</span>';menu.append(nav);
  const root=d.createElement('section');root.id='view-ai-board';root.className='view';root.style.display='none';anchor.parentNode.append(root);
  root.innerHTML=`<div class="board-shell"><header class="board-intro"><div><span class="board-eyebrow">TAKODEÁL / OWNER’S ADVISORY BOARD</span><h2>Seven perspectives.<br>One thoughtful decision.</h2><p>Explore the evidence, challenge assumptions, and choose your next move.</p></div><span class="board-badge">Owner only · Read only</span></header>
    <div class="board-directors" role="group" aria-label="Choose a director">${AI_BOARD_DIRECTORS.map((item,i)=>`<button type="button" data-director="${item.id}" aria-pressed="${i===0}"><span>0${i+1}</span><strong>${esc(item.title)}</strong><small>${esc(item.remit)}</small></button>`).join('')}</div>
    <div class="board-workspace"><form id="board-question-form" class="board-form"><span class="board-eyebrow">YOUR CONSULTATION</span><h3 id="board-director-title">Finance Director</h3><label for="board-consultation">Format</label><select id="board-consultation"><option value="ask">Ask a question</option><option value="brief">Decision brief</option><option value="challenge">Challenge my decision</option><option value="scenarios">Compare scenarios</option><option value="board">Board consultation</option></select><div class="board-dates"><div><label for="board-start">First business day</label><input type="date" id="board-start" required></div><div><label for="board-end">Last business day</label><input type="date" id="board-end" required></div></div><label for="board-branch">Branch</label><input id="board-branch" maxlength="100" value="All" placeholder="All or an exact branch name" required><p class="board-help">Use the exact saved branch name, or All. Up to 31 Philippine business days, starting at 08:30.</p><label for="board-question">Question or decision</label><textarea id="board-question" rows="6" maxlength="4000" required></textarea><p class="board-help">Your question and calculated business summaries are sent to OpenAI for analysis. Customer identities, staff photos, PINs and signatures are excluded from source reads. Include only what is needed in your question.</p><button type="submit" id="board-submit">Consult director →</button><p id="board-status" role="status" aria-live="polite">Checking the Board connection…</p></form><section id="board-result" class="board-result" aria-label="Director report"><div class="board-empty"><span>✦</span><h3>Start with a question.</h3><p>Your director will explain the available evidence, identify gaps, and suggest next steps for your review.</p><p>The Board cannot change sales, stock, payroll, schedules or any other business record.</p></div></section></div></div>`;
  const el=id=>d.getElementById(id),submit=el('board-submit'),result=el('board-result'),status=el('board-status');
  let directorId='finance',controller,generation=0,ready=false;
  const today=new Date(Date.now()+8*3600000-8.5*3600000).toISOString().slice(0,10);
  el('board-end').value=today;el('board-start').value=new Date(Date.parse(today+'T12:00:00Z')-6*86400000).toISOString().slice(0,10);
  el('board-question').value=prompts.finance;submit.disabled=true;
  const clear=()=>{generation++;controller?.abort();result.replaceChildren();};
  root.querySelectorAll('[data-director]').forEach(button=>button.addEventListener('click',()=>{
    clear();directorId=button.dataset.director;el('board-director-title').textContent=AI_BOARD_DIRECTORS.find(x=>x.id===directorId).title;
    root.querySelectorAll('[data-director]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    el('board-question').value=prompts[directorId];status.textContent=ready?'Ready for your question.':'The Board is not ready yet.';submit.disabled=!ready;
  }));
  const request=async(method,body,signal)=>{
    if(!allowed())throw Error('Unlock the verified owner account to use the Board.');
    const identity=w.auth.currentUser.uid,token=await w.auth.currentUser.getIdToken();
    const response=await w.fetch('/api/ai-board',{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal});
    const payload=await response.json();
    if(!allowed()||w.auth.currentUser.uid!==identity)throw Error('Your account changed. Open the Board again.');
    if(!response.ok)throw Error(payload.error?.message||'The Board could not complete this request.');
    return payload;
  };
  const connect=async()=>{try{const info=await request('GET');ready=info.configured===true;status.textContent=ready?'Ready. Consultations run only when you request them.':'The Board connection needs setup before consultations are available.';}catch(error){status.textContent=error.message;ready=false;}submit.disabled=!ready;};
  nav.addEventListener('click',event=>{event.preventDefault();w.switchView('ai-board');});
  const previous=w.switchView;
  w.switchView=function(view,...args){
    if(view==='ai-board'&&!allowed())return;
    if(view!=='ai-board'){clear();root.style.display='none';}
    const answer=previous.call(this,view,...args);
    if(view==='ai-board'){root.style.display='block';el('pageTitle').textContent='AI Board of Directors';connect();}
    return answer;
  };
  el('board-question-form').addEventListener('submit',async event=>{
    event.preventDefault();if(submit.disabled)return;
    clear();const current=generation;controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),55000);
    submit.disabled=true;status.textContent='Reading approved sources and preparing your advisory report…';
    try{
      const payload=await request('POST',{directorId,question:el('board-question').value,branch:el('board-branch').value,period:{start:el('board-start').value,end:el('board-end').value},consultation:el('board-consultation').value},controller.signal);
      if(current!==generation)return;result.innerHTML=renderBoardReport(payload);status.textContent=payload.packet.partial?'Report ready with partial evidence. Review source coverage.':'Report ready. Review the evidence before deciding.';
    }catch(error){if(current===generation)status.textContent=error.name==='AbortError'?'The consultation timed out. Retry manually when ready.':error.message;}
    finally{clearTimeout(timeout);if(current===generation)submit.disabled=!ready;}
  });
  w.addEventListener('pagehide',clear);
}
