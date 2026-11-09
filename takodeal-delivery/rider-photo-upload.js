const bucket='takodeal-pos.firebasestorage.app';
// A retry inspects the immutable exact object. Unknown metadata never triggers
// another write or adopts a URL supplied by the caller.
export async function uploadRiderPhoto(api,{path,file,metadata,assertCurrent=()=>{}}){
 if(typeof api.getMetadata!=='function'||typeof api.uploadBytes!=='function'||typeof api.getDownloadURL!=='function')throw Error('The protected photo upload is unavailable. Reopen the Rider app.');
 const registration=/^riders\/(licenses|orcr|selfies)\/[A-Za-z0-9_-]{12,128}\.(jpg|png|webp)$/.test(path),operational=/^(riders\/topups|deliveries\/proofs)\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{16,128}\/[A-Za-z0-9_-]{1,150}\/[A-Za-z0-9_-]{1,150}\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(path),custom=metadata?.customMetadata;
 if((!registration&&!operational)||!file||!['image/jpeg','image/png','image/webp'].includes(metadata?.contentType)||!(file.size>0)||file.size>(registration?8:5)*1024*1024||!custom||!/^[a-f0-9]{64}$/.test(custom.sha256||''))throw Error('Use this account’s exact bounded photo upload.');
 const ref=api.ref(api.storage,path),check=info=>{assertCurrent();if(info?.bucket!==bucket||info.fullPath!==path||info.contentType!==metadata.contentType||Number(info.size)!==file.size||Object.keys(custom).some(key=>info.customMetadata?.[key]!==custom[key]))throw Error('The saved photo does not match this exact account, attempt or file. Ask HQ to review it.');};
 const inspect=async()=>{try{assertCurrent();const info=await api.getMetadata(ref);check(info);return true;}catch(error){assertCurrent();if(error?.code==='storage/object-not-found')return false;throw error;}};
 assertCurrent();if(!await inspect()){
  try{await api.uploadBytes(ref,file,metadata);assertCurrent();}catch(error){assertCurrent();if(!await inspect())throw Error('The upload result is not confirmed. Retry the same photo and saved attempt when connected.');}
  if(!await inspect())throw Error('The uploaded photo is not confirmed. Retry the same saved attempt.');
 }
 assertCurrent();const url=await api.getDownloadURL(ref);assertCurrent();let parsed;try{parsed=new URL(url);}catch{throw Error('The saved photo URL is unavailable.');}
 if(parsed.origin!=='https://firebasestorage.googleapis.com'||parsed.username||parsed.password||parsed.hash||parsed.pathname!=='/v0/b/'+bucket+'/o/'+encodeURIComponent(path)||parsed.searchParams.get('alt')!=='media'||!parsed.searchParams.get('token')||[...parsed.searchParams.keys()].sort().join(',')!=='alt,token')throw Error('The saved photo URL does not match the exact upload.');return url;
}
