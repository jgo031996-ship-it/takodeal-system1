import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeAIBoard,validateAIBoardQuery,createAIBoardService} from '../functions/ai-board/service.mjs';

const owner={uid:'owner-uid',email:'jgo031996@gmail.com',email_verified:true};
const verifyToken=async(token,checkRevoked)=>{assert.equal(checkRevoked,true);if(token==='revoked')throw Error('revoked');return token==='owner'?owner:{uid:'other',email:'staff@example.com',email_verified:true};};

test('server authorization requires verified owner email AND pinned UID',async()=>{
  assert.equal((await authorizeAIBoard('owner',{verifyToken,ownerUid:'owner-uid'})).uid,'owner-uid');
  await assert.rejects(()=>authorizeAIBoard('staff',{verifyToken,ownerUid:'owner-uid'}),{code:'owner-only'});
  await assert.rejects(()=>authorizeAIBoard('revoked',{verifyToken,ownerUid:'owner-uid'}),{code:'invalid-auth'});
  await assert.rejects(()=>authorizeAIBoard('owner',{verifyToken,ownerUid:'wrong'}),{code:'owner-not-configured'});
  await assert.rejects(()=>authorizeAIBoard('owner',{verifyToken}),{code:'owner-not-configured'});
});

test('query rejects extra fields and unknown directors',()=>{
  assert.equal(validateAIBoardQuery({directorId:'finance',question:' Sales? '}).question,'Sales?');
  assert.throws(()=>validateAIBoardQuery({directorId:'finance',question:'Hi',action:'delete-sales'}),{code:'invalid-query'});
  assert.throws(()=>validateAIBoardQuery({directorId:'unknown',question:'Hi'}),{code:'invalid-query'});
});

test('service is advisory-only and reads only approved collections',async()=>{
  const accessed=[];
  const service=createAIBoardService({
    verifyToken,ownerUid:'owner-uid',
    readCollection:async(collection)=>{accessed.push(collection);return [{amount:42}];},
    interpret:async({read})=>{const data=await read('transactions');assert.equal(data[0].amount,42);return 'Review the revenue trend.';}
  });
  const result=await service.consult({token:'owner',body:{directorId:'finance',question:'Revenue?'}});
  assert.equal(result.advisoryOnly,true);
  assert.deepEqual(accessed,['transactions']);
  const blocked=createAIBoardService({verifyToken,ownerUid:'owner-uid',readCollection:async()=>{throw Error('must not read');},interpret:async({read})=>{await read('hq_email_access');return 'No';}});
  await assert.rejects(()=>blocked.consult({token:'owner',body:{directorId:'audit',question:'Review'}}),{code:'source-denied'});
});
