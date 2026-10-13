import {embeddedBrowser, publicOrderingUrl} from './customer-browser-help.js?v=online-orders-20261008-r1';

export function customerInstallContext(w) {
    return {...embeddedBrowser(w.navigator), installed: !!(w.navigator?.standalone ||
        w.matchMedia?.('(display-mode: standalone)').matches || w.matchMedia?.('(display-mode: fullscreen)').matches)};
}

export function installCustomerApp(w=window, d=document) {
    const slot=d.getElementById('customerInstallSlot');
    if (!slot || d.getElementById('customerInstallCard')) return null;
    const context=customerInstallContext(w);
    slot.innerHTML='<button type="button" id="customerInstallOpen" class="customer-install-reopen" hidden>Get the TAKODEÁL app</button><aside id="customerInstallCard" class="customer-install-card" aria-labelledby="customerInstallTitle"><img src="app-icon-192.png" width="56" height="56" alt=""><div class="customer-install-copy"><span class="customer-install-eyebrow">TAKODEÁL ON YOUR HOME SCREEN</span><h2 id="customerInstallTitle">Your next craving, one tap away.</h2><p id="customerInstallDescription">Add our free ordering app to your phone. Browse branches and order for pickup or delivery.</p><div class="customer-install-actions"><button type="button" id="customerInstallAction" class="customer-install-primary">How to install</button><button type="button" id="customerInstallLater" class="customer-install-later">Maybe later</button></div><section id="customerInstallSteps" class="customer-install-steps" aria-label="Installation instructions" hidden><ol id="customerInstallInstructions"></ol><div id="customerInstallLinkHelp" hidden><label for="customerInstallLink">Ordering link</label><input id="customerInstallLink" type="text" readonly><button type="button" id="customerInstallCopy">Copy link</button></div></section><p id="customerInstallStatus" class="customer-install-status" role="status" aria-live="polite"></p></div></aside>';
    const el=id=>d.getElementById(id),card=el('customerInstallCard'),open=el('customerInstallOpen'),button=el('customerInstallAction');
    let deferred=null,busy=false,installed=context.installed;
    const status=message=>{el('customerInstallStatus').textContent=message;};
    const hide=()=>{card.hidden=true;open.hidden=installed;};
    const show=()=>{if(installed)return;card.hidden=false;open.hidden=true;};
    const steps=context.embedded ? [
        'Open the menu (⋯) in Messenger, Facebook or Instagram.',
        context.ios?'Choose Open in Safari or Open in browser.':'Choose Open in browser to continue in Chrome or your usual browser.',
        context.ios?'In Safari, tap Share, then Add to Home Screen and Add. If shown, keep Open as Web App enabled.':'In your browser, tap Install TAKODEÁL here, or use its menu → Install app / Add to Home screen.'
    ] : context.ios ? [
        'Open this ordering link in Safari.',
        'Tap Share, then Add to Home Screen.',
        'If shown, keep Open as Web App enabled, then tap Add.'
    ] : [
        'Open your browser menu (⋮ or ⋯).',
        'Choose Install app or Add to Home screen. On a computer, look for the install icon in the address bar.',
        'Confirm the installation. If no install option is available, you can keep ordering on this website.'
    ];
    for(const text of steps){const item=d.createElement('li');item.textContent=text;el('customerInstallInstructions').append(item);}
    el('customerInstallLink').value=publicOrderingUrl(w.location.href);
    el('customerInstallLinkHelp').hidden=!(context.embedded || context.ios);
    if(context.embedded)el('customerInstallDescription').textContent='Save TAKODEÁL to your home screen. First open this link in your browser, then add the app.';
    button.textContent=context.embedded?'Show install steps':context.ios?'Add to Home Screen':'How to install';
    const instructions=()=>{el('customerInstallSteps').hidden=false;button.setAttribute('aria-expanded','true');};
    button.setAttribute('aria-controls','customerInstallSteps');button.setAttribute('aria-expanded','false');
    open.onclick=show;
    el('customerInstallLater').onclick=()=>{hide();try{w.sessionStorage.setItem('tk_customer_install_later','1');}catch{}};
    el('customerInstallCopy').onclick=async()=>{
        try{await w.navigator.clipboard.writeText(el('customerInstallLink').value);status('Link copied. Paste it into '+(context.ios?'Safari':'your browser')+'.');}
        catch{el('customerInstallLink').focus();el('customerInstallLink').select();status('Copy the selected link and paste it into your browser.');}
    };
    button.onclick=async()=>{
        if(busy || installed)return;
        if(!deferred){instructions();return;}
        // Calling prompt synchronously inside this click keeps the required gesture.
        const prompt=deferred;deferred=null;busy=true;button.disabled=true;
        try{
            await prompt.prompt();
            const choice=await prompt.userChoice;
            if(installed)return;
            status(choice?.outcome==='accepted'?'Finish installing in your browser. Then open TAKODEÁL from your home screen.':'You can keep ordering here and install the app later.');
        }catch{if(!installed){instructions();status('Use the installation steps below, or keep ordering on the website.');}}
        finally{busy=false;button.disabled=false;if(!deferred)button.textContent=context.ios?'Add to Home Screen':'How to install';}
    };
    w.addEventListener('beforeinstallprompt',event=>{
        if(installed || context.embedded || context.ios || typeof event.prompt!=='function')return;
        event.preventDefault();deferred=event;button.textContent='Install TAKODEÁL';
        // Respect Maybe later; the small Get the app control remains available.
    });
    w.addEventListener('appinstalled',()=>{installed=true;deferred=null;hide();});
    const display=w.matchMedia?.('(display-mode: standalone)');
    const changed=event=>{if(event.matches){installed=true;deferred=null;hide();}};
    if(display?.addEventListener)display.addEventListener('change',changed);else display?.addListener?.(changed);
    // Replace the older browser-only help with this combined guide when mounted.
    d.getElementById('customerBrowserHelp')?.remove();
    if(installed)hide();else{try{if(w.sessionStorage.getItem('tk_customer_install_later')==='1')hide();}catch{}}
    return {show};
}

if(typeof window!=='undefined') {
    const start=()=>{
        installCustomerApp();
        // Network-only navigation fallback supports older install checks without
        // caching branch availability, customer sessions, receipts or order data.
        if('serviceWorker' in navigator && window.isSecureContext)
            navigator.serviceWorker.register('./sw.js').catch(()=>{});
    };
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
}
