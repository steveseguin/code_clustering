const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

async function setup(units) {
    const stored = new Map(units.map(unit => [unit.id, structuredClone(unit)]));
    const reads = [];
    const writes = [];
    const context = vm.createContext({ console, performance, setInterval, clearInterval });
    const db = new vm.SyntheticModule(['getUnit', 'putUnitsChunked'], function () {
        this.setExport('getUnit', async id => {
            reads.push(id);
            // IndexedDB reads return independent structured clones.
            return structuredClone(stored.get(id));
        });
        this.setExport('putUnitsChunked', async updated => {
            writes.push(structuredClone(updated));
            for (const unit of updated) stored.set(unit.id, structuredClone(unit));
        });
    }, { context });
    const load = filename => new vm.SourceTextModule(
        fs.readFileSync(path.join(__dirname, '..', filename), 'utf8'),
        { context, identifier: filename }
    );
    const tracer = load('runtimeTracer.js');
    const updater = load('relationshipUpdater.js');
    await tracer.link(() => { throw new Error('Unexpected tracer import'); });
    await updater.link(specifier => {
        if (specifier === './db.js') return db;
        if (specifier === './runtimeTracer.js') return tracer;
        throw new Error(`Unexpected import: ${specifier}`);
    });
    await updater.evaluate();
    function call(sourceId, targets) {
        const callees = targets.map(targetId => tracer.namespace.traceFn(() => {}, targetId, targetId));
        tracer.namespace.traceFn(() => callees.forEach(fn => fn()), sourceId, sourceId)();
    }
    return { stored, reads, writes, call, tracer: tracer.namespace, update: updater.namespace.updateDynamicRelationships };
}

const unit = (id, relationships = []) => ({ id, name: id, dynamicRelationships: relationships });
const frequencies = value => Object.fromEntries(value.dynamicRelationships.map(rel => [rel.targetId, rel.frequency]));

test('keeps every callee when a caller invokes multiple functions in one batch', async () => {
    const app = await setup([unit('caller')]);
    app.call('caller', ['first', 'second', 'first']);
    const result = await app.update();
    assert.deepEqual(frequencies(app.stored.get('caller')), { first: 2, second: 1 });
    assert.equal(result.updated, 1);
    assert.deepEqual(app.reads, ['caller']);
    assert.equal(app.writes[0].length, 1);
    assert.equal(app.tracer.getTraceLog().length, 0);
});

test('increments several existing relationships without overwriting earlier increments', async () => {
    const app = await setup([unit('caller', [
        { targetId: 'first', frequency: 4 },
        { targetId: 'second', frequency: 6 },
        { targetId: 'untouched', frequency: 9 }
    ])]);
    app.call('caller', ['first', 'second', 'first', 'third']);
    await app.update();
    assert.deepEqual(frequencies(app.stored.get('caller')), { first: 6, second: 7, untouched: 9, third: 1 });
});

test('keeps updates for different callers separate', async () => {
    const app = await setup([unit('a'), unit('b')]);
    app.call('a', ['shared', 'aOnly']);
    app.call('b', ['shared', 'bOnly', 'bOnly']);
    const result = await app.update();
    assert.deepEqual(frequencies(app.stored.get('a')), { shared: 1, aOnly: 1 });
    assert.deepEqual(frequencies(app.stored.get('b')), { shared: 1, bOnly: 2 });
    assert.equal(result.updated, 2);
    assert.equal(app.writes[0].length, 2);
});

test('accumulates frequencies across batches without counting cleared calls twice', async () => {
    const app = await setup([unit('caller')]);
    app.call('caller', ['first', 'second']);
    await app.update();
    app.call('caller', ['first', 'second', 'first']);
    await app.update();
    assert.deepEqual(frequencies(app.stored.get('caller')), { first: 3, second: 2 });
    const empty = await app.update();
    assert.equal(empty.updated, 0);
    assert.equal(app.writes.length, 2);
});

test('skips missing callers without discarding another caller’s updates', async () => {
    const app = await setup([unit('present')]);
    app.call('missing', ['child']);
    app.call('present', ['child']);
    const result = await app.update();
    assert.equal(result.updated, 1);
    assert.deepEqual(frequencies(app.stored.get('present')), { child: 1 });
    assert.equal(app.stored.has('missing'), false);
});

test('does not read or write the database for an empty trace', async () => {
    const app = await setup([unit('caller')]);
    assert.equal((await app.update()).updated, 0);
    assert.equal(app.reads.length, 0);
    assert.equal(app.writes.length, 0);
});
