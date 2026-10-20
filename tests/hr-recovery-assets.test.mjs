import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url),read=file=>readFileSync(new URL(file,root),'utf8');
test('all updated workers execute and include their actual new runtime dependencies without clearing business storage',()=>{
 const apps=[['takodeal-manager','CORE_ASSETS',['hr-review-ui.js','hr-review.css','attendance-amendment-review.js','attendance-amendment-review-model.js','attendance-metadata-reader.js','onboarding-model.js','onboarding-owner.js']],['Takodeal-POS','required',['attendance-amendment-review-model.js','attendance-metadata-reader.js']],['takodeal-staff','SHELL',['onboarding-model.js','onboarding-service.js','onboarding-ui.js','onboarding.css','attendance-amendment-review-model.js','attendance-metadata-reader.js']],['takodeal-franchise','CORE',['attendance-amendment-review-model.js']]];
 for(const [app,list,expected]of apps){const worker=read(app+'/sw.js'),context={URL,self:{location:{href:'https://sample.invalid/'+app+'/sw.js',origin:'https://sample.invalid'},addEventListener(){}}};vm.createContext(context);vm.runInContext(worker+'\nthis.assets='+list,context);const assets=context.assets.map(file=>file.replace(/^\.\//,''));for(const file of expected){assert.ok(assets.includes(file),app+' caches '+file);assert.ok(existsSync(new URL(app+'/'+file,root)));}assert.doesNotMatch(worker,/indexedDB\.deleteDatabase|localStorage\.clear\(/);}
 assert.match(read('takodeal-manager/index.html'),/href="hr-review\.css\?v=20261021"/);assert.match(read('takodeal-staff/index.html'),/href="onboarding\.css\?v=20261021"/);
});
test('Owner entry points use the real review center and frozen paid amount without an automatic approval bypass',()=>{
 const main=read('takodeal-manager/main.js');assert.match(main,/installHRReviewCenter,heldPayrollReviewHTML/);assert.equal(main.split('heldPayrollReviewHTML(d)').length-1,2);assert.match(main,/btnCheckSavedPayslip/);assert.match(main,/accountId:result\.accountId\?\?account\.id/);assert.match(main,/Number\(paidSnapshot\.finalNetPay\)/);assert.match(read('takodeal-manager/index.html'),/HR Review Center/);assert.match(read('takodeal-manager/hr-review-ui.js'),/Review affected records →/);
});
