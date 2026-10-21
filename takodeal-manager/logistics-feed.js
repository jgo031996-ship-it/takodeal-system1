// Keep the pending-order badge live; delivery history belongs to visible Dispatch.
// Every callback is tied to both the unlocked account and its subscription generation.
export function createLogisticsFeed({scope,orders,deliveries,onOrders,onDeliveries,onError=()=>{},isActive=()=>true,onReset=()=>{}}) {
    let key='',generation=0,orderStop=null,deliveryStop=null,deliveryGeneration=0,deliveryRunning=false;
    function stopDeliveries(){
        deliveryGeneration++;deliveryRunning=false;
        const off=deliveryStop;deliveryStop=null;try{off?.();}catch{}
    }
    function stop(){
        generation++;const wasActive=!!key;key='';
        stopDeliveries();const off=orderStop;orderStop=null;try{off?.();}catch{}
        if(wasActive)onReset();
    }
    function accountActive(current,expected){
        if(generation!==current||key!==expected)return false;
        if(scope()!==expected){stop();return false;}return true;
    }
    function syncVisibility(){
        if(!key)return false;
        const expected=key,current=generation;
        if(!accountActive(current,expected))return false;
        if(!isActive()){stopDeliveries();return true;}
        if(deliveryRunning)return true;
        const version=++deliveryGeneration;deliveryRunning=true;
        const active=()=>{
            if(!accountActive(current,expected)||version!==deliveryGeneration||!deliveryRunning)return false;
            if(!isActive()){stopDeliveries();return false;}return true;
        };
        const fail=error=>{if(!active())return;stop();onError(error);};
        try{
            const off=deliveries(snapshot=>{if(active())onDeliveries(snapshot);},fail);
            // Subscribe may call back (or fail) synchronously, before returning its stop.
            if(!active()){off?.();return false;}deliveryStop=off;return true;
        }catch(error){if(active()){stop();onError(error);}return false;}
    }
    function start(){
        const next=scope();if(!next){stop();return false;}
        if(key===next)return syncVisibility();
        stop();key=next;const current=generation;
        const active=()=>accountActive(current,next),fail=error=>{if(!active())return;stop();onError(error);};let initial=true;
        try{
            const off=orders(snapshot=>{if(!active())return;onOrders(snapshot,initial);initial=false;},fail);
            if(!active()){off?.();return false;}orderStop=off;
            return syncVisibility();
        }catch(error){if(active()){stop();onError(error);}return false;}
    }
    return {start,stop,syncVisibility};
}
