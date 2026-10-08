import test from 'node:test';
import assert from 'node:assert/strict';
import {embeddedBrowser,publicOrderingUrl} from '../Customer/customer-browser-help.js';
test('Messenger on iPhone receives honest Safari instructions while normal browsers do not',()=>{
    assert.deepEqual(embeddedBrowser({userAgent:'Mozilla iPhone FBAN/MessengerForiOS FBAV/500'}),{embedded:true,ios:true});
    assert.deepEqual(embeddedBrowser({userAgent:'Mozilla iPhone Safari/605'}),{embedded:false,ios:true});
    assert.deepEqual(embeddedBrowser({userAgent:'Mozilla Android FB_IAB/FB4A'}),{embedded:true,ios:false});
});
test('the customer copied link excludes Facebook tracking, auth and order information',()=>{
    assert.equal(publicOrderingUrl('https://takodeal-customer.vercel.app/?fbclid=abc&code=private#order=secret'),'https://takodeal-customer.vercel.app/');
    assert.throws(()=>publicOrderingUrl('javascript:alert(1)'));
});
