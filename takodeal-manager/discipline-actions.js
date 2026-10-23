import {OWNER_EMAIL, canOpenHrTab, createWorkspaceSession} from './workspace-access-model.js';
import {resolveHQAccount, savedPin} from './hq-account-model.js';
import {phDay, futureEffectiveDate} from './sanction-schedule.js';
import {normalizeDisciplinePolicy, caseHistory, sameCaseStaff} from './discipline-case-model.js';

const text = value => typeof value === 'string' ? value.trim() : '';
const ref = (api, table, id) => api.doc(api.db, table, id);
const data = snap => snap?.exists() ? snap.data() : null;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const copy = value => JSON.parse(JSON.stringify(value));
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const stamp = (api, now) => api.serverTimestamp?.() || now.toISOString();
function savedKey(value) {
    if (typeof value !== 'string' || !value || value.includes('/') || ['.','..'].includes(value) || new TextEncoder().encode(value).length > 1500) throw Error('The saved record identity needs review.');
    return value;
}
function key(value, message = 'Open a saved record before continuing.') {
    if (typeof value !== 'string' || !/^[-A-Za-z0-9_]{1,180}$/.test(value)) throw Error(message);
    return value;
}
function changeKey(value) {
    if (typeof value !== 'string' || !/^[-A-Za-z0-9_]{1,128}$/.test(value)) throw Error('Open a new management action.');
    return value;
}
function date(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('Choose a specific effective date.');
    return phDay(value);
}
function expectedPolicy(input, message) {
    if (!Object.hasOwn(input, 'expectedPolicyRevision')) return null;
    if (!integer(input.expectedPolicyRevision)) throw Error(message);
    return input.expectedPolicyRevision;
}
function clock(now) {
    const at = typeof now === 'function' ? now() : now;
    if (!(at instanceof Date) || !Number.isFinite(+at)) throw Error('The current date could not be confirmed.');
    return at;
}
function confirmedDoc(snap) {
    if (!snap || snap.metadata?.fromCache || snap.metadata?.hasPendingWrites) throw Error('The saved record could not be confirmed. Reconnect and refresh.');
    return data(snap);
}
function rows(snap, maximum = 1000) {
    if (!snap || snap.metadata?.fromCache || snap.metadata?.hasPendingWrites || !Array.isArray(snap.docs) || snap.docs.length > maximum) throw Error('The complete saved history could not be confirmed. Reconnect and refresh.');
    return snap.docs.map(doc => {
        if (doc.metadata?.fromCache || doc.metadata?.hasPendingWrites) throw Error('A saved history record is not yet confirmed. Refresh before continuing.');
        return {...doc.data(), id:savedKey(doc.id)};
    });
}
function actor(api, ownerOnly = false) {
    const user = api.auth?.currentUser, session = api.sessionUser, email = text(user?.email).toLowerCase();
    if (!user?.uid || !email || user.emailVerified !== true || !user.providerData?.some(row => row.providerId === 'google.com') || session?.uid !== user.uid || text(session.email).toLowerCase() !== email || session.isFranchisee === true || !canOpenHrTab(session, 'Sanctions')) throw Error('Sign in with your approved Google account and open the discipline workspace.');
    if (ownerOnly && (email !== OWNER_EMAIL || session.isOwner !== true)) throw Error('Only the verified Owner can edit future discipline levels.');
    return {uid:user.uid, email, name:text(session.cashierName || session.fullName) || email,
        key:JSON.stringify([user.uid,email,session.uid,session.email,session.permissions,session.allowedBranches,session.role,session.isOwner,session.isFranchisee])};
}
function guard(api, identity, ownerOnly = false) {
    if (actor(api, ownerOnly).key !== identity.key) throw Error('The signed-in account or permissions changed. Open this record again.');
}
function checkAuthority(api, identity, accounts, grant, branches = [], ownerOnly = false) {
    guard(api, identity, ownerOnly);
    if (!accounts.length || accounts.some(row => text(row.email).toLowerCase() !== identity.email)) throw Error('The saved HQ identity changed. Reopen the discipline workspace.');
    const account = resolveHQAccount(accounts.map(row => ({id:row.id, data:row})));
    if (account.active === false || account.blocked === true || account.archived === true || /blocked|disabled|inactive|revoked|terminated/i.test(text(account.status)) || /^(REVOKED|BLOCKED)$/i.test(savedPin(account))) throw Error('Your saved HQ account is inactive. Ask the Owner to review its access.');
    const saved = createWorkspaceSession(api.auth.currentUser, account);
    if (saved.isFranchisee || !canOpenHrTab(saved, 'Sanctions')) throw Error('Your saved HQ permissions do not allow discipline review.');
    if (ownerOnly && (identity.email !== OWNER_EMAIL || !saved.isOwner)) throw Error('Only the verified Owner can edit future discipline levels.');
    if (identity.email !== OWNER_EMAIL) {
        if (grant?.active !== true || !Array.isArray(grant.permissions) || !grant.permissions.some(value => ['all','payroll','sanctions'].includes(value)) || !Array.isArray(grant.allowedBranches)) throw Error('Your protected sanctions access needs Owner review.');
        for (const branch of branches) if (!saved.allowedBranches.includes('All') && !saved.allowedBranches.includes(branch) || !grant.allowedBranches.includes('All') && !grant.allowedBranches.includes(branch)) throw Error('This case is outside your assigned discipline branches.');
    }
}
async function authority(api, identity, ownerOnly = false) {
    const snap = typeof api.readHQAccountFromServer === 'function' ? await api.readHQAccountFromServer(api.auth.currentUser) : await api.getDocsFromServer(api.query(api.collection(api.db, 'hq_managers'), api.where('email', '==', identity.email)));
    guard(api, identity, ownerOnly);
    const accounts = rows(snap, 10);
    const grant = identity.email === OWNER_EMAIL ? null : confirmedDoc(await api.getDocFromServer(ref(api, 'hq_email_access', identity.email)));
    checkAuthority(api, identity, accounts, grant, [], ownerOnly);
    return {accounts, grant};
}
async function transaction(api, identity, knownAccounts, handler, ownerOnly = false) {
    return api.runTransaction(api.db, async tx => {
        guard(api, identity, ownerOnly);
        const snapshots = await Promise.all(knownAccounts.map(row => tx.get(ref(api, 'hq_managers', row.id))));
        const accounts = snapshots.map((snap, index) => snap.exists() ? {...confirmedDoc(snap), id:knownAccounts[index].id} : null).filter(Boolean);
        const grant = identity.email === OWNER_EMAIL ? null : confirmedDoc(await tx.get(ref(api, 'hq_email_access', identity.email)));
        const authorize = (...branches) => checkAuthority(api, identity, accounts, grant, branches.filter(Boolean), ownerOnly);
        authorize();
        return handler(tx, authorize);
    });
}
function employee(profile, staffId, {name, branch, active = false} = {}) {
    const staffName = text(profile?.cashierName);
    if (!profile || !staffName || !text(profile.branch)) throw Error('The saved staff identity is missing. Review Staff & Security first.');
    if (name && staffName !== name || branch && profile.branch !== branch) throw Error('The staff assignment changed. Select the saved staff profile again.');
    if (active && (profile.active === false || profile.blocked === true || profile.archived === true || /^(resigned|terminated|inactive|disabled|revoked)$/i.test(text(profile.status)) || /^(REVOKED|BLOCKED)$/i.test(String(profile.pin || '')))) throw Error('This staff profile is inactive. Review it before issuing another notice.');
    return {id:staffId, staffId, name:staffName, cashierName:staffName, branch:profile.branch};
}
function counterState(value, staffId) {
    if (value == null) return null;
    if (value.version !== 1 || value.staffId !== staffId || !integer(value.lastCaseNumber) || value.lastCaseNumber < 1 || !integer(value.seededLegacyCount) || value.lastCaseNumber <= value.seededLegacyCount || !text(value.staffName) || !text(value.branch)) throw Error('The saved case sequence needs an Owner review.');
    key(value.lastCaseId);
    return value;
}
async function historySource(api, staff, identity) {
    const [byId, byName, identities] = await Promise.all([
        api.getDocsFromServer(api.query(api.collection(api.db, 'hr_sanctions'), api.where('staffId', '==', staff.id))),
        api.getDocsFromServer(api.query(api.collection(api.db, 'hr_sanctions'), api.where('staffName', '==', staff.name))),
        api.getDocsFromServer(api.query(api.collection(api.db, 'cashiers'), api.where('cashierName', '==', staff.name)))
    ]);
    guard(api, identity);
    const people = rows(identities), matches = people.filter(row => row.branch === staff.branch);
    const legacyNameVerified = matches.length === 1 && matches[0].id === staff.id;
    const all = new Map();
    for (const row of [...rows(byId), ...rows(byName)]) {
        if (all.has(row.id) && stable(all.get(row.id)) !== stable(row)) throw Error('The saved case history changed while loading. Refresh it before continuing.');
        all.set(row.id, row);
    }
    const raw = [...all.values()], exact = {...staff, legacyNameVerified};
    return {raw, legacyNameVerified, ambiguousLegacy:!legacyNameVerified && raw.some(row => row.staffId == null && text(row.staffName) === staff.name && text(row.branch) === staff.branch), history:caseHistory(raw, exact)};
}
export async function readDisciplineContext(api, selectedStaff) {
    if (selectedStaff?.id && selectedStaff?.staffId && selectedStaff.id !== selectedStaff.staffId) throw Error('Choose one exact saved staff identity.');
    const staffId = key(selectedStaff?.id || selectedStaff?.staffId), identity = actor(api), access = await authority(api, identity);
    const profile = confirmedDoc(await api.getDocFromServer(ref(api, 'cashiers', staffId)));
    const staff = employee(profile, staffId);
    if (selectedStaff?.name && text(selectedStaff.name) !== staff.name || selectedStaff?.cashierName && text(selectedStaff.cashierName) !== staff.name || selectedStaff?.staffName && text(selectedStaff.staffName) !== staff.name || selectedStaff?.branch && selectedStaff.branch !== staff.branch) throw Error('The staff assignment changed. Select the saved profile again.');
    checkAuthority(api, identity, access.accounts, access.grant, [staff.branch]);
    const [source, countSnap, policySnap] = await Promise.all([historySource(api, staff, identity), api.getDocFromServer(ref(api, 'settings', 'discipline_case_' + staffId)), api.getDocFromServer(ref(api, 'settings', 'discipline_policy'))]);
    guard(api, identity);
    const counter = counterState(confirmedDoc(countSnap), staffId), policy = normalizeDisciplinePolicy(confirmedDoc(policySnap));
    if (counter && counter.lastCaseNumber < source.history.nextCaseNumber - 1) throw Error('Saved case history is ahead of its sequence. Ask the Owner to review it.');
    if (counter?.lastCaseNumber === Number.MAX_SAFE_INTEGER) throw Error('The case sequence needs an Owner review.');
    return {staff:{...staff, legacyNameVerified:source.legacyNameVerified}, history:source.history, counter, policy,
        nextCaseNumber:counter ? counter.lastCaseNumber + 1 : source.history.nextCaseNumber, legacyNameVerified:source.legacyNameVerified,
        sequenceNeedsReview:!counter && source.ambiguousLegacy};
}
function issueInput(input) {
    const staffId = key(input?.staffId), name = text(input.name || input.staffName), branch = text(input.branch), type = text(input.type), details = text(input.details), effectiveDate = input.effectiveDate == null || input.effectiveDate === '' ? null : date(input.effectiveDate);
    if (input.name && input.staffName && text(input.name) !== text(input.staffName)) throw Error('Choose one exact staff identity.');
    if (!name || name.length > 200 || !branch || branch.length > 120 || !type || type.length > 200 || details.length < 8 || details.length > 10000) throw Error('Complete the saved staff profile, incident type and specific incident details.');
    if (input.amount != null && Number(input.amount) !== 0 || input.deductionId) throw Error('A new case cannot automatically create a payroll deduction. Review monetary adjustments separately.');
    const evidencePhoto = input.evidencePhoto || '';
    if (typeof evidencePhoto !== 'string' || evidencePhoto.length > 600000) throw Error('Choose a smaller evidence image before issuing the notice.');
    const proposedLevelId = input.proposedLevelId == null || input.proposedLevelId === '' ? null : key(input.proposedLevelId);
    const expectedPolicyRevision = expectedPolicy(input, 'Reload the current discipline policy before choosing an action.');
    return {staffId, name, branch, type, details, effectiveDate, evidencePhoto, proposedLevelId, expectedPolicyRevision};
}
export async function issueDisciplineCase(api, input, {id, now = () => new Date()} = {}) {
    key(id); const checked = issueInput(input), identity = actor(api), at = clock(now), access = await authority(api, identity);
    const profile = confirmedDoc(await api.getDocFromServer(ref(api, 'cashiers', checked.staffId))), person = employee(profile, checked.staffId, {...checked, active:true});
    checkAuthority(api, identity, access.accounts, access.grant, [person.branch]);
    const beforeCounter = counterState(confirmedDoc(await api.getDocFromServer(ref(api, 'settings', 'discipline_case_' + checked.staffId))), checked.staffId);
    const source = beforeCounter ? null : await historySource(api, person, identity);
    if (source?.ambiguousLegacy) throw Error('Legacy notices share this staff name and branch. Ask the Owner to confirm their saved identities before starting the case sequence.');
    const intent = JSON.stringify([2,checked.staffId,checked.name,checked.branch,checked.type,checked.details,checked.effectiveDate,checked.evidencePhoto,checked.proposedLevelId,checked.expectedPolicyRevision]);
    return transaction(api, identity, access.accounts, async (tx, authorize) => {
        const target = ref(api, 'hr_sanctions', id), counterRef = ref(api, 'settings', 'discipline_case_' + checked.staffId);
        const [oldSnap, counterSnap, staffSnap, policySnap] = await Promise.all([tx.get(target), tx.get(counterRef), tx.get(ref(api, 'cashiers', checked.staffId)), tx.get(ref(api, 'settings', 'discipline_policy'))]);
        const current = employee(confirmedDoc(staffSnap), checked.staffId, {...checked, active:true}); authorize(current.branch);
        const counter = counterState(confirmedDoc(counterSnap), checked.staffId), old = confirmedDoc(oldSnap);
        if (old) {
            versionedCase(old);
            if (old.caseVersion !== 2 || old.caseKey !== checked.staffId || old.staffId !== checked.staffId || old.issueIntent !== intent || old.issuedByUid !== identity.uid || !counter || counter.lastCaseNumber < old.caseNumber) throw Error('This notice reference already belongs to different details. Open a new notice.');
            return {id, caseNumber:old.caseNumber, effectiveDate:old.effectiveDate, alreadySaved:true};
        }
        let seed = null;
        if (!counter) {
            if (!source) throw Error('The saved case sequence changed. Refresh the staff history.');
            const seedRows = await Promise.all(source.history.rows.map(row => tx.get(ref(api, 'hr_sanctions', row.id))));
            const fresh = seedRows.map((snap, index) => {const row = confirmedDoc(snap); if (!row) throw Error('A saved legacy case changed. Refresh before issuing the notice.'); return {...row, id:source.history.rows[index].id};});
            seed = caseHistory(fresh, {...current, legacyNameVerified:source.legacyNameVerified});
            if (seed.totalCases !== source.history.totalCases || seed.nextCaseNumber !== source.history.nextCaseNumber) throw Error('The saved case history changed. Refresh before issuing the notice.');
        }
        const policy = normalizeDisciplinePolicy(confirmedDoc(policySnap));
        if (checked.expectedPolicyRevision !== null && policy.revision !== checked.expectedPolicyRevision) throw Error('The discipline policy changed after you opened this notice. Reload the staff history and review the proposed level before issuing.');
        const proposed = checked.proposedLevelId == null ? null : policy.levels.find(level => level.id === checked.proposedLevelId);
        if (checked.proposedLevelId != null && !proposed) throw Error('The proposed level changed. Reload the current discipline policy.');
        const caseNumber = counter ? counter.lastCaseNumber + 1 : seed.nextCaseNumber;
        if (!Number.isSafeInteger(caseNumber) || caseNumber < 1) throw Error('The case sequence needs an Owner review.');
        const effectiveDate = futureEffectiveDate(checked.effectiveDate || phDay(at), at), recordedAt = stamp(api, at);
        authorize(current.branch);
        const notice = {staffId:checked.staffId, staffName:checked.name, branch:checked.branch, type:checked.type, details:checked.details, evidencePhoto:checked.evidencePhoto,
            caseVersion:2, caseKey:checked.staffId, caseNumber, finding:'Pending', severity:'Pending management review', proposedSeverity:proposed ? copy(proposed) : null,
            policyRevisionAtIssue:policy.revision, decisionRevision:0, issueIntent:intent, status:'Pending Reply', issuedBy:identity.name, issuedByUid:identity.uid, issuedByEmail:identity.email,
            timestamp:recordedAt, issuedAt:recordedAt, effectiveDate, scheduleRevision:1,
            scheduleAudit:{issued:{oldDate:null,newDate:effectiveDate,reason:'Notice issued',actorUid:identity.uid,actorEmail:identity.email,at:recordedAt}}};
        if (new TextEncoder().encode(JSON.stringify(notice)).length > 750000) throw Error('This notice and its evidence are too large. Choose a smaller evidence image.');
        tx.set(target, notice);
        tx.set(counterRef, {version:1,staffId:checked.staffId,staffName:checked.name,branch:checked.branch,lastCaseNumber:caseNumber,lastCaseId:id,
            seededLegacyCount:counter?.seededLegacyCount ?? seed.totalCases,updatedAt:recordedAt,updatedByUid:identity.uid,updatedByEmail:identity.email});
        return {id, caseNumber, effectiveDate, alreadySaved:false};
    });
}
export async function saveDisciplinePolicy(api, input, {changeId, now = () => new Date()} = {}) {
    changeKey(changeId);
    if (!integer(input?.expectedRevision)) throw Error('Reload the current discipline policy before saving.');
    const proposed = normalizeDisciplinePolicy({version:1, revision:input.expectedRevision, levels:input.levels}), identity = actor(api, true), access = await authority(api, identity, true), at = clock(now);
    const intent = JSON.stringify([1,input.expectedRevision,proposed.levels]);
    return transaction(api, identity, access.accounts, async (tx, authorize) => {
        const target = ref(api, 'settings', 'discipline_policy'), snap = await tx.get(target), old = confirmedDoc(snap); authorize();
        if (old?.changeId === changeId) {
            if (old.intent !== intent || old.updatedByUid !== identity.uid) throw Error('This policy change reference is already used for different details.');
            return {alreadySaved:true, policy:normalizeDisciplinePolicy(old)};
        }
        const policy = normalizeDisciplinePolicy(old);
        if (policy.revision !== input.expectedRevision) throw Error('The discipline policy changed. Reload it before saving.');
        const revision = policy.revision + 1;
        if (!Number.isSafeInteger(revision)) throw Error('The policy revision needs an Owner review.');
        const saved = {version:1, revision, levels:proposed.levels, changeId, intent, updatedAt:stamp(api, at), updatedByUid:identity.uid, updatedByEmail:identity.email};
        tx.set(target, saved);
        return {alreadySaved:false, policy:normalizeDisciplinePolicy(saved)};
    }, true);
}
function reviewInput(input) {
    if (!['Confirmed','Not established'].includes(input?.outcome) || !integer(input.expectedRevision)) throw Error('Choose a finding and reload the current case review.');
    const reason = text(input.reason), effectiveDate = date(input.effectiveDate);
    if (reason.length < 8 || reason.length > 1500) throw Error('Explain the management finding in 8 to 1500 characters.');
    const levelId = input.levelId == null || input.levelId === '' ? null : key(input.levelId);
    if (input.outcome === 'Confirmed' && !levelId || input.outcome === 'Not established' && levelId != null && levelId !== 'none') throw Error('Choose the reviewed action for the finding. A finding not established has no disciplinary action.');
    const relatedCaseIds = input.relatedCaseIds == null ? [] : input.relatedCaseIds;
    if (!Array.isArray(relatedCaseIds) || relatedCaseIds.length > 5) throw Error('Link up to five confirmed related cases.');
    const ids = relatedCaseIds.map(value => key(value)).sort();
    if (new Set(ids).size !== ids.length) throw Error('Link each related case only once.');
    const expectedPolicyRevision = expectedPolicy(input, 'Reopen this case and review the current discipline policy.');
    return {outcome:input.outcome, levelId, effectiveDate, reason, expectedRevision:input.expectedRevision, relatedCaseIds:ids, expectedPolicyRevision};
}
function versionedCase(row) {
    if (row?.caseVersion !== 2 || !text(row.staffId) || row.caseKey !== row.staffId || !Number.isSafeInteger(row.caseNumber) || row.caseNumber < 1 || !integer(row.decisionRevision) || !text(row.staffName) || !text(row.branch)) throw Error('This legacy or incomplete notice has no recorded case finding. It cannot be confirmed through this review.');
    key(row.staffId);
}
export async function reviewDisciplineCase(api, id, input, {changeId, now = () => new Date()} = {}) {
    key(id); changeKey(changeId); const checked = reviewInput(input), identity = actor(api), access = await authority(api, identity), at = clock(now);
    if (checked.relatedCaseIds.includes(id)) throw Error('A case cannot link itself as a prior finding.');
    const intent = JSON.stringify([2,id,checked.outcome,checked.levelId,checked.effectiveDate,checked.reason,checked.expectedRevision,checked.relatedCaseIds,checked.expectedPolicyRevision]);
    return transaction(api, identity, access.accounts, async (tx, authorize) => {
        const target = ref(api, 'hr_sanctions', id), row = confirmedDoc(await tx.get(target));
        if (!row) throw Error('This case no longer exists.'); versionedCase(row);
        const [staffSnap, policySnap, ...relatedSnaps] = await Promise.all([tx.get(ref(api, 'cashiers', row.staffId)), tx.get(ref(api, 'settings', 'discipline_policy')), ...checked.relatedCaseIds.map(value => tx.get(ref(api, 'hr_sanctions', value)))]);
        const person = employee(confirmedDoc(staffSnap), row.staffId); authorize(row.branch, person.branch);
        if (row.reviewChangeId === changeId) {
            if (row.reviewIntent !== intent || row.reviewedByUid !== identity.uid) throw Error('This case review reference was already used for different details.');
            return {id,alreadySaved:true,status:row.status,finding:row.finding,decisionRevision:row.decisionRevision,reviewedAction:copy(row.reviewedAction)};
        }
        if (row.status !== 'Replied' || row.finding !== 'Pending' || row.decisionRevision !== checked.expectedRevision || row.reviewedAt || row.reviewChangeId) throw Error('Only a replied, pending case at the current review revision can receive a finding. Refresh the case.');
        if (text(row.staffReply).length < 15 || !text(row.signatureBase64) || row.replyByStaffId !== row.staffId || row.repliedAt == null) throw Error('The saved staff explanation and signature need verification before a finding is recorded.');
        const related = relatedSnaps.map((snap, index) => {const saved = confirmedDoc(snap); if (!saved) throw Error('A linked confirmed case is missing.'); return {...saved,id:checked.relatedCaseIds[index]};});
        const history = caseHistory(related, person);
        if (history.confirmedRows.length !== related.length || related.some(saved => saved.staffId !== row.staffId || !sameCaseStaff(saved, person))) throw Error('Each related case must be a saved confirmed finding for this exact staff ID.');
        for (const saved of related) authorize(saved.branch);
        const policy = normalizeDisciplinePolicy(confirmedDoc(policySnap));
        if (checked.expectedPolicyRevision !== null && policy.revision !== checked.expectedPolicyRevision) throw Error('The discipline policy changed after you opened this case. Reopen the case and review the current action before saving a finding.');
        const chosen = checked.outcome === 'Not established' ? {id:'none',label:'No disciplinary action',suspensionDays:0} : policy.levels.find(level => level.id === checked.levelId);
        if (!chosen) throw Error('The selected discipline level changed. Reload the current policy.');
        const effectiveDate = futureEffectiveDate(checked.effectiveDate, at), decisionRevision = row.decisionRevision + 1;
        const reviewedAction = {...copy(chosen), effectiveDate, policyRevision:policy.revision};
        authorize(row.branch, person.branch);
        tx.update(target, {status:'Reviewed',finding:checked.outcome,reviewedAction,reviewReason:checked.reason,reviewedByUid:identity.uid,reviewedByEmail:identity.email,reviewedAt:stamp(api, at),
            decisionRevision,reviewChangeId:changeId,reviewIntent:intent,relatedCaseIds:checked.relatedCaseIds});
        return {id,alreadySaved:false,status:'Reviewed',finding:checked.outcome,decisionRevision,reviewedAction};
    });
}
export async function cancelDisciplineCase(api, id, input, {changeId, now = () => new Date()} = {}) {
    key(id); changeKey(changeId);
    if (!integer(input?.expectedRevision)) throw Error('Reload the current case before closing it.');
    const reason = text(input.reason) || 'Withdrawn by management.';
    if (reason.length < 8 || reason.length > 1500) throw Error('Explain the cancellation in 8 to 1500 characters.');
    const identity = actor(api), access = await authority(api, identity), at = clock(now), intent = JSON.stringify([2,id,input.expectedRevision,reason]);
    return transaction(api, identity, access.accounts, async (tx, authorize) => {
        const target = ref(api, 'hr_sanctions', id), row = confirmedDoc(await tx.get(target));
        if (!row) throw Error('This case no longer exists.'); versionedCase(row);
        const person = employee(confirmedDoc(await tx.get(ref(api, 'cashiers', row.staffId))), row.staffId); authorize(row.branch, person.branch);
        if (row.cancelChangeId === changeId) {
            if (row.cancelIntent !== intent || row.cancelledByUid !== identity.uid) throw Error('This cancellation reference already belongs to different details.');
            return {id,alreadySaved:true,status:row.status,decisionRevision:row.decisionRevision};
        }
        if (!['Pending Reply','Replied','Reviewed'].includes(row.status) || row.decisionRevision !== input.expectedRevision) throw Error('This case changed or is already closed. Refresh before continuing.');
        const status = row.status === 'Reviewed' ? 'Archived' : 'Cancelled', decisionRevision = row.decisionRevision + 1;
        tx.update(target, {status,decisionRevision,cancelChangeId:changeId,cancelIntent:intent,cancelReason:reason,cancelledAt:stamp(api, at),cancelledByUid:identity.uid,cancelledByEmail:identity.email});
        return {id,alreadySaved:false,status,decisionRevision};
    });
}
