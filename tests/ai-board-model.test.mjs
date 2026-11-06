import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_BOARD_DIRECTORS, AI_BOARD_OWNER_EMAIL, AI_BOARD_READ_COLLECTIONS,
  AI_BOARD_OUTPUT_COLLECTIONS, isAIBoardOwner, assertAIBoardOwner,
  assertAIBoardRead, directorById, createAIBoardRequest
} from '../takodeal-manager/ai-board-model.js';

test('only the designated owner identity passes the Board gate', () => {
  assert.equal(isAIBoardOwner({uid:'owner-1',email:AI_BOARD_OWNER_EMAIL}),true);
  assert.equal(isAIBoardOwner({uid:'co-owner',email:'co-owner@example.com',role:'Owner',permissions:['all']}),false);
  assert.equal(isAIBoardOwner({uid:'manager',email:AI_BOARD_OWNER_EMAIL.toUpperCase()}),true);
  assert.equal(isAIBoardOwner({email:AI_BOARD_OWNER_EMAIL}),false);
  assert.throws(()=>assertAIBoardOwner({uid:'manager',email:'manager@example.com'}),{code:'ai-board/owner-only'});
});

test('the seven director roles include the AI Mentor', () => {
  assert.equal(AI_BOARD_DIRECTORS.length,7);
  assert.ok(directorById('mentor').title.includes('AI Mentor'));
  assert.equal(directorById('unknown'),null);
});

test('source collections are explicitly allowlisted and read-only', () => {
  assert.ok(AI_BOARD_READ_COLLECTIONS.includes('transactions'));
  assert.ok(AI_BOARD_OUTPUT_COLLECTIONS.includes('ai_board_reports'));
  assert.equal(assertAIBoardRead('transactions','read'),true);
  for (const [collection,operation] of [
    ['transactions','write'],['inventory','delete'],['payroll_records','update'],
    ['users','read'],['ai_board_reports','read']
  ]) assert.throws(()=>assertAIBoardRead(collection,operation),{code:'ai-board/read-only'});
});

test('director requests are bounded and recommendation-only', () => {
  const request=createAIBoardRequest({
    directorId:'finance',question:'Compare Cabantian and Maa this month.',
    branch:'All',period:{start:'2026-11-01',end:'2026-12-01'}
  });
  assert.equal(request.mode,'recommendation-only');
  assert.equal(request.sourcePolicy,'read-only');
  assert.equal(Object.isFrozen(request),true);
  assert.throws(()=>createAIBoardRequest({directorId:'finance',question:'  '}));
  assert.throws(()=>createAIBoardRequest({directorId:'invalid',question:'Review'}));
  assert.throws(()=>createAIBoardRequest({directorId:'audit',question:'Review',period:{start:'2026-12-01',end:'2026-11-01'}}));
});
