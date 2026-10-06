import {installRecipeReplacement} from './modules/takodeal-manager/recipe-bulk.js';
import {loadRecipeState,recipePlan,saveRecipePlan} from './modules/takodeal-manager/recipe-changes.js';
import {createRecipeFixture} from './fake-store.mjs';
const fixture=createRecipeFixture(),api=fixture.api,$=id=>document.getElementById(id);
const escape=value=>String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
// This small local dialog adapter runs the production UI's actual didOpen and
// preConfirm callbacks. It contains no business logic or save implementation.
const dialog={loading:false,current:null,showValidationMessage:text=>{$('validation').textContent=text;},isLoading:()=>dialog.loading,
    fire(options){return new Promise(resolve=>{
        const host=$('dialog');host.hidden=false;host.innerHTML='<section class="popup" role="dialog" aria-modal="true"><h2>'+escape(options.title || '')+'</h2><div id="dialogBody">'+(options.html || '<p>'+escape(options.text || '')+'</p>')+'</div><p id="validation" role="alert"></p><footer><button id="cancel">'+(options.showCancelButton?'Cancel':'Close')+'</button><button id="confirm" class="primary">'+escape(options.confirmButtonText || 'Continue')+'</button></footer></section>';
        dialog.current=options;dialog.loading=false;
        $('cancel').onclick=()=>{if(dialog.loading)return;host.hidden=true;dialog.current=null;resolve({isConfirmed:false});};
        $('confirm').onclick=async()=>{if(dialog.loading)return;dialog.loading=true;$('confirm').disabled=true;$('validation').textContent='';
            try{const value=options.preConfirm?await options.preConfirm():true;if(value===false)return;host.hidden=true;dialog.current=null;resolve({isConfirmed:true,value});}
            catch(error){dialog.showValidationMessage(error.message);}finally{dialog.loading=false;if($('confirm'))$('confirm').disabled=false;}
        };options.didOpen?.();
    });}};
api.Swal=dialog;api.ManagerUI={notify:text=>{$('notice').textContent=text;}};
const render=()=>{$('checks').textContent=JSON.stringify(fixture.verify(),null,2);$('records').textContent=JSON.stringify([...fixture.docs].filter(([path])=>path.startsWith('bom/') || path.startsWith('settings/recipe_')).map(([path,data])=>({path,...data})),null,2);};
api.onChange=render;installRecipeReplacement(api,document);render();
$('openReplacement').onclick=()=>api.openRecipeReplacement();
$('loseAck').onclick=()=>{fixture.loseNextAck();$('notice').textContent='The next sample save will commit but return a connection error. Press the same Save button again to verify one revision.';};
$('competingSave').onclick=async()=>{try{const state=await loadRecipeState(api);await saveRecipePlan(api,recipePlan(state,[{table:'bom',id:'sauce-twelve',mode:'update',data:{qty:21}}],{label:'Competing sample edit'}),{operationId:'local-competing-'+crypto.randomUUID()});$('notice').textContent='A competing sample change was saved. The open replacement preview must now refuse to save.';}catch(error){$('notice').textContent=error.message;}};
$('revokeAccess').onclick=()=>{fixture.put('hq_managers/qa',{email:'preview@example.test',pin:'1234',role:'Co-Owner',permissions:['dashboard']});$('notice').textContent='Sample saved permission revoked. The open preview must refuse to save.';};
$('reset').onclick=()=>location.reload();
// Browser verification can operate real DOM controls through this helper, then
// inspect the same fake records. Production modules are copied byte-for-byte.
window.recipeQa={api,fixture,dialog,render};window.recipeQaReady=true;
