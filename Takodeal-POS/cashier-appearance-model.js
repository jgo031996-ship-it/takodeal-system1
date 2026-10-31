// Presentation only. This model cannot authorize a device or change sale data.
export const APPEARANCE_KEY='takodeal_cashier_appearance_v1';
export const APPEARANCE_DOCUMENT='cashier_appearance';
export const THEMES=Object.freeze([
 {id:'everyday',name:'Everyday',primary:'#164B3F',accent:'#D6AE57',background:'#F5F6F1',emoji:'✦'},
 {id:'halloween',name:'Halloween',primary:'#492E5B',accent:'#E6A04C',background:'#FBF5EE',emoji:'🎃'},
 {id:'christmas',name:'Christmas',primary:'#184D3D',accent:'#D4AE63',background:'#F8F6EF',emoji:'🎄'},
 {id:'new-year',name:'New Year',primary:'#253651',accent:'#D9B965',background:'#F4F6FA',emoji:'✧'},
 {id:'custom',name:'Custom',primary:'#164B3F',accent:'#D6AE57',background:'#F5F6F1',emoji:'✦'}
].map(Object.freeze));
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const fields=['theme','primary','accent','background','message','decorations','density','largeText','showRanking','scheduled','startDate','endDate'];
const rgb=hex=>hex.slice(1).match(/../g).map(x=>parseInt(x,16));
const luminance=hex=>rgb(hex).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
export function appearanceContrast(a,b){const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
const colour=(value,label)=>{if(typeof value!=='string'||!/^#[A-Fa-f0-9]{6}$/.test(value))throw Error('Choose a valid '+label+' colour.');return value.toUpperCase();};
function date(value){if(value==='')return value;const stamp=typeof value==='string'?new Date(value+'T00:00:00Z'):null;if(typeof value!=='string'||!/^20\d\d-\d{2}-\d{2}$/.test(value)||!Number.isFinite(+stamp)||stamp.toISOString().slice(0,10)!==value)throw Error('Choose a valid appearance date.');return value;}
export function appearanceDefaults(theme='everyday'){
 const preset=THEMES.find(row=>row.id===theme);if(!preset)throw Error('Choose a saved Cashier theme.');
 return {theme,primary:preset.primary,accent:preset.accent,background:preset.background,message:'A good day starts with a good team.',decorations:true,density:'comfortable',largeText:false,showRanking:false,scheduled:false,startDate:'',endDate:''};
}
export function validateAppearance(value){
 if(!object(value)||Object.keys(value).length!==fields.length||fields.some(key=>!Object.hasOwn(value,key)))throw Error('Reload the saved Cashier appearance before editing.');
 if(!THEMES.some(row=>row.id===value.theme))throw Error('Choose a saved Cashier theme.');
 const primary=colour(value.primary,'button'),accent=colour(value.accent,'accent'),background=colour(value.background,'background');
 if(appearanceContrast(primary,'#FFFFFF')<4.5)throw Error('Choose a darker button colour so white button labels stay readable.');
 if(appearanceContrast(background,'#24352F')<7)throw Error('Choose a lighter background so text stays readable.');
 if(appearanceContrast(accent,'#24352F')<3)throw Error('Choose a lighter accent colour so its labels stay readable.');
 if(typeof value.message!=='string'||value.message.length>120)throw Error('Use a welcome message of up to 120 characters.');
 for(const field of ['decorations','largeText','showRanking','scheduled'])if(typeof value[field]!=='boolean')throw Error('Choose a valid '+field+' setting.');
 if(!['comfortable','compact'].includes(value.density))throw Error('Choose Comfortable or Compact spacing.');
 const startDate=value.scheduled?date(value.startDate):'',endDate=value.scheduled?date(value.endDate):'';
 if(value.scheduled&&(!startDate||!endDate||endDate<startDate))throw Error('Set the first and last dates for this theme.');
 return {...value,primary,accent,background,message:value.message.trim(),startDate,endDate};
}
export function appearanceDate(now=new Date()){const stamp=now instanceof Date?+now:typeof now==='function'?+new Date(now()):+new Date(now);if(!Number.isFinite(stamp))throw Error('The appearance date could not be read.');return new Date(stamp+8*60*60*1000).toISOString().slice(0,10);}
export function effectiveAppearance(value,{now=new Date()}={}){const saved=validateAppearance(value),today=appearanceDate(now);return saved.scheduled&&(today<saved.startDate||today>saved.endDate)?appearanceDefaults():saved;}
const blend=(a,b,ratio)=>'#'+rgb(a).map((v,i)=>Math.round(v*(1-ratio)+rgb(b)[i]*ratio).toString(16).padStart(2,'0')).join('').toUpperCase();
export function appearanceTokens(value){const c=validateAppearance(value);return {primary:c.primary,accent:c.accent,background:c.background,soft:blend(c.primary,'#FFFFFF',.94),line:blend(c.primary,'#FFFFFF',.84),ink:'#24352F',muted:'#5C6C64',card:'#FFFFFF',sidebar:blend(c.primary,'#FFFFFF',.98),seasonal:c.theme==='christmas'?'#AF3D38':c.primary};}
