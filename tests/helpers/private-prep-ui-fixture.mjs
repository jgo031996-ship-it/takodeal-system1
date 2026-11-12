import {installPrivatePrepReviews,PRIVATE_PREP_ENDPOINT} from '../../takodeal-manager/private-prep-reviews.js';
import {createPostedPrepWarnings} from '../../takodeal-manager/private-prep-stock-warnings.js';
import {createPrepYieldWarnings} from '../../takodeal-manager/private-prep-yield-warnings.js';
export const reviewSummary=(number=1)=>({operationId:'review-operation-'+number,branch:'Test Branch',outputInventoryId:'prepared-'+number,outputName:'Test Sauce '+number,qty:2,status:'Pending',stockPosted:false,createdAt:new Date(Date.UTC(2026,10,10,10,0,number)).toISOString()});
export const reviewDetail=(number=1)=>({...reviewSummary(number),declaredName:'Test Sauce '+number,reason:'',note:'PRIVATE_NOTE_'+number,issue:{code:'invalid-stock-quantity',message:'Saved raw stock needs review.',details:{inventoryId:'raw-'+number,itemName:'Test Raw',role:'ingredient',recordedStock:-25}},reportedBy:{staffId:'test-crew',staffName:'PRIVATE_STAFF'},sourceFingerprint:'a'.repeat(64)});
const eventTarget=()=>{const events=new Map();return{addEventListener(type,fn){const set=events.get(type)||new Set();set.add(fn);events.set(type,set);},removeEventListener(type,fn){events.get(type)?.delete(fn);},emit(type){for(const fn of[...(events.get(type)||[])])fn({type});}};};
export function privatePrepFixture({active=true,locked=false,owner=true,stockWarnings=false,yieldWarnings=false}={}){
 const nodes=new Map();
 class Element{
  constructor(tag){Object.assign(this,eventTarget());this.tagName=tag.toUpperCase();this.children=[];this.style={};this.hidden=false;this.disabled=false;this.attributes={};this.value='';this._text='';this.classes=new Set();this.classList={add:(...names)=>names.forEach(name=>this.classes.add(name)),contains:name=>this.classes.has(name),remove:name=>this.classes.delete(name)};}
  set id(value){this._id=value;nodes.set(value,this);}get id(){return this._id;}
  set className(value){this.classes=new Set(String(value).split(/\s+/));}get className(){return [...this.classes].join(' ');}
  set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent||'').join(' ');}
  append(...children){this.children.push(...children);}replaceChildren(...children){this._text='';this.children=[...children];}setAttribute(key,value){this.attributes[key]=String(value);}get options(){return this.children;}
 }
 const d={...eventTarget(),visibilityState:'visible',createElement:tag=>new Element(tag),getElementById:id=>nodes.get(id)||null,body:new Element('body')};
 for(const[tag,id]of[['section','privatePrepReviewsHost'],['div','view-alerts'],['div','loginOverlay'],['select','invBranchFilter'],['select','invCategoryFilter'],['input','liveInvSearch']]){const item=d.createElement(tag);item.id=id;d.body.append(item);}
 nodes.get('view-alerts').className=active?'view active':'view';nodes.get('loginOverlay').style.display=locked?'flex':'none';
 let clock=0,sequence=0;const timers=new Map(),observers=[];
 const setTimer=(fn,delay=0)=>{const id=++sequence;timers.set(id,{fn,at:clock+delay});return id;},clearTimer=id=>timers.delete(id);
 function advance(ms){const until=clock+ms;let count=0;while(true){const due=[...timers].filter(([,value])=>value.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;if(++count>1000)throw Error('Runaway test timer');clock=due[1].at;timers.delete(due[0]);due[1].fn();}clock=until;}
 const calls=[],navigation=[],notices=[],publicFeed=[{id:'public-existing',message:'Public existing alert'}],w={...eventTarget(),navigator:{onLine:true},setTimeout:setTimer,clearTimeout:clearTimer,ManagerUI:{notify:message=>notices.push(message)},globalSecurityAlerts:publicFeed,MutationObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){this.stopped=true;}}};
 w.auth={currentUser:{uid:'test-owner',email:owner?'jgo031996@gmail.com':'other@example.test',emailVerified:true,providerData:[{providerId:'google.com'}],getIdToken:async()=>'FICTIONAL_OWNER_TOKEN'}};
 w.sessionUser={uid:'test-owner',email:w.auth.currentUser.email,role:'Owner',isOwner:true,isFranchisee:false,permissions:['all'],allowedBranches:['All']};
 w.localStorage={getItem(){throw Error('Private reviews must not read localStorage');},setItem(){throw Error('Private reviews must not write localStorage');}};
 let clears=0;w.clearManagerMemoryCache=()=>{clears++;return 'original-clear-result';};w.isBranchAllowed=()=>true;
 w.switchView=page=>{navigation.push({page});if(page!=='alerts')nodes.get('view-alerts').classList.remove('active');};w.switchInvTab=tab=>{navigation.push({tab,branch:nodes.get('invBranchFilter').value,item:nodes.get('liveInvSearch').value});w.switchView('inventory');};
 const f={w,d,nodes,calls,navigation,notices,timers,observers,publicFeed,advance,get clears(){return clears;},get now(){return clock;},page:{schemaVersion:1,reviews:[reviewSummary()],hasMore:false,nextAfterOperationId:null},detail:reviewDetail(),async flush(){for(let n=0;n<20;n++)await new Promise(resolve=>queueMicrotask(resolve));},notify(){observers.filter(item=>!item.stopped).forEach(item=>item.fn());},find(text){const all=[];const walk=node=>{all.push(node);for(const child of node.children||[])walk(child);};walk(nodes.get('privatePrepReviewsHost'));return all.find(node=>node.tagName==='BUTTON'&&node.textContent===text);}};
 const fetcher=async(url,options)=>{const call={url,options,body:JSON.parse(options.body)};calls.push(call);if(f.fetchHook)return f.fetchHook(call);const body=[PRIVATE_PREP_ENDPOINT+'stock-warnings',PRIVATE_PREP_ENDPOINT+'yield-warnings'].includes(url)?{schemaVersion:1,warnings:[],hasMore:false,nextAfterOperationId:null}:url===PRIVATE_PREP_ENDPOINT+'reviews'?f.page:{schemaVersion:1,review:f.detail};return{ok:true,status:200,url,text:async()=>JSON.stringify(body)};};
 f.ui=installPrivatePrepReviews(w,d,{fetcher,now:()=>clock,setTimer,clearTimer,makeStockWarnings:stockWarnings?createPostedPrepWarnings:()=>null,makeYieldWarnings:yieldWarnings?createPrepYieldWarnings:()=>null});return f;
}
