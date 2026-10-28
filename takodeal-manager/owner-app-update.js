// Confirm the complete Owner shell before the caller offers an explicit reload.
// This helper never reloads the page or changes stored device/business data.
export async function waitForAppUpdate(registration,{delay=setTimeout,cancelDelay=clearTimeout,serviceWorker}={}) {
    if(!registration)return;
    return new Promise((resolve,reject)=>{
        const removers=[],watched=new Set(),initialActive=registration.active;
        let timer,finished=false,updated=false,target=null;
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
                if(!updated)return;
                if(!target){
                    if(serviceWorker)throw Error('The active app update could not be confirmed. Keep this page open and try again.');
                    finish();return;
                }
                if(target.state!=='activated')return;
                // Activation and control are separate transitions. A reload
                // before controllerchange can still fetch through the old SW.
                if(serviceWorker&&serviceWorker.controller!==target)return;
                finish();
            }catch(error){finish(error);}
        }
        try{
            listen(registration,'updatefound',inspect);
            if(serviceWorker)listen(serviceWorker,'controllerchange',inspect);
            inspect();
            if(finished)return;
            timer=delay(()=>finish(Error('The app update took too long. Keep this page open, check your connection and try again.')),30000);
            if(finished)return;
            Promise.resolve(registration.update()).then(()=>{if(finished)return;updated=true;inspect();},finish);
        }catch(error){finish(error);}
    });
}
