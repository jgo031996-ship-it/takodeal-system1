const MAX_FILE=8*1024*1024,MAX_URL=180000;
const jpeg=value=>typeof value==='string'&&value.length<=MAX_URL&&/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(value);
function bounded(work,ms){let timer;return Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('The photo took too long to prepare. Choose it again.')),ms);})]).finally(()=>clearTimeout(timer));}
export async function prepareEmployeePhoto(file,{document:d=globalThis.document,createImageBitmap:bitmap=globalThis.createImageBitmap,ImageClass=globalThis.Image,URLClass=globalThis.URL,timeoutMs=12000}={}){
 if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||!Number.isFinite(file.size)||file.size<=0||file.size>MAX_FILE)throw Error('Choose one JPEG, PNG or WebP photo up to 8 MB.');
 const head=new Uint8Array(await file.slice(0,16).arrayBuffer());
 const valid=file.type==='image/jpeg'?head[0]===255&&head[1]===216&&head[2]===255:file.type==='image/png'?[137,80,78,71,13,10,26,10].every((v,i)=>head[i]===v):String.fromCharCode(...head.slice(0,4))==='RIFF'&&String.fromCharCode(...head.slice(8,12))==='WEBP';
 if(!valid)throw Error('This file is not a supported photo. Choose a JPEG, PNG or WebP image.');
 let image,url;
 try{
  if(typeof bitmap==='function'){const decoding=Promise.resolve().then(()=>bitmap(file,{imageOrientation:'from-image'}));try{image=await bounded(decoding,timeoutMs);}catch(error){decoding.then(value=>value.close?.()).catch(()=>{});throw error;}}
  else image=await bounded(new Promise((resolve,reject)=>{const value=new ImageClass();url=URLClass.createObjectURL(file);value.onload=()=>resolve(value);value.onerror=()=>reject(Error('The photo could not be opened. Choose another image.'));value.src=url;}),timeoutMs);
  const width=image.width||image.naturalWidth,height=image.height||image.naturalHeight;
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1||width*height>20000000)throw Error('Choose a photo with at most 20 million pixels.');
  const canvas=d.createElement('canvas');
  for(const edge of [640,480,320]){
   const scale=Math.min(1,edge/Math.max(width,height));canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
   const context=canvas.getContext('2d');if(!context)throw Error('Photo preparation is unavailable in this browser.');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
   for(const quality of [.82,.65,.5]){const result=canvas.toDataURL('image/jpeg',quality);if(jpeg(result))return result;}
  }
  throw Error('This photo is too large to keep in the profile. Choose a smaller image.');
 }finally{image?.close?.();if(url)URLClass.revokeObjectURL(url);}
}
