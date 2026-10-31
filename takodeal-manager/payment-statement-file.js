// Statement bytes stay in this browser. Cells are data; formulas are never run.
export const STATEMENT_LIMITS=Object.freeze({fileBytes:5*1024*1024,expandedBytes:24*1024*1024,rows:5000,columns:60,sheets:12});
const DAY=86400000,PH=8*3600000;
const fail=message=>{throw Error(message);};
const heading=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g,'');
const FIELDS={provider:['provider','platform'],merchantAlias:['branch','branchname','storename','merchantbranch'],transactionAt:['transactiondate','transactiondatetime','dateandtime','datetime','paidat','paymentdate','orderdate','orderdatetime','transactiontime'],status:['transactionstatus','status','orderstatus','paymentstatus'],kind:['ordertype','transactiontype','type'],grossAmount:['grossamount','gross','amountpaid','paymentamount','ordervalue','ordertotal','totalorderamount','customerpaidamount'],reference:['uniquereferenceno','uniquereferencenumber','referencenumber','referenceno','transactionreference','transno','transactionno','transactionid'],orderId:['ordernumber','orderid','bookingid','bookingcode'],feeAmount:['fee','fees','servicefee','commission'],netAmount:['netamount','net','netpayout'],sourceProduct:['productname','product']};
export function sniffStatementMapping(headers){const out={},normalized=headers.map(heading);for(const [field,aliases]of Object.entries(FIELDS)){for(const alias of aliases){const found=normalized.map((h,i)=>h===alias?i:-1).filter(i=>i>=0);if(found.length){if(found.length===1)out[field]=found[0];break;}}}return out;}
export function statementFieldNames(){return Object.keys(FIELDS);}
export function parseStatementDate(value,{date1904=false,dateOrder='DMY'}={}){
 if(typeof value==='number'){
  if(!Number.isFinite(value)||value<1||value>2958465||!date1904&&Math.floor(value)===60)fail('Invalid Excel transaction date.');
  const origin=date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,30),serial=!date1904&&value<60?value+1:value,local=origin+Math.round(serial*DAY),ms=local-PH;
  if(!Number.isFinite(ms))fail('Invalid Excel transaction date.');return new Date(ms).toISOString();
 }
 const text=String(value??'').trim();if(!text)fail('Transaction Date is missing.');
 if(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d\d:\d\d)$/i.test(text)){const iso=text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-](\d{2}):(\d{2}))$/i);if(!iso)fail('Invalid transaction date.');const [,y,m,d,h,n,s='0',,oh='0',om='0']=iso,calendar=new Date(Date.UTC(+y,+m-1,+d));if(calendar.getUTCFullYear()!==+y||calendar.getUTCMonth()!==+m-1||calendar.getUTCDate()!==+d||+h>23||+n>59||+s>59||+oh>14||+om>59||+oh===14&&+om!==0)fail('Invalid transaction date.');const ms=Date.parse(text);if(!Number.isFinite(ms))fail('Invalid transaction date.');return new Date(ms).toISOString();}
 let m=text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[T,\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?\s*(AM|PM)?$/i),year,month,day,hour,minute,second,millis,meridian;
 if(m){[,year,month,day,hour,minute,second='0',millis='0',meridian]=m;}
 else{m=text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?\s*(AM|PM)?$/i);if(!m)fail('Use Transaction Date with a time, such as 31/10/2026, 07:25:00 AM.');[,day,month,year,hour,minute,second='0',millis='0',meridian]=m;if(dateOrder==='MDY')[day,month]=[month,day];}
 [year,month,day,hour,minute,second]=[year,month,day,hour,minute,second].map(Number);millis=Number(String(millis).padEnd(3,'0'));
 if(meridian){if(hour<1||hour>12)fail('Invalid AM/PM transaction time.');hour=hour%12+(meridian.toUpperCase()==='PM'?12:0);}
 if(year<1970||year>9999||month<1||month>12||day<1||day>31||hour>23||minute>59||second>59)fail('Invalid transaction date or time.');
 const wall=Date.UTC(year,month-1,day,hour,minute,second,millis),check=new Date(wall);if(check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==day)fail('Invalid calendar date.');return new Date(wall-PH).toISOString();
}
export function parseStatementCSV(input,{delimiter}={}){
 let text=String(input??'').replace(/^\uFEFF/,'');const sep=text.match(/^sep=([,;\t])\r?\n/i);if(sep){delimiter=sep[1];text=text.slice(sep[0].length);}if(!delimiter){const lines=text.split(/\r?\n/).slice(0,60),first=lines.find(line=>/transaction|order/i.test(line)&&/gross|amount/i.test(line))||lines.sort((a,b)=>b.split(/[,;\t]/).length-a.split(/[,;\t]/).length)[0]||'';delimiter=['\t',',',';'].sort((a,b)=>first.split(b).length-first.split(a).length)[0];}
 if(![',',';','\t'].includes(delimiter))fail('Unsupported statement separator.');
 const rows=[];let row=[],cell='',quoted=false,closed=false;
 const pushCell=()=>{row.push({v:cell,t:'s'});cell='';closed=false;if(row.length>STATEMENT_LIMITS.columns)fail('This statement has too many columns. Export only transaction columns.');};
 const pushRow=()=>{pushCell();rows.push(row);row=[];if(rows.length>STATEMENT_LIMITS.rows+60)fail('Export a smaller statement, up to 5,000 rows.');};
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}if(c==='"'&&!cell&&!closed){quoted=true;continue;}if(c===delimiter){pushCell();continue;}if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;pushRow();continue;}if(closed){if(!/\s/.test(c))fail('The CSV contains an invalid quoted cell.');continue;}cell+=c;}
 if(quoted)fail('The CSV contains an unfinished quoted cell.');if(cell||row.length||closed)pushRow();return rows;
}
export function inspectStatementZip(buffer){
 const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),bad=()=>fail('This workbook ZIP format is invalid or unsupported. Export a standard Excel workbook or CSV.');
 if(bytes.length<22||view.getUint32(0,true)!==0x04034b50)fail('Choose a standard .xlsx workbook or CSV statement.');
 let end=-1;for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(view.getUint32(p,true)===0x06054b50){end=p;break;}if(end<0)bad();
 const count=view.getUint16(end+10,true),offset=view.getUint32(end+16,true),size=view.getUint32(end+12,true);
 if(count<1||count>2048||offset+size!==end||view.getUint16(end+8,true)!==count||end+22+view.getUint16(end+20,true)!==bytes.length||view.getUint16(end+4,true)||view.getUint16(end+6,true))bad();
 const extraSafe=(start,length)=>{const stop=start+length;for(let p=start;p<stop;){if(p+4>stop)bad();const type=view.getUint16(p,true),len=view.getUint16(p+2,true);if(type===1||p+4+len>stop)bad();p+=4+len;}};
 let p=offset,total=0;const spans=[],names=new Set();
 for(let i=0;i<count;i++){
  if(p+46>offset+size||view.getUint32(p,true)!==0x02014b50)bad();
  const flags=view.getUint16(p+8,true),method=view.getUint16(p+10,true),crc=view.getUint32(p+16,true),packed=view.getUint32(p+20,true),unpacked=view.getUint32(p+24,true),name=view.getUint16(p+28,true),extra=view.getUint16(p+30,true),comment=view.getUint16(p+32,true),local=view.getUint32(p+42,true);
  if(flags&0x2041||![0,8].includes(method)||[packed,unpacked,local].includes(0xffffffff)||p+46+name+extra+comment>offset+size||view.getUint16(p+34,true))bad();
  total+=unpacked;if(total>STATEMENT_LIMITS.expandedBytes)fail('The expanded workbook is too large. Export fewer transactions.');
  extraSafe(p+46+name,extra);const nameBytes=bytes.slice(p+46,p+46+name),nameKey=Array.from(nameBytes).join(',');if(names.has(nameKey))bad();names.add(nameKey);
  if(local+30>offset||view.getUint32(local,true)!==0x04034b50||view.getUint16(local+6,true)!==flags||view.getUint16(local+8,true)!==method||view.getUint32(local+14,true)!==crc||view.getUint32(local+18,true)!==packed||view.getUint32(local+22,true)!==unpacked||view.getUint16(local+26,true)!==name)bad();
  const localExtra=view.getUint16(local+28,true),data=local+30+name+localExtra,stop=data+packed;if(stop>offset)bad();
  for(let j=0;j<name;j++)if(bytes[local+30+j]!==nameBytes[j])bad();extraSafe(local+30+name,localExtra);
  if(method===0&&packed!==unpacked)bad();
  // The reader allocates from LOCAL sizes. Never pass an unbounded zero-size
  // inflater or disagreeing central/local declarations to it.
  if(method===8&&unpacked===0&&!(packed===2&&bytes[data]===3&&bytes[data+1]===0))bad();
  let entryEnd=stop;if(flags&8){let d=stop;if(d+4>offset)bad();if(view.getUint32(d,true)===0x08074b50)d+=4;if(d+12>offset||view.getUint32(d,true)!==crc||view.getUint32(d+4,true)!==packed||view.getUint32(d+8,true)!==unpacked)bad();entryEnd=d+12;}
  spans.push([local,entryEnd]);p+=46+name+extra+comment;
 }
 if(p!==offset+size)bad();spans.sort((a,b)=>a[0]-b[0]);for(let i=1;i<spans.length;i++)if(spans[i][0]<spans[i-1][1])bad();return {entries:count,expandedBytes:total};
}

const value=cell=>cell?.v??'';
function identity(cell){if(cell?.f)fail('Formula cells cannot be used as transaction identifiers.');const v=value(cell);if(typeof v==='number'){if(!Number.isSafeInteger(v)||v<0||String(v).length>15)fail('A transaction identifier lost numeric precision. Export identifiers as text.');if(typeof cell.w==='string'&&/^\d+$/.test(cell.w))return cell.w;return String(v);}const text=String(v).trim();if(/^[=+@]/.test(text))fail('Formula-like transaction identifiers need review.');return text;}
const stringValue=cell=>String(value(cell)).trim();
export function statementAmount(value){const text=String(value??'').trim().replace(/^(?:₱|PHP)\s*/i,'');if(!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text))fail('The gross amount must be a currency amount with at most two decimal places.');return text.replaceAll(',','').replace(/^\+/,'');}
export function statementRowsFromCells(grid,{provider='GCash',sheetName='Transactions',sheetIndex=0,date1904=false,dateOrder='DMY',headerRow,columns}={}){
 if(!['GCash','Grab','Foodpanda'].includes(provider))fail('Choose GCash, Grab or Foodpanda.');if(grid.length>STATEMENT_LIMITS.rows+60)fail('Export a smaller statement, up to 5,000 rows.');
 let start=headerRow,mapping;if(start!==undefined&&(!Number.isInteger(start)||start<0||start>=Math.min(grid.length,60)))fail('Choose a header row from the first 60 rows.');
 if(start===undefined){for(let i=0;i<Math.min(grid.length,60);i++){const candidate=sniffStatementMapping(grid[i].map(value));if(candidate.transactionAt!==undefined&&candidate.grossAmount!==undefined&&(candidate.reference!==undefined||candidate.orderId!==undefined)){start=i;mapping=candidate;break;}}}
 const needsMapping=start===undefined;start??=0;const headers=(grid[start]||[]).map(c=>String(value(c))),detected=mapping||sniffStatementMapping(headers);mapping={...detected};
 if(columns){for(const field of Object.keys(FIELDS)){if(columns[field]===-1)delete mapping[field];else if(columns[field]!==undefined){if(!Number.isInteger(columns[field])||columns[field]<0||columns[field]>=headers.length)fail('Invalid statement column mapping.');mapping[field]=columns[field];}}}
 const result={sheetName,sheetIndex,date1904,headerRow:start,headers,mapping,needsMapping:needsMapping&&!columns,previewRows:grid.slice(0,Math.min(grid.length,60)).map(r=>r.map(c=>String(value(c)))),rows:[]};
 if(result.needsMapping)return result;if(mapping.transactionAt===undefined||mapping.grossAmount===undefined||(mapping.reference===undefined&&mapping.orderId===undefined))fail('Map Transaction Date, Gross Amount, and Reference or Order Number.');
 const nonempty=grid.slice(start+1).filter(r=>r.some(c=>String(value(c)).trim()));if(nonempty.length>STATEMENT_LIMITS.rows)fail('Export a smaller statement, up to 5,000 rows.');
 for(let i=start+1;i<grid.length;i++){
  const cells=grid[i];if(!cells.some(c=>String(value(c)).trim()))continue;const get=field=>mapping[field]===undefined?undefined:cells[mapping[field]],row={rowId:String(sheetIndex)+'-'+String(i+1),provider:provider,merchantAlias:stringValue(get('merchantAlias')),transactionAt:'',status:stringValue(get('status')),kind:stringValue(get('kind')),grossAmount:'',reference:'',orderId:'',feeAmount:stringValue(get('feeAmount')),netAmount:stringValue(get('netAmount')),sourceProduct:stringValue(get('sourceProduct')),sourceRow:i+1,sourceSheet:sheetName};
  try{if(get('provider')&&stringValue(get('provider')))row.provider=stringValue(get('provider'));for(const field of ['provider','sourceProduct','transactionAt','grossAmount','status','kind','merchantAlias','feeAmount','netAmount'])if(get(field)?.f)fail('Formula cells cannot be used for payment matching.');row.transactionAt=parseStatementDate(value(get('transactionAt')),{date1904,dateOrder});row.grossAmount=statementAmount(value(get('grossAmount')));row.reference=identity(get('reference'));row.orderId=identity(get('orderId'));if(!row.kind&&/dynamic\s*qr|merchant\s*qr|qr\s*payment/i.test(row.sourceProduct))row.kind='Payment';if(!row.kind&&['Grab','Foodpanda'].includes(provider)&&(row.orderId||row.reference))row.kind='Order';}
  catch(error){row.parseError=error.message;}result.rows.push(row);
 }
 return result;
}
export async function parsePaymentStatement(buffer,{name='',provider='GCash',sheetName,headerRow,columns,dateOrder='DMY',xlsxLoader=()=>import('./vendor/xlsx-0.20.3.mjs')}={}){
 const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);if(!bytes.length||bytes.byteLength>STATEMENT_LIMITS.fileBytes)fail('Choose a nonempty statement smaller than 5 MB.');
 const extension=String(name).split('.').pop().toLowerCase();if(['csv','tsv'].includes(extension)){const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),grid=parseStatementCSV(text,{delimiter:extension==='tsv'?'\t':undefined});return {...statementRowsFromCells(grid,{provider,dateOrder,headerRow,columns}),format:extension,sheetNames:['Transactions']};}
 if(extension!=='xlsx')fail('Choose a .xlsx, .csv or .tsv statement.');inspectStatementZip(bytes);const XLSX=await xlsxLoader(),book=XLSX.read(bytes,{type:'array',cellFormula:true,cellDates:false,cellText:true,cellNF:true,sheetRows:STATEMENT_LIMITS.rows+61,bookVBA:false});
 if(!Array.isArray(book.SheetNames)||book.SheetNames.length<1||book.SheetNames.length>STATEMENT_LIMITS.sheets)fail('This workbook has too many sheets. Export only the transaction sheet.');
 const chosen=sheetName||book.SheetNames[0];if(!book.SheetNames.includes(chosen))fail('Choose a worksheet from this file.');const sheet=book.Sheets[chosen],range=XLSX.utils.decode_range(sheet['!ref']||'A1');if(range.e.c>=STATEMENT_LIMITS.columns||range.e.r>STATEMENT_LIMITS.rows+60)fail('Export a smaller transaction worksheet.');
 const grid=[];for(let r=0;r<=range.e.r;r++){const cells=[];for(let c=0;c<=range.e.c;c++){const cell=sheet[XLSX.utils.encode_cell({r,c})];cells.push(cell?{v:cell.v,w:cell.w,t:cell.t,f:cell.f}:{});}grid.push(cells);}
 const parsed=statementRowsFromCells(grid,{provider,sheetName:chosen,sheetIndex:book.SheetNames.indexOf(chosen),date1904:book.Workbook?.WBProps?.date1904===true||book.Workbook?.WBProps?.date1904==='1',dateOrder,headerRow,columns});
 if(sheet['!fullref']){const full=XLSX.utils.decode_range(sheet['!fullref']);if(full.e.r>range.e.r)fail('This worksheet was truncated. Export fewer than 5,000 transactions.');}
 return {...parsed,format:'xlsx',sheetNames:book.SheetNames};
}
