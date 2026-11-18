// Only bounded JPEGs produced by the profile photo picker can become an avatar.
export function validProfilePhoto(value){
 if(typeof value!=='string'||value.length>180000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))return false;
 const encoded=value.slice(23),data=Buffer.from(encoded,'base64');
 if(data.toString('base64')!==encoded||data.length<30||data[0]!==255||data[1]!==216||data.at(-2)!==255||data.at(-1)!==217)return false;
 let offset=2,dimensions=false;
 while(offset+4<data.length){
  if(data[offset++]!==255)return false;
  while(data[offset]===255)offset++;
  const marker=data[offset++];
  if(marker===218)return dimensions;
  if(marker===217||marker===0||marker===216)return false;
  const length=data.readUInt16BE(offset);
  if(length<2||offset+length>data.length)return false;
  if([192,193,194].includes(marker)){
   if(length<8)return false;
   const height=data.readUInt16BE(offset+3),width=data.readUInt16BE(offset+5);
   if(!width||!height||width>640||height>640)return false;
   dimensions=true;
  }
  offset+=length;
 }
 return false;
}
