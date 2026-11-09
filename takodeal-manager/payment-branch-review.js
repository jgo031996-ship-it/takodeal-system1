import {normalizeStatementRows} from './payment-reconciliation-model.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(value/100);
export function paymentBranchReview(plan,rows,settings){
 const normalized=normalizeStatementRows(rows,settings,{scope:plan.scope||undefined}),byIndex=new Map(normalized.map(row=>[row.index,row])),groups=new Map();
 const group=branch=>{if(!groups.has(branch))groups.set(branch,{branch,matched:0,matchedCents:0,verified:0,review:0,awaitingStatement:0});return groups.get(branch);};
 for(const row of plan.matches||[]){const item=group(row.branch);item.matched++;item.matchedCents+=row.grossCents;}
 for(const row of plan.alreadyVerified||[])group(row.branch).verified++;
 for(const row of plan.unresolved||[]){const source=byIndex.get(row.rowIndex);group(source?.eligible?source.branch:'Branch / source needs review').review++;}
 for(const row of plan.awaitingStatement||[])group(row.branch).awaitingStatement++;
 return [...groups.values()].sort((a,b)=>a.branch.localeCompare(b.branch));
}
export function paymentBranchReviewHTML(plan,rows,settings,{exceptionsOnly=false}={}){
 const summary=paymentBranchReview(plan,rows,settings),missing=plan.awaitingStatement||[];
 return '<section class="reconcile-branch-review" aria-label="Store payment checklist"><h3>Store payment checklist</h3><p>One file can cover several stores. Review the exceptions below; an unmatched receipt may need another export or corrected payment details.</p><div class="reconcile-branch-grid">'+summary.map(row=>'<article><strong>'+esc(row.branch)+'</strong><p>'+row.matched+' matched · '+money(row.matchedCents)+'<br>'+row.verified+' already verified<br><b>'+row.review+' statement rows need review</b><br>'+row.awaitingStatement+' saved receipts still need a match</p></article>').join('')+'</div><label class="reconcile-check"><input type="checkbox" data-reconcile-exceptions'+(exceptionsOnly?' checked':'')+'> Show exceptions first</label>'+(missing.length?'<details'+(exceptionsOnly?' open':'')+'><summary>'+missing.length+' saved receipts still need a statement match</summary><p>Check the correct store export, date range and payment reference. These receipts stay unverified.</p>'+missing.slice(0,100).map(row=>'<p><strong>'+esc(row.branch)+'</strong> · '+esc(row.transactionId)+' · '+esc(row.day)+' · '+money(row.grossCents)+'</p>').join('')+(missing.length>100?'<p>Showing the first 100. Use Pending Verifications for the complete saved receipt list.</p>':'')+'</details>':'')+'<p class="reconcile-note">This tool matches the statement you choose. It has no live bank connection. Bank deposits, provider fees, settlement totals and screenshots alone do not verify individual sales.</p></section>';
}
