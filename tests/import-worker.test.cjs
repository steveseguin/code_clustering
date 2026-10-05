// Run: node --experimental-vm-modules --test tests/import-worker.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL, fileURLToPath } = require('node:url');
const root = path.resolve(__dirname, '..');

async function setup(mode = 'analyzer') {
    const writes = [], workers = [], revoked = [], blobs = new Map();
    const context = vm.createContext({console: {error() {}}, URL: class extends URL {
        static createObjectURL(blob) { const id = `blob:${blobs.size}`; blobs.set(id, blob.code); return id; }
        static revokeObjectURL(url) { revoked.push(url); }
    }, Blob: class {constructor(parts) {this.code = parts.join('');}}, Worker: class {
        constructor(url) {
            if (mode === 'constructor') throw new Error('construction failed');
            this.url = url; this.terminated = 0; workers.push(this);
        }
        terminate() {this.terminated++;}
        postMessage(data) {
            if (mode === 'post') throw new Error('cannot clone');
            queueMicrotask(() => {
                if (mode === 'error') {this.onerror({message: 'load failed'}); return;}
                if (mode === 'messageerror') {this.onmessageerror({}); return;}
                if (mode === 'late-chunk' && workers.length === 2) {this.onerror({message: 'second chunk failed'}); return;}
                if (mode === 'protocol') {
                    for (const p of [1, 2, 3]) this.onmessage({data: {type: 'progress', processedLines: p}});
                    this.onmessage({data: {type: 'complete', units: [42], dependencies: []}});
                    this.onmessage({data: {type: 'progress', processedLines: 99}});
                    return;
                }
                if (mode === 'plain') {this.onmessage({data: {value: 42}}); return;}
                const source = blobs.has(String(this.url)) ? blobs.get(String(this.url)) : fs.readFileSync(fileURLToPath(this.url), 'utf8');
                const workerContext = vm.createContext({self: {postMessage: value => {
                    // Delivery is asynchronous as with browser Worker messages.
                    queueMicrotask(() => {if (!this.terminated) this.onmessage({data: value});});
                }}});
                try {vm.runInContext(source, workerContext); workerContext.self.onmessage({data});}
                catch (error) {this.onerror({error});}
            });
        }
    }});
    const db = new vm.SyntheticModule(['putUnitsChunked'], function () {
        this.setExport('putUnitsChunked', async (units, store) => writes.push({units, store}));
    }, {context});
    const cache = new Map();
    async function moduleFor(filename) {
        if (filename === 'db.js') return db;
        if (cache.has(filename)) return cache.get(filename);
        const identifier = pathToFileURL(path.join(root, filename)).href;
        const m = new vm.SourceTextModule(fs.readFileSync(path.join(root, filename), 'utf8'), {context, identifier,
            initializeImportMeta(meta) {meta.url = identifier;}});
        cache.set(filename, m);
        await m.link(specifier => moduleFor(path.posix.normalize(path.posix.join(path.posix.dirname(filename), specifier))));
        return m;
    }
    const ingester = await moduleFor('codeIngester.js'); await ingester.evaluate();
    const helper = await moduleFor('workerUtil.js'); if (helper.status !== 'evaluated') await helper.evaluate();
    return {ingester: ingester.namespace, helper: helper.namespace, writes, workers, revoked};
}

test('normal import analyzes and stores units without executing supplied code', async () => {
    const s = await setup(); const progress = [];
    const r = await s.ingester.ingestCode('function hello() { throw new Error("must not run"); }', 'hello.js', p => progress.push(p));
    assert.equal(r.success, true); assert.ok(r.unitsCount > 0); assert.equal(s.writes[0].units.length, r.unitsCount);
    assert.ok(s.writes[0].units.every(u => u.originalSource === 'hello.js'));
    assert.equal(progress.length, 1); assert.equal(progress[0].processedLines, 1); assert.equal(s.workers[0].terminated, 1);
});
test('multiple chunks retain results and source offsets', async () => {
    const s = await setup(); const progress = [];
    const code = 'function first() { return 1; }\n' + '\n'.repeat(9999) + 'function second() { return 2; }';
    const r = await s.ingester.ingestCode(code, 'large.js', p => progress.push(p));
    assert.equal(r.success, true); assert.equal(s.workers.length, 2); assert.equal(progress.length, 2);
    assert.equal(progress[1].processedLines, 10001); assert.equal(progress[1].totalChunks, 2);
    assert.ok(s.writes[0].units.some(u => u.startLine === 10000));
});
test('empty analyzer result is a legitimate success', async () => {
    const s = await setup(); const r = await s.ingester.ingestCode('// no functions', 'empty.js');
    assert.equal(r.success, true); assert.equal(r.unitsCount, 0); assert.equal(s.writes.length, 0);
});
test('file worker forwards every progress message but settles on completion', async () => {
    const s = await setup('protocol'); const progress = [];
    const result = await s.helper.createWorkerFromFile('test.js').run({}, p => progress.push(p.processedLines));
    assert.deepEqual(progress, [1,2,3]); assert.equal(result.type, 'complete'); assert.equal(s.workers[0].terminated, 1);
});
test('blob worker forwards progress and revokes its URL after completion', async () => {
    const s = await setup('protocol'); const progress = [];
    const result = await s.helper.runInWorker('', {}, p => progress.push(p.processedLines));
    assert.deepEqual(progress, [1,2,3]); assert.equal(result.units[0], 42); assert.equal(s.revoked.length, 1);
});
test('ordinary single-response worker compatibility', async () => {
    const s = await setup('plain'); assert.equal((await s.helper.runInWorker('', {})).value, 42);
});
for (const mode of ['constructor', 'post', 'error', 'messageerror']) {
    test(`${mode} failure returns failure and never writes import results`, async () => {
        const s = await setup(mode); const r = await s.ingester.ingestCode('function x() {}', 'x.js');
        assert.equal(r.success, false); assert.ok(r.error); assert.equal(s.writes.length, 0);
        if (s.workers.length) assert.equal(s.workers[0].terminated, 1);
        await assert.rejects(s.helper.runInWorker('', {})); assert.equal(s.revoked.length, 1);
    });
}
test('later chunk error cannot produce a partial successful import', async () => {
    const s = await setup('late-chunk');
    const r = await s.ingester.ingestCode('function x() {}\n' + '\n'.repeat(10000), 'large.js');
    assert.equal(r.success, false); assert.match(r.error, /second chunk/); assert.equal(s.writes.length, 0);
});
test('progress callback error rejects and cleans up once', async () => {
    const s = await setup('protocol');
    await assert.rejects(s.helper.runInWorker('', {}, () => {throw new Error('callback failed');}), /callback failed/);
    assert.equal(s.workers[0].terminated, 1); assert.equal(s.revoked.length, 1);
});
