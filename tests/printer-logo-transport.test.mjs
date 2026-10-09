import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrinterWriter} from '../Takodeal-POS/printer-connection.js';

const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return {promise, resolve, reject};
}
function hardware({ack = true, write, wait, connect} = {}) {
    const chunks = [], events = [], connects = [], invalidations = [], timers = new Map();
    let connected = false, timerId = 0, attempted = 0;
    const accept = async (chunk, method) => {
        chunks.push([...chunk]);
        attempted += chunk.length;
        events.push({kind: 'write', method, offset: attempted});
        if (write) await write(chunk, chunks.length, method);
    };
    const character = {
        properties: {write: ack, writeWithoutResponse: true},
        writeValueWithResponse: chunk => accept(chunk, 'ack'),
        writeValueWithoutResponse: chunk => accept(chunk, 'no-ack')
    };
    const connections = {
        async connect(role) {
            connects.push(role);
            if (connect) await connect(role);
            connected = true;
            return character;
        },
        ready() { return connected ? character : null; },
        invalidate(role, options) { invalidations.push({role, ...options}); connected = false; }
    };
    const writer = createPrinterWriter(connections, {
        async wait(milliseconds) {
            events.push({kind: 'wait', milliseconds, offset: attempted});
            if (wait) await wait(milliseconds, attempted);
        },
        schedule(callback, milliseconds) { const id = ++timerId; timers.set(id, {callback, milliseconds}); return id; },
        cancel(id) { timers.delete(id); }
    });
    return {writer, character, chunks, events, connects, invalidations, timers, disconnect() { connected = false; }};
}

test('text-only jobs preserve the existing 20-byte chunks, endpoint delays and final drain delay', async () => {
    for (const ack of [true, false]) {
        const app = hardware({ack});
        assert.equal(await app.writer.send(new Uint8Array(41)), true);
        assert.deepEqual(app.chunks.map(chunk => chunk.length), [20, 20, 1]);
        assert.deepEqual(app.events.filter(event => event.kind === 'wait').map(event => event.milliseconds), [ack ? 5 : 25, ack ? 5 : 25, ack ? 5 : 25, 120]);
        assert.ok(app.events.filter(event => event.kind === 'write').every(event => event.method === (ack ? 'ack' : 'no-ack')));
        assert.equal(app.timers.size, 0);
    }
});

test('image bands end at the exact declared offsets without changing any payload byte', async () => {
    const app = hardware();
    // Command-looking values inside pixel bytes are deliberately not interpreted.
    const payload = Uint8Array.from({length: 65}, (_, index) => [27, 29, 118, 48, 255, 0][index % 6]);
    await app.writer.send(payload, 'main', {pauseAfterBytes: [17, 44], bandDelay: 120});
    assert.deepEqual(app.chunks.map(chunk => chunk.length), [17, 20, 7, 20, 1]);
    assert.deepEqual(app.chunks.flat(), [...payload]);
    assert.deepEqual(app.events.filter(event => event.kind === 'wait' && event.milliseconds === 120).map(event => event.offset), [17, 44, 65]);
});

test('command-like payload bytes alone never create an extra image pause', async () => {
    const app = hardware();
    await app.writer.send([29, 118, 48, 0, 27, 42, 33, 255]);
    assert.deepEqual(app.events.filter(event => event.kind === 'wait').map(event => event.milliseconds), [5, 120]);
});

test('neither the next chunk nor a band pause begins before the endpoint accepts the preceding write', async () => {
    for (const ack of [true, false]) {
        const gate = deferred(), app = hardware({ack, write: (_chunk, count) => count === 1 ? gate.promise : undefined});
        const job = app.writer.send(new Uint8Array(23), 'main', {pauseAfterBytes: [7]});
        await turn();
        assert.deepEqual(app.chunks.map(chunk => chunk.length), [7]);
        assert.equal(app.events.filter(event => event.kind === 'wait').length, 0);
        gate.resolve();
        await job;
        assert.deepEqual(app.chunks.map(chunk => chunk.length), [7, 16]);
        assert.deepEqual(app.events.filter(event => event.kind === 'wait').map(event => event.milliseconds), [ack ? 5 : 25, 120, ack ? 5 : 25, 120]);
    }
});

test('the printer queue stays owned by the current receipt throughout a logo-band pause', async () => {
    const gate = deferred();
    const app = hardware({wait: (milliseconds, offset) => milliseconds === 120 && offset === 20 ? gate.promise : undefined});
    const first = app.writer.send(new Uint8Array(41).fill(1), 'main', {pauseAfterBytes: [20]});
    const second = app.writer.send([9]);
    await turn();
    assert.deepEqual(app.connects, ['main']);
    assert.deepEqual(app.chunks.map(chunk => chunk.length), [20]);
    gate.resolve();
    await Promise.all([first, second]);
    assert.deepEqual(app.connects, ['main', 'main']);
    assert.deepEqual(app.chunks.map(chunk => chunk.length), [20, 20, 1, 1]);
    assert.deepEqual(app.chunks.at(-1), [9]);
});

test('pending jobs snapshot their encoder offsets instead of following later caller mutations', async () => {
    const gate = deferred(), app = hardware({write: (_chunk, count) => count === 1 ? gate.promise : undefined});
    const first = app.writer.send([1]);
    const boundaries = [7, 21], second = app.writer.send(new Uint8Array(30).fill(2), 'main', {pauseAfterBytes: boundaries});
    boundaries[0] = 3;
    boundaries.push(29);
    await turn();
    gate.resolve();
    await Promise.all([first, second]);
    assert.deepEqual(app.chunks.map(chunk => chunk.length), [1, 7, 14, 9]);
});

test('invalid, ambiguous or unbounded encoder offsets reject before connection or data writes', async () => {
    const cases = [null, {}, '20', [0], [-1], [501], [2, 1], [2, 2], [1.5], [NaN], [Infinity], ['2'], new Array(1), Array.from({length: 257}, (_, index) => index + 1)];
    for (const pauseAfterBytes of cases) {
        const app = hardware();
        await assert.rejects(app.writer.send(new Uint8Array(500), 'main', {pauseAfterBytes}), error => error.code === 'printer-pacing-invalid');
        assert.equal(app.connects.length, 0);
        assert.equal(app.chunks.length, 0);
        assert.equal(app.invalidations.length, 0);
        // Invalid metadata does not poison the queue for a later valid, explicit job.
        await app.writer.send([7]);
        assert.deepEqual(app.chunks, [[7]]);
    }
});

test('band delays are bounded integer milliseconds, and zero adds no extra wait', async () => {
    for (const bandDelay of [-1, 501, 0.5, NaN, Infinity, '120', null]) {
        const app = hardware();
        await assert.rejects(app.writer.send([1, 2], 'main', {pauseAfterBytes: [1], bandDelay}), error => error.code === 'printer-pacing-invalid');
        assert.equal(app.connects.length, 0);
    }
    for (const bandDelay of [0, 500]) {
        const app = hardware();
        await app.writer.send([1, 2], 'main', {pauseAfterBytes: [1], bandDelay});
        assert.deepEqual(app.events.filter(event => event.kind === 'wait').map(event => event.milliseconds), bandDelay === 0 ? [5, 5, 120] : [5, 500, 5, 120]);
    }
});

test('a failed band stops the receipt without reconnecting, replaying or falling back after data starts', async () => {
    const app = hardware({write: (_chunk, count) => { if (count === 2) throw new Error('Printer link dropped'); }});
    await assert.rejects(app.writer.send(new Uint8Array(60), 'kitchen', {pauseAfterBytes: [17, 44]}), error => error.bytesWritten === 17 && error.bytesAttempted === 37);
    assert.deepEqual(app.connects, ['kitchen']);
    assert.deepEqual(app.chunks.map(chunk => chunk.length), [17, 20]);
    assert.deepEqual(app.invalidations, [{role: 'kitchen', disconnect: false}]);
    assert.deepEqual(app.events.filter(event => event.kind === 'wait' && event.milliseconds === 120).map(event => event.offset), [17]);
    await app.writer.send([9]);
    assert.deepEqual(app.chunks.at(-1), [9]);
});

test('a disconnect during a band pause prevents all following image and receipt bytes', async () => {
    let app;
    app = hardware({wait: (milliseconds, offset) => { if (milliseconds === 120 && offset === 17) app.disconnect(); }});
    await assert.rejects(app.writer.send(new Uint8Array(40), 'main', {pauseAfterBytes: [17]}), error => error.bytesWritten === 17 && error.bytesAttempted === 17);
    assert.deepEqual(app.chunks.map(chunk => chunk.length), [17]);
    assert.equal(app.connects.length, 1);
});

test('a timed-out band retains uncertain byte counts and a late acknowledgement cannot resume or replay it', async () => {
    const gate = deferred(), app = hardware({write: (_chunk, count) => count === 1 ? gate.promise : undefined});
    const job = app.writer.send(new Uint8Array(40), 'main', {pauseAfterBytes: [17]});
    await turn();
    const timer = [...app.timers.values()][0];
    assert.equal(timer.milliseconds, 6000);
    const rejected = assert.rejects(job, error => error.code === 'printer-write-timeout' && error.bytesWritten === 0 && error.bytesAttempted === 17);
    timer.callback();
    await rejected;
    assert.deepEqual(app.invalidations, [{role: 'main', disconnect: true}]);
    await app.writer.send([9]);
    gate.resolve();
    await turn();
    assert.deepEqual(app.chunks.map(chunk => chunk.length), [17, 1]);
    assert.deepEqual(app.chunks.at(-1), [9]);
    assert.equal(app.events.some(event => event.kind === 'wait' && event.offset === 17), false);
    assert.equal(app.timers.size, 0);
});

test('fallback is still allowed only before the first write, and retains exact band boundaries', async () => {
    const app = hardware({connect: role => { if (role === 'kitchen') throw new Error('Kitchen printer unavailable'); }});
    await app.writer.send(new Uint8Array(23), 'kitchen', {pauseAfterBytes: [7]});
    assert.deepEqual(app.connects, ['kitchen', 'main']);
    assert.deepEqual(app.chunks.map(chunk => chunk.length), [7, 16]);
    const strict = hardware({connect: () => { throw new Error('Kitchen printer unavailable'); }});
    await assert.rejects(strict.writer.send([1], 'kitchen', {fallback: false, pauseAfterBytes: [1]}), /unavailable/);
    assert.deepEqual(strict.connects, ['kitchen']);
    assert.equal(strict.chunks.length, 0);
});

test('accepted logo bytes preserve the existing channel-only result without inventing paper confirmation', async () => {
    const app = hardware();
    const result = await app.writer.send([1, 2, 3], 'main', {pauseAfterBytes: [3]});
    assert.equal(result, true);
    assert.equal(typeof result, 'boolean');
    assert.equal('paperConfirmed' in app.character, false);
    assert.deepEqual(app.events.filter(event => event.kind === 'wait').map(event => event.milliseconds), [5, 120, 120]);
});
