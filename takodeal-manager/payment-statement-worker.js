import {parsePaymentStatement} from './payment-statement-file.js';
self.onmessage=async event=>{const {id,buffer,options}=event.data||{};try{const result=await parsePaymentStatement(buffer,options);self.postMessage({id,ok:true,result});}catch(error){self.postMessage({id,ok:false,error:error.message||'The statement could not be read.'});}};
