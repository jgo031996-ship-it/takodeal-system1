// Wait for the new shell to finish installing before reloading. Never clear device data.
export async function waitForAppUpdate(registration,{delay=setTimeout,cancelDelay=clearTimeout}={}) {
    if(!registration)return;
    let timer,finished=false,removeListener=()=>{};
    const deadline=new Promise((_,reject)=>{timer=delay(()=>reject(Error('The app update took too long. Check your connection and try again.')),30000);});
    async function update() {
        await registration.update();
        if(finished)return;
        const worker=registration.installing || registration.waiting;
        if(!worker || worker.state==='activated')return;
        await new Promise((resolve,reject)=>{
            function changed() {
                if(worker.state==='activated' || worker.state==='redundant') {
                    removeListener();
                    worker.state==='activated'?resolve():reject(Error('The update did not finish. Try again.'));
                }
            }
            let listening=true;
            removeListener=()=>{if(listening){listening=false;worker.removeEventListener('statechange',changed);}};
            worker.addEventListener('statechange',changed);changed();
        });
    }
    try {await Promise.race([update(),deadline]);}finally{finished=true;cancelDelay(timer);removeListener();}
}
