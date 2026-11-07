// Pure, dependency-injected AI Board API policy. Firebase Admin must verify tokens
// with checkRevoked=true before any read or model call. No operational writes.
export const AI_BOARD_OWNER_EMAIL = 'jgo031996@gmail.com';
const allowedDirectors = new Set(['finance','audit','inventory','hr','operations','marketing','mentor']);
const allowedCollections = new Set(['transactions','expenses','inventory','inventory_logs','stock_logs','purchase_orders','budgets']);
const lower = value => String(value ?? '').trim().toLowerCase();

export class AIBoardError extends Error {
  constructor(status,code,message) { super(message); this.status=status; this.code=code; }
}
const deny = (status,code,message) => { throw new AIBoardError(status,code,message); };

export async function authorizeAIBoard(token,{verifyToken,ownerUid}) {
  if (!token || typeof token !== 'string') deny(401,'missing-auth','Sign in to the Owner App.');
  let claims;
  try { claims = await verifyToken(token,true); }
  catch { deny(401,'invalid-auth','Your session expired. Sign in again.'); }
  if (!claims?.uid || claims.email_verified !== true || lower(claims.email) !== AI_BOARD_OWNER_EMAIL)
    deny(403,'owner-only','Only the designated TAKODEÁL owner can access the AI Board.');
  // Provision the expected Firebase UID through trusted server configuration.
  // Email alone is not sufficient to enable the live endpoint.
  if (!ownerUid || claims.uid !== ownerUid)
    deny(503,'owner-not-configured','AI Board owner identity must be verified by the administrator.');
  return Object.freeze({uid:claims.uid,email:lower(claims.email)});
}

export function validateAIBoardQuery(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    deny(400,'invalid-query','Enter a valid Board question.');
  const keys=Object.keys(body);
  if (keys.some(key=>!['directorId','question','branch'].includes(key)))
    deny(400,'invalid-query','Unsupported request fields.');
  const directorId=body.directorId;
  const question=typeof body.question==='string'?body.question.trim():'';
  if (!allowedDirectors.has(directorId) || !question || question.length>4000)
    deny(400,'invalid-query','Choose a director and enter a question up to 4,000 characters.');
  const branch=body.branch===undefined?'All':body.branch;
  if (typeof branch!=='string' || branch.length>100)
    deny(400,'invalid-query','Choose a valid branch.');
  return Object.freeze({directorId,question,branch:branch.trim()||'All'});
}

export function createAIBoardService({verifyToken,ownerUid,readCollection,interpret}) {
  if (typeof verifyToken!=='function' || typeof readCollection!=='function' || typeof interpret!=='function')
    throw Error('AI Board service dependencies must be configured.');
  return Object.freeze({
    async consult({token,body}) {
      const owner=await authorizeAIBoard(token,{verifyToken,ownerUid});
      const query=validateAIBoardQuery(body);
      // Only explicit read operations on allowlisted sources; never pass Firestore
      // handles, write capabilities, secrets, or unrestricted tools to the model.
      const read=async collection=>{
        if (!allowedCollections.has(collection)) deny(403,'source-denied','This data source is not approved for AI Board access.');
        return readCollection(collection,{uid:owner.uid,branch:query.branch});
      };
      const response=await interpret({query,read});
      if (typeof response!=='string' || !response.trim())
        deny(502,'empty-response','The AI Board could not produce a recommendation.');
      return Object.freeze({directorId:query.directorId,recommendation:response.trim(),advisoryOnly:true});
    }
  });
}
