import {leaveOnWorkDate} from './worked-leave-review.js';

export async function prepareWorkedDateCheck(api, data, guard) {
    const days = [...new Set((data.logs || []).filter(row => row.attendanceLogId && row.timeOutLogId && row.rateWorkDate)
        .map(row => row.rateWorkDate))];
    if (!days.length) return {days,requestIds:[]};
    const profile = data.profile || {};
    const names = [data.name,profile.cashierName,profile.fullName,profile.nickname,profile.scheduleName,
        profile.scheduleNickname,...(profile.scheduleAliases || [])].filter(Boolean);
    const keys = [['staffId',data.staffId],...[...new Set(names)].map(name => ['staffName',name])];
    const groups = await Promise.all(keys.map(async ([key,value]) => {
        guard();
        const filters = [api.where(key,'==',value),api.where('type','==','Leave')];
        if (api.limit) filters.push(api.limit(501));
        const snapshot = await api.getDocsFromServer(api.query(api.collection(api.db,'staff_requests'),...filters));
        guard();
        if (!snapshot || snapshot.metadata?.fromCache || snapshot.metadata?.hasPendingWrites || snapshot.docs.length > 500)
            throw Error('HQ could not verify the leave records for this payment.');
        return snapshot.docs.filter(doc => {
            const row = doc.data();
            return row.type === 'Leave' && (row.staffId ? row.staffId === data.staffId : names.includes(row.staffName)) &&
                days.some(date => leaveOnWorkDate(row,date) !== false);
        }).map(doc => doc.id);
    }));
    return {days,requestIds:[...new Set(groups.flat())]};
}

// The review transaction reads the payment sentinel and writes its month index.
// Reading that same index inside payment serializes a correction racing Mark Paid.
export async function checkWorkedDatesInPayment(tx,ref,staffId,check,months={}) {
    for (const [month,ids] of Object.entries(months)) {
        const index = await tx.get(ref('settings','schedule_month_'+month.replace('-','_')));
        const current = index.exists() ? index.data().revisionIds || [] : [];
        if (JSON.stringify(current) !== JSON.stringify(ids))
            throw Error('The saved worked shift changed during payment. Refresh the unpaid payroll.');
    }
    if (!check.days.length) return;
    const claims = await tx.get(ref('settings','schedule_leave_staff_'+staffId));
    if (claims.exists() && check.days.some(date => claims.data().dates?.[date]))
        throw Error('Approved leave overlaps a worked date. Refresh payroll and review that shift.');
    for (const id of check.requestIds) {
        const source = await tx.get(ref('staff_requests',id));
        if (source.exists() && source.data().status === 'Approved' &&
            check.days.some(date => leaveOnWorkDate(source.data(),date) === true))
            throw Error('Approved leave overlaps a worked date. Refresh payroll and review that shift.');
    }
}
