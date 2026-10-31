import {APPEARANCE_KEY,APPEARANCE_DOCUMENT,THEMES,appearanceDefaults,validateAppearance,effectiveAppearance,appearanceTokens} from './cashier-appearance-model.js';
const TTL=10*60*1000;
const integer=value=>Number.isSafeInteger(value)&&value>=0;
export function readAppearanceCache(storage,now=Date.now()){
 try{const raw=storage.getItem(APPEARANCE_KEY);if(!raw||raw.length>12000)return null;const row=JSON.parse(raw);if(row.schemaVersion!==1||!integer(row.revision)||!Number.isFinite(row.checkedAt)||row.checkedAt>now+60000)return null;return {...row,appearance:validateAppearance(row.appearance)};}catch{return null;}
}
export function createCashierAppearanceReader({storage,read,apply=()=>{},now=Date.now,timeoutMs=5000}={}){
 let row=readAppearanceCache(storage,now()),pending=null,nextTry=0;
 const paint=()=>{const config=effectiveAppearance(row?.appearance||appearanceDefaults(),{now:new Date(now())});apply(config,{revision:row?.revision||0,checkedAt:row?.checkedAt||null});return config;};
 function refresh({force=false}={}){
  paint();if(pending)return pending;
  if(!force&&(row&&now()-row.checkedAt<TTL||now()<nextTry))return Promise.resolve({saved:!!row,revision:row?.revision||0});
  let expired=false,timer;const work=Promise.resolve().then(()=>read()).then(snapshot=>{
   if(expired)return {saved:false};if(!snapshot||snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites)throw Error('The saved Cashier appearance could not be confirmed.');
   const data=snapshot.exists()?snapshot.data():null;if(data&&(data.schemaVersion!==1||!integer(data.revision)||data.revision<1))throw Error('The saved appearance needs Owner review.');
   const appearance=data?validateAppearance(data.appearance):appearanceDefaults();
   row={schemaVersion:1,revision:data?.revision||0,appearance,checkedAt:now()};try{storage.setItem(APPEARANCE_KEY,JSON.stringify(row));}catch{}paint();return {saved:true,revision:row.revision};
  });
  pending=Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Error('Appearance refresh took too long. The current design is kept.'));},timeoutMs);})]).catch(error=>{nextTry=now()+60000;throw error;}).finally(()=>{expired=true;clearTimeout(timer);pending=null;});return pending;
 }
 paint();return {refresh,paint,get saved(){return row;}};
}
export function applyCashierAppearance(w,d,value,metadata={}){
 const config=validateAppearance(value),root=d.documentElement,tokens=appearanceTokens(config),previousRanking=root.dataset.cashierRanking;
 for(const [key,colour]of Object.entries(tokens))root.style.setProperty('--ca-'+key,colour);
 for(const [alias,key]of [['bg','background'],['text','ink'],['border','line']])root.style.setProperty('--ca-'+alias,tokens[key]);
 root.dataset.cashierTheme=config.theme;root.dataset.cashierDensity=config.density;root.dataset.cashierLargeText=String(config.largeText);root.dataset.cashierDecorations=String(config.decorations);root.dataset.cashierRanking=String(config.showRanking);
 const preset=THEMES.find(row=>row.id===config.theme),login=d.getElementById('loginOverlay');
 if(login&&!login.querySelector('.cashier-welcome-panel')){
  const panel=d.createElement('section');panel.className='cashier-welcome-panel';panel.setAttribute('aria-label','Cashier welcome');
  const brand=d.createElement('p');brand.className='cashier-welcome-eyebrow';brand.textContent='TAKODEÁL · YOUR BRANCH WORKSPACE';
  const title=d.createElement('h1');title.textContent='Ready for a good shift.';
  const message=d.createElement('p');message.dataset.cashierWelcome='';
  const motif=d.createElement('span');motif.className='cashier-season-motif';motif.setAttribute('aria-hidden','true');motif.dataset.cashierMotif='';
  const note=d.createElement('small');note.textContent='Your team. Your orders. One clear workspace.';
  panel.append(brand,title,message,motif,note);login.append(panel);
 }
 for(const node of d.querySelectorAll('[data-cashier-welcome]'))node.textContent=config.message;
 for(const node of d.querySelectorAll('[data-cashier-motif]'))node.textContent=config.decorations?preset.emoji+'  ·  '+preset.emoji:'';
 const top=d.querySelector('.top-bar');if(top&&!d.getElementById('cashierAppearanceBadge')){const badge=d.createElement('span');badge.id='cashierAppearanceBadge';badge.className='cashier-appearance-badge';top.append(badge);}
 const badge=d.getElementById('cashierAppearanceBadge');if(badge){badge.textContent=(config.decorations?preset.emoji+' ':'')+preset.name;badge.hidden=config.theme==='everyday'||config.theme==='custom';}
 const status=d.getElementById('cashierAppearanceStatus');if(status)status.textContent=preset.name+' theme · '+(metadata.checkedAt?'saved on this device':'default appearance');
 w.cashierAppearanceState={theme:config.theme,revision:metadata.revision||0};
 if(config.showRanking&&previousRanking!=='true'&&w.cashierLoginRankingBootChecked)Promise.resolve(w.refreshLoginRankingPreference?.()).catch(()=>{});
}
export function installCashierAppearance(w,d,{getDocFromServer,doc,db,now=Date.now}={}){
 if(w.cashierAppearance)return w.cashierAppearance;
 const reader=createCashierAppearanceReader({storage:w.localStorage,read:()=>getDocFromServer(doc(db,'settings',APPEARANCE_DOCUMENT)),now,apply:(config,meta)=>applyCashierAppearance(w,d,config,meta)});
 let timer,started=false;
 const status=text=>{const node=d.getElementById('cashierAppearanceStatus');if(node)node.textContent=text;};
 const refresh=async()=>{try{const result=await reader.refresh({force:true});status('Appearance refreshed. '+THEMES.find(t=>t.id===reader.paint().theme).name+' is applied.');return result;}catch(error){status(error.message);return {saved:false};}};
 const tick=()=>{reader.paint();clearTimeout(timer);const date=new Date(now()+8*3600000),next=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()+1)-8*3600000;timer=setTimeout(tick,Math.max(1000,next-now()+100));};
 function mountSettings(){
  const host=d.getElementById('view-settings');if(host&&!d.getElementById('cashierAppearanceRefresh')){const section=d.createElement('section');section.className='cashier-panel cashier-appearance-settings';const h=d.createElement('h2');h.textContent='Cashier appearance';const p=d.createElement('p');p.textContent='The Owner chooses the design in POS Config Hub → Cashier appearance.';const info=d.createElement('p');info.id='cashierAppearanceStatus';info.setAttribute('role','status');const button=d.createElement('button');button.type='button';button.id='cashierAppearanceRefresh';button.className='cashier-button';button.textContent='Refresh appearance';button.onclick=async()=>{button.disabled=true;try{await refresh();}finally{button.disabled=false;}};section.append(h,p,info,button);host.append(section);}
 }
 function mount(){if(started)return;started=true;reader.paint();mountSettings();tick();reader.refresh().catch(()=>{});
 }
 w.mountCashierAppearanceSettings=()=>{mountSettings();reader.paint();};
 w.refreshCashierAppearance=refresh;w.cashierAppearance=reader;
 if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
 w.addEventListener('load',()=>{mountSettings();reader.paint();},{once:true});
 d.addEventListener('visibilitychange',()=>{if(!d.hidden){tick();reader.refresh().catch(()=>{});}});
 w.addEventListener('pagehide',()=>clearTimeout(timer));return reader;
}
