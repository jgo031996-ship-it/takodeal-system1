import {mealLevels,validateCheckoutFields,configurationPatch,ROLE_LABELS} from './pos-config-model.js';
import {escapeHTML as esc} from './access-workspace-model.js';
import {bounded} from './unlock-gate.js';
const LISTS = [
    ['paymentMethods','Payment methods',['Cash','GCash','Bank','Grab','Foodpanda']],['orderTypes','Order types',['Dine-In','Take-Out','Delivery','Grab']],
    ['kitchenPrepCats','Kitchen preparation categories',['Prepared Batch']],['consumableCats','Consumable categories',['Consumables','Cleaning Supplies','Packaging']],
    ['mixMatchFlavors','Mix & match flavors',['Pork','Shrimp','Octopus','Ham & Cheese','Bacon & Cheese']],['wasteReasons','Waste reasons',['Dropped / Spilled','Burnt / Overcooked','Spoiled / Expired','Customer Replacement','Pest Damage','Other']],
    ['shiftAuditItems','Shift handover audit items',['Paper Bowl','Plastic Cup']],['auditItems','General audit items',['320cc Paper Bowl','520cc Paper Bowl','LB1 Box','Burger Box']],
    ['customerHomeCategories','Customer featured categories',['Takoyaki','Milk Tea','Iced Coffee']]
];
export function initPosConfigWorkspace({window:w=window,document:d=document}={}) {
    const host=d.getElementById('section-master'); if(!host) return;
    let draft,revision=0,loaded=false,busy=false;
    const writable=()=>Boolean(w.auth?.currentUser && (w.sessionUser?.isOwner || w.sessionUser?.permissions?.includes('posconfig')));
    const uid=prefix=>prefix+(w.crypto?.randomUUID?.() || Date.now().toString(36)+Math.random().toString(36).slice(2));
    const status=(message,error=false)=>{const node=host.querySelector('[data-pc-status]');if(node){node.textContent=message;node.dataset.error=String(error);}};
    const fields=()=>({levels:[...host.querySelectorAll('[data-level]')].map(row=>({id:row.dataset.level,name:row.querySelector('[data-name]').value,
        roles:[...row.querySelectorAll('[data-role]:checked')].map(input=>input.dataset.role),takoyakiPct:row.querySelector('[data-tako]').value,otherPct:row.querySelector('[data-other]').value,enabled:row.querySelector('[data-enabled]').checked})),
        dropdowns:[...host.querySelectorAll('[data-field]')].map(row=>({id:row.dataset.field,name:row.querySelector('[data-name]').value,options:row.querySelector('[data-options]').value.split('\n').map(value=>value.trim()).filter(Boolean),required:row.querySelector('[data-required]').checked,enabled:row.querySelector('[data-enabled]').checked})),
        lists:Object.fromEntries(LISTS.map(([key])=>[key,host.querySelector(`[data-list="${key}"]`).value.split(',').map(value=>value.trim()).filter(Boolean)]))});
    function render(message='') {
        host.className='pos-config-workspace';
        host.innerHTML=`<div class="pc-intro"><div><h2>Checkout configuration</h2><p>Set meal benefits by role and add dropdowns for the details your cashiers need.</p></div><button data-reload>Reload saved settings</button></div>
            <section class="pc-section"><header><div><h3>Staff & leadership meal discounts</h3><p class="pc-hint">Each level requires a matching PIN and role. Staff meals keep the daily limit. Unpaid meal amounts remain salary deductions.</p></div><button data-add-level>+ Add meal level</button></header>
            <div class="pc-scroll"><table class="pc-table"><thead><tr><th>LEVEL</th><th>ALLOWED ROLES</th><th>TAKOYAKI %</th><th>OTHER CATEGORIES %</th><th>ENABLED</th><th></th></tr></thead><tbody>${draft.levels.map(row=>`<tr data-level="${esc(row.id)}"><td><input data-name aria-label="Meal level name" maxlength="80" value="${esc(row.name)}"></td><td><div class="pc-roles">${Object.entries(ROLE_LABELS).map(([role,name])=>`<label><input type="checkbox" data-role="${role}" ${row.roles.includes(role)?'checked':''}>${name}</label>`).join('')}</div></td><td><input data-tako aria-label="Takoyaki discount percentage" type="number" min="0" max="100" step="0.01" value="${row.takoyakiPct}"></td><td><input data-other aria-label="Other category discount percentage" type="number" min="0" max="100" step="0.01" value="${row.otherPct}"></td><td><input type="checkbox" data-enabled aria-label="Enable meal level" ${row.enabled!==false?'checked':''}></td><td><button data-remove-level="${esc(row.id)}" aria-label="Remove ${esc(row.name)}">Remove</button></td></tr>`).join('')}</tbody></table></div></section>
            <section class="pc-section"><header><div><h3>Additional checkout dropdowns</h3><p class="pc-hint">Saved selections are included in the sale record and receipt. Enter one option per line.</p></div><button data-add-field>+ Add dropdown</button></header>
            ${draft.dropdowns.length?draft.dropdowns.map(row=>`<div class="pc-field" data-field="${esc(row.id)}"><div><label>Dropdown label<input data-name maxlength="80" value="${esc(row.name)}" placeholder="e.g. Order source"></label><div class="pc-actions"><label class="pc-toggle"><input type="checkbox" data-required ${row.required?'checked':''}>Required</label><label class="pc-toggle"><input type="checkbox" data-enabled ${row.enabled!==false?'checked':''}>Enabled</label></div></div><label>Options<textarea data-options placeholder="Walk-in&#10;Phone order">${esc(row.options.join('\n'))}</textarea></label><div><button data-remove-field="${esc(row.id)}">Remove</button></div></div>`).join(''):'<p class="pc-hint">No extra dropdowns yet. Add a field such as Order source or Pickup counter.</p>'}</section>
            <section class="pc-section"><header><div><h3>POS lists & categories</h3><p class="pc-hint">Add, rename, or remove entries. Separate entries with commas.</p></div></header><div class="pc-grid">${LISTS.map(([key,name])=>`<label class="pc-list-card">${name}<input data-list="${key}" value="${esc(draft.lists[key].join(', '))}"></label>`).join('')}</div></section>
            <div class="pc-actions"><button class="pc-primary" data-save-config>Save POS configuration</button><span class="pc-hint">Changes apply when each POS refreshes its settings.</span></div><p data-pc-status class="pc-status" role="status">${esc(message)}</p>`;
        host.querySelector('[data-add-level]').onclick=()=>{draft=fields();draft.levels.push({id:uid('meal_level_'),name:'Co-Owner Meal',roles:['co_owner'],takoyakiPct:0,otherPct:0,enabled:true});render('New level added. Set its percentages before saving.');};
        host.querySelector('[data-add-field]').onclick=()=>{draft=fields();draft.dropdowns.push({id:uid('checkout_'),name:'',options:[],required:false,enabled:true});render('New dropdown added. Enter its label and options.');};
        host.querySelectorAll('[data-remove-level],[data-remove-field]').forEach(button=>button.onclick=()=>{draft=fields();if(button.dataset.removeLevel)draft.levels=draft.levels.filter(row=>row.id!==button.dataset.removeLevel);else draft.dropdowns=draft.dropdowns.filter(row=>row.id!==button.dataset.removeField);render('Removed from the draft. Save to apply.');});
        host.querySelector('[data-reload]').onclick=load;
        host.querySelector('[data-save-config]').onclick=save;
        host.querySelectorAll('button,input,textarea').forEach(node=>node.disabled=!writable()||busy);
    }
    async function load() {
        if(busy)return; busy=true;
        try{
            const snap=await bounded(w.getDocFromServer(w.doc(w.db,'settings','global_pos_config'))),data=snap.exists()?snap.data():{};
            revision=Number(data.configEditorRevision)||0;
            draft={levels:mealLevels(data),dropdowns:validateCheckoutFields(data.customCheckoutFields||[]),lists:Object.fromEntries(LISTS.map(([key,,defaults])=>[key,Array.isArray(data[key])&&data[key].length?data[key]:defaults]))};
            loaded=true;busy=false;render('Saved configuration loaded.');
        }catch(error){loaded=false;busy=false;host.innerHTML='<p class="pc-status" role="alert"></p><button data-retry>Retry loading configuration</button>';host.querySelector('p').textContent=error.message;host.querySelector('[data-retry]').onclick=load;}
    }
    async function save() {
        if(busy||!loaded)return;
        try{
            if(!writable())throw Error('Your account cannot change POS configuration.');
            const next=fields(),patch=configurationPatch(next.levels,next.dropdowns);
            for(const [key,,] of LISTS){const list=next.lists[key];if(!list.length||list.length>100||list.some(value=>value.length>100)||new Set(list.map(value=>value.toLowerCase())).size!==list.length)throw Error('Each POS list needs distinct entries, up to 100 items.');patch[key]=list;}
            busy=true;host.querySelectorAll('button,input,textarea').forEach(node=>node.disabled=true);status('Saving configuration to HQ…');
            await bounded(w.runTransaction(w.db,async tx=>{
                const ref=w.doc(w.db,'settings','global_pos_config'),snap=await tx.get(ref);
                if((Number(snap.data()?.configEditorRevision)||0)!==revision)throw Error('Another manager saved changes. Reload saved settings before editing again.');
                if(!writable())throw Error('Your account changed. Sign in again.');
                tx.set(ref,{...patch,configEditorRevision:revision+1,lastUpdatedBy:w.sessionUser?.cashierName||'Manager',timestamp:w.serverTimestamp()},{merge:true});
            }));
            revision++;draft={...next,levels:patch.mealDiscountLevels,dropdowns:patch.customCheckoutFields};busy=false;
            render('POS configuration saved. Cashiers can refresh the app to load it.');
        }catch(error){status(error.message||'Unable to confirm the save. Your draft values are kept.',true);}
        finally{busy=false;host.querySelectorAll('button,input,textarea').forEach(node=>node.disabled=!writable());}
    }
    const prior=w.loadPosConfigHub;
    w.loadPosConfigHub=async()=>{await prior?.();await load();};
    host.innerHTML='<p class="pc-status">Open POS Config Hub to load the saved settings.</p>';
    return {load};
}
