// A page restart is explicit: other open editors may also contain unsaved work.
const installed=new WeakMap();
export function installCloudConnectionNotice(w,d){
 if(installed.has(w))return installed.get(w);
 function show(){if(!w.managerCloudHealth?.isFailed?.())return;if(!d.body){d.addEventListener('DOMContentLoaded',show,{once:true});return;}if(d.getElementById('ownerCloudConnectionNotice'))return;
  const notice=d.createElement('aside');notice.id='ownerCloudConnectionNotice';notice.setAttribute('role','alert');notice.style.cssText='position:fixed;top:12px;left:12px;right:12px;max-width:900px;margin:auto;padding:14px 18px;border:1px solid #e8bd8a;border-radius:12px;background:#fff7e9;color:#713c18;box-shadow:0 6px 22px #39251426;z-index:7000;font:14px Arial,sans-serif;line-height:1.5;box-sizing:border-box;overflow-wrap:anywhere';
  const title=d.createElement('strong');title.textContent='The Owner app’s HQ connection stopped.';const detail=d.createElement('p');detail.style.cssText='margin:5px 0 0';detail.textContent='New saves may be unconfirmed. Keep unsaved work open. For schedule edits, use Schedule Manager’s local draft recovery tools before reopening the app. Clearing app data is not needed.';notice.append(title,detail);d.body.append(notice);
 }
 w.addEventListener('managercloudfailure',show);show();const result={show};installed.set(w,result);return result;
}
if(typeof window!=='undefined'&&typeof document!=='undefined')installCloudConnectionNotice(window,document);
