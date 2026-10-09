export function embeddedBrowser(navigatorLike={}) {
    const ua=navigatorLike.userAgent||'';
    const embedded=/(FBAN|FBAV|FB_IAB|FBios|Messenger|Instagram)/i.test(ua);
    const ios=/iPhone|iPad|iPod/i.test(ua) || /Macintosh/i.test(ua) && navigatorLike.maxTouchPoints>1;
    return {embedded,ios};
}
export function publicOrderingUrl(href) {
    // Never copy tracking, login, customer or order details into a shared link.
    const url=new URL(href);if(!['https:','http:'].includes(url.protocol))throw Error('Website link unavailable.');
    return url.origin+'/';
}
export function installBrowserHelp(w=window,d=document) {
    const context=embeddedBrowser(w.navigator);if(!context.embedded || d.getElementById('customerBrowserHelp'))return;
    try {if(w.sessionStorage.getItem('tk_browser_help_dismissed')==='1')return;}catch{}
    const box=d.createElement('aside');box.id='customerBrowserHelp';box.className='customer-browser-help';box.setAttribute('aria-label','Open the ordering website in your browser');
    const head=d.createElement('div'),title=d.createElement('strong'),close=d.createElement('button');
    title.textContent=context.ios?'Prefer ordering in Safari?':'Open in your usual browser';close.textContent='×';close.type='button';close.setAttribute('aria-label','Dismiss browser help');head.append(title,close);
    const details=d.createElement('details'),summary=d.createElement('summary'),instructions=d.createElement('p'),copy=d.createElement('button'),link=d.createElement('input'),status=d.createElement('p');
    summary.textContent=context.ios?'How to open in Safari':'How to open in a browser';
    instructions.textContent='Tap the menu (⋯) in Messenger, Facebook or Instagram, then choose Open in browser'+(context.ios?' or Open in Safari. If that option is missing, copy this link and paste it into Safari.':'. If that option is missing, copy this link and paste it into your browser.');
    copy.type='button';copy.textContent='Copy ordering link';link.value=publicOrderingUrl(w.location.href);link.readOnly=true;link.setAttribute('aria-label','TAKODEAL ordering website link');status.setAttribute('role','status');
    copy.onclick=async()=>{try{await w.navigator.clipboard.writeText(link.value);status.textContent='Link copied. Paste it into '+(context.ios?'Safari':'your browser')+'.';}catch{link.focus();link.select();status.textContent='Select and copy the link above, then paste it into your browser.';}};
    close.onclick=()=>{box.remove();try{w.sessionStorage.setItem('tk_browser_help_dismissed','1');}catch{}};
    details.append(summary,instructions,link,copy,status);box.append(head,details);d.body.prepend(box);
}
if(typeof window!=='undefined') {
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>installBrowserHelp(),{once:true});else installBrowserHelp();
}
