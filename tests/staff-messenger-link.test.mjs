import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeStaffMessengerUrl} from '../takodeal-manager/staff-messenger-link.js';
test('optional empty contact stays empty and supported direct HTTPS recipients normalize without guessing an identity',()=>{
 for(const value of ['',null,undefined,'   '])assert.equal(normalizeStaffMessengerUrl(value),'');
 for(const [value,expected]of [
  [' https://www.facebook.com/messages/t/0012345/ ','https://facebook.com/messages/t/0012345'],
  [' https://www.facebook.com/messages/e2ee/t/009876543210/ ','https://facebook.com/messages/e2ee/t/009876543210'],
  ['https://www.messenger.com/t/0012345','https://messenger.com/t/0012345'],
  ['https://m.me/sample.employee','https://m.me/sample.employee'],
  ['https://www.facebook.com/profile.php?id=0012345','https://facebook.com/profile.php?id=0012345'],
  ['https://facebook.com/sample.employee/','https://facebook.com/sample.employee']
 ])assert.equal(normalizeStaffMessengerUrl(value),expected);
});
test('lookalike hosts, credentials, non-HTTPS schemes, custom ports and unrelated Facebook pages are rejected',()=>{
 for(const value of [
  'javascript:alert(1)','http://facebook.com/sample.employee','https://facebook.com.example.test/sample.employee','https://fakefacebook.com/sample.employee',
  'https://facebook.com@evil.example.test/sample.employee','https://user:secret@facebook.com/sample.employee','https://facebook.com:8443/sample.employee',
  'https://m.facebook.com/sample.employee','https://www.m.me/sample.employee','https://facebook.com/login','https://facebook.com/groups/sample.employee',
  'https://facebook.com/share/sample.employee','https://facebook.com/l.php','https://facebook.com/me','https://messenger.com/t/me','https://facebook.com/home.php','https://messenger.com/sample.employee','https://m.me/',false,{}]
 )assert.throws(()=>normalizeStaffMessengerUrl(value),/direct HTTPS/);
});
test('unexpected queries, fragments, encoded path tricks and dot-segment changes never silently alter the chosen recipient',()=>{
 for(const value of [
  'https://facebook.com/profile.php?id=123&id=456','https://facebook.com/profile.php?id=123&fbclid=ignored','https://facebook.com/profile.php?id=name',
  'https://m.me/sample.employee?ref=payroll','https://facebook.com/sample.employee?','https://facebook.com/sample.employee#section',
  'https://facebook.com/sample.employee#','https://facebook.com/messages/t/old/../other','https://facebook.com/messages/t/%2e%2e/other',
  'https://facebook.com/messages/t/123%2F456','https://facebook.com/sample.employee\\other','https://facebook.com/sam\nple.employee']
 )assert.throws(()=>normalizeStaffMessengerUrl(value),/direct HTTPS/);
});

test('encrypted conversation support remains limited to the exact Facebook numeric-thread route',()=>{
 for(const value of ['https://facebook.com/messages/e2ee/t/name','https://facebook.com/messages/e2ee/t/123/forward','https://facebook.com/messages/e2ee/t/123?next=https://example.test','https://messenger.com/messages/e2ee/t/123','https://facebook.com.evil.test/messages/e2ee/t/123','https://facebook.com/messages/e2ee/t/%31%32%33','https://facebook.com/messages/e2ee/t/123#redirect','https://facebook.com/messages/e2ee/t/'+ '1'.repeat(41)])assert.throws(()=>normalizeStaffMessengerUrl(value),/direct HTTPS/);
});
