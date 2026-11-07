// TAKODEÁL AI Board domain model.
// UI policy only: server endpoints must independently verify Firebase ID tokens and owner UID.
export const AI_BOARD_OWNER_EMAIL = 'jgo031996@gmail.com';

export const AI_BOARD_DIRECTORS = Object.freeze([
  { id:'finance', title:'Finance Director', remit:'Revenue, expenses, margins, cash flow, branch comparisons and investment scenarios.' },
  { id:'audit', title:'Audit Director', remit:'Reconciliation, duplicate detection, data quality, control gaps and evidence checks.' },
  { id:'inventory', title:'Inventory Director', remit:'Stock movement, ingredient usage, wastage, purchasing signals and variance.' },
  { id:'hr', title:'HR Director', remit:'Staffing, attendance, schedule insights, training and people-process risks.' },
  { id:'operations', title:'Operations Director', remit:'Branch performance, SOP consistency, service quality and bottlenecks.' },
  { id:'marketing', title:'Marketing Director', remit:'Promotion performance, demand patterns, channel mix and campaign analysis.' },
  { id:'mentor', title:'AI Mentor & Strategic Advisor', remit:'Decision briefs, scenario comparisons, counterarguments, trade-offs and practical next steps.' }
]);

// Never inherit broad "all", "owner" role labels, or AI Hub publishing permissions.
const normalize = value => String(value ?? '').trim().toLowerCase();
export function isAIBoardOwner(user) {
  return !!user?.uid && user.emailVerified === true && normalize(user.email) === AI_BOARD_OWNER_EMAIL;
}
export const isAIBoardSessionOwner=(user,session)=>isAIBoardOwner(user)&&session?.uid===user.uid;

export function assertAIBoardOwner(user) {
  if (!isAIBoardOwner(user)) {
    const error = new Error('The TAKODEÁL AI Board is available to the designated owner account only.');
    error.code = 'ai-board/owner-only';
    throw error;
  }
  return true;
}

// The deployed Board has no persistence or operational write functions.
export const AI_BOARD_READ_COLLECTIONS = Object.freeze([
  'transactions','expenses','inventory','stock_logs','shifts','attendance_logs'
]);
export const AI_BOARD_OUTPUT_COLLECTIONS = Object.freeze([
]);

export function assertAIBoardRead(collection, operation='read') {
  if (operation !== 'read' || !AI_BOARD_READ_COLLECTIONS.includes(String(collection))) {
    const error = new Error('AI Board source access is read-only and restricted to approved collections.');
    error.code = 'ai-board/read-only';
    throw error;
  }
  return true;
}

export function directorById(id) {
  return AI_BOARD_DIRECTORS.find(director => director.id === id) || null;
}

const validISODate = value => {
  if (typeof value !== 'string' || value.length !== 10 || value[4] !== '-' || value[7] !== '-') return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0,10) === value;
};

export function createAIBoardRequest({ directorId, question, period, branch='All',consultation='ask' } = {}) {
  if (!directorById(directorId)) throw new Error('Choose a valid AI Board director.');
  const prompt = String(question ?? '').trim();
  if (!prompt || prompt.length > 4000) throw new Error('Enter a question (up to 4,000 characters).');
  if (!period || !validISODate(period.start) || !validISODate(period.end) || period.start > period.end || Date.parse(period.end)-Date.parse(period.start)>30*86400000) {
    throw new Error('Choose a valid reporting period.');
  }
  return Object.freeze({
    directorId, question:prompt, branch:String(branch || 'All').trim().slice(0,100),
    period:period ? Object.freeze({start:period.start,end:period.end}) : null,
    consultation
  });
}
