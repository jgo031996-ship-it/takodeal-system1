// Confirm the complete Owner shell before the caller offers an explicit reload.
// This helper never reloads the page or changes stored device/business data.
export async function waitForAppUpdate(registration,{delay=setTimeout,cancelDelay=clearTimeout,serviceWorker,signal,onProgress=()=>{},timeoutMs=30000}={}) {
    if(!registration)return;
    return new Promise((resolve,reject)=>{
        const removers=[],watched=new Set(),initialActive=registration.active;
        let timer,finished=false,updated=false,target=null,phase;
        const messages={checking:'Checking for the latest Owner app files…',downloading:'Downloading the latest app files…',waiting:'App files downloaded. Waiting for activation…',activating:'Activating the downloaded app files…',controller:'Connecting this page to the updated app files…',ready:'App files are ready.'};
        function progress(next) {
            if(finished||phase===next)return;
            phase=next;
            // A display callback cannot change whether a worker is trusted.
            try{onProgress({phase:next,message:messages[next]});}catch{}
        }
        function aborted() {const error=Error('The update check was canceled. Choose Retry update when ready.');error.name='AbortError';finish(error);}
        function finish(error) {
            if(finished)return;
            finished=true;
            try{cancelDelay(timer);}catch{}
            for(const remove of removers.splice(0))try{remove();}catch{}
            error?reject(error):resolve();
        }
        function listen(object,type,handler) {
            if(typeof object?.addEventListener!=='function')return;
            object.addEventListener(type,handler);
            removers.push(()=>object.removeEventListener(type,handler));
        }
        function adopt(worker) {
            if(!worker)return;
            target=worker;
            if(watched.has(worker))return;
            watched.add(worker);listen(worker,'statechange',inspect);
        }
        function inspect() {
            if(finished)return;
            try{
                const pending=registration.installing || registration.waiting,active=registration.active;
                if(pending)adopt(pending);
                // Keep tracking an observed installation even if the browser
                // clears installing/waiting before its final statechange.
                else if(!target || target===initialActive || active&&active!==target&&active!==initialActive)adopt(active);
                if(target?.state==='redundant')throw Error('The update did not finish. Keep this page open and try again.');
                if(target?.state==='installing')progress('downloading');
                else if(target?.state==='installed')progress('waiting');
                else if(target?.state==='activating')progress('activating');
                if(!updated)return;
                if(!target){
                    if(serviceWorker)throw Error('The active app update could not be confirmed. Keep this page open and try again.');
                    progress('ready');finish();return;
                }
                if(target.state!=='activated')return;
                // Activation and control are separate transitions. A reload
                // before controllerchange can still fetch through the old SW.
                if(serviceWorker&&serviceWorker.controller!==target){progress('controller');return;}
                progress('ready');finish();
            }catch(error){finish(error);}
        }
        try{
            if(signal?.aborted){aborted();return;}
            listen(signal,'abort',aborted);
            listen(registration,'updatefound',inspect);
            if(serviceWorker)listen(serviceWorker,'controllerchange',inspect);
            progress('checking');
            inspect();
            if(finished)return;
            timer=delay(()=>finish(Error('The app update took too long. Keep this page open, check your connection and choose Retry update.')),timeoutMs);
            if(finished)return;
            Promise.resolve(registration.update()).then(()=>{if(finished)return;updated=true;inspect();},finish);
        }catch(error){finish(error);}
    });
}
