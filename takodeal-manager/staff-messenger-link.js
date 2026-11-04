const invalid=()=>Error('Use a direct HTTPS Facebook profile or Messenger conversation link for this employee.');
const reserved=new Set(['about','business','dialog','events','friends','gaming','groups','help','home.php','index.php','l.php','login','login.php','logout.php','marketplace','me','messages','notifications','pages','permalink.php','photo','photos','privacy','profile.php','reel','settings','share','share.php','sharer.php','stories','story.php','terms','watch']);
const recipient=value=>/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)&&!['.','..','me'].includes(value.toLowerCase());
export function normalizeStaffMessengerUrl(value){
 if(value==null||typeof value==='string'&&!value.trim())return '';
 if(typeof value!=='string')throw invalid();const raw=value.trim();
 if(raw.length>1000||/[\s\\%#]/.test(raw)||/\/(?:\.|\.\.)(?:\/|$|\?)/.test(raw))throw invalid();let url;
 try{url=new URL(raw);}catch{throw invalid();}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash)throw invalid();
 const hostname=url.hostname.toLowerCase(),host=hostname.replace(/^www\./,'');
 if(!['facebook.com','www.facebook.com','messenger.com','www.messenger.com','m.me'].includes(hostname))throw invalid();
 const pathname=url.pathname.replace(/\/$/,''),parts=pathname.split('/').slice(1);
 if(host==='facebook.com'&&pathname==='/profile.php'){
  const entries=[...url.searchParams];if(entries.length!==1||entries[0][0]!=='id'||!/^\d{1,40}$/.test(entries[0][1]))throw invalid();
  return 'https://facebook.com/profile.php?id='+entries[0][1];
 }
 if(url.search||raw.includes('?'))throw invalid();
 const direct=host==='facebook.com'&&parts.length===3&&parts[0]==='messages'&&parts[1]==='t'&&recipient(parts[2])||
  host==='facebook.com'&&parts.length===4&&parts[0]==='messages'&&parts[1]==='e2ee'&&parts[2]==='t'&&/^\d{1,40}$/.test(parts[3])||
  host==='messenger.com'&&parts.length===2&&parts[0]==='t'&&recipient(parts[1])||
  host==='m.me'&&parts.length===1&&recipient(parts[0])||
  host==='facebook.com'&&parts.length===1&&recipient(parts[0])&&!reserved.has(parts[0].toLowerCase());
 if(!direct)throw invalid();return 'https://'+host+pathname;
}
