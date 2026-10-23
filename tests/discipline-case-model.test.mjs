import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_DISCIPLINE_POLICY, normalizeDisciplinePolicy, sameCaseStaff, caseHistory} from '../takodeal-manager/discipline-case-model.js';

const staff = {id:'staff-one', cashierName:'Sample Crew', branch:'Sample Branch'};
const at = '2030-01-10T09:00:00+08:00';
const notice = (id, overrides={}) => ({id, staffId:staff.id, staffName:staff.cashierName, branch:staff.branch, caseVersion:2, caseNumber:1, caseKey:staff.id, type:'Attendance', finding:'Pending', status:'Pending Reply', issuedAt:at, ...overrides});
const confirmed = (id, overrides={}) => notice(id, {finding:'Confirmed', status:'Reviewed', reviewedByUid:'reviewer-one', reviewedByEmail:'reviewer@example.test', reviewedAt:at, reviewReason:'Reviewed the incident evidence and staff explanation.', decisionRevision:1, reviewedAction:{id:'written-warning',label:'Written warning',suspensionDays:0,effectiveDate:'2030-01-10',policyRevision:0}, ...overrides});
const policy = overrides => ({version:1, revision:0, levels:[{id:'choice-one',label:'Written warning',suspensionDays:0}], ...overrides});

test('default policy is a fresh choice catalogue with no termination action or label-based suspension inference', () => {
    const original = JSON.stringify(DEFAULT_DISCIPLINE_POLICY), first = normalizeDisciplinePolicy(), second = normalizeDisciplinePolicy(null);
    assert.equal(first.levels.at(-1).label, 'Further HR review');
    assert.deepEqual(first.levels.map(level=>level.suspensionDays), [0,0,1,3,7,14,0]);
    assert.doesNotMatch(first.levels.map(level=>level.label).join(' '), /termination/i);
    first.levels[0].label='Owner future choice'; first.levels.push({id:'new-choice',label:'Additional review',suspensionDays:0});
    assert.equal(JSON.stringify(DEFAULT_DISCIPLINE_POLICY), original);
    assert.equal(second.levels.length, 7);
});

test('a customized reduction uses explicit days and does not change an already saved reviewed action', () => {
    const row=confirmed('case-one',{reviewedAction:{id:'suspension-7',label:'7 days suspension',suspensionDays:7,effectiveDate:'2030-01-20',policyRevision:2}}), before=JSON.stringify(row);
    const result=normalizeDisciplinePolicy(policy({revision:3,levels:[{id:'suspension-7',label:'Reduced to one day',suspensionDays:1},{id:'label-only',label:'14 days suspension — discussion only',suspensionDays:0}]}));
    assert.equal(result.levels[0].id,'suspension-7'); assert.equal(result.levels[0].suspensionDays,1);
    assert.equal(result.levels[1].suspensionDays,0);
    assert.equal(JSON.stringify(row), before);
});

test('policy accepts one through twenty levels and plain Unicode labels at the configured limits', () => {
    const levels=Array.from({length:20},(_,index)=>({id:'level_'+index,label:index?'Review '+index:'é'.repeat(120),suspensionDays:index===19?366:0}));
    assert.equal(normalizeDisciplinePolicy(policy({levels})).levels.length,20);
    assert.equal(normalizeDisciplinePolicy(policy({levels:[{id:'one',label:'  Counsel & review  ',suspensionDays:0}]})).levels[0].label,'Counsel & review');
});

test('malformed policy containers, versions and revisions fail rather than silently replacing saved policy', () => {
    for(const value of [[],{},'default',policy({version:2}),policy({revision:-1}),policy({revision:0.5}),policy({revision:'1'}),policy({levels:[]}),policy({levels:Array.from({length:21},(_,index)=>({id:'l'+index,label:'Review',suspensionDays:0}))})]) assert.throws(()=>normalizeDisciplinePolicy(value));
});

test('policy rejects duplicate or unsafe IDs, HTML, control/bidi text and invalid suspension days', () => {
    for(const level of [
        {id:'invalid/id',label:'Review',suspensionDays:0}, {id:123,label:'Review',suspensionDays:0},
        {id:'x',label:'<img src=x onerror=alert(1)>',suspensionDays:0}, {id:'x',label:'<script>bad</script>',suspensionDays:0},
        {id:'x',label:'Review\nAction',suspensionDays:0}, {id:'x',label:'Review\u202eAction',suspensionDays:0},
        {id:'x',label:' '.repeat(5),suspensionDays:0}, {id:'x',label:'a'.repeat(121),suspensionDays:0},
        {id:'x',label:'Review',suspensionDays:-1}, {id:'x',label:'Review',suspensionDays:367},
        {id:'x',label:'Review',suspensionDays:1.5}, {id:'x',label:'Review',suspensionDays:'3'},
        {id:'x',label:'Review',suspensionDays:NaN}, {id:'x',label:'Review',suspensionDays:Infinity}
    ]) assert.throws(()=>normalizeDisciplinePolicy(policy({levels:[level]})));
    assert.throws(()=>normalizeDisciplinePolicy(policy({levels:[{id:'same',label:'First',suspensionDays:0},{id:'same',label:'Second',suspensionDays:1}]})),/unique/);
});

test('normalization drops unrelated fields without retaining mutable policy references', () => {
    const source=policy({updatedByUid:'reviewer-one',levels:[{id:'choice-one',label:'Review',suspensionDays:0,html:'unsafe'}]}), result=normalizeDisciplinePolicy(source);
    assert.deepEqual(Object.keys(result),['version','revision','levels']); assert.deepEqual(Object.keys(result.levels[0]),['id','label','suspensionDays']);
    result.levels[0].label='Changed'; assert.equal(source.levels[0].label,'Review');
});

test('stable staff IDs follow the same employee across names and branches, while a wrong explicit ID never falls back', () => {
    assert.equal(sameCaseStaff(notice('same',{staffName:'Former display name',branch:'Former branch'}),staff),true);
    assert.equal(sameCaseStaff(notice('wrong',{staffId:'different-staff'}),staff),false);
    assert.equal(sameCaseStaff(notice('blank',{staffId:''}),staff),false);
    assert.equal(sameCaseStaff(notice('number',{staffId:4}),staff),false);
});

test('legacy identity requires an exact name and branch, with an explicit ambiguity hold', () => {
    const legacy={staffName:staff.cashierName,branch:staff.branch};
    assert.equal(sameCaseStaff(legacy,staff),true);
    assert.equal(sameCaseStaff({...legacy,staffName:'sample crew'},staff),false);
    assert.equal(sameCaseStaff({...legacy,staffName:'Sample Cre'},staff),false);
    assert.equal(sameCaseStaff({...legacy,branch:'Other Branch'},staff),false);
    assert.equal(sameCaseStaff({...legacy,branch:''},staff),false);
    assert.equal(sameCaseStaff(legacy,{...staff,legacyNameVerified:false}),false);
    assert.equal(sameCaseStaff(notice('identified'),{...staff,legacyNameVerified:false}),true);
});

test('conflicting profile IDs or profile names do not produce an employee history', () => {
    assert.equal(sameCaseStaff(notice('one'),{...staff,staffId:'another-id'}),false);
    assert.equal(sameCaseStaff(notice('one'),{...staff,name:'Another Crew'}),false);
    assert.throws(()=>caseHistory([],{...staff,staffId:'another-id'}),/exact staff/);
    assert.throws(()=>caseHistory([],{}),/exact staff/);
});

test('overall sequence continues across incident types, withdrawn cases and legacy records without choosing an action', () => {
    const rows=[notice('one',{caseNumber:3,type:'Attendance'}),notice('two',{caseNumber:4,type:'Food safety',status:'Cancelled'}),{id:'legacy',staffName:staff.cashierName,branch:staff.branch,type:'Conduct',severity:'Old warning',status:'Resolved'}];
    const before=JSON.stringify(rows), history=caseHistory(rows,staff);
    assert.equal(history.totalCases,3); assert.equal(history.nextCaseNumber,5); assert.equal(history.cancelledRows.length,1);
    assert.equal(history.confirmedCount,0); assert.equal(history.rows.length,3);
    assert.equal('suggestedAction' in history,false); assert.equal('severity' in history,false);
    assert.equal(JSON.stringify(rows),before);
});

test('legacy records keep finding unknown even if an old severity or status sounds final', () => {
    const history=caseHistory(['Resolved','Replied','Pending Reply','Archived'].map((status,index)=>({id:'legacy-'+index,staffName:staff.cashierName,branch:staff.branch,status,severity:'7th Offense - Termination Notice',finding:'Confirmed',reviewedByUid:'reviewer-one',reviewedAt:at,reviewReason:'Old text'})),staff);
    assert.equal(history.legacyRows.length,4); assert.equal(history.confirmedRows.length,0);
    assert.ok(history.rows.every(row=>row.findingLabel==='Finding not recorded'));
    assert.equal(history.nextCaseNumber,5);
});

test('only canonically confirmed, fully reviewed cases count; pending, missing proof and boolean aliases do not', () => {
    const rows=[confirmed('valid'),confirmed('missing-actor',{reviewedByUid:''}),confirmed('missing-email',{reviewedByEmail:''}),confirmed('missing-date',{reviewedAt:null}),confirmed('missing-reason',{reviewReason:' '}),confirmed('short-reason',{reviewReason:'Review'}),confirmed('missing-revision',{decisionRevision:undefined}),confirmed('zero-revision',{decisionRevision:0}),confirmed('unreviewed',{status:'Replied'}),confirmed('boolean',{finding:undefined,findingConfirmed:true}),notice('pending'),confirmed('not-established',{finding:'Not established',reviewedAction:null})];
    const history=caseHistory(rows,staff);
    assert.deepEqual(history.confirmedRows.map(row=>row.id),['valid']);
    assert.equal(history.pendingRows.length,1);
    assert.equal(history.rows.find(row=>row.id==='pending').findingLabel,'Pending — not a finding');
    assert.equal(history.rows.find(row=>row.id==='not-established').findingLabel,'Not established');
});

test('withdrawn findings stay in case numbering, while an archived confirmed finding remains recorded', () => {
    const history=caseHistory(['Cancelled','Canceled','Deleted','Archived','Reviewed'].map((status,index)=>confirmed('case-'+index,{caseNumber:index+1,status})),staff);
    assert.deepEqual(history.confirmedRows.map(row=>row.status),['Archived','Reviewed']);
    assert.equal(history.cancelledRows.length,3); assert.equal(history.rows.find(row=>row.status==='Archived').archived,true);
    assert.equal(history.nextCaseNumber,6);
});

test('a confirmed case requires a complete immutable action snapshot and canonical case identity', () => {
    const validAction=confirmed('base').reviewedAction;
    for(const patch of [{reviewedAction:null},{reviewedAction:{...validAction,suspensionDays:'3'}},{reviewedAction:{...validAction,label:'<script>bad</script>'}},{reviewedAction:{...validAction,effectiveDate:'2030-02-31'}},{reviewedAction:{...validAction,policyRevision:-1}},{caseKey:'other-profile'},{caseNumber:0},{staffId:undefined}]) assert.equal(caseHistory([confirmed('one',patch)],staff).confirmedCount,0);
    assert.equal(caseHistory([confirmed('valid',{reviewReason:'Reviewed'})],staff).confirmedCount,1);
});

test('related confirmed counts are evidence per exact type and never a cross-type automatic penalty', () => {
    const history=caseHistory([confirmed('a',{type:'Attendance'}),confirmed('b',{type:'Food safety'}),confirmed('c',{type:'Attendance'}),notice('pending',{type:'Attendance'}),confirmed('withdrawn',{type:'Attendance',status:'Cancelled'})],staff);
    assert.equal(history.confirmedCount,3); assert.equal(history.relatedConfirmedCount('Attendance'),2);
    assert.equal(history.relatedConfirmedCount('Food safety'),1); assert.equal(history.relatedConfirmedCount('attendance'),0); assert.equal(history.relatedConfirmedCount(''),0);
    assert.equal(history.rows.some(row=>'recommendedAction' in row),false);
});

test('valid server timestamp shapes are recognized; malformed and rollover review dates never prove a finding', () => {
    const good=[new Date(at),{toMillis:()=>+new Date(at)},{toDate:()=>new Date(at)},{seconds:1894237200,nanoseconds:0},+new Date(at),at];
    for(const reviewedAt of good) assert.equal(caseHistory([confirmed('one',{reviewedAt})],staff).confirmedCount,1);
    for(const reviewedAt of [null,undefined,'Unknown','2030-02-31T09:00:00+08:00','2030-01-10T24:00:00+08:00','2030-01-10',NaN,Infinity,1e20,{toMillis:()=>NaN},{toDate:()=>new Date('bad')},{seconds:1,nanoseconds:1e9},{}]) assert.equal(caseHistory([confirmed('one',{reviewedAt})],staff).confirmedCount,0);
});

test('unknown dates stay visible without fabricated current dates and foreign identities are omitted', () => {
    const history=caseHistory([notice('unknown',{issuedAt:undefined,timestamp:undefined}),notice('later',{issuedAt:'2030-01-12T09:00:00+08:00'}),notice('earlier',{issuedAt:'2030-01-11T09:00:00+08:00'}),notice('foreign',{staffId:'another-person'})],staff);
    assert.deepEqual(history.rows.map(row=>row.id),['earlier','later','unknown']);
    assert.equal(history.rows.at(-1).recordedAtMillis,null); assert.equal(history.totalCases,3);
});

test('overlapping query copies count once and conflicting saved copies fail closed', () => {
    const row=confirmed('same'), history=caseHistory([row,{...row}],staff);
    assert.equal(history.totalCases,1); assert.equal(history.confirmedCount,1); assert.equal(history.nextCaseNumber,2);
    assert.throws(()=>caseHistory([row,{...row,status:'Cancelled'}],staff),/Conflicting copies/);
    assert.throws(()=>caseHistory([row,{...row,reviewedAction:{id:'different',label:'Different',suspensionDays:3}}],staff),/Conflicting copies/);
});

test('sequence uses the larger existing number or historical record count and rejects unsafe overflow', () => {
    assert.equal(caseHistory([],staff).nextCaseNumber,1);
    assert.equal(caseHistory([notice('one',{caseNumber:20}),notice('two',{caseNumber:2})],staff).nextCaseNumber,21);
    assert.equal(caseHistory([notice('one',{caseNumber:'99'}),notice('two',{caseNumber:-4}),notice('three',{caseNumber:1.2})],staff).nextCaseNumber,4);
    assert.throws(()=>caseHistory([notice('overflow',{caseNumber:Number.MAX_SAFE_INTEGER})],staff),/sequence/);
    assert.throws(()=>caseHistory(null,staff),/incomplete/);
});
