const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

const source = readFileSync(`${__dirname}/app.js`, 'utf8');
function journal() {
    const handlers = new Map();
    const elements = new Map();
    const document = {
        querySelector(selector) {
            if (!elements.has(selector)) elements.set(selector, {
                classList: { add() { }, remove() { } },
                addEventListener(type, handler) { handlers.set(`${selector}:${type}`, handler); },
                close() { },
            });
            return elements.get(selector);
        },
        querySelectorAll: () => [],
        addEventListener() { },
    };
    const context = vm.createContext({
        document, crypto: { randomUUID }, structuredClone, URL,
        localStorage: { getItem: () => null, setItem() { } }, location: { hash: '#planner' },
        window: { addEventListener() { } }, requestAnimationFrame() { }, setTimeout() { }, clearTimeout() { },
        FormData: class { constructor(form) { return Object.entries(form.values); } },
    });
    vm.runInContext(source, context);
    return {
        run: (code) => vm.runInContext(code, context),
        dates: (start, end, frequency) => Array.from(vm.runInContext(`repeatDates('${start}', '${end}', '${frequency}')`, context)),
        submit: (values) => handlers.get('#schedule-form:submit')({ preventDefault() { }, target: { values } }),
        elements,
    };
}
const values = (extra = {}) => ({ id: '', kind: 'task', title: 'Focus', notes: '', date: '2026-11-02', start: '09:00', duration: '60', repeat: 'weekly', repeatEnd: '2026-11-16', ...extra });

test('daily repeats include weekdays only and both range boundaries', () => {
    assert.deepEqual(journal().dates('2026-11-06', '2026-11-10', 'daily'), ['2026-11-06', '2026-11-09', '2026-11-10']);
});
test('weekly repeats keep the starting weekday', () => {
    assert.deepEqual(journal().dates('2026-11-02', '2026-11-16', 'weekly'), ['2026-11-02', '2026-11-09', '2026-11-16']);
});
test('monthly repeats clamp to month end without drifting', () => {
    assert.deepEqual(journal().dates('2025-01-31', '2025-03-31', 'monthly'), ['2025-01-31', '2025-02-28', '2025-03-31']);
});
test('yearly repeats restore leap day when available', () => {
    assert.deepEqual(journal().dates('2024-02-29', '2028-02-29', 'yearly'), ['2024-02-29', '2025-02-28', '2028-02-29']);
});
test('invalid, reversed, empty and excessive ranges are rejected', () => {
    const app = journal();
    for (const [start, end, frequency] of [['2026-02-30', '2026-03-03', 'daily'], ['2026-11-03', '2026-11-02', 'weekly'], ['2026-11-07', '2026-11-08', 'daily'], ['2026-11-02', '2050-11-02', 'daily'], ['2026-11-02', '2026-11-03', 'invalid']]) {
        assert.throws(() => app.dates(start, end, frequency));
    }
});
test('all block kinds repeat independently without logging learning hours', () => {
    for (const kind of ['task', 'learning', 'meeting']) {
        const app = journal();
        app.submit(values({ kind, topic: '' }));
        assert.equal(app.run('state.schedule.length'), 3);
        assert.equal(app.run('new Set(state.schedule.map(block => block.id)).size'), 3);
        assert.equal(app.run('state.schedule.every(block => block.status === "planned" && !block.entryId)'), true);
        assert.equal(app.run('state.entries.length'), 0);
        assert.equal(app.run('parseBackup({ ...state, formatVersion: 1 }).schedule.length'), 3);
    }
});
test('a later overlap rejects the entire repeat operation', () => {
    const app = journal();
    app.submit(values({ repeat: 'none', date: '2026-11-09' }));
    app.submit(values());
    assert.equal(app.run('state.schedule.length'), 1);
    assert.match(app.elements.get('#toast').textContent, /Overlaps/);
});
test('custom start and end dates control the generated range', () => {
    const app = journal();
    app.submit(values({ repeat: 'custom', repeatStart: '2026-11-03', repeatEnd: '2026-11-05', repeatFrequency: 'daily' }));
    assert.deepEqual(Array.from(app.run('state.schedule.map(block => block.date)')), ['2026-11-03', '2026-11-04', '2026-11-05']);
});
test('editing one occurrence does not change its siblings or duplicate it', () => {
    const app = journal();
    app.submit(values());
    const id = app.run('state.schedule[0].id');
    app.submit(values({ id, repeat: 'none', title: 'Changed' }));
    assert.equal(app.run('state.schedule.length'), 3);
    assert.equal(app.run('state.schedule.filter(block => block.title === "Changed").length'), 1);
});