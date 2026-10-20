const decode=value=>value.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
export class ReviewElement{
 constructor(tag,document){this.tagName=tag.toUpperCase();this.ownerDocument=document;this.children=[];this.attributes={};this.dataset={};this.listeners={};this.disabled=false;this.hidden=false;this.open=false;this._text='';this._value=undefined;this._html='';}
 append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
 appendChild(node){this.append(node);return node;}
 set textContent(value){this._text=String(value);this.children=[];this._html='';}
 get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
 set value(value){this._value=String(value);}
 get value(){if(this._value!==undefined)return this._value;if(this.tagName==='SELECT'){const option=this.querySelector('option');return option?.attributes.value??option?.textContent??'';}return this.tagName==='TEXTAREA'?this.textContent:'';}
 setAttribute(name,value){this.attributes[name]=String(value);if(name==='id')this.id=String(value);if(name==='value')this.value=value;if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value);}
 addEventListener(type,callback){(this.listeners[type]||=[]).push(callback);}
 emit(type,target=this){const event={target,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};for(const callback of this.listeners[type]||[])callback(event);return event;}
 click(){if(this.disabled)return;this.onclick?.();let parent=this;while(parent){parent.emit('click',this);parent=parent.parentElement;}}
 closest(selector){let node=this;while(node){if(node.matches(selector))return node;node=node.parentElement;}return null;}
 showModal(){this.open=true;}
 close(){if(this.open){this.open=false;this.emit('close');}}
 matches(selector){if(selector[0]==='[')return Object.hasOwn(this.attributes,selector.slice(1,-1));if(selector[0]==='#')return this.id===selector.slice(1);return this.tagName.toLowerCase()===selector;}
 querySelectorAll(selector){const selectors=selector.split(',').map(s=>s.trim()),found=[];const walk=parent=>{for(const node of parent.children){if(selectors.some(s=>node.matches(s)))found.push(node);walk(node);}};walk(this);return found;}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 get innerHTML(){return this._html;}
 set innerHTML(value){const html=String(value);this._html=html;this.children=[];this._text='';const stack=[this];for(const token of html.match(/<[^>]+>|[^<]+/g)||[]){if(token.startsWith('</')){if(stack.length>1)stack.pop();continue;}if(!token.startsWith('<')){stack.at(-1)._text+=decode(token);continue;}const tag=/^<([\w-]+)/.exec(token)?.[1];if(!tag)continue;const node=new ReviewElement(tag,this.ownerDocument);for(const match of token.slice(tag.length+1,-1).matchAll(/([\w-]+)(?:="([^"]*)")?/g))node.setAttribute(match[1],decode(match[2]??''));stack.at(-1).append(node);if(!['input','br','img','hr','meta','link'].includes(tag))stack.push(node);}}
}
export class ReviewDocument{
 constructor(){this.body=new ReviewElement('body',this);}
 createElement(tag){return new ReviewElement(tag,this);}
 getElementById(id){return this.body.querySelector('#'+id);}
 querySelector(selector){return this.body.querySelector(selector);}
}
export const tick=()=>new Promise(resolve=>setImmediate(resolve));
export const drain=async()=>{for(let i=0;i<8;i++)await tick();};
export const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
