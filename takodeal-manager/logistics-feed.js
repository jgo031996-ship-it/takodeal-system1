// One logistics feed per unlocked account. Late callbacks cannot update a new session.
export function createLogisticsFeed({ scope, orders, deliveries, onOrders, onDeliveries, onError = () => {} }) {
    let key = '', generation = 0, stops = [];
    function stop() {
        generation++; key = '';
        stops.splice(0).forEach(off => { try { off?.(); } catch {} });
    }
    function start() {
        const next = scope();
        if (!next) { stop(); return false; }
        if (key === next) return true;
        stop(); key = next;
        const current = generation;
        const active = () => {
            if (generation !== current || key !== next) return false;
            if (scope() !== next) { stop(); return false; }
            return true;
        };
        const fail = error => { if (!active()) return; stop(); onError(error); };
        let initial = true;
        try {
            const orderStop = orders(snapshot => {
                if (!active()) return;
                onOrders(snapshot, initial); initial = false;
            }, fail);
            // A synchronous subscription failure must not leave its partner running.
            if (!active()) { orderStop?.(); return false; }
            stops.push(orderStop);
            const deliveryStop = deliveries(snapshot => { if (active()) onDeliveries(snapshot); }, fail);
            if (!active()) { deliveryStop?.(); return false; }
            stops.push(deliveryStop);
            return true;
        } catch (error) { if (active()) { stop(); onError(error); } return false; }
    }
    return { start, stop };
}
