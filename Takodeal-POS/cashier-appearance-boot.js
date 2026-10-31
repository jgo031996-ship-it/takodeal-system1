// Synchronous, local presentation bootstrap. No Firebase, PINs or device access.
(() => {
 'use strict';
 const defaults={theme:'everyday',primary:'#164B3F',accent:'#D6AE57',background:'#F5F6F1',message:'A good day starts with a good team.',decorations:true,density:'comfortable',largeText:false,showRanking:false};
 const root=document.documentElement,hex=v=>typeof v==='string'&&/^#[a-f0-9]{6}$/i.test(v),rgb=h=>h.slice(1).match(/../g).map(x=>parseInt(x,16));
 const lum=h=>rgb(h).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
 const contrast=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
 const validDate=value=>{if(typeof value!=='string'||!/^20\d\d-\d\d-\d\d$/.test(value))return false;const date=new Date(value+'T00:00:00Z');return Number.isFinite(+date)&&date.toISOString().slice(0,10)===value;};
 const mix=(h,r)=>'#'+rgb(h).map(v=>Math.round(v*(1-r)+255*r).toString(16).padStart(2,'0')).join('');
 let config=defaults;
 try{const raw=localStorage.getItem('takodeal_cashier_appearance_v1');if(raw&&raw.length<=12000){const saved=JSON.parse(raw),c=saved.appearance,today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  const valid=saved.schemaVersion===1&&Number.isSafeInteger(saved.revision)&&saved.revision>=0&&Number.isFinite(saved.checkedAt)&&saved.checkedAt<=Date.now()+60000&&c&&['everyday','halloween','christmas','new-year','custom'].includes(c.theme)&&['primary','accent','background'].every(k=>hex(c[k]))&&contrast(c.primary,'#FFFFFF')>=4.5&&contrast(c.background,'#24352F')>=7&&contrast(c.accent,'#24352F')>=3&&['decorations','largeText','showRanking','scheduled'].every(k=>typeof c[k]==='boolean')&&['comfortable','compact'].includes(c.density);
  const fields=['theme','primary','accent','background','message','decorations','density','largeText','showRanking','scheduled','startDate','endDate'];
  const shape=valid&&Object.keys(c).length===fields.length&&fields.every(key=>Object.hasOwn(c,key))&&typeof c.message==='string'&&c.message.length<=120;
  if(shape&&(c.scheduled?validDate(c.startDate)&&validDate(c.endDate)&&c.startDate<=c.endDate&&today>=c.startDate&&today<=c.endDate:c.startDate===''&&c.endDate===''))config=c;
 }}catch{}
 const values={primary:config.primary,accent:config.accent,background:config.background,bg:config.background,soft:mix(config.primary,.94),line:mix(config.primary,.84),border:mix(config.primary,.84),ink:'#24352F',text:'#24352F',muted:'#5C6C64',card:'#FFFFFF',sidebar:mix(config.primary,.98),seasonal:config.theme==='christmas'?'#AF3D38':config.primary};
 for(const [key,value]of Object.entries(values))root.style.setProperty('--ca-'+key,value);
 root.dataset.cashierTheme=config.theme;root.dataset.cashierDensity=config.density;root.dataset.cashierLargeText=String(config.largeText);root.dataset.cashierDecorations=String(config.decorations);root.dataset.cashierRanking=String(config.showRanking);
 window.paintCashierAppearanceText=()=>{const message=typeof config.message==='string'&&config.message.length<=120?config.message:defaults.message;for(const node of document.querySelectorAll('[data-cashier-welcome]'))node.textContent=message;const motif=({halloween:'🎃',christmas:'🎄','new-year':'✧'})[config.theme]||'✦';for(const node of document.querySelectorAll('[data-cashier-motif]'))node.textContent=config.decorations?motif+' · '+motif:'';};
})();
