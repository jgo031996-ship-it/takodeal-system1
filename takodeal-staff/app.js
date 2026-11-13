import {installLiveBranchDirectory} from './live-branch-directory.js';
import {installPayrollVaultFreshness} from './payroll-vault-freshness.js';
import {payrollRecoveryFromReview} from './payroll-recovery-model.js';
import {timeOutRequestLabel,timeOutRequestDetailsHTML} from './time-out-request-display.js';
import {createAttendanceMetadataReader} from './attendance-metadata-reader.js';
import {createStaffPayrollAttendanceReader} from './staff-payroll-reader.js';
import {getAuth,signInAnonymously,setPersistence,browserLocalPersistence,onAuthStateChanged,updateCurrentUser} from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js';
import {installStaffOnboarding} from './onboarding-ui.js';
import {onboardingDay} from './onboarding-model.js';
import {contractOfferFingerprint,reviewedContractRate,signOfferedContract} from './onboarding-service.js';
import {readStaffOwnerDeductionEstimate} from './staff-owner-deductions.js';
import {isOwnerDeduction} from './owner-deduction-model.js';
import {installDeductionInbox,acknowledgeCashShortagePayslip} from './deduction-inbox.js';
import {installStaffLeaveUI} from './staff-leave-ui.js';
import {leaveToday} from './leave-model.js';
window.getStaffLeaveUI=()=>window.staffLeaveUI||installStaffLeaveUI(window,document);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>window.getStaffLeaveUI(),{once:true});else queueMicrotask(()=>window.getStaffLeaveUI());
import {onlineRefundReviewHTML} from './online-refund-pay.js';
import {payslipDeductionBreakdown,payslipDeductionSummaryHTML,payslipDeductionDetailsHTML,snapshotPayrollDeductionRows} from './payroll-deduction-details.js';
import {payslipSavedAmounts,savedPayslipCents} from './staff-payslip-snapshot.js';
import {readStaffSavedPayslips,installStaffSavedPayslipViews} from './staff-saved-payslips.js';
import {createStaffPrivateProfileClient} from './staff-private-profile-client.js';
import {installStaffPrivateProfileUI} from './staff-private-profile-ui.js';
import {createStaffAccessClient} from './staff-access.js';
import {createStaffVaultRecoveryForPhone} from './staff-vault-recovery.js';
import {installStaffVaultRecovery} from './staff-vault-recovery-ui.js';
import {createStaffLoanLedgerClient} from './staff-loan-ledger-client.js';
import {installStaffLoanLedger} from './staff-loan-ledger-ui.js';
import {isPayrollAdjustment,payrollAdjustmentDetailsHTML,payrollAdjustmentHistoryHTML} from './payroll-adjustment-model.js';
import {readStaffPayrollAdjustments,staffPayrollAdjustmentEstimate} from './staff-payroll-adjustments.js';
import {readStaffPayrollRecoveryHistory} from './payroll-adjustment-history.js';
import { installStaffLocation } from './staff-location.js';
import { installAttendanceCamera } from './attendance-camera.js';
import { installAttendanceProofUploader } from './attendance-proof.js';
import {createClockUploadAccess} from './clock-upload-access.js';
import {readStaffRecords, latestAttendance, attendanceMillis, attendanceKind, sopCoversShift, closeAttendanceShift} from './attendance-reconcile.js';
import {prepareEarlyTimeOut} from './early-time-out-ui.js';
import {planPayrollAttendance} from './payroll-attendance.js';
import {loadStaffPayrollShiftConfirmations} from './payroll-confirmed-shifts.js';
import { installStaffRegistration } from './staff-registration.js';
import { installStaffPhone } from './staff-phone.js';
import { installStaffPortal } from './staff-portal.js';
import {installStaffDocuments} from './staff-documents.js';
import {createStaffDocumentFirebase,readInitializedStaffDocumentClient} from './staff-document-firebase.js';
import {createStaffSelfRepairSDK} from './staff-self-repair-sdk.js';
import {profileDailyRate} from './staff-rate-privacy.js';
import {loadStaffSalaryTimeline,staffRateForDate,staffProfileForWork,staffRateWorkDate} from './staff-rate-model.js';
import { calculateLateMinutes, resolveScheduledShift, resolveAttendanceShift, captureAttendanceSchedule, latePay, earnedNightBonus, calculateShiftEarnings, attendanceLateMinutes, isMealDeduction } from './payroll-safety.js';
import {phDay, pendingDueNotices, clockInRestriction, startPhilippineDayTimer, noticeIsDue, deductionIsDue, isPenaltyDeduction, acknowledgeSanction, sanctionReviewSummary} from './sanction-schedule.js';
import {createScheduleHistoryStore, scheduleDateKey, monthKey, resolveScheduleForDate} from './schedule-history.js';
import {createPayrollBonusHistoryStore} from './payroll-bonus-templates.js';
import {loadScheduleMonthView} from './schedule-sync.js';
import {renderAttendanceSchedulePreview,assertAttendanceScheduleUnchanged,staffScheduleDay,renderStaffScheduleConflict,emergencyReliefForClockIn,emergencyReliefTimeOutNotice} from './attendance-schedule-preview.js';
import {installScheduleViewSync} from './schedule-view-sync.js';
import {swapCandidates,SWAP_PENDING_STATUS,SWAP_REVIEW_STATUS,SWAP_REQUEST_VERSION} from './schedule-swap-model.js';
import {activeStaffProfile} from './staff-lifecycle-model.js';
import {loadStaffSwapContext,staffSwapAliases,swapCandidateKey,staffSwapContextKey,incomingSwapDetailsHTML,swapEscape} from './staff-swap-request.js';
import {savedShiftChoices,savedShiftChoicesHTML,selectedSavedShiftChoice,makeSavedShiftProposal} from './saved-shift-proposal.js';
import {chooseClockInSchedule} from './attendance-shift-declaration-ui.js';
import {revalidateClockInScheduleDeclaration,clockInDeclarationSavedProposal,clockInDeclarationRequest} from './attendance-shift-declaration.js';
// Takodeál Staff Engine v3.0 - Fleet Access & Offline Sync Fix
import { initializeApp,getApps } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
// 🔥 UPGRADE: Imported the Offline Cache Engines!
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, getDocs, getDocsFromServer, getDoc, getDocFromServer, query, where, doc, updateDoc, addDoc, setDoc, deleteDoc, serverTimestamp, orderBy, limit, onSnapshot, enableNetwork, disableNetwork, writeBatch, runTransaction,waitForPendingWrites } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";
  
const firebaseConfig = {
    apiKey: "AIzaSyAmAWBbW7tTnIQkm2kTcJ-MLrjKHNGKcp4",
    authDomain: "takodeal-pos.firebaseapp.com",
    projectId: "takodeal-pos",
    storageBucket: "takodeal-pos.firebasestorage.app",
    messagingSenderId: "248826111383",
    appId: "1:248826111383:web:48bf1e2c172298079bd0d2"
};

const app = initializeApp(firebaseConfig);
const staffPrimaryAuth = getAuth(app);
window.readStaffMetadata = createAttendanceMetadataReader({projectId:firebaseConfig.projectId,apiKey:firebaseConfig.apiKey,auth:staffPrimaryAuth,fetch:window.fetch?.bind(window)});
window.readStaffPayrollAttendance = createStaffPayrollAttendanceReader({projectId:firebaseConfig.projectId,apiKey:firebaseConfig.apiKey,auth:staffPrimaryAuth,fetch:window.fetch?.bind(window)});

// 🔥 UPGRADE: This activates the "Indestructible Offline Mode" on the Staff App!
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()}),
  experimentalForceLongPolling: true, experimentalAutoDetectLongPolling: false
});
const storage = getStorage(app);

window.db = db;
window.storage = storage;

// 🔥 THE FIREBASE BRIDGE FIX 🔥
window.query = query;
window.where = where;
window.collection = collection;
window.getDocs = getDocs;
window.getDocsFromServer = getDocsFromServer;
window.getDoc = getDoc;
window.getDocFromServer = getDocFromServer;
window.runTransaction = runTransaction;
window.addDoc = addDoc;
window.updateDoc = updateDoc;
window.deleteDoc = deleteDoc;
window.doc = doc;
window.setDoc = setDoc;
window.serverTimestamp = serverTimestamp;
window.orderBy = orderBy;
window.limit = limit;
window.onSnapshot = onSnapshot;
window.enableNetwork = enableNetwork;
window.disableNetwork = disableNetwork;

// One live subscription per signed-in staff identity. Invalidate queued callbacks
// before detaching so a previous account cannot update the next account's screen.
window.staffLiveListenerEpoch = 0;
window.stopStaffLiveListeners = function() {
    window.staffLiveListenerEpoch++;
    window.staffSwapRequestGeneration=(window.staffSwapRequestGeneration||0)+1;
    window.pendingSwapData=null;
    for (const kind of ['Inbox', 'Swap', 'Sanction']) {
        const stop = window['staff' + kind + 'Unsubscribe'];
        window['staff' + kind + 'Unsubscribe'] = null;
        window['staff' + kind + 'ListenerKey'] = null;
        if (stop) { try { stop(); } catch (error) { console.error('Staff listener cleanup:', error); } }
    }
    if (window.staffSanctionPadTimer) clearTimeout(window.staffSanctionPadTimer);
    window.staffSanctionPadTimer = null;
    window.staffSanctionDayStop?.(); window.staffSanctionDayStop = null;
    window.staffSanctionCachedSnapshot = null;
    window.lastUnreadCount = undefined;
    for (const id of ['navReqBadge', 'navSchedBadge', 'incomingSwapsContainer', 'staffAppSanctionModal','swapRequestModal']) {
        const element = document.getElementById(id);
        if (element) element.style.display = 'none';
    }
    const active = document.getElementById('activeSanctionId');
    if (active) active.value = '';
};
window.addEventListener('pagehide', () => window.stopStaffLiveListeners());
window.addEventListener('pageshow', event => {
    if (!event.persisted || !localStorage.getItem('takodeal_staff_id')) return;
    window.startStaffDeviceSetup?.();
});
// =======================================================
// 🧠 TAKODEAL GLOBAL CACHE ENGINE (COST SAVER)
// =======================================================
window.TK_CACHE = {
    announcements: null,
    lastAnnouncements: 0,
    schedule: null,
    lastSchedule: 0,
    ttl: 15 * 60 * 1000 // 15 Minute Memory! Unbelievably efficient!
};

window.fetchCachedAnnouncements = async function() {
    let now = Date.now();
    if (window.TK_CACHE.announcements && (now - window.TK_CACHE.lastAnnouncements < window.TK_CACHE.ttl)) {
        console.log(`📦 Loaded ANNOUNCEMENTS from RAM (0 Firebase Reads)`);
        return window.TK_CACHE.announcements;
    }
    console.log(`☁️ Fetching ANNOUNCEMENTS from Firebase...`);
    const q = window.query(window.collection(window.db, "announcements"), window.where("active", "==", true));
    const snap = await window.getDocs(q);
    let data = [];
    snap.forEach(doc => data.push({id: doc.id, ...doc.data()}));
    
    window.TK_CACHE.announcements = data;
    window.TK_CACHE.lastAnnouncements = now;
    return data;
};

window.fetchCachedSchedule = async function() {
    let now = Date.now();
    if (window.TK_CACHE.schedule && (now - window.TK_CACHE.lastSchedule < window.TK_CACHE.ttl)) {
        console.log(`📦 Loaded SCHEDULE from RAM (0 Firebase Reads)`);
        return window.TK_CACHE.schedule;
    }
    console.log(`☁️ Fetching SCHEDULE from Firebase...`);
    const schedSnap = await window.getDoc(window.doc(window.db, "settings", "global_schedule"));
    
    window.TK_CACHE.schedule = schedSnap;
    window.TK_CACHE.lastSchedule = now;
    return schedSnap;
};
console.log("🚀 Takodeál Staff Portal Booted (v3.0 - Fleet Engine Active)");

// ==========================================
// 🕒 UNIVERSAL SHIFT MATCHER (LATE DETECTOR)
// ==========================================
window.calculateLateMinutes = calculateLateMinutes;

window.BRANCH_ZONES = {
    "Cabantian": { lat: 7.130415, lng: 125.617306 },
    "Citygate":  { lat: 7.111076, lng: 125.612883 },
    "Maa":       { lat: 7.0786417726231425, lng: 125.58344120162646 },
    "Main Office": { lat: 7.153756, lng: 125.595667 }
};
window.ALLOWED_RADIUS_METERS = 50;

// ==========================================
// 🔒 DEVICE FLEET & SECURITY ENGINE
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    localStorage.removeItem('takodeal_device_trusted');
    window.startStaffDeviceSetup?.();
});

// ==========================================
// 🔒 DEVICE FLEET & SECURITY ENGINE
// ==========================================
// Device registration and cloud-confirmed approval are installed below.
window.getClosestBranch = function() {
    if (!window.currentLat || !window.currentLng) return null;
    let closestBranch = "Main Office";
    let minDistance = 999999;
    for (let branch in window.BRANCH_ZONES) {
        let zone = window.BRANCH_ZONES[branch];
        let dist = window.getDistanceInMeters(window.currentLat, window.currentLng, zone.lat, zone.lng);
        if (dist < minDistance) { minDistance = dist; closestBranch = branch; }
    }
    return closestBranch;
};

window.checkNormalLogin = function() {
    if(window.staffSelfRepair?.requiresCode()){window.startStaffDeviceSetup?.();return false;}
    if(!window.staffSetupAccess?.isVerified()){window.startStaffDeviceSetup?.();return false;}
    let savedName = localStorage.getItem('takodeal_staff_name');
    let savedId = localStorage.getItem('takodeal_staff_id');
    const setupBinding=window.staffSetupAccess.binding();
    if(setupBinding && savedId!==setupBinding.staffId){
        window.stopStaffLiveListeners();window.lockPayslipVault?.();
        for(const key of ['takodeal_staff_name','takodeal_staff_id','takodeal_staff_pic'])localStorage.removeItem(key);
        savedName=null;savedId=null;
    }
    if(savedId){window.staffSetupAccess.assertStaff(savedId);if(setupBinding){savedName=setupBinding.staffName;localStorage.setItem('takodeal_staff_name',savedName);}}
    
    // 🚀 AUTO-LOGIN ENGINE
    if (savedName && savedId) {
        document.getElementById('loggedInName').innerText = savedName;
        let pic = localStorage.getItem('takodeal_staff_pic');
        if (pic && pic.length > 5) {
            document.getElementById('topAvatar').innerText = '';
            document.getElementById('topAvatar').style.backgroundImage = `url('${pic}')`;
        }
        
        document.getElementById('loginOverlay').style.display = 'none';
        document.getElementById('appContainer').style.display = 'flex';
        
        if(!window.clockStarted) { window.startLiveClock(); window.clockStarted = true; }
        window.loadAnnouncements();
        window.startInboxListener();
        window.checkContractLifecycle(savedId);
        window.listenToIncomingSwaps();
        
        // 🚨 THE GATEKEEPER: Instantly block access if they have a pending NTE!
        window.startSanctionListener(savedName);
        
    } else {
        window.stopStaffLiveListeners();
        // Fallback to normal PIN login if no saved session exists
        document.getElementById('loginOverlay').style.display = 'flex';
        document.getElementById('appContainer').style.display = 'none';
        
        let pinBox = document.getElementById('loginPin');
        if (pinBox) pinBox.value = '';
    }
};

window.loginStaff = async function() {
    if(window.staffSelfRepair?.requiresCode()){window.staffSelfRepair.open();return false;}
    let pinInput = document.getElementById('loginPin').value.trim();
    let errorMsg = document.getElementById('loginError');
    let btn = document.querySelector('#loginOverlay .btn-primary');

    if (pinInput.length < 1) {
        errorMsg.innerText = "❌ Please enter your PIN.";
        errorMsg.style.display = 'block';
        return;
    }

    btn.innerText = "⏳ Verifying..."; btn.disabled = true; errorMsg.style.display = 'none';

    try {
        if(!window.staffSetupAccess)throw Error('Reconnect to confirm this phone before signing in.');
        const deviceId=localStorage.getItem('takodeal_device_id');
        await window.staffSetupAccess.confirm(deviceId);
        const setupSession=window.staffSetupAccess.capture(),setupBinding=window.staffSetupAccess.binding();
        let staffData = null; let docId = null;
        if(setupBinding){
            const profile=await getDocFromServer(doc(db,'cashiers',setupBinding.staffId));
            const data=profile.exists()?profile.data():null;
            if(data && (data.branch!==setupBinding.branch || data.cashierName!==setupBinding.staffName))throw Error('Your staff profile changed. Check this phone’s setup again before signing in.');
            const pinMatches=data && (String(data.pin)===pinInput || typeof data.pin==='number'&&Number.isSafeInteger(data.pin)&&/^\d+$/.test(pinInput)&&Number(pinInput)===data.pin);
            if(data && data.active!==false && data.archived!==true && data.blocked!==true && !/^(Blocked|Revoked|Terminated|Resigned|Inactive|Disabled|Archived|Deleted)$/i.test(String(data.status||'')) && !/^(REVOKED|BLOCKED)$/i.test(String(data.pin)) && pinMatches){staffData=data;docId=setupBinding.staffId;}
        } else {
            const qStr = query(collection(db, "cashiers"), where("pin", "==", pinInput));
            const snapStr = await getDocs(qStr);
            if (!snapStr.empty) {staffData=snapStr.docs[0].data();docId=snapStr.docs[0].id;}
            else {
                let pinNum = parseInt(pinInput);
                if (!isNaN(pinNum)) {
                    const qNum = query(collection(db, "cashiers"), where("pin", "==", pinNum));
                    const snapNum = await getDocs(qNum);
                    if (!snapNum.empty) { staffData = snapNum.docs[0].data(); docId = snapNum.docs[0].id; }
                }
            }
        }

        if (staffData) {
            window.staffSetupAccess.assert(setupSession,docId);
            if (localStorage.getItem('takodeal_staff_id') !== docId) window.stopStaffLiveListeners();
            // Re-establish session memory
            localStorage.setItem('takodeal_staff_name', staffData.cashierName);
            localStorage.setItem('takodeal_staff_id', docId);
            localStorage.setItem('takodeal_staff_pic', staffData.profilePicUrl || '');
            localStorage.setItem('takodeal_staff_pic', staffData.profilePicUrl || '');
            
            document.getElementById('loggedInName').innerText = staffData.cashierName;
            if (staffData.profilePicUrl) {
                document.getElementById('topAvatar').innerText = '';
                document.getElementById('topAvatar').style.backgroundImage = `url('${staffData.profilePicUrl}')`;
            }
            
            document.getElementById('loginOverlay').style.opacity = '0';
            setTimeout(() => {
                try{window.staffSetupAccess.assert(setupSession,docId);}catch{window.stopStaffLiveListeners();window.startStaffDeviceSetup?.();return;}
                document.getElementById('loginOverlay').style.display = 'none';
                document.getElementById('appContainer').style.display = 'flex';
                document.getElementById('loginPin').value = ''; 
                document.getElementById('loginOverlay').style.opacity = '1';
                
                // 🚨 THE GATEKEEPER: Catch them immediately upon manual login!
                if (localStorage.getItem('takodeal_staff_id') === docId) window.startSanctionListener(staffData.cashierName);
            }, 300);
            
            if(!window.clockStarted) { window.startLiveClock(); window.clockStarted = true; }
            window.loadAnnouncements();
            window.startInboxListener();
            window.checkContractLifecycle(docId);
            window.listenToIncomingSwaps(); // 🔥 Ensures the Shift Swapping listener starts!
        } else {
            errorMsg.innerText = "❌ Incorrect PIN. Please try again."; errorMsg.style.display = 'block';
        }
    } catch (e) {
        errorMsg.innerText = e.message || "Connection error. Check again before signing in."; errorMsg.style.display = 'block';
    } finally {
        btn.innerText = "Secure Login"; btn.disabled = false;
    }
};

window.logoutStaff = function() {
    window.staffLateProofDraft = null;
    Swal.fire({
        title: 'Sign Out?', text: "You will need your PIN to access your portal again.", icon: 'question',
        showCancelButton: true, confirmButtonColor: '#0f766e', confirmButtonText: 'Yes, sign out'
    }).then((result) => {
        if (result.isConfirmed) {
            window.stopStaffLiveListeners();
            localStorage.removeItem('takodeal_staff_name');
            localStorage.removeItem('takodeal_staff_id');
            localStorage.removeItem('takodeal_staff_pic');
            location.reload(); 
        }
    });
};

// ==========================================
// 📋 PROFILE ENGINE
// ==========================================
window.selectedProfileFile = null;

// Contact, daily-PIN and private-ID actions are installed separately below.

// Personal reminders never issue a contract offer or change employment by a timer.
window.checkContractLifecycle = function(staffId) {
    if(staffId!==localStorage.getItem('takodeal_staff_id'))return Promise.resolve(null);
    return window.staffOnboarding?.refresh() || Promise.resolve(null);
};

// Contract wages use the existing approved private Staff client, never public salary fallback.
const previousContractRateLock=window.onStaffRateLocked;
window.onStaffRateLocked=function(){previousContractRateLock?.();if(window.staffPendingContractOffer){window.closePendingContractReview?.();Swal.close();}};
window.staffContractPrivateAPI = async function(staffId,stillCurrent=()=>true) {
    const check=()=>{if(localStorage.getItem('takodeal_staff_id')!==staffId||!stillCurrent())throw Error('Your staff profile changed. Reopen the contract.');};check();
    const client=await createStaffDocumentFirebase(firebaseConfig,()=>localStorage.getItem('takodeal_staff_id'));check();
    const user=client.auth.currentUser;if(!user?.uid)throw Error('Use your approved Staff phone to review the contract wage.');
    await client.store.binding();check();if(client.auth.currentUser!==user)throw Error('Your private Staff account changed. Reopen the contract.');
    return {db:client.db,auth:client.auth,doc:client.sdk.doc,getDocFromServer:client.sdk.getDocFromServer,runTransaction:client.sdk.runTransaction,localStorage};
};
window.loadPrivateStaffSalaryProfile = async function(profile) {
    const staffId=profile.staffId||localStorage.getItem('takodeal_staff_id');
    if(profile.salaryRateVersion!==1)return profile;
    const api=await window.staffContractPrivateAPI(staffId),user=api.auth.currentUser;
    const result=await loadStaffSalaryTimeline(api,{...profile,staffId});
    if(localStorage.getItem('takodeal_staff_id')!==staffId||api.auth.currentUser!==user)throw Error('Your staff profile changed. Reopen the contract.');
    return result;
};

// ========================================================
// 📄 UNIFIED DOLE CONTRACT CONTENT GENERATOR
// ========================================================
window.getUnifiedContractContent = function(data, signDate, type) {
    const knownRate=Number.isFinite(data.contractDailyRate)?data.contractDailyRate:profileDailyRate(data);
    let dailySalary = knownRate == null ? 'Rate not set' : knownRate.toFixed(2);

    let content = "";
    const savedInitial = data.contractTerms?.initial;
    const datedInitial = savedInitial?.version===1 && typeof savedInitial.startDate==='string' && onboardingDay(savedInitial.startDate)===savedInitial.startDate && typeof savedInitial.endDate==='string' && onboardingDay(savedInitial.endDate)===savedInitial.endDate;
    if (type === 'Initial') {
        content = `
            <p><b>1. POSITION AND COMMENCEMENT</b><br>The Employer hereby employs the Employee as a <b>${data.role || 'Service Crew'}</b>. Employment shall commence on <b>${datedInitial?savedInitial.startDate:data.dateHired || signDate}</b>${datedInitial?' with the saved six-month term ending on <b>'+savedInitial.endDate+'</b>.':' and shall be valid for a period of six (6) months.'}</p>
            <p><b>2. WORK SCHEDULE AND COMPENSATION</b><br>The Employee shall receive a daily basic salary of <b>₱${dailySalary}</b>. Entitled to one (1) day off per week.</p>
            <p><b>3. ATTENDANCE AND ABSENCES POLICY</b><br>Unexcused absences and tardiness are subject to progressive disciplinary action (Verbal Warning, Written Warning, Suspension, Termination).</p>
            <p><b>4. CONFIDENTIALITY AGREEMENT</b><br>Strict maintenance of proprietary recipes under penalty of <b>₱1,000,000.00</b> for breaches.</p>
            <p><b>5. HEALTH DECLARATION</b><br>Employee affirms physical fitness for a food-handling environment.</p>
            <p><b>6. NOTICE OF RESIGNATION</b><br>Mandatory 30-day notice prior to voluntary resignation.</p>
            <p><b>7. COMPANY UNIFORM AND PROPERTY</b><br>Obligation to care for and return provided items to avoid payroll deductions.</p>
        `;
    } else if (type === 'Extension') {
        let contractEnd = new Date(data.dateHired || signDate); contractEnd.setMonth(contractEnd.getMonth() + 6);
        content = `
            <p><b>1. EXTENSION OF EMPLOYMENT</b><br>Employment is extended as <b>${data.role || 'Service Crew'}</b> for an additional six (6) months from <b>${signDate}</b> to <b>${contractEnd.toLocaleDateString('en-US', {month:'long', day:'numeric', year:'numeric'})}</b>. This is the final probationary phase.</p>
            <p><b>2. COMPENSATION</b><br>Daily basic salary remains <b>₱${dailySalary}</b>.</p>
            <p><b>3. REAFFIRMATION OF TERMS</b><br>All original policies (Attendance, ₱1M Confidentiality penalty, 30-Day Notice) remain in full force.</p>
            <p><b>4. PATHWAY TO REGULARIZATION</b><br>Upon successful completion, the Employee may be offered a regularized contract.</p>
        `;
    } else {
        content = `
            <p><b>1. REGULARIZATION</b><br>Effective <b>${signDate}</b>, the Employer hereby grants the Employee <b>REGULAR (PERMANENT)</b> employment status.</p>
            <p><b>2. COMPENSATION</b><br>Daily basic salary of <b>₱${dailySalary}</b>.</p>
            <p><b>3. REAFFIRMATION OF TERMS</b><br>All original policies (Attendance, ₱1M Confidentiality penalty, 30-Day Notice) remain in full force.</p>
            <p><b>4. TERMINATION</b><br>Employment may only be terminated for just or authorized causes as provided by the Philippine Labor Code.</p>
        `;
    }

    return `<div style="font-size: 13px; line-height: 1.6; text-align: justify; color: #1e293b;">${content}</div>`;
};

// 📄 1. UNIFIED EMPLOYMENT CONTRACT UI
window.showContractUI = function(staffId, data, type) {
    if(staffId!==localStorage.getItem('takodeal_staff_id'))return;
    const knownRate=reviewedContractRate(data,type);
    if(!Number.isFinite(knownRate)||knownRate<0)return Swal.fire('Wage needs HR review','HQ must confirm the contract wage before you can sign.','info');
    data={...data,contractDailyRate:knownRate};
    window.staffPendingContractOffer={staffId,type,fingerprint:contractOfferFingerprint(data,type),dailyRate:knownRate};
    let dateToday = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    let dateHired = data.dateHired ? new Date(data.dateHired).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : dateToday;
    
    let branchAddress = "Davao City, Philippines";
    if (data.branch === 'Cabantian') branchAddress = "Blk 14, Lot 6, Deca Homes Subdivision, Barangay Cabantian, Davao City";
    if (data.branch === 'Citygate') branchAddress = "Citygate, Buhangin, Davao City";
    if (data.branch === 'Maa') branchAddress = "Maa, Davao City";

    let isRegular = (type === 'Regularization' || type === 'Extension');
    let title = isRegular ? "REGULARIZATION OF EMPLOYMENT AGREEMENT" : "EMPLOYMENT CONTRACT";

    let contractHtml = `
        <h2 style="text-align: center; color: #0f766e; text-transform: uppercase; margin-bottom: 20px;">${title}</h2>
        <p>This Agreement is executed on <b>${dateToday}</b> between <b>TAKODEAL TAKOYAKI FOODCART</b> ("Employer") and <b>${(data.cashierName || 'Employee').toUpperCase()}</b> ("Employee").</p>
        
        <div style="background: #f8fafc; padding: 20px; border-radius: 8px; border: 1px solid #cbd5e1; margin-bottom: 20px;">
            ${window.getUnifiedContractContent(data, dateToday, type)}
        </div>

        <div style="margin-top: 20px; font-weight: bold; text-align: center;">
            IN WITNESS WHEREOF, the Parties have hereunto affixed their signatures on this ${dateToday} at Davao City, Philippines.
        </div>

        ${window.getSignaturePadHTML(staffId, type)}
    `;
    window.renderContractOverlay(contractHtml, data);
};

// ⚙️ OVERLAY RENDERER & SIGNATURE UI
window.getSignaturePadHTML = function(staffId, type) {
    return `
        <div style="background: #f8fafc; border: 2px dashed #0f766e; padding: 20px; border-radius: 8px; margin-top: 30px; text-align: center;">
            <button type="button" onclick="window.closePendingContractReview()" style="display:block;margin:0 0 15px auto;padding:9px 12px;border:1px solid #cbd5e1;border-radius:6px;background:white;color:#475569;">Review later</button>
            <h3 style="margin: 0 0 10px 0; color: #0f766e;">Required Digital Signature</h3>
            <p style="font-size: 12px; color: #64748b; margin-bottom: 15px;">Please sign your name inside the box below to legally accept this contract.</p>
            <div style="background: white; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; touch-action: none; position: relative; margin-bottom: 15px;">
                <canvas id="contractSigCanvas" style="width: 100%; height: 150px; cursor: crosshair; touch-action: none;"></canvas>
            </div>
            <div style="display: flex; gap: 10px;">
                <button onclick="window.clearContractSignature()" style="flex: 1; background: white; color: #64748b; border: 1px solid #cbd5e1; padding: 12px; border-radius: 6px; font-weight: bold; cursor: pointer;">Clear Signature</button>
                <button onclick="window.acceptContract('${staffId}', '${type}')" style="flex: 2; background: #10b981; color: white; border: none; padding: 12px; border-radius: 6px; font-size: 16px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 6px rgba(16, 185, 129, 0.3); transition: 0.2s;">📝 Sign & Accept Contract</button>
            </div>
        </div>
    `;
};

window.renderContractOverlay = function(contractHtml, data) {
    window.coePendingData = data; 
    let overlay = document.getElementById('renewalContractOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'renewalContractOverlay';
        overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(15, 23, 42, 0.95); z-index: 999999; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; backdrop-filter: blur(5px);";
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = `<div style="background: white; padding: 40px; border-radius: 12px; max-width: 800px; width: 100%; max-height: 85vh; overflow-y: auto; text-align: left; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">${contractHtml}</div>`;
    document.getElementById('loginOverlay').style.display = 'none';
    document.getElementById('appContainer').style.display = 'none';
    overlay.style.display = 'flex';

    setTimeout(() => { window.initContractSignaturePad(); }, 300);
};

// ✍️ SIGNATURE PAD LOGIC
window.isContractSignatureBlank = true;

window.initContractSignaturePad = function() {
    let canvas = document.getElementById('contractSigCanvas');
    if (!canvas) return;
    
    canvas.width = canvas.offsetWidth || 400;
    canvas.height = canvas.offsetHeight || 150;
    
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
    window.isContractSignatureBlank = true;

    let drawing = false;

    const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    };

    const startDraw = (e) => { 
        drawing = true; window.isContractSignatureBlank = false;
        const pos = getPos(e); ctx.beginPath(); ctx.moveTo(pos.x, pos.y); e.preventDefault(); 
    };

    const draw = (e) => { 
        if (!drawing) return; 
        const pos = getPos(e); ctx.lineTo(pos.x, pos.y); ctx.stroke(); e.preventDefault(); 
    };

    const stopDraw = (e) => { drawing = false; ctx.closePath(); };

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDraw);
    canvas.addEventListener('mouseout', stopDraw);
    canvas.addEventListener('touchstart', startDraw, {passive: false});
    canvas.addEventListener('touchmove', draw, {passive: false});
    canvas.addEventListener('touchend', stopDraw, {passive: false});
};

window.clearContractSignature = function() {
    const canvas = document.getElementById('contractSigCanvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        window.isContractSignatureBlank = true;
    }
};

window.closePendingContractReview = function() {
    const overlay=document.getElementById('renewalContractOverlay');if(overlay){overlay.style.display='none';overlay.innerHTML='';}
    document.getElementById('appContainer').style.display='flex';window.staffPendingContractOffer=null;window.coePendingData=null;
};
// Accept only the explicit, unchanged Owner offer the current employee opened.
window.acceptContract = async function(staffId, type) {
    if(window.isContractSignatureBlank)return Swal.fire('Signature Required','Please sign inside the box before accepting this contract.','warning');
    const offer=window.staffPendingContractOffer;
    if(!offer||offer.staffId!==staffId||offer.type!==type||localStorage.getItem('takodeal_staff_id')!==staffId)return Swal.fire('Reopen contract','Open the contract offer from your personal reminders before signing.','info');
    const stillCurrent=()=>window.staffPendingContractOffer===offer&&localStorage.getItem('takodeal_staff_id')===staffId&&window.staffRateSession?.allows(staffId);
    Swal.fire({title:'Saving your contract signature…',allowOutsideClick:false,didOpen:()=>Swal.showLoading()});
    try{
        const signature=document.getElementById('contractSigCanvas').toDataURL('image/png');
        if(!window.staffRateSession?.allows(staffId))throw Error('Your wage privacy session expired. Reopen the contract and unlock it again.');
        const api=await window.staffContractPrivateAPI(staffId,stillCurrent);
        const result=await signOfferedContract(api,{staffId,type,signature,expectedFingerprint:offer.fingerprint,expectedDailyRate:offer.dailyRate,stillCurrent});
        if(!stillCurrent())return;
        window.coePendingData=result.profile;
        window.closePendingContractReview();
        void window.refreshStaffOnboarding?.({force:true});
        if(result.alreadySaved)return Swal.fire('Contract already signed','Your existing signed record is preserved. Open Profile to view your saved contract.','success');
        window.downloadContractPDF(type,result.profile,result.signedOn,true);
    }catch(error){if(stillCurrent()){console.error(error);Swal.fire('Contract not signed',error.message||'Reconnect and reopen your contract.','error');}}
};

// ========================================================
// 🖨️ UNIVERSAL HR PDF CONTRACT GENERATOR (WITH SIGNATURE & IDs)
// ========================================================
window.downloadContractPDF = function(type, data, signDate, isStaffApp = false) {
    let branchAddress = "Davao City, Philippines";
    if (data.branch === 'Cabantian') branchAddress = "Blk 14, Lot 6, Deca Homes Subdivision, Barangay Cabantian, Davao City";
    if (data.branch === 'Citygate') branchAddress = "Citygate, Buhangin, Davao City";
    if (data.branch === 'Maa') branchAddress = "Maa, Davao City";

    let isRegular = (type === 'Regularization' || type === 'Extension');
    let title = isRegular ? "REGULARIZATION OF EMPLOYMENT AGREEMENT" : "EMPLOYMENT CONTRACT";
    let content = window.getUnifiedContractContent(data, signDate, type);

    // Gather Uploaded IDs from Database for Page 2
    let idImagesHtml = "";
    let ids = [];
    if (data.sssIdUrl) ids.push(data.sssIdUrl);
    if (data.philhealthIdUrl) ids.push(data.philhealthIdUrl);
    if (data.pagibigIdUrl) ids.push(data.pagibigIdUrl);

    if (ids.length > 0) {
        idImagesHtml += `<div style="page-break-before: always; padding-top: 40px;">`;
        idImagesHtml += `<h3 style="text-align: center; color: #0f172a; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 30px;">ATTACHED VALID IDs</h3>`;
        idImagesHtml += `<div style="display: flex; flex-direction: column; gap: 30px; align-items: center;">`;
        ids.forEach(url => {
            idImagesHtml += `<img src="${url}" style="max-width: 90%; max-height: 350px; border: 2px solid #cbd5e1; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">`;
        });
        idImagesHtml += `</div></div>`;
    }

    // 🔥 THE SIGNATURE INJECTOR 🔥
    let employeeSignatureHtml = data.contractSignature 
        ? `<img src="${data.contractSignature}" style="height: 60px; display: block; margin-bottom: -10px;">` 
        : `<div style="height: 50px; display: block; margin-bottom: 5px;"></div>`;

    // Combine into Final PDF Container
    let container = document.createElement('div');
    container.innerHTML = `
        <div style="padding: 40px 50px; font-family: 'Helvetica', 'Arial', sans-serif; color: #1e293b; background: white; width: 800px; box-sizing: border-box;">
            <div style="text-align: center; border-bottom: 3px solid #0f172a; padding-bottom: 15px; margin-bottom: 20px;">
                <h1 style="margin: 0; font-size: 32px; letter-spacing: 2px; color: #0f172a;">TAKODEÁL</h1>
                <p style="margin: 5px 0 0 0; color: #64748b; font-size: 12px; text-transform: uppercase;">${branchAddress}</p>
            </div>
            <h2 style="text-align: center; color: #b45309; font-size: 18px; text-transform: uppercase; margin-bottom: 20px;">${title}</h2>
            <p style="margin-bottom: 15px; font-size: 13px; line-height: 1.5;">This Agreement is executed on <b>${signDate}</b> between <b>TAKODEAL TAKOYAKI FOODCART</b> ("Employer") and <b>${(data.cashierName || 'Employee').toUpperCase()}</b> ("Employee").</p>
            
            ${content}
            
            <div style="margin-top: 40px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; font-size: 13px;">
                <div>
                    ${employeeSignatureHtml}
                    <div style="border-bottom: 1px solid #1e293b; margin-bottom: 5px; padding-bottom: 5px;"><b>${(data.cashierName || 'Employee').toUpperCase()}</b></div>
                    <span style="color: #64748b;">Employee Digitally Accepted</span>
                </div>
                <div>
                    <div style="height: 50px; display: block; margin-bottom: 5px;"></div>
                    <div style="border-bottom: 1px solid #1e293b; margin-bottom: 5px; padding-bottom: 5px;"><b>Chery Ann R. Fonda</b></div>
                    <span style="color: #64748b;">Owner / Employer</span>
                </div>
            </div>
            ${idImagesHtml}
        </div>`;
    
    Swal.fire({title: 'Generating PDF...', text: 'Attaching IDs and formatting contract...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
    
    // Execute PDF Engine
    let opt = {
        margin: 0,
        filename: `${title.replace(/\s+/g, '_')}_${(data.cashierName || 'Employee').replace(/\s+/g, '_')}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true }, 
        jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
    };
    
    html2pdf().set(opt).from(container).save().then(() => {
        if (isStaffApp) {
            Swal.fire({
                title: '<div style="font-size: 32px; animation: bounce 1s infinite;">🎉 CONGRATULATIONS! 🎉</div>',
                html: `<b>Welcome to the next chapter of your journey at TAKODEÁL!</b> 🐙<br><br>Your official contract has been digitally signed and a PDF soft copy has been downloaded to your device for your records.`,
                icon: 'success',
                confirmButtonText: 'Awesome! 🚀',
                confirmButtonColor: '#10b981',
                customClass: { popup: 'rounded-2xl shadow-2xl p-6' }
            });
        } else {
            Swal.close();
        }
    }).catch(err => {
        console.error("PDF Gen Error:", err);
        Swal.fire('Warning', 'Contract generated, but there was an issue attaching the ID photos. Please ensure IDs are uploaded in the Staff Profile.', 'warning');
    });
};

window.reprintContract = async function(type, encodedData, signDate) {
    const staffId=decodeURIComponent(encodedData);
    if(staffId!==localStorage.getItem('takodeal_staff_id') || !await window.ensureStaffRateUnlocked())return;
    try {
        const snap=await getDocFromServer(doc(db,'cashiers',staffId));
        if(staffId!==localStorage.getItem('takodeal_staff_id') || !window.staffRateSession?.allows(staffId) || !snap.exists())return;
        let data = snap.data();const key={Initial:'initial',Extension:'extension',Regularization:'regularization'}[type];
        const savedSignDate=key && data.signedContracts?.[key];
        if(typeof savedSignDate!=='string' || !savedSignDate.trim())return Swal.fire('Contract not signed','This saved contract has no employee acceptance on file.','info');
        data=await window.loadPrivateStaffSalaryProfile({...data,staffId});
        if(staffId!==localStorage.getItem('takodeal_staff_id') || !window.staffRateSession?.allows(staffId))return;
        const rate=reviewedContractRate(data,type);if(rate===null)throw Error('The saved contract wage could not be confirmed. Reconnect using the approved Staff phone.');
        data={...data,contractDailyRate:rate};
        let printWin = window.open('', '', 'width=850,height=900');
        if(!printWin)return Swal.fire('Allow document window','Allow the document window, then select the contract again.','info');
        printWin.document.write(window.getContractPrintHTML(type, data, savedSignDate));
    } catch(error) { if(staffId===localStorage.getItem('takodeal_staff_id'))return Swal.fire('Contract unavailable',error.message||'Reconnect and reopen your saved contract.','info'); }
};

window.getContractPrintHTML = function(type, data, signDate) {
    const title = {Initial:'Employment Contract',Extension:'Contract Renewal & Extension',Regularization:'Regularization of Employment'}[type] || 'Employment Contract';
    // Legacy extension reprints used the saved signature date for their six-month end.
    const printableData=type==='Extension'?{...data,dateHired:signDate}:data;
    let content = window.getUnifiedContractContent(printableData, signDate, type);
    let logoUrl = window.location.origin + '/payslip%20logo.jpg';

    return `
        <html><head><title>${title} - ${data.cashierName}</title></head>
        <body style="font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; color: #1e293b; max-width: 800px; margin: 0 auto; line-height: 1.6; position: relative;">
            <img src="${logoUrl}" style="position: absolute; left: 40px; top: 30px; width: 100px; height: 100px; object-fit: contain;">
            <div style="text-align: center; margin-bottom: 30px; padding-top: 10px;">
                <h1 style="margin: 0; font-size: 38px; letter-spacing: 2px; color: #0f172a;">TAKODEÁL</h1>
                <p style="margin: 0; color: #64748b; font-size: 14px; text-transform: uppercase;">Davao City, Philippines</p>
            </div>
            <hr style="border: none; border-top: 3px solid #0f172a; margin-bottom: 40px;">
            <h2 style="text-align: center; color: #b45309; text-transform: uppercase;">${title}</h2>
            <p>This Agreement is executed on <b>${signDate}</b> between <b>TAKODEAL TAKOYAKI FOODCART</b> ("Employer") and <b>${(data.cashierName || 'Employee').toUpperCase()}</b> ("Employee").</p>
            ${content}
            <div style="margin-top: 80px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px;">
                <div>
                    <div style="border-bottom: 1px solid #1e293b; margin-bottom: 5px;"><b>${(data.cashierName || 'Employee').toUpperCase()}</b></div>
                    <span style="font-size: 14px; color: #64748b;">Employee Signature / Digitally Accepted</span>
                </div>
                <div>
                    <div style="border-bottom: 1px solid #1e293b; margin-bottom: 5px;"><b>Chery Ann R. Fonda</b></div>
                    <span style="font-size: 14px; color: #64748b;">Owner / Employer</span>
                </div>
            </div>
            <script>setTimeout(() => { window.print(); window.close(); }, 1500);</script>
        </body></html>
    `;
};

window.previewProfileImage = async function(event) {
    const file = event.target.files[0];
    if (file) {
        window.selectedProfileFile = file;
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('profilePreview').src = e.target.result;
            document.getElementById('profilePreview').style.display = 'block';
            document.getElementById('profilePlaceholder').style.display = 'none';
        }
        reader.readAsDataURL(file);
        await window.uploadProfilePicture();
    }
};

window.uploadProfilePicture = async function() {
    if (!window.selectedProfileFile) return;
    let staffName = localStorage.getItem('takodeal_staff_name');
    let staffId = localStorage.getItem('takodeal_staff_id');

    try {
        const fileExt = window.selectedProfileFile.name.split('.').pop();
        const fileName = `staff_profiles/${staffName.replace(/\s+/g, '_')}_${Date.now()}.${fileExt}`;
        const storageReference = ref(storage, fileName);
        const snapshot = await uploadBytes(storageReference, window.selectedProfileFile);
        const photoUrl = await getDownloadURL(snapshot.ref);

        await updateDoc(doc(db, "cashiers", staffId), { profilePicUrl: photoUrl });
        localStorage.setItem('takodeal_staff_pic', photoUrl);
        document.getElementById('topAvatar').innerText = '';
        document.getElementById('topAvatar').style.backgroundImage = `url('${photoUrl}')`;
        Swal.fire({toast: true, position: 'top-end', icon: 'success', title: 'Photo Uploaded!', showConfirmButton: false, timer: 2000});
    } catch (e) {
        console.error(e); Swal.fire('Error', 'Failed to upload photo.', 'error');
    }
};

// ==========================================
// 📱 NAVIGATION ENGINE
// ==========================================
window.switchView = function(viewId, btnElement) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    let targetView = document.getElementById('view-' + viewId);
    if (targetView) targetView.classList.add('active');

    document.querySelectorAll('.bottom-nav .nav-item').forEach(btn => btn.classList.remove('active'));
    if (btnElement) {
        btnElement.classList.add('active');
    } else {
        // 🔥 THE FIX: Auto-highlights the tab even if triggered by code!
        let autoBtn = document.querySelector(`.bottom-nav .nav-item[onclick*="'${viewId}'"]`);
        if (autoBtn) autoBtn.classList.add('active');
    }
    
    if (viewId === 'timeclock') window.startCameraAndGPS();
    else window.stopCamera();
    if (viewId === 'payslip' && window.staffVaultSession?.allows(localStorage.getItem('takodeal_staff_id'))) window.loadPayslipVault();
    if (viewId === 'schedule') window.loadStaffSchedule();
};

// ==========================================
// 📢 BULLETIN BOARD & SIGNATURE ENGINE
// ==========================================
window.hasAutoShownBulletin = false; 

window.loadAnnouncements = async function() {
    let container = document.getElementById('bulletinList');
    let cashierName = localStorage.getItem('takodeal_staff_name');
    let staffId = localStorage.getItem('takodeal_staff_id');
    if (!cashierName) return;

    try {
        // 🔥 GET STAFF BRANCH: Required to route branch-specific announcements
        let staffBranch = "Unknown";
        if (staffId) {
            const staffDoc = await window.getDoc(window.doc(window.db, "cashiers", staffId));
            if (staffDoc.exists()) staffBranch = staffDoc.data().branch || "Unknown";
        }

        const q = window.query(window.collection(window.db, "announcements"), window.where("active", "==", true));
        const snap = await window.getDocs(q);

        const ackQ = window.query(window.collection(window.db, "acknowledgments"), window.where("staffName", "==", cashierName));
        const ackSnap = await window.getDocs(ackQ);

        let signatures = {};
        ackSnap.forEach(doc => { let d = doc.data(); signatures[d.announcementId] = d; });

        let announcementsArray = [];
        snap.forEach(docSnap => announcementsArray.push({id: docSnap.id, ...docSnap.data()}));
        announcementsArray.sort((a,b) => b.timestamp - a.timestamp); 

        let html = '';
        let unreadAnnouncements = [];

        announcementsArray.forEach(ann => {
            // 🔥 THE GATEKEEPER: Filters out announcements not meant for this staff member
            let isTarget = false;
            if (!ann.targetType || ann.targetType === 'All') isTarget = true;
            else if (ann.targetType === 'Branch' && ann.targetBranch === staffBranch) isTarget = true;
            else if (ann.targetType === 'Individual' && ann.targetStaff === cashierName) isTarget = true;

            if (!isTarget) return; 

            let dateStr = ann.timestamp ? ann.timestamp.toDate().toLocaleDateString() : 'Recent';
            let sigData = signatures[ann.id];
            let shortMsg = ann.message ? ann.message.substring(0, 100) + (ann.message.length > 100 ? '...' : '') : '';

            let statusBadge = sigData
                ? `<span style="background: #dcfce7; color: #16a34a; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; border: 1px solid #bbf7d0;">✅ Signed</span>`
                : `<span style="background: #fee2e2; color: #dc2626; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; border: 1px solid #fecaca; animation: pulse 2s infinite;">❌ Requires Signature</span>`;

            // 🔥 VISUAL BADGES for targeted notices
            let targetBadge = '';
            if (ann.targetType === 'Branch') targetBadge = `<span style="background: #e0f2fe; color: #0284c7; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; border: 1px solid #bae6fd; margin-top: 4px;">🏢 Branch Notice</span>`;
            if (ann.targetType === 'Individual') targetBadge = `<span style="background: #f5f3ff; color: #7c3aed; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; border: 1px solid #ddd6fe; margin-top: 4px;">👤 Private Notice</span>`;

            let sigDateStr = sigData && sigData.timestamp ? sigData.timestamp.toDate().toLocaleString('en-US', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : 'Unknown';

            let safeData = {
                id: ann.id,
                title: ann.title || 'Announcement',
                subHeadline: ann.subHeadline || '',
                message: ann.message || '',
                footerMessage: ann.footerMessage || '', 
                images: ann.images || [],
                dateStr: dateStr,
                hasSignature: !!sigData,
                signatureImg: sigData ? sigData.signature : '',
                signatureDate: sigDateStr,
                targetType: ann.targetType || 'All'
            };
            
            let modalData = encodeURIComponent(JSON.stringify(safeData));

            if (!sigData) unreadAnnouncements.push(modalData);

            html += `
                <div class="req-item-card" onclick="window.viewAnnouncement('${modalData}')" style="cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.05); transition: transform 0.2s;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
                        <h3 style="margin:0; color:#0f172a; font-size: 15px; flex: 1;">${ann.title}</h3>
                        <div style="margin-left: 10px; display: flex; flex-direction: column; align-items: flex-end;">
                            ${statusBadge}
                            ${targetBadge}
                        </div>
                    </div>
                    ${ann.subHeadline ? `<div style="font-size:12px; font-weight:bold; color:#0ea5e9; margin-bottom:6px;">${ann.subHeadline}</div>` : ''}
                    <div style="font-size:11px; color:#64748b; margin-bottom:10px;">📅 Published: ${dateStr}</div>
                    <p style="font-size:13px; color:#334155; margin:0 0 10px 0; line-height: 1.4;">${shortMsg}</p>
                    <div style="font-size: 11px; color: #0ea5e9; font-weight: bold; text-align: right;">View Full Details &rarr;</div>
                </div>
            `;
        });
        
        container.innerHTML = html || '<div style="text-align:center; padding: 40px; color: #94a3b8;">No new announcements.</div>';

        if (unreadAnnouncements.length > 0 && !window.hasAutoShownBulletin) {
            window.hasAutoShownBulletin = true;
            setTimeout(() => {
                window.viewAnnouncement(unreadAnnouncements[0]); 
            }, 1000); 
        }

    } catch (e) { 
        console.error(e); 
        container.innerHTML = '<div style="text-align:center; padding: 40px; color: #dc2626;">Error loading announcements.</div>';
    }
};

window.showExtraLargeImage = function(imgSrc) {
    let existing = document.getElementById('announceImageOverlay');
    if (existing) existing.remove();
    
    let overlay = document.createElement('div');
    overlay.id = 'announceImageOverlay';
    overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(15, 23, 42, 0.95); z-index: 100000; display: flex; flex-direction: column; align-items: center; justify-content: center; backdrop-filter: blur(5px);";
    
    overlay.innerHTML = `
        <button onclick="document.getElementById('announceImageOverlay').remove()" style="position: absolute; top: 20px; right: 20px; background: #ef4444; color: white; border: 2px solid white; border-radius: 50%; width: 45px; height: 45px; font-size: 22px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 6px rgba(0,0,0,0.4); transition: 0.2s;">✖</button>
        <img src="${imgSrc}" style="max-width: 95%; max-height: 80vh; object-fit: contain; border-radius: 12px; box-shadow: 0 20px 40px rgba(0,0,0,0.6);">
        <div style="color: white; margin-top: 20px; font-size: 14px; font-weight: bold; background: rgba(0,0,0,0.6); padding: 10px 20px; border-radius: 30px; border: 1px solid rgba(255,255,255,0.2);">Tap the ✖ in the top right to read details and sign</div>
    `;
    document.body.appendChild(overlay);
};

// If there is an existing wrapper intercepting this, save the original reference first!
if (typeof window.originalViewAnnouncement === 'undefined' && typeof window.viewAnnouncement === 'function') {
    window.originalViewAnnouncement = window.viewAnnouncement;
}

window.viewAnnouncement = function(encodedData) {
    let data = JSON.parse(decodeURIComponent(encodedData));
    
    let imagesHtml = '';
    if (data.images && data.images.length > 0) {
        imagesHtml = `<div style="display: flex; flex-direction: column; gap: 10px; margin-top: 20px; padding-bottom: 5px;">`;
        data.images.forEach(img => {
            imagesHtml += `<img src="${img}" style="width: 100%; max-height: 250px; border-radius: 8px; border: 1px solid #cbd5e1; object-fit: cover; cursor: pointer; box-shadow: 0 4px 6px rgba(0,0,0,0.05);" onclick="window.showExtraLargeImage('${img}')">
            <div style="text-align: center; font-size: 10px; color: #94a3b8; font-weight: bold;">Tap image to enlarge 🔍</div>`;
        });
        imagesHtml += `</div>`;
    }

    let sigHtml = '';
    if (data.hasSignature) {
        sigHtml = `
            <div style="margin-top: 20px; padding-top: 15px; border-top: 1px dashed #cbd5e1; text-align: center; background: #f8fafc; border-radius: 8px; padding: 15px; border: 1px solid #bbf7d0;">
                <span style="font-size: 12px; color: #16a34a; font-weight: bold; display: block; margin-bottom: 10px;">✅ You acknowledged this on ${data.signatureDate}</span>
                <img src="${data.signatureImg}" style="height: 60px; background: white; border: 1px solid #e2e8f0; border-radius: 6px; padding: 5px;">
            </div>`;
    } else {
        sigHtml = `
            <div style="margin-top: 25px; padding: 20px; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 12px;">
                <h4 style="margin: 0 0 5px 0; color: #b45309; text-align: center; font-size: 15px;">Mandatory Acknowledgment</h4>
                <p style="font-size: 11px; color: #92400e; text-align: center; margin-bottom: 15px;">Please sign your name inside the box below to confirm you have read and understood this update.</p>
                <div style="background: white; border: 2px dashed #d97706; border-radius: 8px; overflow: hidden; touch-action: none; position: relative;">
                    <canvas id="sigCanvas" width="300" height="150" style="width: 100%; height: 150px; cursor: crosshair; touch-action: none;"></canvas>
                </div>
                <div style="display: flex; gap: 10px; margin-top: 15px;">
                    <button onclick="window.clearSignature()" style="flex: 1; background: white; color: #64748b; border: 1px solid #cbd5e1; padding: 10px; border-radius: 6px; font-weight: bold; cursor: pointer;">Clear</button>
                    <button onclick="window.submitSignature('${data.id}')" id="btnSubmitSig" style="flex: 2; background: #0f766e; color: white; border: none; padding: 10px; border-radius: 6px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 6px rgba(15, 118, 110, 0.3);">Submit Signature</button>
                </div>
            </div>`;
    }

    let subHeadlineHtml = data.subHeadline ? `<div style="font-size: 16px; font-weight: 900; color: #0ea5e9; margin-bottom: 15px; line-height: 1.3;">${data.subHeadline}</div>` : '';
    let footerHtml = data.footerMessage ? `<div style="font-size: 12px; color: #64748b; margin-top: 25px; padding-top: 15px; border-top: 2px dashed #e2e8f0; text-align: center; font-style: italic; font-weight: bold;">${data.footerMessage}</div>` : '';

    // 🔥 MODAL TARGET BADGES
    let targetBanner = '';
    if (data.targetType === 'Branch') targetBanner = `<div style="background: #e0f2fe; color: #0284c7; padding: 6px 10px; border-radius: 6px; font-size: 11px; font-weight: bold; margin-bottom: 12px; border: 1px solid #bae6fd; display: inline-block;">🏢 Specific Branch Notice</div>`;
    if (data.targetType === 'Individual') targetBanner = `<div style="background: #f5f3ff; color: #7c3aed; padding: 6px 10px; border-radius: 6px; font-size: 11px; font-weight: bold; margin-bottom: 12px; border: 1px solid #ddd6fe; display: inline-block;">👤 Private Individual Notice</div>`;

    Swal.fire({
        title: `<div style="text-align:left; font-size: 22px; font-weight: 900; color: #0f172a; margin-bottom: 5px; line-height: 1.2; text-transform: uppercase;">${data.title}</div>`,
        html: `<div style="text-align: left; max-height: 75vh; overflow-y: auto; padding-right: 5px;">
                <div style="font-size: 12px; font-weight: bold; color: #64748b; margin-bottom: 15px; border-bottom: 2px solid #f1f5f9; padding-bottom: 10px;">📅 Published: ${data.dateStr}</div>
                ${targetBanner}
                ${subHeadlineHtml}
                <div style="font-size: 15px; color: #334155; line-height: 1.6; white-space: pre-wrap;">${data.message || ''}</div>
                ${imagesHtml}
                ${sigHtml}
                ${footerHtml}
               </div>`,
        showCloseButton: true, 
        showConfirmButton: false,
        allowOutsideClick: data.hasSignature,
        customClass: { popup: 'rounded-2xl shadow-2xl p-4' },
        didOpen: () => {
            if (!data.hasSignature) window.initSignaturePad();
            if (data.images && data.images.length > 0) window.showExtraLargeImage(data.images[0]);
        }
    });
};

window.isSignatureBlank = true;

window.initSignaturePad = function() {
    const canvas = document.getElementById('sigCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Make lines look like a smooth pen!
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0f172a';
    window.isSignatureBlank = true;

    let drawing = false;

    // Accurate coordinates regardless of screen size
    const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: (clientX - rect.left) * (canvas.width / rect.width),
            y: (clientY - rect.top) * (canvas.height / rect.height)
        };
    };

    const startDraw = (e) => { 
        drawing = true; 
        window.isSignatureBlank = false;
        const pos = getPos(e); 
        ctx.beginPath(); 
        ctx.moveTo(pos.x, pos.y); 
        e.preventDefault(); // Stops the screen from scrolling on mobile!
    };

    const draw = (e) => { 
        if (!drawing) return; 
        const pos = getPos(e); 
        ctx.lineTo(pos.x, pos.y); 
        ctx.stroke(); 
        e.preventDefault(); 
    };

    const stopDraw = (e) => { 
        drawing = false; 
        ctx.closePath(); 
        if(e) e.preventDefault(); 
    };

    // Mouse Events
    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDraw);
    canvas.addEventListener('mouseout', stopDraw);

    // Touch Events (For mobile phones!)
    canvas.addEventListener('touchstart', startDraw, {passive: false});
    canvas.addEventListener('touchmove', draw, {passive: false});
    canvas.addEventListener('touchend', stopDraw, {passive: false});
};

window.clearSignature = function() {
    const canvas = document.getElementById('sigCanvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        window.isSignatureBlank = true;
    }
};

window.submitSignature = async function(announcementId) {
    const canvas = document.getElementById('sigCanvas');
    if (!canvas) return;

    if (window.isSignatureBlank) {
        return Swal.showValidationMessage("Please draw your signature in the box first.");
    }

    let btn = document.getElementById('btnSubmitSig');
    let origText = btn.innerText;
    btn.innerText = "⏳ Saving..."; btn.disabled = true;

    // Convert the drawing to a Base64 image string
    let sigDataUrl = canvas.toDataURL("image/png");
    let staffName = localStorage.getItem('takodeal_staff_name');

    try {
        await addDoc(collection(db, "acknowledgments"), {
            announcementId: announcementId,
            staffName: staffName,
            signature: sigDataUrl,
            timestamp: serverTimestamp()
        });

        Swal.fire({
            toast: true, position: 'top-end', icon: 'success', 
            title: 'Thank you! Acknowledgment saved.', 
            showConfirmButton: false, timer: 2500
        });

        // Close the modal and reload the list so it instantly turns into a Green Checkmark!
        Swal.close();
        window.loadAnnouncements();

    } catch (e) {
        console.error("Signature Save Error:", e);
        Swal.showValidationMessage("Failed to save signature. Check connection.");
        btn.innerText = origText; btn.disabled = false;
    }
};

// ==========================================
// ⏱️ TIME CLOCK, CAMERA & GPS ENGINE
// ==========================================
// Camera and bounded location sessions are installed by staff-location.js.
window.cameraStream = null;
window.getDistanceInMeters = function(lat1, lon1, lat2, lon2) {
    var R = 6371e3; var dLat = (lat2 - lat1) * Math.PI / 180; var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; 
};

installAttendanceCamera(window, document);
installAttendanceProofUploader(window, document, {uploadBytesResumable, getDownloadURL, ref, getStorage});
window.authorizeAttendanceUpload=createClockUploadAccess({auth:staffPrimaryAuth,deviceId:()=>localStorage.getItem('takodeal_device_id'),authority:()=>window.staffSetupAccess,Swal,fetcher:window.fetch.bind(window)});
window.punchTime = async function(type) {
    if (!['TIME IN', 'TIME OUT'].includes(type)) return Swal.fire('Attendance not saved', 'Choose Time In or Time Out using the attendance buttons.', 'warning');
    let staffName = localStorage.getItem('takodeal_staff_name');
    if (!staffName) return Swal.fire('Error', 'Not logged in.', 'error');
    if (window.staffPunchBusy) return;
    window.staffPunchBusy = true;
    const punchStaffId = localStorage.getItem('takodeal_staff_id');

    let btnIn = document.getElementById('btnTimeIn'); 
    let btnOut = document.getElementById('btnTimeOut');
    if (btnIn) btnIn.disabled = true; 
    if (btnOut) btnOut.disabled = true;

    const attendanceRef = doc(collection(db, 'attendance_logs'));
    const lateRequestRef = doc(collection(db, 'staff_requests'));
    let pendingLateRequest = null, pendingStaffShiftChoice = null;
    let punchScheduleData = null, punchScheduleProfiles = {}, punchSchedulePreview = null, punchScheduleDeclaration = null;
    let activeTimeIn = null;
    const assertPunchIdentity=()=>{if(localStorage.getItem('takodeal_staff_id')!==punchStaffId||localStorage.getItem('takodeal_staff_name')!==staffName)throw Error('Your staff session changed. Sign in again.');};
    const readFreshPunchSchedule=async at=>createScheduleHistoryStore({db,doc,getDocFromServer:async reference=>{
        assertPunchIdentity();const saved=await getDocFromServer(reference);assertPunchIdentity();
        if(!saved||typeof saved.exists!=='function'||saved.metadata?.fromCache===true||saved.metadata?.hasPendingWrites===true)throw Error('The assigned schedule could not be confirmed with HQ. Reconnect and tap Time In again.');
        return saved;
    }}).loadRange(new Date(+at-86400000),new Date(+at+86400000));

    try {
        Swal.fire({title: 'Verifying with HQ...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});

        // Read the same employee ID across Cashier and Staff, including exact legacy names.
        const userLogs = await readStaffRecords(window,punchStaffId,staffName,{metadataOnly:true,assertCurrent:()=>{if(localStorage.getItem('takodeal_staff_id')!==punchStaffId||localStorage.getItem('takodeal_staff_name')!==staffName)throw Error('Your staff session changed. Sign in again.');}});
        const lastLog = latestAttendance(userLogs, punchStaffId, staffName);
        const lastType = attendanceKind(lastLog);
        const hoursSince = lastLog ? (Date.now() - attendanceMillis(lastLog.timestamp)) / 3600000 : 0;
        if (type === 'TIME OUT') {
            if (lastType !== 'TIME IN') {
                Swal.fire(lastType === 'TIME OUT' ? 'Already Timed Out' : 'No Active Shift', 'Refresh attendance after your Cashier Time In has synced to HQ. No Time Out was created.', 'warning'); return;
            }
            if (hoursSince > 16) { Swal.fire('Shift Expired', 'This Time In is more than 16 hours old. Ask HQ to review the missing Time Out.', 'error'); return; }
            if (hoursSince < 0.05) { Swal.fire('Too Soon', 'Wait at least three minutes after Time In before recording Time Out.', 'warning'); return; }
            activeTimeIn = lastLog;
        } else if (lastType === 'TIME IN' && hoursSince < 16) {
            Swal.fire('Already Timed In', 'You are currently clocked in. Please TIME OUT of your active shift first.', 'error'); return;
        }

        // 2. 📋 THE DAILY SOP COMPLIANCE BLOCKER (ONLY ON TIME OUT)
        if (type === "TIME OUT") {
            const sopRecords = await readStaffRecords(window,punchStaffId,staffName,{table:'sop_logs',names:[activeTimeIn.staffName],metadataOnly:true,assertCurrent:()=>{if(localStorage.getItem('takodeal_staff_id')!==punchStaffId)throw Error('Your staff session changed. Sign in again.');}});
            const hasSopToday = sopCoversShift(sopRecords,activeTimeIn,punchStaffId,staffName);
            
            if (!hasSopToday) {
                Swal.fire({
                    title: '📋 SOP Required!',
                    html: 'You cannot Time Out until you have submitted your Daily SOP Checklist.<br><br><span style="font-size:12px; color:#dc2626; font-weight:bold;">If tasks are unfinished, you must mark them as "Missed" and type a reason.</span>',
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: 'Go to SOP',
                    cancelButtonText: 'Cancel',
                    confirmButtonColor: '#0f766e',
                    customClass: { popup: 'rounded-2xl' }
                }).then((result) => {
                    if (result.isConfirmed) {
                        window.switchView('sop', document.querySelectorAll('.bottom-nav .nav-item')[4]);
                    }
                });
                return; 
            }
        }

        // Confirm a fresh, accurate location without changing the branch radius.
        Swal.fire({title:'Checking your branch location…',text:'Keep Clock open while GPS and Wi-Fi confirm your location.',allowOutsideClick:false,didOpen:()=>Swal.showLoading()});
        let punchLocation = await window.getAttendanceLocation();
        let closestBranch = punchLocation.branch, minDistance = punchLocation.distance;
        if (type === 'TIME OUT' && activeTimeIn.branch !== closestBranch) throw Error(`Your active shift is at ${activeTimeIn.branch||'an unrecorded branch'}. Record Time Out from that branch or ask HQ to review the location.`);

        // 4. ⏰ THE STRICT LATE DETECTOR & PHOTO INTERCEPTOR
        if (type === "TIME IN") {
            try {
                let staffProfiles = {}; 
                const staffDocSnap = await getDocFromServer(doc(db, "cashiers", punchStaffId));
                assertPunchIdentity();
                if (staffDocSnap.exists()) {
                    staffProfiles[staffName] = {...staffDocSnap.data(),id:punchStaffId,staffId:punchStaffId};
                }

                const clockDate = new Date();
                punchScheduleProfiles = staffProfiles;
                punchScheduleData = await readFreshPunchSchedule(clockDate);
                {
                    let scheduleData = punchScheduleData;
                    
                    // 🔥 THE UPGRADE: Cross-Branch Universal Matcher Call
                    const snapshot = captureAttendanceSchedule(clockDate, closestBranch, staffName, scheduleData, staffProfiles);
                    punchSchedulePreview = snapshot;
                    const reliefPreview=emergencyReliefForClockIn(snapshot,staffProfiles[staffName],closestBranch);
                    const reviewedShift = await chooseClockInSchedule({Swal,document,history:scheduleData,snapshot,profile:staffProfiles[staffName],staffId:punchStaffId,staffName,branch:closestBranch,at:clockDate,emergencyRelief:reliefPreview,
                        title:reliefPreview?'Emergency branch cover':'Review your assigned hours',assertCurrent:assertPunchIdentity});
                    assertPunchIdentity();if(!reviewedShift.proceed)return;
                    punchScheduleDeclaration=reviewedShift.declaration;
                    let lateMinutes = snapshot.needsScheduleReview || snapshot.wasScheduled!==true ? 0 : resolveAttendanceShift({staffName, branch:closestBranch, timestamp:clockDate, scheduleSnapshot:snapshot}, scheduleData, staffProfiles)?.lateMinutes || 0;
                    
                    // Trigger Interceptor Letter if they are more than 3 minutes late!
                    if (lateMinutes > 3) {
                        Swal.close(); 

                        const savedProof = window.staffLateProofDraft;
                        const lateDraft = savedProof?.staffId === punchStaffId && savedProof.branch === closestBranch && Date.now() - savedProof.savedAt < 30 * 60000 ? savedProof : null;
                        const lateShiftChoices=savedShiftChoices(scheduleData,{start:{id:attendanceRef.id,type:'TIME IN',staffId:punchStaffId,staffName,branch:closestBranch,timestamp:clockDate},staffId:punchStaffId,staffName});
                        if (!lateDraft) window.staffLateProofDraft = null;
                        const { value: lateForm, isConfirmed } = await Swal.fire({
                            title: '⏰ You are Late!',
                            html: `
                                <div style="font-size: 14px; color: #475569; margin-bottom: 15px; text-align: left;">
                                    You are <b>${lateMinutes} minutes late</b> for your shift.<br><br>
                                    You are strictly required to provide a valid reason and attach a screenshot of your message sent to the Owner, Manager, or HR.
                                </div>
                                ${savedShiftChoicesHTML(lateShiftChoices,{id:'lateSavedShiftChoice'})}
                                <textarea id="lateReason" placeholder="Explain what happened; the saved shift choice above is only a reference for Owner review." style="width: 100%; padding: 12px; border: 2px solid #cbd5e1; border-radius: 8px; margin-bottom: 15px; font-family: inherit; resize: none; outline: none; font-weight: bold; box-sizing: border-box;"></textarea>
                                <label style="font-size: 12px; font-weight: bold; color: #dc2626; display: block; margin-bottom: 5px; text-align: left;">Upload Screenshot Proof 📸 *</label>
                                <p id="lateProofKept" style="font-size:13px;color:#0f766e"></p>
                                <p style="font-size:13px;color:#64748b">Choose a JPG, PNG or WebP screenshot. The app reduces its size for slow connections.</p>
                                <input type="file" id="lateProof" accept="image/jpeg,image/png,image/webp" style="width: 100%; padding: 10px; border: 2px dashed #fca5a5; border-radius: 8px; box-sizing: border-box; background: #fef2f2; color: #b91c1c; font-weight: bold; outline: none;">
                            `,
                            showCancelButton: true,
                            confirmButtonText: 'Submit & Time In',
                            cancelButtonText: 'Cancel',
                            confirmButtonColor: '#ef4444',
                            cancelButtonColor: '#64748b',
                            allowOutsideClick: false,
                            customClass: { popup: 'rounded-2xl shadow-xl border border-red-100' },
                            didOpen: () => {
                                if (lateDraft) {document.getElementById('lateReason').value = lateDraft.reason;document.getElementById('lateProofKept').textContent = 'Selected screenshot kept: ' + (lateDraft.file.name || 'Screenshot') + '. Choose another image to replace it.';}
                                if(lateDraft?.staffShiftChoice&&lateShiftChoices.some(row=>row.key===lateDraft.staffShiftChoice.key&&row.sourceFingerprint===lateDraft.staffShiftChoice.sourceFingerprint)){const select=document.getElementById('lateSavedShiftChoice');if(select)select.value=lateDraft.staffShiftChoice.key;}
                            },
                            preConfirm: () => {
                                let reason = document.getElementById('lateReason').value.trim();
                                let file = document.getElementById('lateProof').files[0] || lateDraft?.file;
                                if (!reason || !file) {
                                    Swal.showValidationMessage("Both a reason and a screenshot proof are strictly required to time in.");
                                    return false;
                                }
                                try{return {reason,file,staffShiftChoice:selectedSavedShiftChoice(lateShiftChoices,document.getElementById('lateSavedShiftChoice')?.value||'')};}catch(error){Swal.showValidationMessage(error.message);return false;}
                            }
                        });

                        if (!isConfirmed) return; 

                        window.staffLateProofDraft = {staffId:punchStaffId, branch:closestBranch, reason:lateForm.reason, file:lateForm.file, staffShiftChoice:lateForm.staffShiftChoice, savedAt:Date.now()};
                        pendingStaffShiftChoice=lateForm.staffShiftChoice;
                        const uploadAccess=await window.authorizeAttendanceUpload({staffId:punchStaffId,attendanceId:attendanceRef.id,assertCurrent:assertPunchIdentity});
                        if(!uploadAccess)return;
                        const proof = await window.uploadAttendanceProof({
                            file:lateForm.file, path:uploadAccess.path,metadata:uploadAccess.metadata,
                            assertCurrent:()=>{
                                uploadAccess.assertCurrent();
                                if (localStorage.getItem('takodeal_staff_id') !== punchStaffId || localStorage.getItem('takodeal_staff_name') !== staffName) throw Error('Your staff session changed. Sign in again before uploading or recording attendance.');
                            }
                        });
                        const proofUrl = proof.url;

                        pendingLateRequest = {
                            attendanceLogId: attendanceRef.id,
                            staffId:punchStaffId,
                            lateMinutes,
                            type: "Reason Letter",
                            staffName: staffName,
                            branch: closestBranch,
                            status: "Pending",
                            explanationCause: "Tardiness / Late Arrival",
                            explanationMessage: `Clocked in ${lateMinutes} minutes late. Reason: ${lateForm.reason}`,
                            proofImageUrl: proofUrl,
                            timestamp: serverTimestamp()
                        };
                        
                        Swal.fire({title: 'Verifying location...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
                    }
                }
            } catch(e) {
                console.error("Late Checker Error:", e);
                throw e;
            }
        }

        if (type === 'TIME IN' && await window.checkActiveSanctions(staffName, {requireFresh:true})) {
            throw Error('Reply to your pending HR notice before recording Time In.');
        }

        // Proof uploads and HR checks can take minutes; check location and identity again.
        Swal.fire({title:'Rechecking your branch location…',text:'A recent verified location is reused while GPS keeps updating.',allowOutsideClick:false,didOpen:()=>Swal.showLoading()});
        const latestLocation = await window.getAttendanceLocation();
        if (latestLocation.branch !== closestBranch) throw Error('Your branch changed during verification. Please record attendance again.');
        if (localStorage.getItem('takodeal_staff_id') !== punchStaffId) throw Error('Your staff session changed. Sign in again before recording attendance.');
        punchLocation = latestLocation; minDistance = latestLocation.distance;

        // Check the exact photo being saved, after slow proof and HR requests.
        let faceResult = null;
        if (type === 'TIME IN') {
            if (typeof window.verifyAttendanceFace !== 'function') throw Error('The camera check is unavailable. Refresh while online before Time In.');
            // Finish remote roster checks before starting the photo's 15-second
            // validity window. Its current-time checks still run below.
            Swal.fire({title:'Confirming your saved shift…',text:'Checking the latest assigned hours before capturing your attendance photo.',allowOutsideClick:false,didOpen:()=>Swal.showLoading()});
            punchScheduleData = await readFreshPunchSchedule(new Date());
            assertPunchIdentity();
            Swal.fire({title:'Confirming your branch location…',text:'Checking the location saved with this attendance.',allowOutsideClick:false,didOpen:()=>Swal.showLoading()});
            const finalLocation = await window.getAttendanceLocation();
            if (finalLocation.branch !== closestBranch) throw Error('Your branch changed. Please record attendance again.');
            if (localStorage.getItem('takodeal_staff_id') !== punchStaffId || localStorage.getItem('takodeal_staff_name') !== staffName) throw Error('Your staff session changed. Sign in again.');
            punchLocation = finalLocation; minDistance = finalLocation.distance;
            Swal.fire({title:'Checking your current camera photo…',text:'Keep your face in the camera frame.',allowOutsideClick:false,didOpen:()=>Swal.showLoading()});
            faceResult = await window.verifyAttendanceFace();
            assertPunchIdentity();
            window.assertAttendanceFaceFresh(faceResult);
        }
        const assertClockCurrent=()=>{if(localStorage.getItem('takodeal_staff_id')!==punchStaffId || localStorage.getItem('takodeal_staff_name')!==staffName)throw Error('Your staff session changed. Sign in again.');};
        let earlyClockOut=null,timeOutResult=null;
        if(type==='TIME OUT'){
            earlyClockOut=await prepareEarlyTimeOut(window,{start:activeTimeIn,staffId:punchStaffId,staffName,assertCurrent:assertClockCurrent});
            if(!earlyClockOut.proceed)return;
            assertClockCurrent();if(Date.now()-punchLocation.timestamp>60000)throw Error('Location verification expired. Tap Time Out again to refresh your location.');
        }
        const photoBase64 = faceResult ? faceResult.photoBase64 : (window.captureOptionalAttendancePhoto?.() || '');

        Swal.fire({title: 'Preparing attendance…', text: 'Keep this screen open while the final checks finish.', allowOutsideClick: false, allowEscapeKey: false, showConfirmButton: false, didOpen: () => Swal.showLoading()});

        // 6. 💾 SAVE TO FIREBASE
        const attendance = {
            staffName, staffId: localStorage.getItem('takodeal_staff_id'), branch: closestBranch, type, timestamp: serverTimestamp(),
            sourceApp:'staff', recordedBy:staffName, recordedByStaffId:punchStaffId,
            recordedDeviceId:localStorage.getItem('takodeal_device_id') || '', createdAt:serverTimestamp(),
            locationLat: punchLocation.lat, locationLng: punchLocation.lng, distanceMeters: Math.round(minDistance),
            locationAccuracyMeters: Math.ceil(punchLocation.accuracy), locationCapturedAt: new Date(punchLocation.timestamp).toISOString(),
            photoBase64
        };
        if (type === 'TIME IN') {
            attendance.faceCheck = faceResult.faceCheck;
            // Recalculate with the current time and the freshly confirmed
            // roster. No remote history read may age this final camera photo.
            assertPunchIdentity();
            window.assertAttendanceFaceFresh(faceResult);
            const clockDate = new Date();
            attendance.scheduleSnapshot = captureAttendanceSchedule(clockDate, closestBranch, staffName, punchScheduleData, punchScheduleProfiles);
            assertAttendanceScheduleUnchanged(punchSchedulePreview,attendance.scheduleSnapshot);
            if(Date.now()-punchLocation.timestamp>60000)throw Error('Location verification expired while checking the schedule. No Time In was saved. Tap Time In again; your selected late-proof draft is kept.');
            const matched = resolveAttendanceShift({...attendance, timestamp:clockDate}, punchScheduleData, punchScheduleProfiles);
            if (!attendance.scheduleSnapshot.needsScheduleReview && attendance.scheduleSnapshot.wasScheduled===true && matched) attendance.lateMinutes = matched.lateMinutes;
            if(Number(attendance.lateMinutes)>3&&!pendingLateRequest)throw Error('The current Time In now needs a lateness explanation. No punch was saved. Tap Time In again to review the current time and provide your explanation.');
            if(!(Number(attendance.lateMinutes)>3))pendingLateRequest=null;
            if(pendingLateRequest&&pendingStaffShiftChoice)pendingLateRequest.staffShiftProposal=makeSavedShiftProposal(punchScheduleData,{start:{id:attendanceRef.id,type:'TIME IN',staffId:punchStaffId,staffName,branch:closestBranch,timestamp:clockDate},staffId:punchStaffId,staffName},pendingStaffShiftChoice);
            const emergencyRelief=emergencyReliefForClockIn(attendance.scheduleSnapshot,punchScheduleProfiles[staffName],closestBranch);
            if(emergencyRelief){attendance.emergencyRelief=emergencyRelief;attendance.lateMinutes=0;pendingLateRequest=null;}
            if(punchScheduleDeclaration){
                const declaration=revalidateClockInScheduleDeclaration(punchScheduleData,{staffId:punchStaffId,staffName,profile:punchScheduleProfiles[staffName],branch:closestBranch,at:clockDate,snapshot:attendance.scheduleSnapshot},punchScheduleDeclaration);
                attendance.scheduleDeclaration=declaration;
                attendance.scheduleDeclarationRequestId=lateRequestRef.id;
                pendingLateRequest=clockInDeclarationRequest({declaration,attendanceLogId:attendanceRef.id,lateRequest:pendingLateRequest,lateMinutes:attendance.lateMinutes??attendance.scheduleSnapshot.lateMinutes,timestamp:serverTimestamp()});
                if(!pendingLateRequest.staffShiftProposal){const proposal=clockInDeclarationSavedProposal(punchScheduleData,{start:{id:attendanceRef.id,type:'TIME IN',staffId:punchStaffId,staffName,branch:closestBranch,timestamp:clockDate},staffId:punchStaffId,staffName},declaration);if(proposal)pendingLateRequest.staffShiftProposal=proposal;}
            }
        }
        Swal.fire({title:'Saving attendance…',text:'Keep this screen open until HQ confirms your attendance.',allowOutsideClick:false,allowEscapeKey:false,showConfirmButton:false,didOpen:()=>Swal.showLoading()});
        if (type === 'TIME OUT') {
            timeOutResult=await earlyClockOut.service.close({start:activeTimeIn,staffId:punchStaffId,staffName,attendance,reliefForReview:earlyClockOut.reliefForReview===true,assertCurrent:assertClockCurrent});
            assertClockCurrent();
        } else {
        const batch = writeBatch(db);
        if (pendingLateRequest) {
            if (Number.isFinite(attendance.lateMinutes)) {
                pendingLateRequest.lateMinutes = attendance.lateMinutes;
                pendingLateRequest.explanationMessage = pendingLateRequest.explanationMessage.replace(/^Clocked in \d+ minutes late\./, `Clocked in ${attendance.lateMinutes} minutes late.`);
            }
            if(pendingLateRequest.type==='Reason Letter')attendance.lateReasonRequestId = lateRequestRef.id;
            batch.set(lateRequestRef, pendingLateRequest);
        }
        batch.set(attendanceRef, attendance);
        await batch.commit();
        }

        
        window.staffLateProofDraft = null;
        window.loadMyAttendance?.(true);
        if(type==='TIME IN')void window.refreshStaffOnboarding?.({force:true});
        Swal.fire('✅ Success', emergencyReliefTimeOutNotice(timeOutResult,closestBranch)||`${type} logged securely at ${closestBranch}!`, 'success');

    } catch(e) { 
        console.error(e); 
        Swal.fire(String(e.code||'').startsWith('attendance/location-')?'Location needs attention':'Attendance not saved', e.message || 'Check your connection and location, then try again.', 'warning');
    } 
    finally { 
        window.staffPunchBusy = false;
        if(btnIn) btnIn.disabled = false; 
        if(btnOut) btnOut.disabled = false; 
    }
};

// ==========================================
// 📥 STAFF REQUESTS & INBOX ENGINE
// ==========================================
window.openReqForm = function(type) {
    if (type === 'Inbox') { document.getElementById('inboxModal').style.display = 'flex'; return window.loadInbox(); }
    if (type === 'Loans') return window.loadMyLoanLedger();
    
    let formHtml = ''; window.currentReqType = type;
    document.getElementById('reqModalTitle').innerText = type + " Request";

    if (type === 'Leave') {
        const today=leaveToday();
        formHtml = `<p class="leave-note">Management confirms leave before it changes your saved schedule. Choose today or future dates.</p>
            <div class="form-group"><label>Leave type</label><select id="reqLeaveType"><option>Leave</option><option>Vacation Leave</option><option>Sick Leave</option><option>Emergency Leave</option></select></div>
            <div class="form-group"><label>Start date</label><input type="date" id="reqStart" min="${today}" required></div>
            <div class="form-group"><label>End date</label><input type="date" id="reqEnd" min="${today}" required></div>
            <div class="form-group"><label>Reason</label><textarea id="reqReason" rows="3" maxlength="1500" required></textarea></div>`;
    } else if (type === 'Cash Advance') {
        formHtml = `<div class="form-group"><label>Amount (₱)</label><input type="number" id="reqAmount" placeholder="0.00"></div>
            <div class="form-group"><label>Reason / Purpose</label><textarea id="reqReason" rows="2"></textarea></div>`;
    } else if (type === 'Staff Meal') {
        // 🔥 THE NEW DUAL-VERIFICATION UI 🔥
        formHtml = `<div style="margin-bottom: 15px;">
                <p style="font-size: 12px; color: #64748b; margin-bottom: 10px;">To authorize your payroll deduction, please enter the exact POS Receipt OR# generated when you punched your meal.</p>
            </div>
            <div class="form-group">
                <label>POS Receipt OR#</label>
                <input type="text" id="reqMealReceiptCode" placeholder="e.g. 20260917-0001-XYZ" style="text-align: center; letter-spacing: 1px; font-weight: bold; font-family: monospace; font-size: 15px; border: 2px dashed #f59e0b; background: #fffbeb; color: #d97706; text-transform: uppercase;">
            </div>`;
    }
    
    document.getElementById('reqModalBody').innerHTML = formHtml;
    document.getElementById('requestModal').style.display = 'flex';
};

window.submitStaffRequest = async function() {
    if(window.currentReqType==='Leave')return window.getStaffLeaveUI().submitFromForm();
    const requestStaffId=localStorage.getItem('takodeal_staff_id'),requestStaffName=localStorage.getItem('takodeal_staff_name'),requestType=window.currentReqType,requestUser=staffPrimaryAuth.currentUser;
    let payload = { type: requestType, staffId:requestStaffId, staffName: requestStaffName, status: "Pending", staffAcknowledged: false, timestamp: window.serverTimestamp() };
    let fileToUpload = null;

    if (payload.type === 'Cash Advance') {
        payload.amount = parseFloat(document.getElementById('reqAmount').value); 
        payload.reason = document.getElementById('reqReason') ? document.getElementById('reqReason').value.trim() : '';
        if (!payload.amount || !payload.reason) return Swal.fire('Incomplete', 'Fill all required fields.', 'warning');
    } else if (payload.type === 'Staff Meal') {
        
        // 🔥 THE NEW RECEIPT VERIFIER 🔥
        let receiptCode = document.getElementById('reqMealReceiptCode') ? document.getElementById('reqMealReceiptCode').value.trim().toUpperCase() : '';
        
        if (!receiptCode) {
            return Swal.fire('Required', '❌ Please enter the exact Receipt OR# from the POS.', 'warning');
        }
        
        payload.item = "Meal Verification OR#: " + receiptCode; 
        payload.receiptId = receiptCode; // Links this securely to the Cashier App transaction!
        payload.amount = 0; // The Manager App will pull the real amount automatically!
    }

    // 🛡️ THE BULLETPROOF FIX: Deep clean undefined values before sending to Firebase!
    let cleanPayload = {};
    for (let key in payload) {
        if (payload[key] !== undefined) {
            cleanPayload[key] = payload[key];
        }
    }

    let btn = document.getElementById('btnSubmitReq');
    btn.innerText = fileToUpload ? "⏳ Uploading Photo..." : "⏳ Sending..."; btn.disabled = true;
    const requestModal=document.getElementById('requestModal'),formValues=()=>JSON.stringify(['reqAmount','reqReason','reqMealReceiptCode'].map(id=>document.getElementById(id)?.value??null)),requestForm=formValues();
    let requestDispatched=false;
    const requestProblem=message=>Object.assign(Error(message),{staffRequestSafe:true});
    const assertRequestCurrent=()=>{if(localStorage.getItem('takodeal_staff_id')!==requestStaffId||localStorage.getItem('takodeal_staff_name')!==requestStaffName||window.currentReqType!==requestType||staffPrimaryAuth.currentUser!==requestUser||document.getElementById('requestModal')!==requestModal||requestModal?.style.display==='none'||formValues()!==requestForm)throw requestProblem(requestDispatched?'Your Staff account or request changed after sending. Check the original account’s inbox before sending it again.':'Your Staff account or request changed. Reopen the request; nothing was sent.');};

    try {
        assertRequestCurrent();
        if(typeof requestStaffId!=='string'||!requestStaffId||requestStaffId.length>128||requestStaffId.includes('/'))throw requestProblem('Sign in to your Staff account again before sending this request.');
        if(payload.type==='Cash Advance'){
            let profileTimer;const profile=await Promise.race([getDocFromServer(doc(db,'cashiers',requestStaffId)),new Promise((_,reject)=>{profileTimer=setTimeout(()=>reject(requestProblem('HQ did not confirm your current Staff profile in time. Nothing was sent; reconnect and try again.')),20000);})]).finally(()=>clearTimeout(profileTimer));assertRequestCurrent();
            const person=profile.exists()?profile.data():null;
            if(profile.metadata?.fromCache===true||profile.metadata?.hasPendingWrites===true||!person||!activeStaffProfile(person)||typeof person.cashierName!=='string'||!person.cashierName.trim()||typeof person.branch!=='string'||!person.branch.trim())throw requestProblem('Your current Staff name and home branch could not be confirmed. Reconnect or ask HQ to review the profile; no request was sent.');
            cleanPayload.staffName=person.cashierName;cleanPayload.branch=person.branch;
        }
        if (fileToUpload) {
            const fileName = `staff_requests/meal_${cleanPayload.staffName.replace(/\s+/g, '_')}_${Date.now()}.${fileToUpload.name.split('.').pop()}`;
            const snapshot = await uploadBytes(ref(storage, fileName), fileToUpload);
            cleanPayload.proofImageUrl = await getDownloadURL(snapshot.ref);
        }
        
        assertRequestCurrent();
        requestDispatched=true;
        await window.addDoc(window.collection(window.db, "staff_requests"), cleanPayload);
        assertRequestCurrent();
        
        Swal.fire({toast: true, position: 'top-end', icon: 'success', title: 'Submitted to HQ!', showConfirmButton: false, timer: 2000});
        document.getElementById('requestModal').style.display = 'none';
        
    } catch(e) { 
        console.error(e); 
        if(localStorage.getItem('takodeal_staff_id')===requestStaffId&&localStorage.getItem('takodeal_staff_name')===requestStaffName)Swal.fire('Request not confirmed', e.staffRequestSafe?e.message:requestDispatched?'The request could not be confirmed with HQ. Check your inbox before sending it again.':'HQ could not confirm your current request details. Nothing was sent; reconnect and try again.', 'warning');
    } finally { 
        btn.innerText = "🚀 Submit to HQ"; btn.disabled = false; 
    }
};

window.playNotificationPing = function() {
    try {
        let audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        let osc = audioCtx.createOscillator(); let gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'sine'; osc.frequency.setValueAtTime(1318.51, audioCtx.currentTime);
        gain.gain.setValueAtTime(1, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
        osc.start(audioCtx.currentTime); osc.stop(audioCtx.currentTime + 0.5);
    } catch(e){}
};

window.startInboxListener = function() {
    let staffName = localStorage.getItem('takodeal_staff_name');
    const staffId = localStorage.getItem('takodeal_staff_id');
    if (!staffName || !staffId) return window.stopStaffLiveListeners();
    const key = staffId + '|' + staffName, epoch = window.staffLiveListenerEpoch;
    if (window.staffInboxListenerKey === key && window.staffInboxUnsubscribe) return;
    if (window.staffInboxUnsubscribe) window.staffInboxUnsubscribe();
    window.staffInboxListenerKey = key;
    window.lastUnreadCount = undefined;
    const current = () => epoch === window.staffLiveListenerEpoch && window.staffInboxListenerKey === key && localStorage.getItem('takodeal_staff_id') === staffId && localStorage.getItem('takodeal_staff_name') === staffName;

    // 🔥 OPTIMIZED QUERY: Only fetch requests that have NOT been acknowledged yet!
    const inboxQ = window.query(
        window.collection(window.db, "staff_requests"), 
        window.where("staffName", "==", staffName),
        window.where("staffAcknowledged", "==", false)
    );

    window.staffInboxUnsubscribe = window.onSnapshot(inboxQ, (snapshot) => {
        if (!current()) return;
        let unreadCount = 0;
        snapshot.forEach(doc => { 
            let d = doc.data(); 
            // We still check the status because "Pending" requests are also unacknowledged, 
            // but we only want to badge them when the Manager has Approved/Rejected them!
            if (d.status === 'Approved' || d.status === 'Rejected') {
                unreadCount++; 
            }
        });
        let badge = document.getElementById('navReqBadge');
        if (badge) {
            if (unreadCount > 0) {
                badge.style.display = 'block'; badge.innerText = unreadCount;
                if (window.lastUnreadCount !== undefined && unreadCount > window.lastUnreadCount) window.playNotificationPing();
                window.lastUnreadCount = unreadCount;
            } else { badge.style.display = 'none'; window.lastUnreadCount = 0; }
        }
    }, error => {
        if (!current()) return;
        window.staffInboxUnsubscribe = null; window.staffInboxListenerKey = null;
        console.error('Staff inbox listener:', error);
    });
};

// ==========================================
// 📥 STAFF INBOX (WITH DETAILED EXTRACTOR)
// ==========================================
window.loadInbox = async function() {
    const inboxStaffId=localStorage.getItem('takodeal_staff_id'),inboxStaffName=localStorage.getItem('takodeal_staff_name');
    const inboxRoot=document.getElementById('reqInboxList');
    let listEl=document.getElementById('requestInboxPanel');
    if(!listEl){listEl=document.createElement('div');listEl.id='requestInboxPanel';inboxRoot.append(listEl);}
    listEl.innerHTML = '<div style="text-align:center; padding:20px; color:#94a3b8;">Loading...</div>';

    try {
        const [snap,leaveRows] = await Promise.all([
            getDocs(query(collection(db, "staff_requests"), where("staffName", "==", localStorage.getItem('takodeal_staff_name')))),
            window.getStaffLeaveUI().list()
        ]);
        if(localStorage.getItem('takodeal_staff_id')!==inboxStaffId||localStorage.getItem('takodeal_staff_name')!==inboxStaffName)return;
        let docsArray = [...leaveRows]; snap.forEach(docSnap => {const row=docSnap.data();if(row.type!=='Leave'&&row.type!=='Leave Change')docsArray.push({...row,id:docSnap.id});});
        const requestMillis=row=>{const value=row.timestamp?.toDate?.()||row.timestamp;const at=new Date(value);return Number.isFinite(+at)?+at:0;};
        docsArray.sort((a,b) => requestMillis(b)-requestMillis(a));

        let html = '';
        docsArray.forEach(d => {
            let color = d.status === 'Approved' ? '#16a34a' : (d.status === 'Rejected' ? '#dc2626' : '#d97706');
            let bg = d.status === 'Approved' ? '#dcfce7' : (d.status === 'Rejected' ? '#fef2f2' : '#fffbeb');
            
            let replyHtml = d.managerReply ? `<div style="margin-top: 8px; padding: 8px; background: #f8fafc; border-left: 3px solid ${color}; border-radius: 4px; font-size: 12px; color: #475569;"><b>HQ Reply:</b> ${d.managerReply}</div>` : '';
            let proofHtml = d.proofImageUrl ? `<div style="margin-top: 8px; font-size: 11px;"><a href="${d.proofImageUrl}" target="_blank" style="color:#0ea5e9; text-decoration:none; font-weight:bold;">📸 View Receipt Attached</a></div>` : '';

            // 🔥 THE FIX: EXPLICITLY EXTRACT THE REQUEST DETAILS!
            let detailText = "";
            if (d.type === "Leave" || d.type === "Leave Change") detailText = window.getStaffLeaveUI().details(d)+window.getStaffLeaveUI().actions(d);
            else if (d.type === "Cash Advance") detailText = `💸 ₱${(parseFloat(d.amount)||0).toFixed(2)}<br><span style="color:#64748b; font-size:12px;">Reason: ${d.reason}</span>`;
            else if (String(d.type||'').includes("Staff Meal") || String(d.type||'').includes("Manager Meal")) {
                let ackBtn = !d.staffAcknowledged 
                    ? `<button onclick="window.acknowledgeMeal('${d.id}')" style="margin-top:8px; background:#10b981; color:white; padding:8px 12px; border-radius:6px; font-weight:bold; border:none; width:100%; box-shadow:0 2px 4px rgba(0,0,0,0.2); cursor:pointer;">👍 I Confirm this POS Meal</button>` 
                    : `<div style="margin-top:8px; color:#16a34a; font-size:11px; font-weight:bold;">✅ You confirmed this meal.</div>`;
                detailText = `🍔 ${d.item} <br><span style="color:#dc2626; font-weight:bold;">Deduction: ₱${(parseFloat(d.amount)||0).toFixed(2)}</span>${ackBtn}`;
            }
            else if (d.type === "Early Time Out") detailText = timeOutRequestDetailsHTML(d);
            else if (d.type === "Reason Letter") detailText = `✉️ ${d.explanationCause || 'Letter'}<br><span style="color:#64748b; font-size:12px;">${d.explanationMessage || ''}</span>`;
            else if (d.type === "Waste Report") detailText = `🗑️ Waste Log (₱${(parseFloat(d.totalValueLost)||0).toFixed(2)})<br><span style="color:#64748b; font-size:12px;">${(d.items || []).length} items submitted</span>`;
            else detailText = d.reason || d.item || "";

            html += `
                <div class="req-item-card" style="border-left: 4px solid ${color}; margin-bottom: 15px; padding: 15px; background: white; border-radius: 8px; border-top: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; box-shadow: 0 2px 4px rgba(0,0,0,0.03);">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                        <strong style="color:#0f172a; font-size:15px;">${d.type === 'Early Time Out' ? timeOutRequestLabel(d) : d.type}</strong>
                        <span style="background:${bg}; color:${color}; font-weight:bold; font-size:11px; padding:4px 8px; border-radius:6px; height: fit-content;">${d.status}</span>
                    </div>
                    <div style="font-size:13px; color:#334155; margin-bottom: 10px; font-weight: 500; line-height: 1.4;">
                        ${detailText}
                    </div>
                    <div style="font-size:11px; color:#94a3b8;">Submitted: ${requestMillis(d)?new Date(requestMillis(d)).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'})+' (PH)':'Time not recorded'}</div>
                    ${proofHtml}${replyHtml}
                </div>
            `;
            if ((d.status === 'Approved' || d.status === 'Rejected') && !d.staffAcknowledged) updateDoc(doc(db, "staff_requests", d.id), { staffAcknowledged: true });
        });
        listEl.innerHTML = html || '<div style="color:#64748b; font-size:13px; text-align:center;">No requests found.</div>';
    } catch(e) { if(localStorage.getItem('takodeal_staff_id')!==inboxStaffId||localStorage.getItem('takodeal_staff_name')!==inboxStaffName)return;listEl.textContent = e.message || 'Connect to HQ and refresh your inbox.'; }
};

// ==========================================
// 📋 DYNAMIC MULTI-BRANCH SOP ENGINE
// ==========================================
window.currentSopRoles = {};

// Hook into view navigation
const originalSwitchView = window.switchView;
window.switchView = function(viewId, btnElement) {
    if (typeof originalSwitchView === 'function') originalSwitchView(viewId, btnElement);

    if (viewId === 'sop') {
        window.initSopModule();
    }
};

window.initSopModule = async function() {
    const branchSelect = document.getElementById('sopBranchSelect'), gpsBadge = document.getElementById('sopGpsBadge');
    const staffName = localStorage.getItem('takodeal_staff_name'), staffId = localStorage.getItem('takodeal_staff_id');
    const epoch = window.sopShiftEpoch = (window.sopShiftEpoch || 0) + 1;
    if (gpsBadge) { gpsBadge.innerText = 'Syncing with your active shift…'; gpsBadge.style.background = '#fffbeb'; gpsBadge.style.color = '#d97706'; }
    try {
        const logs = await readStaffRecords(window,staffId,staffName,{metadataOnly:true,assertCurrent:()=>{if(window.sopShiftEpoch!==epoch||localStorage.getItem('takodeal_staff_id')!==staffId||localStorage.getItem('takodeal_staff_name')!==staffName)throw Error('Your staff session changed.');}});
        if (window.sopShiftEpoch !== epoch || localStorage.getItem('takodeal_staff_id') !== staffId || localStorage.getItem('takodeal_staff_name') !== staffName) return;
        const latest = latestAttendance(logs,staffId,staffName);
        const active = attendanceKind(latest) === 'TIME IN' ? latest : null;
        const targetBranch = active?.branch || window.getClosestBranch();
        if (!targetBranch) throw Error('Your shift branch could not be confirmed. Check your location or ask HQ to review attendance.');
        window.sopActiveTimeIn = active;
        if (branchSelect) { branchSelect.value = targetBranch; branchSelect.disabled = !!active; }
        if (gpsBadge) { gpsBadge.innerText = 'Shift location: ' + targetBranch; gpsBadge.style.background = '#dcfce7'; gpsBadge.style.color = '#16a34a'; }
        await window.onSopBranchChange();
    } catch(error) {
        if (window.sopShiftEpoch !== epoch || localStorage.getItem('takodeal_staff_id') !== staffId) return;
        window.sopActiveTimeIn = null;
        if (branchSelect) { branchSelect.value = ''; branchSelect.disabled = false; }
        if (gpsBadge) { gpsBadge.innerText = error.message || 'Refresh to confirm your shift branch.'; gpsBadge.style.background = '#fffbeb'; gpsBadge.style.color = '#b45309'; }
        document.getElementById('sopTasksContainer').style.display = 'none';
        document.getElementById('sopEmptyState').style.display = 'block';
    }
};

window.onSopBranchChange = async function() {
    let branch = document.getElementById('sopBranchSelect').value;
    let roleSelect = document.getElementById('sopRoleSelect');
    
    document.getElementById('sopTasksContainer').style.display = 'none';
    document.getElementById('sopEmptyState').style.display = 'block';
    
    if (!branch) return;
    
    roleSelect.innerHTML = '<option value="">⏳ Loading roles...</option>';

    try {
        // Pull exact roles configured in Manager App for this branch
        const docSnap = await getDoc(doc(db, "settings", "sop_" + branch));
        window.currentSopRoles = docSnap.exists() ? (docSnap.data().roles || {}) : {};

        let roleKeys = Object.keys(window.currentSopRoles);
        let html = '<option value="">-- Select Role / Shift --</option>';

        if (roleKeys.length === 0) {
            html = '<option value="">No roles configured for this branch</option>';
        } else {
            roleKeys.forEach(role => {
                html += `<option value="${role}">${role}</option>`;
            });
        }
        roleSelect.innerHTML = html;

    } catch (e) {
        console.error("SOP Fetch Error:", e);
        roleSelect.innerHTML = '<option value="">Error loading tasks</option>';
    }
};

window.renderSopTasks = function() {
    let roleName = document.getElementById('sopRoleSelect').value;
    let branch = document.getElementById('sopBranchSelect').value;
    let container = document.getElementById('sopTasksContainer');
    let emptyState = document.getElementById('sopEmptyState');
    let list = document.getElementById('sopTaskList');

    if (!roleName || !window.currentSopRoles[roleName]) {
        container.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    let tasks = window.currentSopRoles[roleName] || [];
    document.getElementById('sopTitleHeader').innerText = `Tasks for ${roleName}`;
    
    // 🔥 THE MEMORY ENGINE: Check if they started this checklist earlier today!
    let draftKey = `takodeal_sop_draft_${branch}_${roleName}`;
    let savedDraft = [];
    try { savedDraft = JSON.parse(localStorage.getItem(draftKey)) || []; } catch(e){}

    let html = '';
    tasks.forEach((taskText, index) => {
        // Retrieve memory states
        let isChecked = savedDraft[index] ? savedDraft[index].checked : false;
        let savedRemark = savedDraft[index] ? savedDraft[index].remark : "";

        // Notice the new oninput="window.updateSopProgress()" attached to the text box!
        html += `
            <div class="sop-task-item" style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; transition: 0.2s;">
                <label style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer; margin: 0;">
                    <input type="checkbox" class="sop-chk" data-index="${index}" onchange="window.updateSopProgress()" ${isChecked ? 'checked' : ''} style="width: 20px; height: 20px; margin-top: 2px; accent-color: #0f766e; cursor: pointer;">
                    <div style="flex: 1;">
                        <span style="font-size: 14px; font-weight: bold; color: #0f172a; line-height: 1.4; display: block;">${taskText}</span>
                        <input type="text" class="sop-remark" placeholder="Optional remark/note if skipped or issue found..." value="${savedRemark}" oninput="window.updateSopProgress()" style="width: 100%; padding: 6px 10px; margin-top: 8px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 12px; outline: none; box-sizing: border-box;">
                    </div>
                </label>
            </div>
        `;
    });

    list.innerHTML = html || '<div style="color:#64748b; font-style:italic;">No tasks defined for this role.</div>';
    emptyState.style.display = 'none';
    container.style.display = 'block';
    
    window.updateSopProgress();
};

window.updateSopProgress = function() {
    let allChecks = document.querySelectorAll('.sop-chk');
    let checkedCount = document.querySelectorAll('.sop-chk:checked').length;
    let total = allChecks.length;

    let badge = document.getElementById('sopProgressBadge');
    if (badge) {
        badge.innerText = `${checkedCount}/${total} Done`;
        if (checkedCount === total && total > 0) {
            badge.style.background = "#dcfce7";
            badge.style.color = "#16a34a";
        } else {
            badge.style.background = "#e0f2fe";
            badge.style.color = "#0284c7";
        }
    }

    // 🔥 THE MEMORY ENGINE: Auto-save the state to LocalStorage every time they type or click!
    let branch = document.getElementById('sopBranchSelect').value;
    let roleName = document.getElementById('sopRoleSelect').value;
    
    if (branch && roleName && total > 0) {
        let draftKey = `takodeal_sop_draft_${branch}_${roleName}`;
        let draftData = [];
        document.querySelectorAll('.sop-task-item').forEach(item => {
            draftData.push({
                checked: item.querySelector('.sop-chk').checked,
                remark: item.querySelector('.sop-remark').value
            });
        });
        localStorage.setItem(draftKey, JSON.stringify(draftData));
    }
};

window.submitSopChecklist = async function() {
    let branch = document.getElementById('sopBranchSelect').value;
    let roleName = document.getElementById('sopRoleSelect').value;
    let staffName = localStorage.getItem('takodeal_staff_name') || 'Staff';
    const staffId = localStorage.getItem('takodeal_staff_id');
    if (!staffId) return Swal.fire('Sign in required', 'Sign in to your staff account before submitting SOP.', 'warning');

    if (!roleName) return Swal.fire('Required', 'Please select your role first.', 'warning');

    let taskItems = document.querySelectorAll('.sop-task-item');
    if (taskItems.length === 0) return Swal.fire('Empty', 'No tasks to submit.', 'warning');

    let completedTasks = [];
    let doneCount = 0;

    taskItems.forEach(item => {
        let taskText = item.querySelector('span').innerText;
        let isChecked = item.querySelector('.sop-chk').checked;
        let remark = item.querySelector('.sop-remark').value.trim();

        if (isChecked) doneCount++;

        completedTasks.push({
            task: taskText,
            status: isChecked ? 'done' : 'skipped',
            remark: remark
        });
    });

    let scorePercentage = Math.round((doneCount / taskItems.length) * 100);

    let btn = document.getElementById('btnSubmitSop');
    btn.innerText = "⏳ Submitting to HQ..."; btn.disabled = true;

    try {
        const latest = latestAttendance(await readStaffRecords(window,staffId,staffName,{metadataOnly:true,assertCurrent:()=>{if(localStorage.getItem('takodeal_staff_id')!==staffId||localStorage.getItem('takodeal_staff_name')!==staffName)throw Error('Your staff session changed.');}}),staffId,staffName);
        const active = attendanceKind(latest) === 'TIME IN' ? latest : null;
        if (localStorage.getItem('takodeal_staff_id') !== staffId || localStorage.getItem('takodeal_staff_name') !== staffName) throw Error('Your staff session changed. Sign in again.');
        if (active && active.branch !== branch) throw Error('Submit SOP for your active shift at ' + (active.branch || 'the branch confirmed by HQ') + '.');
        await addDoc(collection(db, "sop_logs"), {
            branch: branch,
            staffName: staffName,
            staffId,
            ...(active ? {timeInLogId:active.id,shiftStartedAt:new Date(attendanceMillis(active.timestamp)).toISOString()} : {}),
            roleName: roleName,
            scorePercentage: scorePercentage,
            tasks: completedTasks,
            timestamp: serverTimestamp()
        });

        // 🔥 THE MEMORY ENGINE: Wipe the memory clean only AFTER successful submission!
        localStorage.removeItem(`takodeal_sop_draft_${branch}_${roleName}`);

        Swal.fire({
            title: '✅ SOP Submitted!',
            text: `Compliance Score: ${scorePercentage}%. Your report has been logged to HQ.`,
            icon: 'success',
            confirmButtonColor: '#0f766e',
            customClass: { popup: 'rounded-2xl' }
        });

        // Reset check selections visually
        document.querySelectorAll('.sop-chk').forEach(c => c.checked = false);
        document.querySelectorAll('.sop-remark').forEach(r => r.value = '');
        window.updateSopProgress();

    } catch (e) {
        console.error("SOP Submit Error:", e);
        Swal.fire('SOP not saved', e.message || 'Failed to submit checklist. Check connection.', 'warning');
    } finally {
        btn.innerText = "🚀 Submit Completed Checklist"; btn.disabled = false;
    }
};

// ==========================================
// 💸 PAYSLIP VAULT & LIVE ESTIMATOR ENGINE
// ==========================================
window.switchPayslipTab = function(tabName) {
    let liveBtn = document.getElementById('btnTabLivePay');
    let pendingBtn = document.getElementById('btnTabPendingPay');
    let pastBtn = document.getElementById('btnTabPastPay');
    
    [liveBtn, pendingBtn, pastBtn].forEach(b => {
        b.style.background = 'transparent'; b.style.color = '#64748b';
    });
    
    document.getElementById('payslipLiveSection').style.display = 'none';
    document.getElementById('payslipPendingSection').style.display = 'none';
    document.getElementById('payslipPastSection').style.display = 'none';

    if (tabName === 'Live') {
        liveBtn.style.background = '#0f766e'; liveBtn.style.color = 'white';
        document.getElementById('payslipLiveSection').style.display = 'block';
    } else if (tabName === 'Pending') {
        pendingBtn.style.background = '#0f172a'; pendingBtn.style.color = 'white';
        document.getElementById('payslipPendingSection').style.display = 'block';
    } else {
        pastBtn.style.background = '#0f172a'; pastBtn.style.color = 'white';
        document.getElementById('payslipPastSection').style.display = 'block';
    }
};

window.loadPayslipVault = async function() {
    let staffName = localStorage.getItem('takodeal_staff_name');
    let staffId = localStorage.getItem('takodeal_staff_id');
    if (!staffName || !staffId || !window.staffVaultSession?.allows(staffId)) return;
    const vaultEpoch = window.staffVaultSession.epoch;
    const stillOpen = () => window.staffVaultSession.allows(staffId, vaultEpoch) && localStorage.getItem('takodeal_staff_id') === staffId;
    const savedViews=installStaffSavedPayslipViews(window,document);savedViews.restoreLive();
    let savedPayslips={paid:[],shared:[],held:[],errors:[]};
    const renderSaved=(processingHTML='',processingCount=0)=>{if(stillOpen())savedViews.render(savedPayslips,{staffId,epoch:vaultEpoch,start:startDateStr,end:endDateStr,processingHTML,processingCount});};

    const safeDate = (fbDate) => {
        if (!fbDate) return new Date();
        if (fbDate.toDate) return fbDate.toDate();
        let d = new Date(fbDate);
        return isNaN(d.getTime()) ? new Date() : d;
    };

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    let startDateStr, endDateStr, prevStartStr, prevEndStr; 

    if (today.getDate() <= 15) {
        startDateStr = `${yyyy}-${mm}-01`;
        endDateStr = `${yyyy}-${mm}-15`;
        let prevMonth = today.getMonth(); 
        let prevYyyy = yyyy;
        if (prevMonth === 0) { prevMonth = 12; prevYyyy--; }
        let prevMmStr = String(prevMonth).padStart(2, '0');
        let lastDayOfPrevMonth = new Date(prevYyyy, prevMonth, 0).getDate();
        prevStartStr = `${prevYyyy}-${prevMmStr}-16`;
        prevEndStr = `${prevYyyy}-${prevMmStr}-${lastDayOfPrevMonth}`;
    } else {
        startDateStr = `${yyyy}-${mm}-16`;
        let lastDay = new Date(yyyy, today.getMonth() + 1, 0).getDate();
        endDateStr = `${yyyy}-${mm}-${String(lastDay).padStart(2, '0')}`;
        prevStartStr = `${yyyy}-${mm}-01`;
        prevEndStr = `${yyyy}-${mm}-15`;
    }

    document.getElementById('liveCutoffDates').innerText = `Cutoff Period: ${startDateStr} to ${endDateStr}`;

    try {
        let staffProfile={staffId,cashierName:staffName},salaryHistoryUnavailable=false;
        try {
            const staffRef = await window.readPrivateStaffProfile(staffId,{assertCurrent:()=>{if(!stillOpen())throw Error('The private Pay view changed.');}});
            if(!staffRef.exists()||staffRef.metadata?.fromCache||staffRef.metadata?.hasPendingWrites)throw Error('Salary profile is not confirmed.');
            staffProfile={...staffRef.data(),staffId};
        } catch {salaryHistoryUnavailable=true;}
        if (!stillOpen()) return;
        if(staffProfile.salaryRateVersion===1){try{staffProfile=await window.loadPrivateStaffSalaryProfile(staffProfile);}catch{salaryHistoryUnavailable=true;}}
        if(!stillOpen())return;
        savedPayslips=await readStaffSavedPayslips(window,{staffId,staffName,profile:staffProfile,createVault:()=>createStaffDocumentFirebase(firebaseConfig,()=>localStorage.getItem('takodeal_staff_id')),assertCurrent:()=>{if(!stillOpen())throw Error('The Payslip Vault closed or changed. Reopen Pay.');}});
        if(!stillOpen())return;renderSaved();
        let dailyRate = salaryHistoryUnavailable?0:staffRateForDate(staffProfile) ?? 0;
        let ratePerHour = dailyRate / 8;
        let nickname = staffProfile.scheduleNickname || staffName;
        
        let baseNameLower = staffName.toLowerCase().trim();
        let nickNameLower = nickname.toLowerCase().trim();
        let strippedNameLower = baseNameLower.replace(/,?\s*(jr\.?|sr\.?|i|ii|iii|iv)\b/gi, '').trim();

        const isMatch = (dbName) => {
            if (!dbName) return false;
            let n = String(dbName).toLowerCase().trim();
            return n === baseNameLower || n === nickNameLower || n === strippedNameLower;
        };

        let scheduleData = await createPayrollBonusHistoryStore(window).loadRange(prevStartStr, endDateStr);
        if (!stillOpen()) return;
        let holidaysObj = scheduleData ? (scheduleData.holidays || {}) : {};

        const parseTimeStr = (timeStr) => {
            let t = timeStr.toLowerCase().replace(/\s/g, '');
            let isPM = t.includes('pm'); let isNN = t.includes('nn');
            let parts = t.replace(/(am|pm|nn)/, '').split(':');
            let hour = parseInt(parts[0]) || 0; let minute = parts.length > 1 ? parseInt(parts[1]) : 0;
            if ((isPM || isNN) && hour < 12) hour += 12;
            if (t.includes('am') && hour === 12) hour = 0;
            return hour + (minute / 60);
        };

        let fetchStart = new Date(prevStartStr + 'T00:00:00');
        if(typeof window.readStaffPayrollAttendance!=='function')throw Error('Payroll attendance is not ready. Reopen Pay and reconnect.');
        const attendanceSource = await window.readStaffPayrollAttendance({staffId,names:[staffName,nickname],assertCurrent:()=>{if(!stillOpen())throw Error('This Pay view closed or changed. Reopen Pay.');}});
        const attendanceRecords = new Map();
        attendanceSource.forEach(row=>{const data=row.data();if(data.staffId?data.staffId===staffId:isMatch(data.staffName))attendanceRecords.set(row.id,{...data,id:row.id});});
        const attSnap = {forEach:fn=>attendanceRecords.forEach(log=>fn({id:log.id,data:()=>log}))};
        if (!stillOpen()) return;
        scheduleData=await loadStaffPayrollShiftConfirmations(window,{scheduleData,staffId,profile:staffProfile,attendanceRecords:[...attendanceRecords.values()],start:prevStartStr,end:endDateStr,assertCurrent:()=>{if(!stillOpen())throw Error('This Pay view closed or changed. Reopen Pay.');}});
        if(!stillOpen())return;
        
        const financialInputs=await window.readPrivatePayrollInputs({staffId,assertCurrent:()=>{if(!stillOpen())throw Error('The private Pay view changed.');}});
        if(financialInputs.complete!==true)throw Error('Your private payroll inputs are incomplete. Ask HQ to review saved records.');
        const privateSnapshot=rows=>({docs:rows.map(row=>({id:row.id,data:()=>row})),forEach:fn=>rows.forEach(row=>fn({id:row.id,data:()=>row}))});
        const bonusSnap=privateSnapshot(financialInputs.staffBonuses);
        if (!stillOpen()) return;
        const payrollAdjustmentHistory=await readStaffPayrollAdjustments({readPrivatePayrollInputs:async()=>financialInputs},{staffId,stillCurrent:stillOpen});
        if (!stillOpen()) return;
        const adjustmentIdentity={staffId,name:staffProfile.cashierName||staffProfile.fullName||staffName,branch:staffProfile.branch};
        const currentAdjustments=staffPayrollAdjustmentEstimate(payrollAdjustmentHistory,{...adjustmentIdentity,start:startDateStr,end:endDateStr});
        const previousAdjustments=staffPayrollAdjustmentEstimate(payrollAdjustmentHistory,{...adjustmentIdentity,start:prevStartStr,end:prevEndStr});

        const analyzeCutoff = (startT, endT) => {
            if(salaryHistoryUnavailable)return {shiftsWorked:0,basicPay:0,totalLatePenalty:0,totalBonuses:0,shiftPairs:[],scheduleReviews:0,amendmentReviews:0,attendanceHeld:true,salaryHistoryUnavailable:true};
            let fLogs = [];
            let bufferEnd = new Date(endT);
            bufferEnd.setHours(bufferEnd.getHours() + 18);

            attSnap.forEach(docSnap => {
                let log = docSnap.data();
                if (log.timestamp && (log.staffId ? log.staffId===staffId : isMatch(log.staffName))) {
                    let t = safeDate(log.timestamp);
                    let logType = typeof log.type === 'string' ? log.type.toUpperCase() : "UNKNOWN";
                    
                    if (t >= startT) {
                        if (logType === "TIME IN") {
                            if (t <= endT) fLogs.push(log);
                        } else {
                            if (t <= bufferEnd) fLogs.push(log);
                        }
                    }
                }
            });
            fLogs.sort((a, b) => safeDate(a.timestamp).getTime() - safeDate(b.timestamp).getTime());
            const payrollPlan=planPayrollAttendance(fLogs,{resolveName:()=>staffProfile.cashierName||staffName,resolveShift:log=>resolveAttendanceShift(log,scheduleData,{[staffProfile.cashierName||log.staffName]:staffProfile}),referenceRecords:[...attendanceRecords.values()]});
            fLogs=payrollPlan.logs;

            let tBonuses = 0; let fBonuses = [];
            bonusSnap.forEach(docSnap => {
                let b = docSnap.data();
                if(isPayrollAdjustment({...b,id:docSnap.id}))return;
                if (b.dateAdded && isMatch(b.staffName)) {
                    let t = safeDate(b.dateAdded);
                    if (t >= startT && t <= endT) { tBonuses += (parseFloat(b.amount) || 0); fBonuses.push(b); }
                }
            });

            let tShifts = 0; let tBasic = 0; let tLate = 0; let activeShift = null; let sPairs = [], scheduleReviews = 0,amendmentReviews=0,confirmationReviews=0,reliefReviews=payrollPlan.reviews.filter(review=>review.reason.includes('Emergency branch cover:')).length;
            for(const review of payrollPlan.reviews){
                const at=review.records.map(log=>attendanceMillis(log.timestamp)).find(Number.isFinite);
                sPairs.push({dateObj:Number.isFinite(at)?new Date(at):startT,in:null,out:'HR REVIEW',hrs:0,remark:'<span style="color:#b45309;font-weight:bold">'+review.reason+'</span>',lateMins:0,needsAttendanceReview:true});
            }
            
            fLogs.forEach(log => {
                let manualPenalty = parseFloat(log.penaltyAmount) || 0;
                let logType = typeof log.type === 'string' ? log.type.toUpperCase() : "UNKNOWN";

                if (logType === "TIME IN") {
                    let logDate = safeDate(log.timestamp); 
                    let lateMinutes = 0; let wasScheduled = false; let expectedStartHour = null;

                    if (activeShift) {
                        let missedIn = activeShift.time;
                        sPairs.push({ dateObj: missedIn, in: missedIn, out: "MISSED", hrs: "0.00", remark: `<span style="color:#ef4444; font-weight:bold;">Missed Time Out</span>`, lateMins: activeShift.lateMinutes || 0 });
                    }

                    const matchedShift = resolveAttendanceShift({...log, timestamp:logDate, staffName:staffProfile.cashierName || log.staffName},
                        scheduleData, { [staffProfile.cashierName || log.staffName]: staffProfile });
                    if (matchedShift?.needsScheduleReview) scheduleReviews++; if(matchedShift?.payrollShiftConfirmationError)confirmationReviews++;
                    if (matchedShift?.amendmentNeedsReview) amendmentReviews++; if(matchedShift?.reliefNeedsReview)reliefReviews++;
                    lateMinutes = attendanceLateMinutes(log, matchedShift);
                    wasScheduled = matchedShift?.wasScheduled || false;
                    const rateProfile=staffProfileForWork(staffProfile,log,matchedShift);
                    const lateExempted = matchedShift?.reliefReviewVerified ? matchedShift.reliefLateExempted : matchedShift?.amendmentReviewVerified ? matchedShift.amendmentLateExempted : log.lateExempted === true;
                    const late = latePay(lateMinutes, rateProfile, matchedShift, lateExempted);
                    activeShift = { time: logDate, lateMinutes, lateAmount: late.amount, lateExempted,
                        manualPenalty, wasScheduled, matchedShift,rateProfile };

                } else if (logType.includes("TIME OUT") && activeShift) {
                    let timeIn = activeShift.time; let lMins = activeShift.lateMinutes;
                    let lAmt = activeShift.lateAmount; let lExempt = activeShift.lateExempted;
                    let wasScheduled = activeShift.wasScheduled; 
                    let totalManualPenaltyForShift = (activeShift.manualPenalty || 0) + manualPenalty;
                    
                    let timeOut = safeDate(log.timestamp);
                    let hoursWorked = (timeOut.getTime() - timeIn.getTime()) / (1000 * 60 * 60);
                    
                    if (hoursWorked > 18) {
                        sPairs.push({ dateObj: timeIn, in: timeIn, out: timeOut, hrs: hoursWorked, remark: `<span style="color:#ef4444; font-weight:bold;">INVALID (${hoursWorked.toFixed(1)}h)</span>` });
                        activeShift = null; return; 
                    }

                    let isAutoClosed = logType === "TIME OUT (AUTO)";
                    let remark = isAutoClosed ? `<span style="color:#d97706; font-weight:bold;">Auto-Closed</span>` : `<span style="color:#10b981; font-weight:bold;">Complete</span>`;
                    const earnings=calculateShiftEarnings(activeShift.rateProfile||staffProfile,activeShift.matchedShift,timeIn,timeOut,{autoClosed:isAutoClosed});
                    const shiftMultiplier=earnings.shiftMultiplier;tBonuses+=earnings.straightBonus;
                    if(shiftMultiplier===0)remark='<span style="color:#ef4444;font-weight:bold">Misclick (Ignored)</span>';
                    else if(shiftMultiplier===2)remark='<span style="color:#8b5cf6;font-weight:bold">Owner-approved straight duty · +₱'+earnings.straightBonus.toFixed(2)+' straight incentive</span>';
                    else if(earnings.shortHours>0)remark='<span style="color:#b45309">Short duty ('+hoursWorked.toFixed(2)+'h worked; '+earnings.shortHours.toFixed(2)+'h below 8h) · full daily pay retained</span>';
                    if(earnings.straightApprovalRequired)remark+='<br><span style="color:#b45309">Over 16h recorded · Owner straight-duty review pending.</span>';
                    if(earnings.bonusReviewRequired)remark+='<br><span style="color:#b45309">Actual-work Mid/Night bonus needs HQ review. '+String(earnings.bonusReviewReason||'Confirm the work recorded on these punches.').replace(/[&<>"\']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))+'</span>';
                    if(activeShift.matchedShift?.amendmentNeedsReview)remark+='<br><span style="color:#a16207;font-weight:bold">Shift correction — HQ must review the saved lateness decision.</span>';
                    else if (activeShift.matchedShift?.needsScheduleReview) remark += activeShift.matchedShift.scheduleSource === 'legacy-unverified'
                        ? '<br><span style="color:#a16207;font-weight:bold">Legacy estimate — schedule history was not saved for this date.</span>'
                        : '<br><span style="color:#a16207;font-weight:bold">Schedule history missing — review required; no inferred lateness.</span>';

                    const bonusBasis=earnings.bonusBasis||null,bonusWorkType={morning:'Morning',mid:'Mid',night:'Night','mid-night':'Mid/Night',other:'Other'}[bonusBasis?.shiftType];
                    if(bonusWorkType&&['actual-punches','owner-review'].includes(bonusBasis.source)&&Number.isFinite(bonusBasis.workedHours))remark+='<br><span style="color:#557061">Bonus basis: '+(bonusBasis.source==='owner-review'?'Owner-confirmed ':'actual ')+bonusWorkType+' work · '+bonusBasis.workedHours.toFixed(2)+'h recorded'+(bonusBasis.status==='qualified'&&earnings.nightBonus===0?' · no additional Mid/Night bonus configured':bonusBasis.status==='not-qualified'?' · no Mid/Night bonus for this work category':'')+'</span>';
                    if(activeShift.matchedShift.expectedStartAt&&activeShift.matchedShift.expectedEndAt)remark+='<br><span style="color:#557061">Scheduled reference: '+activeShift.matchedShift.expectedStartAt.toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit'})+' → '+activeShift.matchedShift.expectedEndAt.toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit'})+'</span>';
                    const thisShiftNightBonus = earnings.nightBonus;
                    tBonuses += thisShiftNightBonus;
                    if(thisShiftNightBonus>0)remark+='<br><span style="color:#b45309">'+(earnings.bonusShiftType==='night'?'Night':earnings.bonusShiftType==='mid-night'?'Mid/Night':'Mid')+' bonus: +₱'+thisShiftNightBonus.toFixed(2)+'</span>';

                    let logDateStr = staffRateWorkDate({timestamp:timeIn},activeShift.matchedShift);
                    let hType = holidaysObj[logDateStr];
                    const appliedDailyRate=activeShift.rateProfile.hourlyRate;
                    tBasic+=appliedDailyRate*shiftMultiplier;
                    let baseForHoliday = (appliedDailyRate * shiftMultiplier) + thisShiftNightBonus;
                    let hBonus = 0;

                    if (hType === 'Regular') { hBonus = baseForHoliday * 0.50; tBonuses += hBonus; remark += ` <br><span style="color:#ea580c; font-weight:bold;">(Reg Hol: +₱${hBonus.toFixed(2)})</span>`; } 
                    else if (hType === 'Special') { hBonus = baseForHoliday * 0.10; tBonuses += hBonus; remark += ` <br><span style="color:#ea580c; font-weight:bold;">(Spl Hol: +₱${hBonus.toFixed(2)})</span>`; }

                    if (lMins > 0 && !lExempt) { remark += `<br><span style="color:#dc2626; font-weight:bold;">(Late = -₱${lAmt.toFixed(2)})</span>`; tLate += lAmt; }
                    if (totalManualPenaltyForShift > 0) { remark += `<br><span style="color:#b91c1c; font-weight:900; font-size:10px;">-₱${totalManualPenaltyForShift.toFixed(2)} Manual Penalty</span>`; tLate += totalManualPenaltyForShift; }

                    tShifts += shiftMultiplier;
                    sPairs.push({ dateObj: timeIn, in: timeIn, out: timeOut, hrs: hoursWorked, remark: remark, dailyRate:appliedDailyRate,rateWorkDate:logDateStr,bonusBasis:bonusBasis?{...bonusBasis,matchingShiftIds:[...(bonusBasis.matchingShiftIds||[])]}:null,bonusReviewReason:earnings.bonusReviewReason||'',nightBonus:thisShiftNightBonus,expectedStartAt:activeShift.matchedShift.expectedStartAt?.toISOString()||null,expectedEndAt:activeShift.matchedShift.expectedEndAt?.toISOString()||null,lateMins: (!lExempt && lMins > 0) ? lMins : 0 });
                    activeShift = null;
                } else if (manualPenalty > 0) {
                    tLate += manualPenalty;
                    let logTime = log.timestamp ? safeDate(log.timestamp) : new Date();
                    sPairs.push({ dateObj: logTime, in: logTime, out: null, hrs: 0, remark: `<span style="color:#b91c1c; font-weight:900; font-size:10px;">-₱${manualPenalty.toFixed(2)} Manual Penalty</span>`, lateMins: 0 });
                }
            });

            if (activeShift) {
                let activeTime = activeShift.time;
                let isOrphaned = ((new Date() - activeTime) / (1000 * 60 * 60)) > 18; 
                sPairs.push({ 
                    dateObj: activeTime, in: activeTime, out: isOrphaned ? null : "Active Shift", hrs: 0, 
                    remark: isOrphaned ? `<span style="color:#ef4444; font-weight:bold;">Missing Time Out</span>` : `<span style="color:#0ea5e9; font-style:italic;">Active Shift</span>`,
                    isActive: !isOrphaned, isMissingOut: isOrphaned
                });
            }

            fBonuses.forEach(b => {
                let amt = parseFloat(b.amount) || 0; let bDate = b.dateAdded ? safeDate(b.dateAdded) : new Date();
                let dateStr = bDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                let existingLog = sPairs.find(l => l.in && l.in.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) === dateStr);
                if (existingLog) {
                    if (existingLog.remark.includes('Complete')) existingLog.remark = existingLog.remark.replace('Complete', 'Complete (w/ Overtime)');
                    existingLog.remark += `<br><span style="color:#ea580c; font-weight:bold;">+₱${amt.toFixed(2)} (Manual OT: ${b.remarks || 'Bonus'})</span>`;
                } else {
                    sPairs.push({ dateObj: bDate, in: null, out: null, hrs: 0, remark: `<span style="color:#ea580c; font-weight:bold;">+₱${amt.toFixed(2)} (Manual OT: ${b.remarks || 'Bonus'})</span>`, lateMins: 0 });
                }
            });

            return { shiftsWorked: tShifts, basicPay:tBasic,totalLatePenalty: tLate, totalBonuses: tBonuses, shiftPairs: sPairs, scheduleReviews,amendmentReviews,confirmationReviews,reliefReviews,attendanceHeld:payrollPlan.reviews.length>0||amendmentReviews>0||reliefReviews>0||confirmationReviews>0 };
        };

        let currentData = analyzeCutoff(new Date(startDateStr + 'T00:00:00'), new Date(endDateStr + 'T23:59:59'));
        let prevData = analyzeCutoff(new Date(prevStartStr + 'T00:00:00'), new Date(prevEndStr + 'T23:59:59'));

        let estGross = currentData.basicPay;
        let prevEstGross = prevData.basicPay;

        const dedSnap=privateSnapshot(financialInputs.staffDeductions);
        if (!stillOpen()) return;
        let liveUnpaidVales = 0; let liveActiveDeductions = [];
        const onlineStaffId=localStorage.getItem('takodeal_staff_id');
        const onlineSnap=privateSnapshot(financialInputs.staffDeductions.filter(row=>row.staffId===onlineStaffId));
        if(!stillOpen())return;
        const onlineRows=onlineSnap.docs.map(row=>({id:row.id,...row.data()})).filter(row=>row.type==='Online Order Refund'&&row.staffId===onlineStaffId);
        const hasCashShortageReview=onlineSnap.docs.some(row=>{const item=row.data();return item.staffId===onlineStaffId&&(item.type==='Cash Shortage'||row.id.startsWith('cash-shortage-'))&&['Pending Review','Unpaid'].includes(item.status);});
        let pendingUnpaidVales = 0, scheduledPenaltyReview = 0, pendingActiveDeductions=[];
        
        let cutoffEndTimestamp = new Date(endDateStr + 'T23:59:59'); 
        let prevCutoffEndTimestamp = new Date(prevEndStr + 'T23:59:59'); 
        
        const ownDeductionRows=new Map();
        [dedSnap,onlineSnap].forEach(snapshot=>snapshot.forEach(row=>{const data=row.data();if(data.staffId?data.staffId===onlineStaffId:isMatch(data.staffName))ownDeductionRows.set(row.id,{...data,id:row.id});}));
        ownDeductionRows.forEach(data => {
            if (data.status === "Unpaid") {
                if (isPenaltyDeduction(data) && data.scheduleVersion===1 && deductionIsDue(data,endDateStr)) scheduledPenaltyReview += Number(data.amount)||0;
                let dDate = safeDate(data.dateAdded || data.timestamp);
                if (data.type === "Cash Advance" || isMealDeduction(data.type)) {
                    let val = parseFloat(data.amount) || 0; 
                    if (dDate <= cutoffEndTimestamp) {
                        liveUnpaidVales += val; 
                        liveActiveDeductions.push(data); 
                    }
                    if (dDate <= prevCutoffEndTimestamp) {
                        pendingUnpaidVales += val; 
                        pendingActiveDeductions.push(data);
                    }
                }
            }
        });

        const loanSnapshot=await window.readMyLoanLedgerSnapshot({assertCurrent:()=>{if(!stillOpen())throw Error('The private Pay view changed.');}});
        if(!stillOpen())return;
        if(loanSnapshot.reviewRequired||loanSnapshot.historyComplete!==true)throw Object.assign(Error('Ask HQ to confirm your private loan balance before using the live estimate.'),{code:'loan-ledger-review'});
        const loanData=loanSnapshot.ledger;
        let cutoffLoanDeduction=0,remBal=loanData?.remainingBalance??0;
        if(loanData&&remBal>0){if(loanData.cutoffDeduction===null)throw Object.assign(Error('Your saved loan cutoff deduction needs HQ review.'),{code:'loan-ledger-review'});cutoffLoanDeduction=Math.min(loanData.cutoffDeduction,remBal);}

        const onlineDue=onlineRows.filter(row=>row.status==='Unpaid'&&(row.dateAdded?.toDate?.()||new Date(row.dateAdded))<=cutoffEndTimestamp);
        const onlineDueAmount=onlineDue.reduce((sum,row)=>sum+(Number(row.amount)||0),0);
        const profileCharges={sss:staffProfile.sssAmount||0,philhealth:staffProfile.philHealthAmount||0,pagibig:staffProfile.pagibigAmount||0,customDeductions:staffProfile.customDeductions||[]};
        const recurringDeductionTotal=payslipDeductionBreakdown(profileCharges).total;
        const ownerEstimateInput={rows:[...ownDeductionRows.values()],staffId:onlineStaffId,name:staffProfile.cashierName||staffProfile.fullName||staffName,branch:staffProfile.branch,createVault:()=>createStaffDocumentFirebase(firebaseConfig,()=>localStorage.getItem('takodeal_staff_id')),stillCurrent:stillOpen};
        const ownerCurrent=await readStaffOwnerDeductionEstimate({...ownerEstimateInput,end:endDateStr});if(!stillOpen())return;
        const ownerPreviousDetails=ownerCurrent.details.filter(row=>row.effectiveDate<=prevEndStr);
        const ownerPrevious={...ownerCurrent,total:ownerPreviousDetails.reduce((sum,row)=>sum+Math.round(row.amount*100),0)/100,details:ownerPreviousDetails,rows:ownerPreviousDetails.map(row=>({id:row.id,amount:row.amount}))};
        const estimateDeductionData=(activeRows,late,refundRows)=>({...profileCharges,lateDeduction:late,loans:cutoffLoanDeduction,advances:activeRows.filter(row=>row.type==='Cash Advance').reduce((sum,row)=>sum+(Number(row.amount)||0),0),meals:activeRows.filter(row=>isMealDeduction(row.type)).reduce((sum,row)=>sum+(Number(row.amount)||0),0),onlineRefunds:refundRows.reduce((sum,row)=>sum+(Number(row.amount)||0),0),onlineRefundRows:refundRows,deductionDetailsVersion:1,deductionDetails:snapshotPayrollDeductionRows(activeRows,activeRows.filter(row=>Number(row.amount)>0).map(row=>({id:row.id,taken:Number(row.amount)})))});
        const currentDeductionDetails={...estimateDeductionData(liveActiveDeductions,currentData.totalLatePenalty,onlineDue),ownerDeductions:ownerCurrent.total,ownerDeductionRows:ownerCurrent.rows,ownerDeductionDetails:ownerCurrent.details,payrollRecoveryRows:ownerCurrent.payrollRecoveryRows||[]};
        let estNet = (estGross + currentData.totalBonuses + currentAdjustments.amount) - currentData.totalLatePenalty - liveUnpaidVales - cutoffLoanDeduction - onlineDueAmount - recurringDeductionTotal - ownerCurrent.total;
        let refundEstimate=document.getElementById('liveOnlineRefundEstimate');if(!refundEstimate){refundEstimate=document.createElement('p');refundEstimate.id='liveOnlineRefundEstimate';document.getElementById('payslipLiveSection').prepend(refundEstimate);}refundEstimate.textContent='ONLINE REFUND ORDERS: −₱'+onlineDueAmount.toFixed(2);refundEstimate.hidden=!onlineDueAmount;
        let cashReviewHint=document.getElementById('liveCashShortageReviewHint');if(!cashReviewHint){cashReviewHint=document.createElement('p');cashReviewHint.id='liveCashShortageReviewHint';cashReviewHint.style.cssText='padding:10px 12px;border:1px solid #e6d9bd;border-radius:8px;background:#fff9ed;font-size:12px;';document.getElementById('payslipLiveSection').prepend(cashReviewHint);}cashReviewHint.hidden=!hasCashShortageReview;cashReviewHint.textContent='This estimate excludes cash shortage reviews. Open My Inbox for the protected review and your response. Any lawfully approved amount will be itemized on the final payslip.';

        let ownerReviewHint=document.getElementById('liveOwnerDeductionHint');if(!ownerReviewHint){ownerReviewHint=document.createElement('p');ownerReviewHint.id='liveOwnerDeductionHint';ownerReviewHint.style.cssText='padding:10px 12px;border:1px solid #d3dfd3;border-radius:8px;background:#f5f9f1;font-size:12px;';document.getElementById('payslipLiveSection').prepend(ownerReviewHint);}ownerReviewHint.hidden=!ownerCurrent.pending&&!ownerCurrent.held;ownerReviewHint.textContent=ownerCurrent.held?'One-time deduction records could not be verified. '+ownerCurrent.message:'A one-time deduction is under review. It is excluded from this estimate until authorized. Open My Inbox to read or respond.';
        document.getElementById('liveEstGross').innerText = currentData.salaryHistoryUnavailable?'Confirm salary on approved phone':currentData.attendanceHeld ? 'Held for HR review' : '₱' + estGross.toLocaleString(undefined, {minimumFractionDigits: 2});
        document.getElementById('liveEstLates').innerText = '-₱' + currentData.totalLatePenalty.toLocaleString(undefined, {minimumFractionDigits: 2});
        document.getElementById('liveEstVales').innerText = '-₱' + liveUnpaidVales.toLocaleString(undefined, {minimumFractionDigits: 2});
        document.getElementById('liveEstNetPay').innerText = currentAdjustments.held?'Confirm adjustment records':ownerCurrent.held?'Confirm deduction records':currentData.salaryHistoryUnavailable?'Confirm salary on approved phone':currentData.attendanceHeld ? 'Held for HR review' : '₱' + Math.max(0, estNet).toLocaleString(undefined, {minimumFractionDigits: 2});
        let adjustmentPanel=document.getElementById('staffPayrollAdjustmentHistory');if(!adjustmentPanel){adjustmentPanel=document.createElement('div');adjustmentPanel.id='staffPayrollAdjustmentHistory';document.getElementById('payslipLiveSection').appendChild(adjustmentPanel);}
        const recoveryHistory=await readStaffPayrollRecoveryHistory(ownerEstimateInput);if(!stillOpen())return;
        adjustmentPanel.innerHTML=(currentAdjustments.held?'<p style="padding:12px;border:1px solid #e6d9bd;border-radius:8px;background:#fffbef;font-size:12px;color:#92400e">Previous payroll adjustments need confirmation. Reconnect or ask the Owner to review them before relying on the live estimate. Saved paid payslips below stay unchanged.</p>':payrollAdjustmentDetailsHTML({payrollAdjustments:currentAdjustments.amount,payrollAdjustmentRows:currentAdjustments.rows},{live:true}))+payrollAdjustmentHistoryHTML(payrollAdjustmentHistory.rows)+recoveryHistory.html;
        let penaltyReview=document.getElementById('liveScheduledPenaltyReview');
        if(!penaltyReview){penaltyReview=document.createElement('p');penaltyReview.id='liveScheduledPenaltyReview';penaltyReview.style.cssText='padding:10px;background:#fff8ed;font-size:12px;';document.getElementById('payslipLiveSection').prepend(penaltyReview);}
        penaltyReview.hidden=!scheduledPenaltyReview;
        penaltyReview.textContent='Scheduled penalties due for ledger review: ₱'+scheduledPenaltyReview.toFixed(2)+'. This amount is separate from the estimated net pay. Contact management to review collection.';
        let scheduleNotice = document.getElementById('liveScheduleHistoryNotice');
        if (!scheduleNotice) {
            scheduleNotice = document.createElement('p');scheduleNotice.id = 'liveScheduleHistoryNotice';
            scheduleNotice.style.cssText = 'padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;color:#92400e;font-size:12px;line-height:1.5';
            document.getElementById('payslipLiveSection').prepend(scheduleNotice);
        }
        scheduleNotice.hidden = !currentData.scheduleReviews && !currentData.attendanceHeld;
        scheduleNotice.textContent = currentData.salaryHistoryUnavailable?'Salary details could not be confirmed. Use the approved Staff phone and reconnect to confirm the rate for each work date. Saved paid payslips below remain available.':currentData.confirmationReviews?'The saved Owner-assigned hours could not be confirmed. Reconnect and reopen Pay; HQ can review the exact work record if this remains pending.':currentData.reliefReviews ? 'Your actual emergency-cover arrival and departure are recorded. Owner HR will confirm your assigned hours before this pay estimate is finalized.' : currentData.amendmentReviews ? 'A dated shift correction needs HQ review of a saved lateness decision. This attendance estimate is held until that review is complete.' : currentData.attendanceHeld ? 'This attendance estimate is held for HR review because linked punches conflict or overlap. No payable hours or lateness penalty have been inferred.' : `${currentData.scheduleReviews} clock-in(s) lack saved schedule evidence. Review the attendance details before payroll approval.`;

        let grossRow = document.getElementById('liveEstGross').parentElement;
        if (!document.getElementById('liveEstOTRow')) {
            grossRow.insertAdjacentHTML('afterend', `<div id="liveEstOTRow" style="display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 14px;"><span style="color: #64748b; font-weight: bold;">Overtime / Bonuses:</span><strong id="liveEstOT" style="color: #0ea5e9;">+₱0.00</strong></div>`);
        }
        document.getElementById('liveEstOT').innerText = '+₱' + currentData.totalBonuses.toLocaleString(undefined, {minimumFractionDigits: 2});

        let valesRow = document.getElementById('liveEstVales').parentElement;
        const valesLabel=valesRow.querySelector('span');if(valesLabel)valesLabel.textContent='Cash advances / food purchases:';
        let profileRow=document.getElementById('liveEstProfileDeductionsRow');
        if(!profileRow){profileRow=document.createElement('div');profileRow.id='liveEstProfileDeductionsRow';profileRow.style.cssText='display:flex;justify-content:space-between;gap:12px;margin-bottom:10px;font-size:14px';valesRow.after(profileRow);}
        profileRow.hidden=!recurringDeductionTotal;profileRow.innerHTML='<span style="color:#64748b;font-weight:bold">Government / recurring deductions:</span><strong style="color:#ef4444">−₱'+recurringDeductionTotal.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})+'</strong>';
        if (!document.getElementById('liveEstLoanRow')) {
            valesRow.insertAdjacentHTML('afterend', `<div id="liveEstLoanRow" style="display: none; justify-content: space-between; margin-bottom: 10px; font-size: 14px;"><span style="color: #64748b; font-weight: bold;">Company Loan Deduction:</span><strong id="liveEstLoan" style="color: #ef4444;">-₱0.00</strong></div>`);
        }
        
        let loanRow = document.getElementById('liveEstLoanRow');
        if (cutoffLoanDeduction > 0) {
            loanRow.style.display = 'flex';
            document.getElementById('liveEstLoan').innerText = '-₱' + cutoffLoanDeduction.toLocaleString(undefined, {minimumFractionDigits: 2});
        } else {
            loanRow.style.display = 'none';
        }

        let logsContainer = document.getElementById('liveCutoffDetailedLogs');
        if (!logsContainer) {
            logsContainer = document.createElement('div'); logsContainer.id = 'liveCutoffDetailedLogs';
            document.getElementById('payslipLiveSection').appendChild(logsContainer);
        }

        const generateTableRows = (pairs) => {
            let html = '';
            if (pairs.length > 0) {
                pairs.sort((a,b) => b.dateObj.getTime() - a.dateObj.getTime()).forEach(p => {
                    let dateStr = p.dateObj.toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
                    let inStr = p.in ? p.in.toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit'}) : '---';
                    let outStr = p.isActive ? '<span style="color:#0ea5e9; font-style:italic;">Active Shift</span>' : (p.isMissingOut ? '<span style="color:#ef4444; font-weight:bold;">No Record</span>' : (p.out ? (typeof p.out === 'string' ? p.out : p.out.toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit'})) : '---'));
                    let safeHrs = parseFloat(p.hrs);
                    let hrStr = p.isActive ? '<span style="color:#94a3b8;">--</span>' : (isNaN(safeHrs) ? '0.00h' : `${safeHrs.toFixed(2)}h`);
                    
                    let inColor = '#16a34a'; let outColor = '#16a34a'; 
                    if (p.lateMins && p.lateMins > 0) { inStr += `<br><span style="color:#dc2626; font-size:10px; font-weight:bold;">Late: ${p.lateMins}m</span>`; inColor = '#dc2626'; }
                    if (p.remark && (p.remark.includes('Short') || p.remark.includes('INVALID') || p.remark.includes('Missed') || p.remark.includes('Ignored'))) outColor = '#dc2626'; 
                    if (p.isActive) outColor = '#0ea5e9'; 

                    html += `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 8px; color: #64748b;">${dateStr}</td><td style="padding: 10px 8px; color: ${inColor}; font-weight: bold; text-align: center; vertical-align: middle;">${inStr}</td><td style="padding: 10px 8px; color: ${outColor}; font-weight: bold; text-align: center; vertical-align: middle;">${outStr}</td><td style="padding: 10px 8px; font-weight: bold; color: #334155; text-align: center; vertical-align: middle;">${hrStr}</td><td style="padding: 10px 8px; font-size: 11px; text-align: center; vertical-align: middle;">${p.remark}</td></tr>`;
                });
            } else {
                html += `<tr><td colspan="5" style="padding: 15px; text-align: center; color: #94a3b8;">No valid Time In/Out pairs found.</td></tr>`;
            }
            return html;
        };

        let detailsHtml = `
            <div style="margin-top: 20px; background: white; border-radius: 12px; border: 1px solid #cbd5e1; padding: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                <h3 style="margin-top: 0; color: #334155; font-size: 14px; border-bottom: 2px solid #f1f5f9; padding-bottom: 8px;">⏱️ Attendance Logs (This Cutoff)</h3>
                <div style="padding-bottom: 10px; max-height: none !important; overflow: visible;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left;">
                        <thead style="background: #f8fafc; position: sticky; top: 0; z-index: 5;">
                            <tr><th style="padding: 8px; border-bottom: 1px solid #cbd5e1;">Date</th><th style="padding: 8px; border-bottom: 1px solid #cbd5e1; text-align: center;">In</th><th style="padding: 8px; border-bottom: 1px solid #cbd5e1; text-align: center;">Out</th><th style="padding: 8px; border-bottom: 1px solid #cbd5e1; text-align: center;">Hrs</th><th style="padding: 8px; border-bottom: 1px solid #cbd5e1; text-align: center;">Remarks</th></tr>
                        </thead>
                        <tbody>${generateTableRows(currentData.shiftPairs)}</tbody>
                    </table>
                </div>
            </div>
            
        `;

        if (loanData && remBal > 0) {
            detailsHtml += `
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13px; padding: 12px; border-radius: 8px; border: 1px dashed #fcd34d; background: #fffbeb; margin-bottom: 15px;">
                    <div><strong style="color: #b45309; font-size: 14px;">💳 Company Loan Deduction</strong><br><span style="font-size: 11px; color: #d97706;">Auto-deducted this cutoff. (Remaining Debt: ₱${remBal.toLocaleString(undefined, {minimumFractionDigits: 2})})</span></div>
                    <strong style="color: #dc2626; font-size: 16px;">-₱${cutoffLoanDeduction.toLocaleString(undefined, {minimumFractionDigits: 2})}</strong>
                </div>`;
        }

        detailsHtml+=payslipDeductionDetailsHTML(currentDeductionDetails,{live:true});
        detailsHtml+=onlineRefundReviewHTML(onlineRows,onlineStaffId);
        logsContainer.innerHTML = detailsHtml;

        let pendingHtml = ''; let pendingCount = 0;
        const hasPrevCutoffRecord=[...savedPayslips.paid,...savedPayslips.shared].some(entry=>entry.data.start===prevStartStr&&entry.data.end===prevEndStr)||savedPayslips.held.some(entry=>(entry.record.startDate??entry.record.frozenData?.start??entry.record.frozenData?.startDate??entry.record.snapshot?.start)===prevStartStr&&(entry.record.endDate??entry.record.frozenData?.end??entry.record.frozenData?.endDate??entry.record.snapshot?.end)===prevEndStr);

        if (!hasPrevCutoffRecord) {
            pendingCount++;
            
            let prevEstGross = prevData.basicPay;
            const prevOnlineAmount=onlineRows.filter(row=>row.status==='Unpaid'&&(row.dateAdded?.toDate?.()||new Date(row.dateAdded))<=prevCutoffEndTimestamp).reduce((sum,row)=>sum+(Number(row.amount)||0),0);
            let prevEstNet = (prevEstGross + prevData.totalBonuses + previousAdjustments.amount) - prevData.totalLatePenalty - pendingUnpaidVales - cutoffLoanDeduction - prevOnlineAmount - recurringDeductionTotal - ownerPrevious.total;
            const previousRefundRows=onlineRows.filter(row=>row.status==='Unpaid'&&(row.dateAdded?.toDate?.()||new Date(row.dateAdded))<=prevCutoffEndTimestamp);
            const previousDeductionDetails={...estimateDeductionData(pendingActiveDeductions,prevData.totalLatePenalty,previousRefundRows),ownerDeductions:ownerPrevious.total,ownerDeductionRows:ownerPrevious.rows,ownerDeductionDetails:ownerPrevious.details,payrollRecoveryRows:(ownerPrevious.payrollRecoveryRows||[]).filter(row=>ownerPrevious.rows.some(item=>item.id===row.id))};

            let prevLoanStr = (cutoffLoanDeduction > 0) ? `<div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span>Company Loan:</span> <strong style="color:#ef4444;">-₱${cutoffLoanDeduction.toLocaleString(undefined, {minimumFractionDigits:2})}</strong></div>` : '';

            pendingHtml += `
                <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 12px; padding: 15px; margin-bottom: 15px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); opacity: 0.95;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; margin-bottom: 12px;">
                        <div>
                            <h3 style="margin: 0 0 5px 0; color: #475569; font-size: 16px;">Cutoff: ${prevStartStr} to ${prevEndStr}</h3>
                            <div style="font-size: 12px; color: #0284c7; font-weight: bold;">⏳ Processing by HQ</div>
                            <div style="font-size: 11px; color: #64748b; margin-top: 5px; line-height: 1.4;">Your manager is currently calculating this payroll.<br>You can preview your records below.</div>
                        </div>
                        <div style="text-align: right; background: white; padding: 8px 12px; border-radius: 8px; border: 1px solid #cbd5e1;">
                            <div style="font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: bold;">Est. Net Pay</div>
                            <div style="font-size: 18px; font-weight: 900; color: #0f172a;">${previousAdjustments.held?'Confirm adjustment records':ownerPrevious.held?'Confirm deduction records':prevData.salaryHistoryUnavailable?'Confirm salary on approved phone':prevData.attendanceHeld ? 'Held for HR review' : '₱'+Math.max(0, prevEstNet).toLocaleString(undefined, {minimumFractionDigits:2})}</div>
                        </div>
                    </div>
                    
                    <div style="font-size: 13px; color: #475569; margin-bottom: 15px; background: white; padding: 10px; border-radius: 8px; border: 1px dashed #cbd5e1;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span>Estimated Basic Pay:</span> <strong style="color:#16a34a;">₱${prevEstGross.toLocaleString(undefined, {minimumFractionDigits:2})}</strong></div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span>Overtime / Bonuses:</span> <strong style="color:#0ea5e9;">+₱${prevData.totalBonuses.toLocaleString(undefined, {minimumFractionDigits:2})}</strong></div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span>Late Penalties:</span> <strong style="color:#ef4444;">-₱${prevData.totalLatePenalty.toLocaleString(undefined, {minimumFractionDigits:2})}</strong></div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span>Unpaid Vales/Meals:</span> <strong style="color:#ef4444;">-₱${pendingUnpaidVales.toLocaleString(undefined, {minimumFractionDigits:2})}</strong></div>
                        ${prevLoanStr}
                        ${recurringDeductionTotal?'<div style="display:flex;justify-content:space-between;gap:12px"><span>Government / recurring deductions:</span><strong style="color:#ef4444">−₱'+recurringDeductionTotal.toFixed(2)+'</strong></div>':''}
                    </div>
                    ${payslipDeductionDetailsHTML(previousDeductionDetails,{live:true})}
                    ${payrollAdjustmentDetailsHTML({payrollAdjustments:previousAdjustments.amount,payrollAdjustmentRows:previousAdjustments.rows},{live:true})}
                    ${hasCashShortageReview?'<p style="font-size:12px;color:#7a5a21;line-height:1.5">This estimate excludes cash shortage reviews. Check My Inbox; any lawfully approved amount is itemized on the final payslip.</p>':''}
                    
                    ${prevData.salaryHistoryUnavailable?'<p style="font-size:12px;color:#92400e;line-height:1.5">Use your approved Staff phone and reconnect to confirm the daily wage for each work date.</p>':prevData.confirmationReviews?'<p style="font-size:12px;color:#92400e;line-height:1.5">The saved Owner-assigned hours could not be confirmed. Reconnect and reopen Pay, or ask HQ to review this exact work record.</p>':prevData.reliefReviews ? '<p style="font-size:12px;color:#92400e;line-height:1.5">Your actual emergency-cover punches are recorded. Assigned hours are waiting for Owner HR review before this estimate is finalized.</p>' : prevData.amendmentReviews ? '<p style="font-size:12px;color:#92400e;line-height:1.5">A dated shift correction needs HQ review of a saved lateness decision. This attendance estimate is held until that review is complete.</p>' : prevData.attendanceHeld ? '<p style="font-size:12px;color:#92400e;line-height:1.5">Linked punches conflict or overlap. The attendance estimate is held for HR review; no payable hours or lateness penalty have been inferred.</p>' : prevData.scheduleReviews ? '<p style="font-size:12px;color:#92400e;line-height:1.5">Saved schedule evidence is missing for some clock-ins in this estimate. Review the attendance details before payroll approval.</p>' : ''}
                    <details style="background: white; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                        <summary style="font-weight: bold; color: #0f766e; cursor: pointer; outline: none; font-size: 13px; display: flex; align-items: center; gap: 8px;">
                            <span>👀 View Attendance Logs</span>
                        </summary>
                        <div style="margin-top: 10px; border-top: 1px dashed #e2e8f0; padding-top: 10px; padding-bottom: 10px; max-height: none !important; overflow: visible;">
                            <table style="width: 100%; border-collapse: collapse; font-size: 11px; text-align: left;">
                                <thead style="background: #f8fafc; position: sticky; top: 0;">
                                    <tr><th style="padding: 6px 4px; border-bottom: 1px solid #cbd5e1;">Date</th><th style="padding: 6px 4px; border-bottom: 1px solid #cbd5e1; text-align: center;">In</th><th style="padding: 6px 4px; border-bottom: 1px solid #cbd5e1; text-align: center;">Out</th><th style="padding: 6px 4px; border-bottom: 1px solid #cbd5e1; text-align: center;">Hrs</th><th style="padding: 6px 4px; border-bottom: 1px solid #cbd5e1; text-align: center;">Remarks</th></tr>
                                </thead>
                                <tbody>${generateTableRows(prevData.shiftPairs)}</tbody>
                            </table>
                        </div>
                    </details>
                </div>
            `;
        }

        renderSaved(pendingHtml,pendingCount);

    } catch (e) {
        if (!stillOpen()) return;
        console.error("Payslip Fetch Error:", e);
        const loanUnavailable=e?.code?.startsWith('loan-ledger-'),financialUnavailable=e?.code?.startsWith('staff-financial-inputs/')||e?.code?.startsWith('staff-access/')||e?.code?.startsWith('private-profile/');
        document.getElementById('liveEstNetPay').innerText = loanUnavailable||financialUnavailable?'Unavailable':"Error";
        renderSaved();
        let parentEl = document.getElementById('liveEstNetPay').parentElement;
        if(parentEl && !parentEl.querySelector('.error-text')) {
            parentEl.innerHTML += `<p class="error-text" style="color: #fca5a5; font-size: 12px; font-weight: bold; margin-top: 10px;">${loanUnavailable?'Your loan records could not be verified. Reopen Pay when connected or ask HQ to review this phone and ledger.':financialUnavailable?'Your complete private deduction and bonus records could not be verified. Reopen Pay on your approved phone or ask HQ to review the records.':'Error loading data.'}</p>`;
        }
    }
};

// ==========================================
// 🧾 THE UPGRADED PAYSLIP UI ENGINE
// ==========================================
window.viewPastPayslip = function(encodedData) {
    if (!window.staffVaultSession?.allows(localStorage.getItem('takodeal_staff_id'))) return;
    const payEpoch = window.staffVaultSession.epoch;
    let d = JSON.parse(decodeURIComponent(encodedData));
    
    let disbursedDateStr = 'Pending';
    if (d.processedAt) {
        let pDate = d.processedAt.seconds ? new Date(d.processedAt.seconds * 1000) : new Date(d.processedAt);
        disbursedDateStr = pDate.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
    } else {
        disbursedDateStr = d.recordState==='shared'?'Awaiting payment':'Not recorded';
    }

    let savedAmounts;
    try{if(d.staffId&&d.staffId!==localStorage.getItem('takodeal_staff_id'))throw Error('This payslip belongs to another employee.');savedAmounts=payslipSavedAmounts(d);d={...d,...savedAmounts,finalNetPay:savedPayslipCents(d.finalNetPay,{negative:true})/100};}
    catch(error){return Swal.fire('Saved payslip needs review',error.message,'warning');}
    const basicPay=savedAmounts.basicPay.toFixed(2),otPay=savedAmounts.nightBonus.toFixed(2),straightPay=savedAmounts.straightBonus.toFixed(2),holPay=savedAmounts.holidayPayTotal.toFixed(2),perfBonus=savedAmounts.perfBonus.toFixed(2),payrollAdjustmentPay=savedAmounts.payrollAdjustments.toFixed(2);
    const grossIncome=savedAmounts.grossPay.toFixed(2),totalDeduct=savedAmounts.totalDeductions.toFixed(2);
    const netPay=d.finalNetPay.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
    encodedData=encodeURIComponent(JSON.stringify(d)).replace(/'/g,'%27');

    let logoUrl = "https://takodeal-owner.vercel.app/payslip%20logo.jpg";

    let sigHtml = '';
    if (d.staffSignature) {
        sigHtml = `
            <div style="margin-top: 25px; padding-top: 15px; text-align: center;">
                <span style="font-size: 11px; font-weight: bold; color: #16a34a; text-transform: uppercase;">Digitally Acknowledged & Signed</span>
                <img src="${d.staffSignature}" style="height: 60px; display: block; margin: 5px auto 0 auto; background: white; border-radius: 6px;">
            </div>
        `;
    }

    // 🔥 THE NEW ATTENDANCE SUMMARY GENERATOR
    let attendanceHtml = "";
    let logsArray = d.shiftPairs || d.logs || [];
    if (logsArray.length > 0) {
        logsArray.forEach(log => {
            const parseDate = (val) => {
                if (!val) return null;
                if (val.seconds) return new Date(val.seconds * 1000);
                if (val.toDate) return val.toDate();
                let parsed = new Date(val);
                return isNaN(parsed.getTime()) ? null : parsed;
            };

            // 1. DATE COLUMN: Check for pre-formatted strings first!
            let dateStr = log.date || log.dateString; 
            if (!dateStr) {
                let logDate = parseDate(log.dateObj || log.timestamp) || new Date();
                dateStr = logDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            }

            // 2. TIME IN COLUMN: Support both text strings and raw dates!
            let inTime = '---';
            if (log.in) {
                if (typeof log.in === 'string' && !log.in.includes('T') && !log.in.includes('-')) {
                    inTime = log.in; // Use text directly
                } else {
                    let inDate = parseDate(log.in);
                    inTime = inDate ? inDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '---';
                }
            }

            // 3. TIME OUT COLUMN: Support both text strings and raw dates!
            let outTime = '---';
            if (log.out) {
                if (typeof log.out === 'string' && !log.out.includes('T') && !log.out.includes('-')) {
                    outTime = log.out; // Use text directly
                } else {
                    let outDate = parseDate(log.out);
                    outTime = outDate ? outDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '---';
                }
            }

            let inColor = (log.lateMins > 0) ? '#dc2626' : '#16a34a';
            let outColor = (outTime.includes('MISSED') || outTime === '---' || (log.remark && log.remark.includes('Short'))) ? '#dc2626' : '#16a34a';

            let hrs = parseFloat(log.hrs || 0).toFixed(2) + 'h';
            if (hrs === '0.00h' || isNaN(parseFloat(hrs))) hrs = '---';

            attendanceHtml += `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 10px 4px; color: #334155; text-align: center;">${dateStr}</td>
                    <td style="padding: 10px 4px; color: ${inColor}; font-weight: bold; text-align: center;">${inTime}</td>
                    <td style="padding: 10px 4px; color: ${outColor}; font-weight: bold; text-align: center;">${outTime}</td>
                    <td style="padding: 10px 4px; color: #334155; font-weight: bold; text-align: center;">${hrs}</td>
                    <td style="padding: 10px 4px; font-size: 10px; color: #64748b; text-align: right;">${log.remark || ''}</td>
                </tr>
            `;
        });
    } else {
        attendanceHtml = `<tr><td colspan="5" style="padding: 15px; text-align: center; color: #94a3b8; font-size: 12px; font-style: italic;">No attendance records found for this cutoff.</td></tr>`;
    }

    // THE FULL PDF LAYOUT
    let html = `
        <div style="overflow-x: auto; width: 100%; background: #f1f5f9; padding: 15px; border-radius: 8px;">
            <div style="text-align: right; margin-bottom: 15px; position: sticky; top: 0; left: 0; z-index: 50;">
                <button id="btnDownloadStaffPayslip" onclick="window.downloadStaffPayslipImage('${encodedData}')" style="background: #10b981; color: white; border: none; padding: 12px 20px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 14px; box-shadow: 0 4px 6px rgba(16, 185, 129, 0.3);">⬇️ Download HD Image</button>
            </div>

            ${d.recordState==='shared'?'<p style="padding:12px;background:#fff8e8;color:#76501c;text-align:left">Owner-shared payslip · Payment pending. These are the exact saved Owner figures. This document is not a payment or a signature request.</p>':''}
            <div id="printableStaffPayslip" style="width: 750px; background: white; padding: 25px; font-family: 'Segoe UI', Arial, sans-serif; color: black; text-align: left; box-sizing: border-box; margin: 0 auto; box-shadow: 0 10px 25px rgba(0,0,0,0.1);">
                <div style="border: 3px solid black; padding: 2px;">
                    <div style="border: 1px solid black; padding: 20px;">
                        
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid black; padding-bottom: 15px; margin-bottom: 15px;">
                            <div style="width: 140px; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                                <img src="${logoUrl}" alt="Takodeal Logo" style="width: 90px; object-fit: contain; border-radius: 8px;">
                            </div>
                            <div style="text-align: center; flex: 1;">
                                <h1 style="margin: 0; font-size: 32px; letter-spacing: 2px;">TAKODEÁL</h1>
                                <p style="margin: 5px 0 0 0; font-size: 16px;">Payslip</p>
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; font-size: 14px;">
                            <div style="display: grid; grid-template-columns: 120px 1fr; gap: 5px;">
                                <strong style="text-align: right; padding-right: 10px;">Employee Name:</strong> <span style="border-bottom: 1px solid black; font-weight: bold;">${d.name || d.staffName}</span>
                                <strong style="text-align: right; padding-right: 10px;">Department:</strong> <span style="border-bottom: 1px solid black;">${d.branch || 'N/A'}</span>
                                <strong style="text-align: right; padding-right: 10px;">Date Hired:</strong> <span>${d.dateHired || '---'}</span>
                            </div>
                            <div style="display: grid; grid-template-columns: 140px 1fr; gap: 5px;">
                                <strong style="text-align: right; padding-right: 10px;">Cutoff Started:</strong> <span style="border-bottom: 1px solid black;">${d.start || d.startDate}</span>
                                <strong style="text-align: right; padding-right: 10px;">Cutoff Ended:</strong> <span style="border-bottom: 1px solid black;">${d.end || d.endDate}</span>
                                <strong style="text-align: right; padding-right: 10px;">Pay Distributed:</strong> <span style="border-bottom: 1px solid black;">${disbursedDateStr}</span>
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 1px solid black;">
                            <div style="border-right: 1px solid black;">
                                <div style="background: #e2e8f0; padding: 8px; font-weight: bold; border-bottom: 1px solid black; text-align: left;">INCOME</div>
                                <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px dashed #cbd5e1;">
                                    <span>Basic Pay (${d.shiftsWorked || 0} days)</span> <span style="font-weight: bold;">${basicPay}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-bottom: 1px dashed #cbd5e1;">
                                    <span>Overtime / Night Diff</span> <span>${otPay}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-bottom: 1px dashed #cbd5e1;">
                                    <span>Straight Duty Bonus</span> <span>${straightPay}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-bottom: 1px dashed #cbd5e1;">
                                    <span>Holiday Pay</span> <span>${holPay}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-bottom: 1px solid black; color: #16a34a; font-weight: bold;">
                                    <span>Performance Bonus</span> <span>${perfBonus}</span>
                                </div>
                                ${Number(payrollAdjustmentPay)>0?'<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-bottom:1px solid black;color:#166534;font-weight:bold"><span>Previous payroll credits</span><span>'+payrollAdjustmentPay+'</span></div>':''}
                                <div style="display: flex; justify-content: space-between; padding: 12px 8px; font-weight: bold; font-size: 16px;">
                                    <span>GROSS INCOME</span> <span>${grossIncome}</span>
                                </div>
                            </div>
                            <div>
                                <div style="background: #e2e8f0; padding: 8px; font-weight: bold; border-bottom: 1px solid black; text-align: left;">DEDUCTIONS</div>
                                <div style="padding:4px 8px;font-size:13px">${payslipDeductionSummaryHTML(d)}</div>
                                <div style="display: flex; justify-content: space-between; padding: 8px; font-weight: bold; background: #f1f5f9; border-top: 1px solid black;">
                                    <span>TOTAL DEDUCTIONS</span> <span>${totalDeduct}</span>
                                </div>
                            </div>
                        </div>

                        <div style="display: flex; justify-content: flex-start; align-items: center; margin-top: 20px;">
                            <div style="background: #cbd5e1; padding: 10px 20px; font-weight: bold; font-size: 18px; border: 1px solid black; width: 120px; text-align: center;">
                                NET PAY
                            </div>
                            <div style="padding: 10px 20px; font-weight: bold; font-size: 22px; margin-left: 20px; border-bottom: 2px solid black;">
                                ${netPay}
                            </div>
                        </div>

                        ${payslipDeductionDetailsHTML(d,{showTotal:false})}
                        ${payrollAdjustmentDetailsHTML(d)}
                        <!-- 🔥 ATTENDANCE SUMMARY TABLE -->
                        <div style="margin-top: 35px;">
                            <div style="border-top: 2px dashed #0f172a; margin-bottom: 20px;"></div>
                            <h4 style="text-align: center; color: #475569; font-size: 13px; letter-spacing: 1px; margin: 0 0 15px 0; text-transform: uppercase;">ATTENDANCE SUMMARY (CURRENT CUTOFF)</h4>
                            <table style="width: 100%; border-collapse: collapse; font-size: 13px; font-family: 'Segoe UI', Arial, sans-serif;">
                                <thead style="border-bottom: 2px solid #cbd5e1; background: #f8fafc;">
                                    <tr>
                                        <th style="padding: 10px 4px; color: #0f172a; text-align: center;">Date</th>
                                        <th style="padding: 10px 4px; color: #0f172a; text-align: center;">Time In</th>
                                        <th style="padding: 10px 4px; color: #0f172a; text-align: center;">Time Out</th>
                                        <th style="padding: 10px 4px; color: #0f172a; text-align: center;">Hours</th>
                                        <th style="padding: 10px 4px; color: #0f172a; text-align: right;">Remarks</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${attendanceHtml}
                                </tbody>
                            </table>
                        </div>

                        ${sigHtml}

                        <div style="text-align: center; margin-top: 25px; font-size: 10px; color: #64748b; font-style: italic;">
                            System Generated Digital Payslip • Takodeal POS
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    Swal.fire({
        html: html,
        width: '100%', 
        showConfirmButton: true,
        confirmButtonText: 'Close',
        confirmButtonColor: '#0f172a',
        customClass: { popup: 'rounded-2xl shadow-2xl p-0' }
    });
};

// 🔥 NEW: DEDICATED IMAGE DOWNLOADER FOR STAFF PHONES
window.downloadStaffPayslipImage = function(encodedData) {
    if (!window.staffVaultSession?.allows(localStorage.getItem('takodeal_staff_id'))) return;
    const payEpoch = window.staffVaultSession.epoch;
    let d = JSON.parse(decodeURIComponent(encodedData));
    let payslipNode = document.getElementById('printableStaffPayslip');
    if (!payslipNode) return;

    let btn = document.getElementById('btnDownloadStaffPayslip');
    let origText = btn ? btn.innerText : "⬇️ Download HD Image";
    if (btn) { btn.innerText = "⏳ Generating..."; btn.disabled = true; }

    // Create an invisible, perfect 800px wrapper so the phone doesn't compress it
    const printWrapper = document.createElement('div');
    printWrapper.setAttribute('data-pay-export', 'true');
    printWrapper.style.position = 'absolute';
    printWrapper.style.left = '-9999px'; 
    printWrapper.style.top = '0';
    printWrapper.style.background = '#ffffff';
    printWrapper.style.width = '800px'; 
    printWrapper.style.padding = '20px';
    printWrapper.style.boxSizing = 'border-box';
    
    const clone = payslipNode.cloneNode(true);
    clone.style.overflow = 'visible';
    clone.style.maxHeight = 'none';
    clone.style.height = 'auto';
    clone.style.width = '100%';
    
    printWrapper.appendChild(clone);
    document.body.appendChild(printWrapper);

    // Blast it into an HD Canvas!
    html2canvas(printWrapper, { scale: 2, backgroundColor: "#ffffff" }).then(canvas => {
        if (!window.staffVaultSession.allows(localStorage.getItem('takodeal_staff_id'), payEpoch)) { printWrapper.remove(); return; }
        let imgData = canvas.toDataURL("image/png");
        let link = document.createElement('a');
        
        let staffName = (d.name || d.staffName || "Staff").replace(/\s+/g, '_');
        let endDate = d.end || d.endDate || "Date";
        link.download = `Payslip_${staffName}_${endDate}.png`;
        
        link.href = imgData;
        link.click();

        printWrapper.remove(); 
        if (btn) { btn.innerText = origText; btn.disabled = false; }
    }).catch(err => {
        console.error("Error generating image:", err);
        Swal.fire('Error', 'Failed to generate image.', 'error');
        printWrapper.remove();
        if (btn) { btn.innerText = origText; btn.disabled = false; }
    });
};

// ==========================================
// 🗓️ PERSONAL STAFF SCHEDULE & SWAP ENGINE
// ==========================================
window.cachedSchedData = null; // Memory to make swaps lightning fast

window.loadStaffSchedule = async function() {
    let container = document.getElementById('scheduleContainer');
    if (!container) return;
    const loadToken = window.staffScheduleLoadToken = (window.staffScheduleLoadToken || 0) + 1;
    const staffId = localStorage.getItem('takodeal_staff_id');
    const scheduleViewToken = window.staffScheduleSync?.token();
    const scheduleStaffName = localStorage.getItem('takodeal_staff_name');
    const picker = document.getElementById('staffMonthPicker');
    const requestedMonth = picker?.value || scheduleDateKey(new Date()).slice(0,7);
    const stillCurrent = () => window.staffScheduleLoadToken === loadToken
        && localStorage.getItem('takodeal_staff_id') === staffId
        && localStorage.getItem('takodeal_staff_name') === scheduleStaffName
        && (!window.staffScheduleSync || window.staffScheduleSync.current(scheduleViewToken))
        && (picker?.value || requestedMonth) === requestedMonth;
    window.cachedSchedData = null;
    window.cachedSchedProfile = null;
    window.cachedScheduleDaySnapshots = {};window.cachedScheduleDayRevisions = {};
    
    let staffName = localStorage.getItem('takodeal_staff_name');
    if (!staffName) {
        container.innerHTML = '<div style="text-align:center; padding: 40px; color: #ef4444; font-weight: bold;">Not logged in.</div>';
        return;
    }

    container.innerHTML = '<div style="text-align:center; padding: 40px; color: #0ea5e9; font-weight: bold;">⏳ Downloading your schedule...</div>';

    try {
        const selected = monthKey(requestedMonth);
        const [year, month] = selected.split('-').map(Number);
        if (picker) picker.value = selected;
        const staffSnap = await window.getDocFromServer(window.doc(window.db, 'cashiers', staffId));
        if (!stillCurrent()) return;
        
        let nickname = staffName;
        let myBranch = null;
        
        if (staffSnap.exists()) {
            let data = staffSnap.data();
            nickname = data.scheduleNickname || staffName;
            myBranch = data.branch;
            window.cachedSchedProfile = data;
        } else throw new Error('Your staff profile is unavailable. Sign in again or ask HQ to check your account.');

        const monthView = await loadScheduleMonthView(window, {month:selected});
        if (!stillCurrent()) return;
        if (!monthView.hasSavedSchedule) {
            const niceMonth = new Date(year,month-1).toLocaleString('en-PH',{month:'long',year:'numeric'});
            container.innerHTML = `<div style="text-align:center;padding:40px;color:#64748b;font-weight:bold">HQ has not saved a schedule for ${niceMonth} yet.</div>`;
            window.cachedSchedData = null;
            return;
        }
        let schedData = structuredClone(monthView.snapshot);
        window.cachedScheduleDaySnapshots = monthView.daySnapshots;
        window.cachedScheduleDayRevisions = monthView.dayRevisions;
        window.cachedSchedData = schedData;

        let monthName = new Date(year, month - 1).toLocaleString('en-PH', { month: 'long' });
        
        let branchConfig = schedData.branchConfig || {};
        let schedule = schedData.currentSchedule;
        let holidays = schedData.holidays || {};

        let html = `
            <div style="background: white; border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
                <div style="background: #0f172a; color: white; padding: 15px; text-align: center;">
                    <h3 style="margin: 0; font-size: 18px;">🗓️ ${monthName} ${year}</h3>
                    <div style="font-size: 12px; color: #94a3b8; margin-top: 4px; font-weight: bold;">Home Branch: ${myBranch || 'Unassigned'}</div>
                </div>
                <div style="max-height: 60vh; overflow-y: auto;">
                    <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
                        <thead style="background: #f8fafc; position: sticky; top: 0; z-index: 10; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                            <tr>
                                <th style="padding: 12px 15px; color: #475569; border-bottom: 2px solid #cbd5e1; width: 35%;">Date</th>
                                <th style="padding: 12px 15px; color: #475569; border-bottom: 2px solid #cbd5e1;">Shift Status</th>
                            </tr>
                        </thead>
                        <tbody>
        `;

        let daysInMonth = new Date(year, month, 0).getDate();
        let hasShifts = false;

        const todayKey = scheduleDateKey(new Date());

        for (let day = 1; day <= daysInMonth; day++) {
            let dStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            let dateObj = new Date(year, month - 1, day);
            let displayDate = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            
            let isFutureOrToday = dStr >= todayKey;

            let dayData = schedule[day];
            if (!dayData) continue;

            let shiftFound = null;
            let isStandby = false;
            let isLeave = false;
            let leaveReason = "";
            let assignedToBranch = "";

            const savedDay=staffScheduleDay(dayData,window.cachedScheduleDaySnapshots?.[day]?.branchConfig||branchConfig,
                [staffName,nickname,window.cachedSchedProfile?.cashierName,window.cachedSchedProfile?.nickname]);
            if(!savedDay.conflict&&savedDay.assignments.length===1){
                shiftFound=savedDay.assignments[0].shift;assignedToBranch=savedDay.assignments[0].branch;
            } else if(!savedDay.assignments.length&&savedDay.unavailable.length){
                isLeave=true;leaveReason=savedDay.unavailable[0].status;assignedToBranch=savedDay.unavailable[0].branch;
            } else if(!savedDay.assignments.length&&savedDay.standby.length){
                isStandby=true;assignedToBranch=savedDay.standby[0].branch;
            }

            let holType = window.cachedScheduleDaySnapshots?.[day]?.holidays?.[dStr] ?? holidays[dStr];
            let holBadge = holType ? `<div style="font-size: 10px; color: #ea580c; font-weight: bold; margin-top: 4px;">🎉 ${holType} Holiday</div>` : '';

            let rowBg = "white";
            let statusHtml = '<span style="color: #94a3b8; font-style: italic;">No Schedule</span>';

            // Show a Relief Badge if they are working outside their home branch!
            let reliefBadge = '';
            if (assignedToBranch && assignedToBranch !== myBranch) {
                reliefBadge = `<div style="font-size: 10px; color: #b45309; font-weight: bold; background: #fef3c7; padding: 2px 6px; border-radius: 4px; display: inline-block; margin-top: 4px; border: 1px solid #fde68a;">🌍 Relief: ${assignedToBranch}</div>`;
            }

            if (savedDay.conflict) {
                rowBg = '#fff8e8';statusHtml=renderStaffScheduleConflict(savedDay);hasShifts=true;
            } else if (isLeave) {
                rowBg = "#fef2f2";
                statusHtml = `<span style="background: #fecaca; color: #b91c1c; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">🚫 ${leaveReason}</span>${reliefBadge}`;
                hasShifts = true;
            } else if (isStandby) {
                rowBg = "#fffbeb";
                statusHtml = `<span style="background: #fde68a; color: #b45309; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">🛋️ Standby / Day Off</span>${reliefBadge}`;
                hasShifts = true;
            } else if (shiftFound) {
                rowBg = "#f0fdf4";
                
                let timeString = shiftFound.name;
                if (shiftFound.startTime && shiftFound.endTime) {
                    let formatTime = (time24) => {
                        let [h, m] = time24.split(':'); h = parseInt(h);
                        let ampm = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
                        return `${h}:${m} ${ampm}`;
                    };
                    timeString = `<div style="font-weight: 900; color: #0f172a;">${shiftFound.name}</div><div style="font-size: 11px; color: #0ea5e9; margin-top: 2px;">⏰ ${formatTime(shiftFound.startTime)} to ${formatTime(shiftFound.endTime)}</div>`;
                } else {
                    timeString = `<div style="font-weight: 900; color: #0f172a;">${shiftFound.name}</div>`;
                }

                // The Request Swap Button!
                let swapBtn = isFutureOrToday ? `<button onclick="window.initiateSwapRequest(${day}, '${dStr}', '${assignedToBranch}', '${shiftFound.id}', '${shiftFound.name.replace(/'/g, "\\'")}')" style="margin-top: 8px; background: white; color: #d97706; border: 1px solid #fcd34d; padding: 6px 10px; border-radius: 6px; font-size: 11px; font-weight: bold; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.05); width: 100%;">🔄 Request Swap</button>` : '';

                statusHtml = timeString + reliefBadge + swapBtn;
                hasShifts = true;
            }

            let isToday = dStr === todayKey;
            let todayBorder = isToday ? 'border-left: 4px solid #0ea5e9;' : '';
            let todayBadge = isToday ? '<br><span style="background: #0ea5e9; color: white; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; display: inline-block; margin-top: 4px;">TODAY</span>' : '';

            html += `
                <tr style="border-bottom: 1px solid #f1f5f9; background: ${rowBg};">
                    <td style="padding: 12px 15px; color: #334155; font-weight: bold; ${todayBorder}">${displayDate} ${todayBadge}${holBadge}</td>
                    <td style="padding: 12px 15px;">${statusHtml}</td>
                </tr>
            `;
        }

        html += `</tbody></table></div></div>`;
        
        if (!hasShifts) html = '<div style="text-align:center; padding: 40px; color: #64748b; font-weight: bold;">You have no assigned shifts for this month.</div>';
        container.innerHTML = html;

    } catch (error) {
        if (!stillCurrent()) return;
        console.error("Staff Schedule Error:", error);
        container.innerHTML = '<div style="text-align:center; padding: 40px; color: #ef4444; font-weight: bold;">❌ Failed to load schedule. Check connection.</div>';
    }
};

window.cancelSwapRequest = function() {
    if(window.staffSwapWritePending)return staffSwapMessage('Request is sending','Wait for HQ to confirm the request. Closing or retrying now could hide its result.','info');
    if(window.pendingSwapData?.sendUnconfirmed)return staffSwapMessage('Keep the previous send reference','Its result is not confirmed. Check with your co-worker or Owner before closing or starting another request.','warning');
    const workflow=window.staffSwapWorkflow;if(workflow){workflow.cancelled=true;finishStaffSwapProgress(workflow);}
    window.staffSwapRequestGeneration=(window.staffSwapRequestGeneration||0)+1;
    window.pendingSwapData=null;
    window.staffSwapSubmitting=null;
    const button=document.getElementById('btnSendSwap'),cancel=document.getElementById('btnCancelSwap');if(button){button.disabled=false;button.textContent='Send Request';}if(cancel)cancel.disabled=false;
    const modal=document.getElementById('swapRequestModal');if(modal)modal.style.display='none';
};

function staffSwapMessage(title,text,icon){
    const modal=document.getElementById('swapRequestModal');
    return Swal.fire({...modal&&modal.style.display!=='none'?{target:modal}:{},titleText:title,text,icon});
}
function beginStaffSwapProgress(title){
    const modal=document.getElementById('swapRequestModal'),workflow={phase:'checking',cancelled:false,popup:null};window.staffSwapWorkflow=workflow;
    Promise.resolve(Swal.fire({...modal&&modal.style.display!=='none'?{target:modal}:{},titleText:title,text:'Confirming the current saved evidence. Slow connections can take up to 45 seconds. Nothing has been sent yet.',allowOutsideClick:false,allowEscapeKey:true,showCancelButton:true,cancelButtonText:'Cancel check',didOpen:popup=>{if(window.staffSwapWorkflow!==workflow||workflow.phase!=='checking'||workflow.cancelled)return;const currentPopup=Swal.getPopup?.();if(popup&&currentPopup!==popup)return;workflow.popup=currentPopup;Swal.showLoading();}})).then(result=>{
        if(window.staffSwapWorkflow===workflow&&workflow.phase==='checking'&&['cancel','esc'].includes(result?.dismiss))window.cancelSwapRequest();
    }).catch(()=>{if(window.staffSwapWorkflow===workflow&&workflow.phase==='checking')window.cancelSwapRequest();});
    return workflow;
}
function updateStaffSwapProgress(workflow,text,writing=false){
    if(window.staffSwapWorkflow!==workflow||workflow.cancelled)return;
    if(workflow.popup&&Swal.getPopup?.()!==workflow.popup)return;
    Swal.update?.({titleText:writing?'Sending your swap request…':text,text:writing?'Keep this screen open until HQ confirms the send. Do not send the request again while its result is unknown.':'Checking fresh saved evidence across all branches. Nothing has been sent yet.',showCancelButton:!writing,allowEscapeKey:!writing});
}
function finishStaffSwapProgress(workflow){
    if(window.staffSwapWorkflow!==workflow)return;
    workflow.phase='finished';window.staffSwapWorkflow=null;
    if(!workflow.popup||Swal.getPopup?.()===workflow.popup)Swal.close?.();
}

window.initiateSwapRequest = async function(day,dateStr,branch,myShiftId,myShiftName) {
    if(window.pendingSwapData?.sendUnconfirmed)return staffSwapMessage('Check the previous send','Its result is not confirmed. Check with your co-worker or Owner before starting another request.','warning');
    if(window.staffSwapSubmitting||window.staffSwapWritePending)return staffSwapMessage('Sending request','Wait for your current request to finish.','info');
    if(window.staffSwapWorkflow?.phase==='checking')return;
    const staffId=localStorage.getItem('takodeal_staff_id'),staffName=localStorage.getItem('takodeal_staff_name');
    const user=staffPrimaryAuth.currentUser,deviceId=localStorage.getItem('takodeal_device_id');
    const scheduleToken=window.staffScheduleSync?.token();
    const generation=window.staffSwapRequestGeneration=(window.staffSwapRequestGeneration||0)+1;
    window.pendingSwapData=null;
    let workflow;
    const assertCurrent=()=>{
        if(window.staffSwapRequestGeneration!==generation||workflow?.cancelled||staffPrimaryAuth.currentUser!==user||localStorage.getItem('takodeal_device_id')!==deviceId||localStorage.getItem('takodeal_staff_id')!==staffId||localStorage.getItem('takodeal_staff_name')!==staffName)throw Error('Your staff account or swap selection changed. Open the request again.');
        if(window.staffScheduleSync&&!window.staffScheduleSync.current(scheduleToken))throw Error('The schedule view changed. Open the request again.');
        if(document.getElementById('staffMonthPicker')?.value!==monthKey(dateStr))throw Error('The selected schedule month changed. Open the request again.');
    };
    try {
        const date=scheduleDateKey(dateStr);
        if(Number(day)!==Number(date.slice(-2))||date<scheduleDateKey(new Date()))throw Error('Choose a current or future work date.');
        workflow=beginStaffSwapProgress('Checking all branch schedules…');
        const context=await loadStaffSwapContext(window,{staffId,staffName,workDate:date,assertCurrent,onProgress:text=>updateStaffSwapProgress(workflow,text)});
        const candidates=swapCandidates({snapshot:context.snapshot,daySnapshots:context.daySnapshots,workDate:date,requesterBranch:branch,requesterShiftId:myShiftId,requesterAliases:context.requesterAliases,requesterStaffId:staffId});
        assertCurrent();finishStaffSwapProgress(workflow);
        if(!candidates.length)return staffSwapMessage('No eligible co-workers','No eligible scheduled or standby staff were found across the saved branch schedules for '+date+'. No request was sent. Ask HQ to check your exact assignment, staff links, saved hours and overnight conflicts.','info');
        const select=document.getElementById('swapCandidateSelect'),placeholder=document.createElement('option');
        placeholder.value='';placeholder.textContent='-- Choose Co-Worker --';select.replaceChildren(placeholder);
        for(const kind of ['scheduled','standby']){
            const group=document.createElement('optgroup');group.label=kind==='scheduled'?'🔄 Swap with Scheduled Staff · All Branches':'🛋️ Ask Standby Staff to Cover · All Branches';
            candidates.forEach((candidate,index)=>{
                if(candidate.kind!==kind)return;
                const option=document.createElement('option');option.value=String(index);
                option.textContent=(candidate.targetName||candidate.targetAssignedName)+' — '+candidate.targetBranch+' · '+(kind==='standby'?'Standby / Day Off':candidate.targetShiftName);
                group.appendChild(option);
            });
            if(group.children.length)select.appendChild(group);
        }
        const assigned=context.snapshot.currentSchedule[context.day][branch].scheduled[myShiftId];
        const rule=context.snapshot.branchConfig[branch].find(shift=>shift.id===myShiftId);
        window.pendingSwapData={day:context.day,dateStr:date,workDate:date,branch,myShiftId,myShiftName:rule.name||myShiftName,sourceScheduleMonth:context.sourceScheduleMonth,sourceRevisionId:context.sourceRevisionId,requesterAssignedName:assigned,staffId,staffName,user,deviceId,generation,contextKey:staffSwapContextKey(context),candidates};
        document.getElementById('swapModalDetails').textContent='You are requesting to trade '+(rule.name||myShiftName)+' at '+branch+' on '+date+'. Branches are shown beside each co-worker.';
        document.getElementById('swapRequestModal').style.display='flex';
    }catch(error){
        if(workflow)finishStaffSwapProgress(workflow);
        if(window.staffSwapRequestGeneration!==generation)return;
        staffSwapMessage('Could not prepare swap',error.message+' No request was sent.','warning');
    }
};

window.submitSwapRequest = async function() {
    const select=document.getElementById('swapCandidateSelect'),selectedValue=select.value,d=window.pendingSwapData,index=Number(selectedValue);
    if(!d||!selectedValue||!Number.isSafeInteger(index)||String(index)!==selectedValue||!d.candidates[index])return staffSwapMessage('Required','Please select a co-worker from this request.','warning');
    if(window.staffSwapSubmitting)return;
    if(window.staffSwapWritePending)return staffSwapMessage('Check the previous send','A previous send is still pending or unconfirmed. Check with your co-worker or Owner before sending again.','warning');
    if(d.sendUnconfirmed)return staffSwapMessage('Check the previous send','Its result was not confirmed. Check with your co-worker or Owner before starting another request.','warning');
    const candidate=d.candidates[index],button=document.getElementById('btnSendSwap'),cancel=document.getElementById('btnCancelSwap');
    let workflow,writeStarted=false,writeAcknowledged=false;
    const assertCurrent=()=>{
        if(window.pendingSwapData!==d||window.staffSwapRequestGeneration!==d.generation||workflow?.cancelled||staffPrimaryAuth.currentUser!==d.user||localStorage.getItem('takodeal_device_id')!==d.deviceId||localStorage.getItem('takodeal_staff_id')!==d.staffId||localStorage.getItem('takodeal_staff_name')!==d.staffName||document.getElementById('staffMonthPicker')?.value!==d.sourceScheduleMonth||select.value!==selectedValue||document.getElementById('swapRequestModal').style.display==='none')throw Error('Your staff account, date or selected co-worker changed. Open the request again.');
    };
    window.staffSwapSubmitting=d;if(button){button.disabled=true;button.textContent='Checking current schedule…';}if(cancel)cancel.disabled=false;
    try {
        assertCurrent();
        if(d.workDate<scheduleDateKey(new Date()))throw Error('Past schedules stay unchanged. Choose a current or future work date.');
        workflow=beginStaffSwapProgress('Checking before sending…');
        const context=await loadStaffSwapContext(window,{staffId:d.staffId,staffName:d.staffName,workDate:d.workDate,assertCurrent,onProgress:text=>updateStaffSwapProgress(workflow,text)});
        if(staffSwapContextKey(context)!==d.contextKey)throw Error('HQ changed the schedule while this request was open. Refresh and choose again.');
        const fresh=swapCandidates({snapshot:context.snapshot,daySnapshots:context.daySnapshots,workDate:d.workDate,requesterBranch:d.branch,requesterShiftId:d.myShiftId,requesterAliases:context.requesterAliases,requesterStaffId:d.staffId}).find(row=>swapCandidateKey(row)===swapCandidateKey(candidate));
        if(!fresh)throw Error('This co-worker is no longer eligible for this swap. Refresh and choose again.');
        assertCurrent();
        workflow.phase='writing';writeStarted=true;window.staffSwapWritePending=true;if(cancel)cancel.disabled=true;if(button)button.textContent='Waiting for HQ confirmation…';updateStaffSwapProgress(workflow,'',true);
        await addDoc(collection(db,'shift_swaps'),{
            requesterName:context.requesterName,requesterStaffId:d.staffId,requesterAssignedName:d.requesterAssignedName,
            targetName:fresh.targetName||fresh.targetAssignedName,targetAssignedName:fresh.targetAssignedName,
            ...(fresh.targetStaffId?{targetStaffId:fresh.targetStaffId}:{}),
            branch:d.branch,targetBranch:fresh.targetBranch,workDate:d.workDate,dateStr:d.workDate,dayIndex:d.day,
            sourceScheduleMonth:d.sourceScheduleMonth,sourceRevisionId:d.sourceRevisionId,
            requesterShiftId:d.myShiftId,requesterShiftName:d.myShiftName,targetShiftId:fresh.targetShiftId,targetShiftName:fresh.targetShiftName,
            requestVersion:SWAP_REQUEST_VERSION,status:SWAP_PENDING_STATUS,timestamp:serverTimestamp()
        });
        writeAcknowledged=true;window.staffSwapWritePending=false;finishStaffSwapProgress(workflow);
        const ownsWindow=window.pendingSwapData===d;if(ownsWindow)window.pendingSwapData=null;
        if(!ownsWindow||localStorage.getItem('takodeal_staff_id')!==d.staffId||localStorage.getItem('takodeal_staff_name')!==d.staffName||staffPrimaryAuth.currentUser!==d.user)return;
        document.getElementById('swapRequestModal').style.display='none';
        staffSwapMessage('Request sent','Your request was sent to '+(fresh.targetName||fresh.targetAssignedName)+'. The schedule changes only after their acceptance and HQ approval.','success');
    }catch(error){
        const unconfirmed=writeStarted&&!writeAcknowledged;if(unconfirmed)d.sendUnconfirmed=true;
        window.staffSwapWritePending=unconfirmed;if(workflow)finishStaffSwapProgress(workflow);
        if(localStorage.getItem('takodeal_staff_id')===d.staffId&&localStorage.getItem('takodeal_staff_name')===d.staffName&&staffPrimaryAuth.currentUser===d.user&&(window.pendingSwapData===d||writeAcknowledged))staffSwapMessage(writeAcknowledged?'Request saved':unconfirmed?'Send not confirmed':'Could not send request',writeAcknowledged?'HQ confirmed the send, but this screen could not finish refreshing. Check with your co-worker; do not send it again.':unconfirmed?'The send was not confirmed. Check with your co-worker or Owner before starting another request; it may already be saved.':error.message+' No request was sent.','warning');
    }finally{
        if(window.staffSwapSubmitting===d){window.staffSwapSubmitting=null;if(button){button.disabled=d.sendUnconfirmed===true;button.textContent=d.sendUnconfirmed?'Check previous send':'Send Request';}if(cancel)cancel.disabled=false;}
    }
};

window.listenToIncomingSwaps = async function() {
    let staffName = localStorage.getItem('takodeal_staff_name');
    let staffId = localStorage.getItem('takodeal_staff_id');
    if (!staffName || !staffId) return window.stopStaffLiveListeners();
    const key = staffId + '|' + staffName, epoch = window.staffLiveListenerEpoch;
    // Reserve the identity before fetching its nickname to deduplicate concurrent starts.
    if (window.staffSwapListenerKey === key) return;
    if (window.staffSwapUnsubscribe) window.staffSwapUnsubscribe();
    window.staffSwapUnsubscribe = null;
    window.staffSwapListenerKey = key;
    const current = () => epoch === window.staffLiveListenerEpoch && window.staffSwapListenerKey === key && localStorage.getItem('takodeal_staff_id') === staffId && localStorage.getItem('takodeal_staff_name') === staffName;

    let nickname = staffName,swapAliases=[staffName];
    try {
        const docSnap = await getDoc(doc(db, "cashiers", staffId));
        if(docSnap.exists()){nickname=docSnap.data().scheduleNickname||staffName;swapAliases=staffSwapAliases(docSnap.data());}
    } catch(e) {}
    if (!current()) return;

    let isMatch = (assignedName) => {
        if (!assignedName || assignedName === "N/A" || assignedName === "UNFILLED") return false;
        let aName = assignedName.toLowerCase().trim();
        return swapAliases.some(name=>name.toLowerCase().trim()===aName);
    };

    window.staffSwapUnsubscribe = onSnapshot(query(collection(db, "shift_swaps"), where("status", "in", ["Pending",SWAP_PENDING_STATUS])), (snap) => {
        if (!current()) return;
        
        // 🔥 DYNAMIC UI INJECTOR: Ensure the container exists and doesn't get wiped!
        let container = document.getElementById('incomingSwapsContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'incomingSwapsContainer';
            container.style.cssText = "display: none; padding: 0 15px; margin-bottom: 15px; text-align: left;";
            
            // Insert it safely outside the scheduleContainer so it survives refreshes!
            let viewSched = document.getElementById('view-schedule');
            let monthPicker = document.getElementById('staffMonthPicker');
            if (monthPicker) {
                monthPicker.parentElement.insertAdjacentElement('afterend', container);
            } else if (viewSched) {
                viewSched.insertBefore(container, document.getElementById('scheduleContainer'));
            }
        }

        let badge = document.getElementById('navSchedBadge');
        let myPendingSwaps = [];
        
        snap.forEach(docSnap => {
            let d = docSnap.data();
            // Did this request use my short name OR my full name?
            if (d.targetStaffId ? d.targetStaffId===staffId : isMatch(d.targetAssignedName||d.targetName)) {
                myPendingSwaps.push({ id: docSnap.id, ...d });
            }
        });

        if (myPendingSwaps.length === 0) {
            container.style.display = 'none';
            if(badge) badge.style.display = 'none';
            return;
        }

        if(badge) badge.style.display = 'inline-block';

        let html = '<h3 style="color: #ea580c; margin-top:0; font-size:15px; border-bottom: 2px dashed #fcd34d; padding-bottom: 8px;">🔄 Shift Swap Requests</h3>';
        
        myPendingSwaps.forEach(d => {
            html += `
                <div style="background: #fffbeb; border: 1px solid #fcd34d; padding: 15px; border-radius: 8px; margin-bottom: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <div style="font-size: 13px; color: #b45309; margin-bottom: 12px; line-height: 1.5;">
                        ${incomingSwapDetailsHTML(d)}
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <button onclick="window.handleIncomingSwap(${swapEscape(JSON.stringify(d.id))}, 'Approved')" style="flex:1; background: #16a34a; color: white; border: none; padding: 10px; border-radius: 6px; font-weight: bold; cursor: pointer; box-shadow: 0 2px 4px rgba(22, 163, 74, 0.2);">✅ Accept</button>
                        <button onclick="window.handleIncomingSwap(${swapEscape(JSON.stringify(d.id))}, 'Rejected')" style="flex:1; background: #ef4444; color: white; border: none; padding: 10px; border-radius: 6px; font-weight: bold; cursor: pointer; box-shadow: 0 2px 4px rgba(239, 68, 68, 0.2);">❌ Reject</button>
                    </div>
                </div>
            `;
        });
        
        container.innerHTML = html;
        container.style.display = 'block';
    }, error => {
        if (!current()) return;
        window.staffSwapUnsubscribe = null; window.staffSwapListenerKey = null;
        console.error('Staff swap listener:', error);
    });
};

window.handleIncomingSwap = async function(swapId, action) {
    if (!['Approved', 'Rejected'].includes(action)) return;
    if (!confirm(`Are you sure you want to ${action === 'Approved' ? 'accept this swap for HQ review' : 'reject this swap'}?`)) return;
    const staffId = localStorage.getItem('takodeal_staff_id');
    if (!staffId) return Swal.fire('Sign in required', 'Sign in to your staff account before responding.', 'warning');
    Swal.fire({title:'Processing...', allowOutsideClick:false, didOpen:()=>Swal.showLoading()});
    try {
        const result = await runTransaction(db, async transaction => {
            const requestRef = doc(db,'shift_swaps',swapId), profileRef = doc(db,'cashiers',staffId);
            const [request, profile] = await Promise.all([transaction.get(requestRef),transaction.get(profileRef)]);
            if (localStorage.getItem('takodeal_staff_id') !== staffId) throw Error('Your staff account changed. Sign in again.');
            if (!request.exists() || !profile.exists()) throw Error('This request or staff profile is no longer available.');
            const data = request.data(), person = profile.data();
            const key = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
            const aliases = new Set(staffSwapAliases(person).map(key));
            const targetNames=[data.targetAssignedName,data.targetName].filter(name=>typeof name==='string'&&name.trim());
            if (data.targetStaffId&&data.targetStaffId!==staffId||!targetNames.length||!targetNames.every(name=>aliases.has(key(name)))||!activeStaffProfile(person)||person.scheduleEligible===false) throw Error('This swap is not assigned to your active staff account.');
            const versioned=data.requestVersion===SWAP_REQUEST_VERSION;
            if(data.requestVersion!==undefined&&!versioned||!versioned&&data.targetBranch&&data.targetBranch!==data.branch)throw Error('Ask the requester to resend this swap using the updated Staff app.');
            const pendingStatus=versioned?SWAP_PENDING_STATUS:'Pending',reviewStatus=versioned?SWAP_REVIEW_STATUS:'Awaiting HQ Approval';
            if (data.status === reviewStatus && data.acceptedByStaffId === staffId && action === 'Approved') return 'already-accepted';
            if (data.status !== pendingStatus) throw Error('This swap was already processed or needs an updated request. Refresh the schedule.');
            if (action === 'Rejected') {
                transaction.update(requestRef,{status:'Rejected',rejectedByStaffId:staffId,rejectedBy:person.cashierName,rejectedAt:serverTimestamp()});
                return 'rejected';
            }
            if (!data.workDate || scheduleDateKey(data.workDate) < scheduleDateKey(new Date()) || monthKey(data.workDate) !== data.sourceScheduleMonth) throw Error('This request has no current or future work date. Ask the requester to send it again.');
            transaction.update(requestRef,{status:reviewStatus,acceptedByStaffId:staffId,acceptedBy:person.cashierName,
                acceptedAt:serverTimestamp(),acceptanceVersion:1});
            return 'accepted';
        });
        if (result === 'rejected') Swal.fire('Rejected','The swap request was declined.','info');
        else Swal.fire('Sent to HQ','You accepted the request. HQ must approve it before the dated schedule changes.','success');
        const swapModal = document.getElementById('swapRequestModal');if(swapModal)swapModal.style.display='none';
        window.loadStaffSchedule();
    } catch(error) {console.error(error);Swal.fire('Could not process swap',error.message,'error');}
};

// ========================================================
// 📅 DYNAMIC SCHEDULE IMAGE NOTIFICATION ENGINE
// ========================================================

if (typeof window.originalViewAnnouncement === 'undefined') {
    window.originalViewAnnouncement = window.viewAnnouncement;
}

window.viewAnnouncement = async function(encodedData) {
    let data = JSON.parse(decodeURIComponent(encodedData));
    
    // Quick fetch to check if it has the secret "isSchedule" flag!
    let isSchedule = false;
    try {
        const docSnap = await window.getDoc(window.doc(window.db, "announcements", data.id));
        if (docSnap.exists() && docSnap.data().isSchedule) {
            isSchedule = true;
        }
    } catch(e) {}

    // 🔥 THE NEW SCHEDULE IMAGE POPUP ENGINE 🔥
    if (isSchedule) {
        let imgUrl = data.images && data.images.length > 0 ? data.images[0] : '';
        
        let ackBtnHtml = data.hasSignature 
            ? `<div style="width: 100%; background: #dcfce7; color: #16a34a; padding: 15px; border-radius: 8px; font-weight: 900; font-size: 16px; text-align: center; border: 2px solid #bbf7d0;">✅ You acknowledged this schedule on ${data.signatureDate}</div>`
            : `<button onclick="window.submitScheduleAck('${data.id}')" id="btnAckSched" style="width: 100%; background: #10b981; color: white; border: none; padding: 15px; border-radius: 8px; font-weight: 900; font-size: 18px; cursor: pointer; box-shadow: 0 4px 6px rgba(16, 163, 74, 0.3);">✅ I ACKNOWLEDGE MY SHIFTS</button>`;

        let modalHtml = `
            <div id="schedulePopupOverlay" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(15, 23, 42, 0.95); z-index: 100000; display: flex; flex-direction: column; align-items: center; justify-content: center; backdrop-filter: blur(5px);">
                <div style="background: white; padding: 15px; border-radius: 12px; width: 95vw; max-width: 700px; max-height: 95vh; display: flex; flex-direction: column; align-items: center; box-shadow: 0 25px 50px rgba(0,0,0,0.5);">
                    <div style="width: 100%; display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 10px;">
                        <h2 style="margin: 0; color: #0f172a; text-transform: uppercase; font-size: 18px;">📅 New Schedule Posted</h2>
                        ${data.hasSignature ? `<button onclick="document.getElementById('schedulePopupOverlay').remove()" style="background: #ef4444; color: white; border: none; width: 30px; height: 30px; border-radius: 6px; font-weight: bold; cursor: pointer;">✖</button>` : ''}
                    </div>
                    <div style="flex: 1; overflow-y: auto; width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; margin-bottom: 15px; background: #f8fafc;">
                        <img src="${imgUrl}" style="width: 100%; height: auto; display: block;">
                    </div>
                    ${ackBtnHtml}
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        return; // Intercepts and stops the normal Bulletin Board from opening!
    }

    // If it's a normal memo announcement, run the standard code!
    window.originalViewAnnouncement(encodedData);
};

window.submitScheduleAck = async function(announcementId) {
    let btn = document.getElementById('btnAckSched');
    btn.innerText = "⏳ Saving..."; btn.disabled = true;

    let cashierName = localStorage.getItem('cashierName') || localStorage.getItem('takodeal_staff_name') || 'Staff';

    // A visual trick so the Manager App sees a text graphic instead of a broken signature image!
    let quickSigImg = "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='250' height='50'%3E%3Ctext x='10' y='30' font-family='Arial' font-size='18' font-weight='bold' fill='%2316a34a'%3E%E2%9C%85 1-Click Acknowledged%3C/text%3E%3C/svg%3E";

    try {
        await window.addDoc(window.collection(window.db, "acknowledgments"), {
            announcementId: announcementId,
            staffName: cashierName,
            signature: quickSigImg,
            timestamp: window.serverTimestamp()
        });

        document.getElementById('schedulePopupOverlay').remove();
        
        Swal.fire({
            toast: true, position: 'top-end', icon: 'success', 
            title: 'Schedule Acknowledged!', 
            showConfirmButton: false, timer: 2500
        });

        // If there's another unread announcement in the queue, automatically show it!
        if (typeof window.currentBulletinIndex !== 'undefined' && window.activeAnnouncements) {
            window.currentBulletinIndex++;
            if (window.currentBulletinIndex < window.activeAnnouncements.length) {
                let nextData = window.activeAnnouncements[window.currentBulletinIndex];
                let encoded = encodeURIComponent(JSON.stringify(nextData));
                window.viewAnnouncement(encoded);
            } else {
                window.hasAutoShownBulletin = true;
            }
        }

        // Refresh the backend lists
        if (typeof window.loadBulletinHistory === 'function') window.loadBulletinHistory();
        if (typeof window.loadAnnouncements === 'function') window.loadAnnouncements();

    } catch (e) {
        console.error("Ack Error:", e);
        Swal.fire("Error", "Failed to acknowledge schedule.", "error");
        btn.innerText = "✅ I ACKNOWLEDGE MY SHIFTS"; btn.disabled = false;
    }
};

// ========================================================
// 🚨 STAFF APP: HR SANCTION INTERCEPTOR & SIGNATURE ENGINE
// ========================================================
window.hasSignedStaffNTE = false;

window.initStaffAppSignaturePad = function() {
    const canvas = document.getElementById('staffAppSignatureCanvas');
    if (!canvas) return;
    
    // Sync resolution to device width for perfect tracking on phones
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    
    const ctx = canvas.getContext('2d');
    let isDrawing = false;
    window.hasSignedStaffNTE = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0f172a';

    const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    };

    const startDraw = (e) => { 
        isDrawing = true; window.hasSignedStaffNTE = true; 
        const pos = getPos(e); ctx.beginPath(); ctx.moveTo(pos.x, pos.y); e.preventDefault(); 
    };
    const draw = (e) => { 
        if (!isDrawing) return; 
        const pos = getPos(e); ctx.lineTo(pos.x, pos.y); ctx.stroke(); e.preventDefault(); 
    };
    const stopDraw = () => { isDrawing = false; ctx.closePath(); };

    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDraw);
    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDraw);
};

window.clearStaffAppSignature = function() {
    const canvas = document.getElementById('staffAppSignatureCanvas');
    if (canvas) {
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
        window.hasSignedStaffNTE = false;
    }
};

window.renderActiveSanctions = function(snap, staffName) {
    if (localStorage.getItem('takodeal_staff_name') !== staffName) return false;
    const epoch = window.staffLiveListenerEpoch;
    const modal = document.getElementById('staffAppSanctionModal');
    const active = document.getElementById('activeSanctionId');
    const entries = snap.docs.filter(entry=>!entry.data().staffId || entry.data().staffId===localStorage.getItem('takodeal_staff_id'));
    const due = pendingDueNotices(entries.map(entry=>({...entry.data(),id:entry.id})));
    if (!due.length) {
        modal.style.display = 'none'; active.value = '';
        if (window.staffSanctionPadTimer) clearTimeout(window.staffSanctionPadTimer);
        window.staffSanctionPadTimer = null;
        return false;
    }
    const entry = entries.find(entry=>entry.id===due[0].id), sanction = entry.data(), summary=sanctionReviewSummary(sanction);window.activeStaffSanctionIsCase=summary.isCase;
    let close = document.getElementById('staffSanctionCloseNotice');
    if (!close) {close=document.createElement('button');close.id='staffSanctionCloseNotice';close.type='button';close.textContent='Close notice · Time Out remains available';close.style.cssText='width:100%;margin-top:12px;padding:12px;border:1px solid #d1dcd5;border-radius:8px;background:white;color:#345847;';close.onclick=()=>{modal.style.display='none';};modal.querySelector('div')?.append(close);}
    close.textContent=summary.isCase?'Close notice · Pending reply does not block Time In or Time Out':'Close notice · Time Out remains available';
    document.getElementById('sanctionLockType').innerText = (sanction.type || 'Violation')+(summary.isCase?' · '+summary.caseNumber:'');
    document.getElementById('sanctionLockSeverity').innerText = summary.isCase?summary.actionHeading+': '+summary.actionLabel+'\nFinding: '+summary.finding:summary.actionLabel;
    document.getElementById('sanctionLockDetails').innerText = (sanction.details || 'No details provided.')+(summary.isCase?'\n\n'+summary.message:'');
    const submit=document.getElementById('btnSubmitAppSanction');if(submit)submit.innerText=summary.isCase?'Submit explanation':'Submit & Unlock App';
    // Snapshot updates must not erase an explanation or signature being written.
    if (active.value !== entry.id) {
        active.value = entry.id;
        document.getElementById('sanctionStaffReply').value = '';
        window.hasSignedStaffNTE = false;
        if (window.staffSanctionPadTimer) clearTimeout(window.staffSanctionPadTimer);
        window.staffSanctionPadTimer = setTimeout(() => {
            if (epoch !== window.staffLiveListenerEpoch || localStorage.getItem('takodeal_staff_name') !== staffName || active.value !== entry.id) return;
            window.initStaffAppSignaturePad();
            window.staffSanctionPadTimer = null;
        }, 300);
    }
    modal.style.display = 'flex';
    return true;
};

window.startSanctionListener = function(staffName) {
    const staffId = localStorage.getItem('takodeal_staff_id');
    if (!staffName || !staffId || localStorage.getItem('takodeal_staff_name') !== staffName) return;
    const key = staffId + '|' + staffName, epoch = window.staffLiveListenerEpoch;
    if (window.staffSanctionListenerKey === key && window.staffSanctionUnsubscribe) return;
    if (window.staffSanctionUnsubscribe) window.staffSanctionUnsubscribe();
    window.staffSanctionListenerKey = key;
    const current = () => epoch === window.staffLiveListenerEpoch && window.staffSanctionListenerKey === key && localStorage.getItem('takodeal_staff_id') === staffId && localStorage.getItem('takodeal_staff_name') === staffName;
    const q = query(collection(db, 'hr_sanctions'), where('staffName', '==', staffName));
    window.staffSanctionUnsubscribe = onSnapshot(q, snap => {
        if (!current()) return;
        window.staffSanctionCachedSnapshot = snap;
        window.renderActiveSanctions(snap, staffName);
        if (!window.staffSanctionDayStop) window.staffSanctionDayStop = startPhilippineDayTimer(()=>{if(current() && window.staffSanctionCachedSnapshot)window.renderActiveSanctions(window.staffSanctionCachedSnapshot,staffName);});
    }, error => {
        if (!current()) return;
        window.staffSanctionUnsubscribe = null; window.staffSanctionListenerKey = null;
        window.staffSanctionDayStop?.(); window.staffSanctionDayStop=null; window.staffSanctionCachedSnapshot=null;
        console.error('Staff sanction listener:', error);
    });
};

window.checkActiveSanctions = async function(staffName, {requireFresh = false} = {}) {
    const staffId = localStorage.getItem('takodeal_staff_id'), epoch = window.staffLiveListenerEpoch;
    try {
        if (!staffId || !staffName || localStorage.getItem('takodeal_staff_name') !== staffName) throw Error('Your staff session changed. Sign in again.');
        const q = query(collection(db, 'hr_sanctions'), where('staffName', '==', staffName));
        // Clock-in and explicit acknowledgement checks must see HQ's current state.
        const snap = await getDocsFromServer(q);
        if (epoch !== window.staffLiveListenerEpoch || localStorage.getItem('takodeal_staff_id') !== staffId || localStorage.getItem('takodeal_staff_name') !== staffName) throw Error('Your staff session changed. Sign in again.');
        const restricted = clockInRestriction(snap.docs.map(entry=>({...entry.data(),id:entry.id})).filter(row=>!row.staffId || row.staffId===staffId));
        if (requireFresh && restricted && !restricted.replyRequired) throw Error(restricted.message);
        // The notice remains available from the listener and HR history. A v2
        // pending explanation is not a clock-in restriction or a final finding.
        if(requireFresh&&!restricted)return false;
        const shown=window.renderActiveSanctions(snap, staffName);return requireFresh?!!restricted?.replyRequired:shown;
    } catch (error) {
        console.error('Error checking sanctions:', error);
        if (requireFresh) throw Error(error.message || 'Connect to HQ to verify HR notices before Time In.');
        return null;
    }
};
document.addEventListener('visibilitychange',()=>{const name=localStorage.getItem('takodeal_staff_name');if(document.visibilityState==='visible' && name && window.staffSanctionCachedSnapshot)window.renderActiveSanctions(window.staffSanctionCachedSnapshot,name);});

window.submitStaffAppSanctionReply = async function() {
    let sanctionId = document.getElementById('activeSanctionId').value;
    let replyText = document.getElementById('sanctionStaffReply').value.trim();
    const caseNotice=window.activeStaffSanctionIsCase===true;

    if (!replyText || replyText.length < 15) {
        Swal.fire('Explanation Too Short', 'You must provide a detailed written explanation (at least 15 characters) before unlocking the app.', 'warning');
        return;
    }

    if (!window.hasSignedStaffNTE) {
        Swal.fire('Signature Required', 'Please sign inside the signature box using your finger to legally acknowledge this notice.', 'error');
        return;
    }

    let btn = document.getElementById('btnSubmitAppSanction');
    btn.innerText = "⏳ Submitting to HQ..."; btn.disabled = true;

    try {
        const canvas = document.getElementById('staffAppSignatureCanvas');
        const signatureDataUrl = canvas.toDataURL('image/png');

        await acknowledgeSanction({db,doc,runTransaction,serverTimestamp},{id:sanctionId,staffName:localStorage.getItem('takodeal_staff_name'),reply:replyText,signature:signatureDataUrl},{identity:()=>({staffName:localStorage.getItem('takodeal_staff_name'),staffId:localStorage.getItem('takodeal_staff_id')})});

        Swal.fire({
            title: '✅ Notice Acknowledged', 
            text: caseNotice?'Your explanation and signature have been sent for management review. This reply is not an admission, a final finding or an effective suspension.':'Your explanation and signature have been logged to HQ. A scheduled suspension still follows its effective date until management resolves it.',
            icon: 'success', 
            customClass: { popup: 'rounded-2xl' }
        });
        
        if (document.getElementById('activeSanctionId').value === sanctionId) document.getElementById('staffAppSanctionModal').style.display = 'none';

    } catch (e) {
        console.error(e);
        Swal.fire('Could not submit', e.message || 'Check internet connection.', 'error');
    } finally {
        btn.innerText = caseNotice?'Submit explanation':"Submit & Unlock App"; btn.disabled = false;
    }
};

// ========================================================
// 🚨 STAFF APP: SANCTION UPDATES
// ========================================================
// The signed-in staff listener delivers changes without repeated cloud queries.

// ========================================================
// ⚖️ STAFF APP: SANCTION HISTORY VIEWER
// ========================================================
window.loadMySanctionsHistory = async function() {
    // Show the container
    document.getElementById('staffSanctionsHistorySection').style.display = 'block';
    
    let container = document.getElementById('mySanctionsList');
    let staffName = localStorage.getItem('takodeal_staff_name') || localStorage.getItem('cashierName');
    const staffId=localStorage.getItem('takodeal_staff_id'),safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    
    if (!staffName) {
        container.innerHTML = '<div style="text-align:center; color:#dc2626; font-weight:bold;">Error: Not logged in.</div>';
        return;
    }

    container.innerHTML = '<div style="text-align:center; color:#64748b; font-weight:bold; padding: 20px;">⏳ Fetching your records from HQ...</div>';

    try {
        const q = window.query(
            window.collection(window.db, "hr_sanctions"), 
            window.where("staffName", "==", staffName)
        );
        const snap = await window.getDocsFromServer(q);
        if(localStorage.getItem('takodeal_staff_id')!==staffId||localStorage.getItem('takodeal_staff_name')!==staffName)return;

        let records = [];
        snap.forEach(doc => {const row=doc.data();if(!row.staffId||row.staffId===staffId)records.push({...row,id:doc.id});});

        // Sort newest first
        records.sort((a,b) => {
            let tA = a.timestamp ? (a.timestamp.toMillis ? a.timestamp.toMillis() : new Date(a.timestamp).getTime()) : 0;
            let tB = b.timestamp ? (b.timestamp.toMillis ? b.timestamp.toMillis() : new Date(b.timestamp).getTime()) : 0;
            return tB - tA;
        });

        let html = '';
        records.forEach(d => {
            const summary=sanctionReviewSummary(d);
            let dateStr = d.timestamp ? (d.timestamp.toDate ? d.timestamp.toDate().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : new Date(d.timestamp).toLocaleDateString()) : 'Unknown Date';
            
            let statusBadge = '';
            let actionBtn = ''; // 🔥 Create an empty variable for the button
            
            if(summary.isCase&&['Reviewed','Archived','Cancelled','Canceled'].includes(d.status)){
                statusBadge='<span style="color:#27684d;font-weight:bold;">'+safe(d.status)+' · '+safe(summary.finding)+'</span>';
            } else if (d.status === 'Pending Reply') {
                if (!noticeIsDue(d)) {
                    statusBadge = `<span style="color:#27684d;font-weight:bold;">Scheduled · Effective ${d.effectiveDate}</span>`;
                } else {
                statusBadge = `<span style="background: #fef2f2; color: #dc2626; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px; border: 1px solid #fca5a5;">⚠️ Action Required</span>`;
                // 🔥 Inject the manual trigger button!
                actionBtn = `<button onclick="window.checkActiveSanctions(${safe(JSON.stringify(staffName))})" style="width: 100%; margin-top: 15px; background: #dc2626; color: white; border: none; padding: 12px; border-radius: 8px; font-weight: 900; font-size: 14px; cursor: pointer; box-shadow: 0 4px 6px rgba(220, 38, 38, 0.3);">✍️ Read notice &amp; send explanation</button>`;
                }
            } else if (d.status === 'Resolved') {
                statusBadge = `<span style="background: #dcfce7; color: #16a34a; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px; border: 1px solid #bbf7d0;">✅ Resolved</span>`;
            } else {
                statusBadge = `<span style="background: #e0f2fe; color: #0284c7; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px; border: 1px solid #bae6fd;">📩 Sent to HQ</span>`;
            }

            let replyHtml = '';
            if (d.staffReply) {
                replyHtml = `
                    <div style="margin-top: 10px; padding: 10px; background: white; border-radius: 6px; border: 1px dashed #cbd5e1;">
                        <span style="font-size: 11px; font-weight: bold; color: #64748b;">YOUR EXPLANATION:</span>
                        <div style="font-size: 13px; color: #334155; font-style: italic; margin-top: 4px;">"${safe(d.staffReply)}"</div>
                    </div>
                `;
            }

            html += `
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin-bottom: 15px; text-align: left;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                        <div>
                            <strong style="color: #b91c1c; font-size: 15px; display: block;">${safe(d.type)}</strong>
                            <span style="font-size: 11px; color: #64748b;">Issued: ${safe(dateStr)}<br>${summary.isCase?safe(summary.caseNumber)+'<br>Finding: '+safe(summary.finding):'Effective: '+safe(d.effectiveDate || 'Immediate (legacy notice)')}</span>
                        </div>
                        ${statusBadge}
                    </div>
                    
                    <div style="font-size: 13px; font-weight: bold; color: #ea580c; margin-bottom: 8px;">${safe(summary.actionHeading)}: ${safe(summary.actionLabel)}</div>
                    ${summary.isCase?'<p style="font-size:12px;color:#64748b;">'+safe(summary.message)+'</p>':''}
                    
                    <div style="font-size: 13px; color: #334155; background: white; padding: 10px; border-radius: 6px; border-left: 3px solid #dc2626;">
                        <span style="font-size: 11px; font-weight: bold; color: #dc2626; display: block; margin-bottom: 4px;">HQ REPORT:</span>
                        ${safe(d.details)}
                    </div>
                    
                    ${actionBtn} <!-- 🔥 The button will appear here if action is required! -->
                    ${replyHtml}
                </div>
            `;
        });

        container.innerHTML = html || '<div style="text-align:center; color:#16a34a; font-weight:bold; padding: 20px;">🎉 Clean Record! You have no sanctions or notices.</div>';

    } catch (e) {
        console.error("Sanctions History Error:", e);
        container.innerHTML = '<div style="text-align:center; color:#dc2626; font-weight:bold;">❌ Failed to load records.</div>';
    }
};

// ========================================================
// ✍️ STAFF APP: PAYSLIP SIGNATURE ENGINE
// ========================================================
window.openPayslipSignatureModal = function(recordId, encodedData) {
    if (!window.staffVaultSession?.allows(localStorage.getItem('takodeal_staff_id'))) return;
    const payEpoch = window.staffVaultSession.epoch, payStaffId = localStorage.getItem('takodeal_staff_id');
    const signatureCurrent = () => localStorage.getItem('takodeal_staff_id')===payStaffId && window.staffVaultSession.allows(payStaffId,payEpoch);
    let d = JSON.parse(decodeURIComponent(encodedData));
    
    if(d.recordState==='shared'||d.isPaid===false)return Swal.fire('Payment pending','This is an Owner-shared unpaid payslip. It cannot be acknowledged as a payment.','info');
    let savedAmounts;
    try{if(d.staffId&&d.staffId!==payStaffId)throw Error('This payslip belongs to another employee.');savedAmounts=payslipSavedAmounts(d);d={...d,...savedAmounts,finalNetPay:savedPayslipCents(d.finalNetPay,{negative:true})/100};}
    catch(error){return Swal.fire('Saved payslip needs review',error.message,'warning');}
    const basicPay=savedAmounts.basicPay.toFixed(2),otPay=savedAmounts.nightBonus.toFixed(2),straightPay=savedAmounts.straightBonus.toFixed(2),holPay=savedAmounts.holidayPayTotal.toFixed(2),perfBonus=savedAmounts.perfBonus.toFixed(2),payrollAdjustmentPay=savedAmounts.payrollAdjustments.toFixed(2);
    const grossIncome=savedAmounts.grossPay.toFixed(2),totalDeduct=savedAmounts.totalDeductions.toFixed(2),netPayFmt=d.finalNetPay.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
    encodedData=encodeURIComponent(JSON.stringify(d)).replace(/'/g,'%27');

    return Swal.fire({
        title: `<h3 style="margin: 0; color: #b45309; text-transform: uppercase;">Acknowledge Payslip</h3>`,
        html: `
            <div style="background: white; border: 1px solid #cbd5e1; border-radius: 8px; padding: 15px; margin-bottom: 15px; font-size: 13px; text-align: left; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                <div style="font-weight: 900; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 10px; text-align: center; color: #334155; letter-spacing: 1px;">PAYSLIP PREVIEW</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <div>
                        <div style="font-weight:bold; color:#16a34a; border-bottom: 1px solid #e2e8f0; margin-bottom: 6px; padding-bottom: 2px;">INCOME</div>
                        <div style="display:flex; justify-content:space-between; margin-bottom: 4px;"><span>Basic:</span> <span>₱${basicPay}</span></div>
                        <div style="display:flex; justify-content:space-between; margin-bottom: 4px;"><span>Bonus/OT:</span> <span>₱${(parseFloat(otPay) + parseFloat(straightPay) + parseFloat(holPay) + parseFloat(perfBonus)).toFixed(2)}</span></div>
                        ${Number(payrollAdjustmentPay)>0?'<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>Previous payroll credits:</span><span>₱'+payrollAdjustmentPay+'</span></div>':''}
                        <div style="display:flex; justify-content:space-between; font-weight:bold; margin-top:8px; color:#15803d; border-top: 1px dashed #cbd5e1; padding-top: 4px;"><span>GROSS:</span> <span>₱${grossIncome}</span></div>
                    </div>
                    <div>
                        <div style="font-weight:bold; color:#dc2626; border-bottom: 1px solid #e2e8f0; margin-bottom: 6px; padding-bottom: 2px;">DEDUCTIONS</div>
                        ${payslipDeductionSummaryHTML(d)}
                        <div style="display:flex; justify-content:space-between; font-weight:bold; margin-top:8px; color:#b91c1c; border-top: 1px dashed #cbd5e1; padding-top: 4px;"><span>DEDUCT:</span> <span>₱${totalDeduct}</span></div>
                    </div>
                </div>
                <div style="background: #f1f5f9; text-align: center; padding: 10px; font-weight: 900; font-size: 18px; margin-top: 15px; border-radius: 6px; color: #0f172a; border: 1px solid #e2e8f0;">
                    NET PAY: <span style="color: #16a34a;">₱${netPayFmt}</span>
                </div>
                ${payslipDeductionDetailsHTML(d,{showTotal:false})}
                ${payrollAdjustmentDetailsHTML(d)}
                <div style="text-align: center; margin-top: 15px;">
                    <button type="button" onclick="window.viewPastPayslip('${encodedData}')" style="background: #f0f9ff; color: #0284c7; border: 1px solid #bae6fd; padding: 8px 15px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 12px; transition: 0.2s;">🔍 View Full Detailed Payslip</button>
                </div>
            </div>

            <div style="text-align: left; font-size: 12px; color: #475569; margin-bottom: 15px; background: #fffbeb; padding: 12px; border-radius: 8px; border: 1px dashed #fcd34d;">
                By signing below, you acknowledge the receipt of <strong style="color: #dc2626; font-size: 14px;">₱${netPayFmt}</strong> for the period of <b>${d.start || d.startDate}</b> to <b>${d.end || d.endDate}</b>.
            </div>
            
            <div style="border: 2px dashed #d97706; border-radius: 8px; background: white; position: relative; margin-bottom: 10px; overflow: hidden;">
                <canvas id="payslipSignatureCanvas" width="400" height="150" style="width: 100%; height: 150px; cursor: crosshair; touch-action: none; display: block;"></canvas>
                <button type="button" onclick="const c = document.getElementById('payslipSignatureCanvas'); c.getContext('2d').clearRect(0,0,c.width,c.height); window.hasSignedStaffNTE = false;" style="position: absolute; top: 5px; right: 5px; background: #fef2f2; border: 1px solid #fca5a5; border-radius: 6px; font-size: 10px; font-weight: bold; padding: 6px 10px; cursor: pointer; color: #dc2626; z-index: 10;">Clear</button>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: '✅ Sign & Accept',
        confirmButtonColor: '#16a34a',
        cancelButtonColor: '#94a3b8',
        customClass: { popup: 'rounded-2xl shadow-xl' },
        didOpen: () => {
            // Re-use our universal signature engine!
            let canvas = document.getElementById('payslipSignatureCanvas');
            canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight;
            let ctx = canvas.getContext('2d');
            ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.strokeStyle = '#0f172a';
            let isDrawing = false; window.hasSignedStaffNTE = false;
            
            const getPos = (e) => {
                const rect = canvas.getBoundingClientRect();
                const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                return { x: (clientX - rect.left) * (canvas.width/rect.width), y: (clientY - rect.top) * (canvas.height/rect.height) };
            };
            const startDraw = (e) => { isDrawing = true; window.hasSignedStaffNTE = true; ctx.beginPath(); ctx.moveTo(getPos(e).x, getPos(e).y); e.preventDefault(); };
            const draw = (e) => { if (!isDrawing) return; ctx.lineTo(getPos(e).x, getPos(e).y); ctx.stroke(); e.preventDefault(); };
            const stopDraw = () => { isDrawing = false; ctx.closePath(); };

            canvas.addEventListener('touchstart', startDraw, { passive: false });
            canvas.addEventListener('touchmove', draw, { passive: false });
            canvas.addEventListener('touchend', stopDraw);
            canvas.addEventListener('mousedown', startDraw);
            canvas.addEventListener('mousemove', draw);
            canvas.addEventListener('mouseup', stopDraw);
        },
        preConfirm: () => {
            if (!signatureCurrent()) return false;
            if (!window.hasSignedStaffNTE) { Swal.showValidationMessage("You must sign inside the box to accept your payslip."); return false; }
            return document.getElementById('payslipSignatureCanvas').toDataURL('image/png');
        }
    }).then(async (res) => {
        if (res.isConfirmed && signatureCurrent()) {
            Swal.fire({title: 'Saving Signature...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
            try {
                if (Number(d.ownerDeductions)>0 || Array.isArray(d.ownerDeductionRows) && d.ownerDeductionRows.length>0 || Number(d.cashShortages)>0 || Array.isArray(d.cashShortageRows) && d.cashShortageRows.length>0) {
                    const vault=await createStaffDocumentFirebase(firebaseConfig,()=>localStorage.getItem('takodeal_staff_id'));
                    if (!signatureCurrent()) return;
                    await acknowledgeCashShortagePayslip(vault,{recordId,staffId:payStaffId,signature:res.value,stillCurrent:signatureCurrent});
                } else {
                    await window.staffAccessClient.acknowledgePayroll({staffId:payStaffId,recordId,signatureBase64:res.value,expectedFingerprint:d.staffPayrollFingerprint,operationId:crypto.randomUUID(),createPrivateClient:createPrivateStaffClient,assertCurrent:()=>{if(!signatureCurrent())throw Error('The private payslip view changed. Reopen it.');}});
                }
                if (!signatureCurrent()) return;
                Swal.fire({title: '✅ Payslip Acknowledged!', text: 'Your signed record has been securely moved to the Past Payslips vault.', icon: 'success', customClass: { popup: 'rounded-2xl' }});
                window.loadPayslipVault(); // Instantly refresh
            } catch(e) {
                if (!signatureCurrent()) return;
                console.error(e); Swal.fire('Error', e.message || 'Failed to save signature. Check connection.', 'error');
            }
        }
    });
};

// ========================================================
// 💳 STAFF APP: MY LOAN LEDGER VIEWER
// ========================================================
// My loans uses the approved private-phone client installed below.

// ==========================================
// 🎓 END OF CONTRACT & COE ENGINE (BYPASS & DOWNLOAD FIX)
// ==========================================
window.dismissCOEWarning = function() {
    document.getElementById('coeFarewellOverlay').style.display = 'none';
    document.getElementById('appContainer').style.display = 'flex';
    window.switchView('timeclock'); // Automatically push them to the time clock to start their shift!
};

window.generateCOE = function() {
    let d = window.coePendingData;
    if (!d) return Swal.fire('Error', 'Missing employee data.', 'error');

    let name = d.cashierName;
    let dateHired = d.dateHired;
    let role = d.role || "Service Crew";

    let template = document.getElementById('coeTemplate');
    if (!template) {
        return Swal.fire('Error', 'COE Template not found in the HTML.', 'error');
    }

    template.style.display = 'block'; 
    
    document.getElementById('coeName').innerText = name.toUpperCase();
    document.getElementById('coeRole').innerText = role;
    
    let hiredDate = dateHired ? new Date(dateHired).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : "their start date";
    let todayDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    
    document.getElementById('coeDateHired').innerText = hiredDate;
    document.getElementById('coeDateToday').innerText = todayDate;
    
    Swal.fire({title: 'Generating COE...', text: 'Please wait...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});

    html2canvas(template, { scale: 2, backgroundColor: "#ffffff" }).then(async (canvas) => {
        let link = document.createElement('a');
        link.download = `Certificate_of_Employment_${name.replace(/\s+/g, '_')}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
        
        template.style.display = 'none'; 
        
        Swal.fire({
            title: '✅ Downloaded!',
            text: 'Your Certificate of Employment has been successfully downloaded. Your access will now be securely locked.',
            icon: 'success',
            confirmButtonText: 'Log Out',
            confirmButtonColor: '#dc2626',
            allowOutsideClick: false,
            customClass: { popup: 'rounded-2xl shadow-xl' }
        }).then(() => {
            // 🔥 THE LOCKOUT FIX: Automatically clear their login session and reload the page!
            localStorage.removeItem('takodeal_staff_name');
            localStorage.removeItem('takodeal_staff_id');
            localStorage.removeItem('takodeal_staff_pic');
            location.reload();
        });
    }).catch(err => {
        console.error(err);
        Swal.fire('Error', 'Failed to generate COE image.', 'error');
        template.style.display = 'none';
    });
};

// ========================================================
// 🪪 AUTOMATED HD VIRTUAL ID GENERATOR (STAFF APP)
// ========================================================
window.generateVirtualID = async function() {
    let staffId = localStorage.getItem('takodeal_staff_id');
    if (!staffId) return Swal.fire('Error', 'You must be logged in to download your ID.', 'error');

    Swal.fire({title: 'Generating Virtual ID...', text: 'Fetching your verified records from HQ...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});

    try {
        const docSnap = await window.getDoc(window.doc(window.db, "cashiers", staffId));
        if (!docSnap.exists()) return Swal.fire('Error', 'Profile not found.', 'error');
        
        let data = docSnap.data();

        if (!data.empId || data.empId === 'Pending Generation...') {
            return Swal.fire('ID Not Assigned', 'HQ has not formally assigned your Employee ID Number yet. Please ask the Manager to click "Save Data" on your profile.', 'warning');
        }

        let template = document.getElementById('virtualIdTemplate');
        template.style.display = 'flex';

        document.getElementById('vIdFrontName').innerText = (data.cashierName || 'Staff Member').toUpperCase();
        document.getElementById('vIdFrontRole').innerText = (data.role || 'Service Crew').toUpperCase();
        document.getElementById('vIdFrontNo').innerText = data.empId || 'PENDING';
        document.getElementById('vIdFrontBranch').innerText = (data.branch || 'UNASSIGNED').toUpperCase() + ' BRANCH';
        
        let hiredDate = data.dateHired ? new Date(data.dateHired).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : 'N/A';
        document.getElementById('vIdFrontHired').innerText = hiredDate;

        let emergName = data.emergencyName || 'N/A';
        let emergNum = data.emergencyNumber || data.emergencyPhone || data.emergencyContact || 'N/A';
        let blood = data.bloodType || 'N/A';

        document.getElementById('vIdBackNotify').innerText = emergName;
        document.getElementById('vIdBackNum').innerText = emergNum;
        document.getElementById('vIdBackBlood').innerText = blood;

        // 🔥 THE UNBREAKABLE OFF-SCREEN CANVAS PRELOADER 🔥
        let picSrc = data.profilePicUrl; 
        
        // Smart Check: If they just uploaded it, grab the local data straight from the live screen!
        let previewImg = document.getElementById('profilePreview');
        if (previewImg && previewImg.src && previewImg.src.startsWith('data:image')) {
            picSrc = previewImg.src; 
        }

        let base64Img = 'logo_id.png'; // Failsafe fallback

        if (picSrc) {
            if (picSrc.startsWith('data:') || !picSrc.startsWith('http')) {
                base64Img = picSrc; // Already safe!
            } else {
                // Secretly paints the image on an invisible canvas to bypass CORS security!
                const getBase64 = (url) => new Promise((resolve, reject) => {
                    let img = new Image();
                    img.crossOrigin = "anonymous";
                    img.onload = () => {
                        let canvas = document.createElement("canvas");
                        canvas.width = img.width;
                        canvas.height = img.height;
                        let ctx = canvas.getContext("2d");
                        ctx.drawImage(img, 0, 0);
                        resolve(canvas.toDataURL("image/png"));
                    };
                    img.onerror = reject;
                    img.src = url;
                });

                try {
                    // Tier 1: Premium CDN Image Proxy (wsrv.nl) - Extremely Reliable
                    base64Img = await getBase64(`https://wsrv.nl/?url=${encodeURIComponent(picSrc)}`);
                } catch (e1) {
                    console.warn("Proxy 1 failed, trying Proxy 2...");
                    try {
                        // Tier 2: AllOrigins Raw Data Proxy
                        base64Img = await getBase64(`https://api.allorigins.win/raw?url=${encodeURIComponent(picSrc)}`);
                    } catch (e2) {
                        console.warn("Proxy 2 failed, trying direct fetch...");
                        try {
                            // Tier 3: Direct Fetch (Just in case Firebase CORS is open)
                            base64Img = await getBase64(picSrc);
                        } catch (e3) {
                            console.error("All image fetch attempts failed due to strict network security. Falling back to logo.");
                            base64Img = 'logo_id.png';
                        }
                    }
                }
            }
        }

        let frontPic = document.getElementById('vIdFrontPic');
        frontPic.removeAttribute('crossorigin'); // It is pure text now, so security tags are unnecessary!
        frontPic.src = base64Img;

        // Ensure it's fully painted before proceeding
        await new Promise((resolve) => {
            if (frontPic.complete) resolve();
            else {
                frontPic.onload = resolve;
                frontPic.onerror = resolve; 
            }
        });

        await new Promise(r => setTimeout(r, 300));

        // 🔥 THE SCREENSHOT ENGINE (Camera Ignored)
        html2canvas(template, { 
            scale: 3, 
            backgroundColor: "#ffffff", 
            useCORS: true, 
            allowTaint: false,
            ignoreElements: (node) => node.nodeName === 'VIDEO' || node.tagName === 'VIDEO'
        }).then(canvas => {
            let link = document.createElement('a');
            link.download = `Virtual_ID_${(data.cashierName || 'Staff').replace(/\s+/g, '_')}.png`;
            link.href = canvas.toDataURL("image/png");
            link.click();
            
            template.style.display = 'none'; 
            Swal.close();
            
            Swal.fire({
                title: '✅ Virtual ID Downloaded!',
                text: 'Your official TAKODEÁL Virtual ID has been saved to your camera roll/downloads.',
                icon: 'success',
                confirmButtonColor: '#0ea5e9',
                customClass: { popup: 'rounded-2xl shadow-xl' }
            });
        }).catch(err => {
            console.error("ID Generation Error:", err);
            template.style.display = 'none';
            Swal.fire('Error', 'Failed to generate ID image. Please try again.', 'error');
        });

    } catch (e) {
        console.error("Fetch Error:", e);
        document.getElementById('virtualIdTemplate').style.display = 'none';
        Swal.fire('Error', 'Failed to fetch profile data from HQ.', 'error');
    }
};

// =======================================================
// 🧟 ZOMBIE LISTENER KILLER (BATTERY & READ SAVER)
// =======================================================
document.addEventListener("visibilitychange", async () => {
    if (document.hidden) {
        // Screen locked or app minimized -> Pause Firebase!
        console.log("🛑 Staff App hidden. Pausing network to save data plan and database reads...");
        try { 
            if (window.disableNetwork && window.db) await window.disableNetwork(window.db); 
        } catch(e) { console.warn("Failed to pause network:", e); }
    } else {
        // App opened again -> Reconnect instantly!
        console.log("🟢 Staff App visible. Waking up Firebase...");
        try { 
            if (window.enableNetwork && window.db) await window.enableNetwork(window.db); 
        } catch(e) { console.warn("Failed to wake network:", e); }
    }
});

// ==========================================
// 🔄 FORCE UPDATE & CACHE CLEARING ENGINE
// ==========================================
// 🍔 1-CLICK MEAL CONFIRMATION ENGINE
// =======================================================
window.acknowledgeMeal = async function(docId) {
    try {
        await window.updateDoc(window.doc(window.db, "staff_requests", docId), {
            staffAcknowledged: true
        });
        Swal.fire({
            toast: true, position: 'top-end', icon: 'success', 
            title: 'Meal Confirmed!', showConfirmButton: false, timer: 2000
        });
        window.loadInbox(); // Refresh the list instantly
    } catch(e) {
        console.error(e); 
        Swal.fire('Error', 'Could not confirm meal.', 'error');
    }
};

// ==========================================
// 🔄 FORCE UPDATE & CACHE CLEARING ENGINE
// ==========================================
const createPrivateStaffClient=()=>createStaffDocumentFirebase(firebaseConfig,()=>localStorage.getItem('takodeal_staff_id'));
window.staffPrivateProfileClient=createStaffPrivateProfileClient({identity:()=>localStorage.getItem('takodeal_staff_id'),deviceId:()=>localStorage.getItem('takodeal_device_id'),account:()=>staffPrimaryAuth.currentUser,onInvalidate:()=>window.staffPrivateProfileUI?.clear(),createPrivateClient:createPrivateStaffClient,fetcher:window.fetch.bind(window)});
window.staffAccessClient=createStaffAccessClient({auth:staffPrimaryAuth,ensureUser:async()=>{if(!staffPrimaryAuth.currentUser)throw Error('Reconnect your Staff phone.');return staffPrimaryAuth.currentUser;},deviceId:()=>localStorage.getItem('takodeal_device_id'),sessionId:()=>localStorage.getItem('takodeal_staff_session_id'),fetcher:window.fetch.bind(window)});
window.readPrivateStaffProfile=async(staffId,options={})=>{const value=await window.staffPrivateProfileClient.read(staffId,options);return{id:staffId,exists:()=>true,data:()=>value.profile,metadata:{fromCache:false,hasPendingWrites:false},expectedFingerprint:value.expectedFingerprint};};
window.loadPrivateStaffSalaryProfile=async profile=>(await window.readPrivateStaffProfile(profile.staffId||profile.id)).data();
window.readStaffPaidHistory=options=>window.staffAccessClient.payroll({...options,createPrivateClient:createPrivateStaffClient});
window.readPrivatePayrollInputs=options=>window.staffAccessClient.payrollInputs({...options,createPrivateClient:createPrivateStaffClient});
window.readMyLoanLedgerSnapshot=async options=>{const client=createStaffLoanLedgerClient({createPrivateClient:createPrivateStaffClient,identity:()=>localStorage.getItem('takodeal_staff_id'),deviceId:()=>localStorage.getItem('takodeal_device_id')});try{return await client.read(options);}finally{client.invalidate();}};
window.readPrivateVaultSettings=options=>window.staffPrivateProfileClient.vaultSettings(options.staffId,{assertCurrent:options.assertCurrent});
window.savePrivateVaultPin=(input,options)=>window.staffPrivateProfileClient.vaultSave(input,options);
window.staffPrivateProfileUI=installStaffPrivateProfileUI(window,document,{client:window.staffPrivateProfileClient,access:window.staffAccessClient,createPrivateClient:createPrivateStaffClient});
installStaffPortal();
installStaffLoanLedger(window,document,{createClient:options=>createStaffLoanLedgerClient({...options,createPrivateClient:()=>createStaffDocumentFirebase(firebaseConfig,()=>localStorage.getItem('takodeal_staff_id')),identity:()=>localStorage.getItem('takodeal_staff_id'),deviceId:()=>localStorage.getItem('takodeal_device_id')})});
window.staffBranchDirectory=installLiveBranchDirectory(window,document,{kind:'staff',subscribe:(next,error)=>onSnapshot(collection(db,'branches'),{includeMetadataChanges:true},next,error)});
installStaffLocation({loadBranches:()=>getDocsFromServer(collection(db,'branches'))});
installPayrollVaultFreshness(window,document);
let setupAuthUid=staffPrimaryAuth.currentUser?.uid||null;
if(window.staffSelfRepair){
    let repairStateKey='';
    window.addEventListener('takodeal-staff-repair-state',()=>{
        if(window.staffSelfRepair.requiresCode()){window.staffSetupAccess?.invalidate();window.startStaffDeviceSetup?.();return;}
        let row;try{row=JSON.parse(localStorage.getItem('takodeal_staff_self_repair_v1')||'null');}catch{return;}
        if(row?.phase==='complete'&&row.candidateUid===staffPrimaryAuth.currentUser?.uid&&row.candidateDeviceId===localStorage.getItem('takodeal_device_id')&&repairStateKey!==row.operationId){repairStateKey=row.operationId;window.staffSetupAccess?.invalidate();window.startStaffDeviceSetup?.();}
    });
    window.staffSelfRepair.configureSDK(createStaffSelfRepairSDK({app,auth:staffPrimaryAuth,db,config:firebaseConfig,sdk:{getApps,initializeApp,getAuth,setPersistence,browserLocalPersistence,signInAnonymously,updateCurrentUser,waitForPendingWrites},readPrivateClient:readInitializedStaffDocumentClient,window}));
}
installStaffRegistration({projectId:firebaseConfig.projectId,apiKey:firebaseConfig.apiKey,setup:{
    auth:staffPrimaryAuth,
    ensureUser:async({guard=()=>{}}={})=>{
        await staffPrimaryAuth.authStateReady();guard();
        if(staffPrimaryAuth.currentUser)return staffPrimaryAuth.currentUser;
        await setPersistence(staffPrimaryAuth,browserLocalPersistence);guard();
        const signedIn=await signInAnonymously(staffPrimaryAuth);guard();return signedIn.user;
    },
    onAuthChange:callback=>onAuthStateChanged(staffPrimaryAuth,user=>{
        const changed=setupAuthUid && setupAuthUid!==(user?.uid||null);setupAuthUid=user?.uid||null;
        if(changed)callback();
    })
}});
window.getStaffVaultRecoveryClient=(options={})=>createStaffVaultRecoveryForPhone({...options,auth:staffPrimaryAuth,authority:()=>window.staffSetupAccess,identity:()=>localStorage.getItem('takodeal_staff_id'),deviceId:()=>localStorage.getItem('takodeal_device_id'),createPrivateClient:()=>createStaffDocumentFirebase(firebaseConfig,()=>localStorage.getItem('takodeal_staff_id'))});
installStaffVaultRecovery(window,document,{createClient:options=>window.getStaffVaultRecoveryClient(options)});
installStaffPhone();
installStaffDocuments(window,{createVault:()=>createStaffDocumentFirebase(firebaseConfig,()=>localStorage.getItem('takodeal_staff_id'))});

installDeductionInbox(window,{createClient:()=>createStaffDocumentFirebase(firebaseConfig,()=>localStorage.getItem('takodeal_staff_id'))});
installStaffOnboarding(window,document,{createVault:()=>createStaffDocumentFirebase(firebaseConfig,()=>localStorage.getItem('takodeal_staff_id'))});
window.staffScheduleSync = installScheduleViewSync(window, {window, document,
    scope: () => document.getElementById('view-schedule')?.classList.contains('active')
        && localStorage.getItem('takodeal_staff_id') && localStorage.getItem('takodeal_staff_name')
        && document.getElementById('appContainer')?.style.display !== 'none'
        ? {identity:localStorage.getItem('takodeal_staff_id'), name:localStorage.getItem('takodeal_staff_name'),
            month:document.getElementById('staffMonthPicker')?.value || scheduleDateKey(new Date()).slice(0,7)} : null,
    refresh: () => window.loadStaffSchedule(),
    error: () => { const box=document.getElementById('scheduleContainer');if(box)box.setAttribute('aria-label','Schedule connection interrupted. Reopen Schedule to refresh.'); }
});
window.loadStaffSchedule = window.staffScheduleSync.wrap(window.loadStaffSchedule);
window.staffStartup?.ready();
