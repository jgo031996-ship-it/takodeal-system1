import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceLength,installEmployeeProfileSections} from '../takodeal-staff/staff-employee-sections.js';
import {payslipWorkRows} from '../takodeal-staff/staff-payslip-work.js';

test('service uses completed calendar months on the Philippine date and skips unknown hire dates',()=>{
 const now=new Date('2026-11-16T16:15:00Z');
 assert.equal(serviceLength('2024-10-17',now),'2 years, 1 month');
 assert.equal(serviceLength('2026-10-18',now),'Less than a month');
 assert.equal(serviceLength('2026-02-31',now),'');assert.equal(serviceLength('2027-01-01',now),'');
});
test('profile navigation shows one section, keeps edits across tabs, and clears private headings when locked',()=>{
 const names=['personal','employment','contact','pay','documents','security'];
 const buttons=names.map(profileTab=>({dataset:{profileTab},setAttribute(k,v){this[k]=v;},addEventListener(k,fn){this[k]=fn;}}));
 const panels=names.map(profilePanel=>({dataset:{profilePanel}}));
 const nodes=new Map();const d={getElementById(id){if(!nodes.has(id))nodes.set(id,id==='profileModal'?{querySelectorAll:key=>key.includes('tab')?buttons:panels}:{});return nodes.get(id);}};
 const view=installEmployeeProfileSections(d);view.clear();view.show({cashierName:'Example Crew',branch:'Example branch',role:'Crew'});
 buttons[2].click();assert.deepEqual(panels.filter(p=>!p.hidden).map(p=>p.dataset.profilePanel),['contact']);
 d.getElementById('profPhone').value='draft';buttons[4].click();buttons[2].click();assert.equal(d.getElementById('profPhone').value,'draft');
 assert.equal(d.getElementById('staffProfileName').textContent,'Example Crew');view.clear();assert.equal(d.getElementById('staffProfileName').textContent,'');assert.equal(buttons[0]['aria-pressed'],'true');
});
test('frozen overnight rows show actual and scheduled times, saved rate and recorded lateness without substituting today',()=>{
 const html=payslipWorkRows({shiftPairs:[],logs:[{branch:'Test <branch>',timeInAt:'2026-11-13T09:25:00Z',timeOutAt:'2026-11-13T18:03:00Z',expectedStartAt:'2026-11-13T09:30:00Z',expectedEndAt:'2026-11-13T18:00:00Z',hrs:8.63,lateMins:0,dailyRate:450,remark:'<test>'},{}]});
 for(const expected of ['Test &lt;branch&gt;','5:25','2:03','Scheduled','8.63 h','Recorded late: 0 min','450.00','&lt;test&gt;','Not recorded'])assert.ok(html.includes(expected),expected);
 assert.doesNotMatch(html,/<test>/);assert.match(payslipWorkRows({}),/No attendance detail/);
});
