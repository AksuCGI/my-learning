const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

const source = readFileSync(`${__dirname}/app.js`, 'utf8');
function journal(saved = null) {
    let stored = saved ? JSON.stringify(saved) : null;
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
        addEventListener(type, handler) { handlers.set(`document:${type}`, handler); },
    };
    const context = vm.createContext({
        document, crypto: { randomUUID }, structuredClone, URL,
        localStorage: { getItem: () => stored, setItem(key, value) { stored = value; } }, location: { hash: '#planner' },
        window: { addEventListener() { } }, requestAnimationFrame() { }, setTimeout() { }, clearTimeout() { },
        FormData: class { constructor(form) { return Object.entries(form.values); } },
    });
    vm.runInContext(source, context);
    return {
        run: (code) => vm.runInContext(code, context),
        dates: (start, end, frequency) => Array.from(vm.runInContext(`repeatDates('${start}', '${end}', '${frequency}')`, context)),
        submit: (values) => handlers.get('#schedule-form:submit')({ preventDefault() { }, target: { values } }),
        inputGoals: (value) => handlers.get('#weekly-goal-form:submit')({ preventDefault() { }, target: { values: { goal: value, week: vm.runInContext('selectedWeek', context) } } }),
        stored: () => JSON.parse(stored),
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
test('a later overlap allows the entire repeat operation', () => {
    const app = journal();
    app.submit(values({ repeat: 'none', date: '2026-11-09' }));
    app.submit(values());
    assert.equal(app.run('state.schedule.length'), 4);
    assert.equal(app.run('state.schedule.filter(block => block.date === "2026-11-09").length'), 2);
    assert.equal(app.run('new Set(state.schedule.map(block => block.id)).size'), 4);
});
test('several blocks of any kind can fully or partially overlap', () => {
    const app = journal();
    app.submit(values({ repeat: 'none', kind: 'task' }));
    app.submit(values({ repeat: 'none', kind: 'learning', topic: '' }));
    app.submit(values({ repeat: 'none', kind: 'meeting', start: '09:30' }));
    assert.equal(app.run('state.schedule.length'), 3);
    assert.equal(app.run('weekBlocks("2026-11-02").length'), 3);
    assert.equal(app.run('parseBackup({ ...state, formatVersion: 1 }).schedule.length'), 3);
    assert.equal(app.run('state.entries.length'), 0);
});
test('moving a block into an occupied time preserves both blocks', () => {
    const app = journal();
    app.submit(values({ repeat: 'none', title: 'Original' }));
    app.submit(values({ repeat: 'none', start: '11:00', title: 'Moving' }));
    const id = app.run('state.schedule[1].id');
    app.submit(values({ id, repeat: 'none', title: 'Moved', start: '09:30' }));
    assert.equal(app.run('state.schedule.length'), 2);
    assert.equal(app.run('state.schedule.find(block => block.title === "Original").start'), '09:00');
    assert.equal(app.run('state.schedule.find(block => block.title === "Moved").start'), '09:30');
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

test('weekly goals save multiple lines from the dialog and survive a reload', () => {
    const app = journal();
    app.run('selectedWeek = "2026-11-02"');
    app.inputGoals('Finish module 2\nPrepare the team demo');
    const reloaded = journal(app.stored());
    assert.equal(reloaded.run('state.weeklyGoals["2026-11-02"]'), 'Finish module 2\nPrepare the team demo');
    assert.equal(reloaded.run('state.entries.length'), 0);
    assert.equal(reloaded.run('state.schedule.length'), 0);
});
test('weekly goals stay separate when navigating and clearing a week', () => {
    const app = journal();
    app.run('selectedWeek = "2026-11-02"');
    app.inputGoals('First week');
    app.run('selectedWeek = "2026-11-09"');
    assert.doesNotMatch(app.run('weeklyGoalsMarkup()'), /First week/);
    app.inputGoals('Second week');
    app.run('selectedWeek = "2026-11-02"');
    assert.match(app.run('weeklyGoalsMarkup()'), /First week/);
    app.run('saveWeeklyGoals("")');
    assert.equal(app.run('state.weeklyGoals["2026-11-02"]'), undefined);
    assert.equal(app.stored().weeklyGoals['2026-11-09'], 'Second week');
});
test('weekly goals are safely escaped in the reminder markup', () => {
    const app = journal();
    app.inputGoals('</textarea><script>alert("test")</script>');
    const markup = app.run('weeklyGoalsMarkup()');
    assert.doesNotMatch(markup, /<script>/);
    assert.match(markup, /&lt;\/textarea&gt;/);
});
test('backup import preserves weekly goals and accepts older backups', () => {
    const app = journal();
    app.run('selectedWeek = "2026-11-02"');
    app.inputGoals('Complete the prototype');
    assert.equal(app.run('parseBackup({ ...state, formatVersion: 1 }).weeklyGoals["2026-11-02"]'), 'Complete the prototype');
    assert.equal(app.run('Object.keys(parseBackup({ ...state, formatVersion: 1, weeklyGoals: undefined }).weeklyGoals).length'), 0);
    assert.throws(() => app.run('parseBackup({ ...state, formatVersion: 1, weeklyGoals: { "2026-11-03": "Not a Monday" } })'));
    assert.equal(app.run('Object.keys(upgradeState({ ...state, weeklyGoals: undefined }).weeklyGoals).length'), 0);
});

test('weekly goals appear above the schedule as reminders with add and edit actions', () => {
    const app = journal();
    let markup = app.run('plannerMarkup()');
    assert.ok(markup.indexOf('class="weekly-notes"') < markup.indexOf('class="week-grid"'));
    assert.match(markup, /data-action="add-weekly-goal"/);
    assert.doesNotMatch(markup, /<textarea/);
    app.inputGoals('Prepare the team demo');
    markup = app.run('plannerMarkup()');
    assert.match(markup, /class="weekly-note-text">Prepare the team demo/);
    assert.match(markup, /data-action="edit-weekly-goal"/);
    assert.match(markup, /data-action="delete-weekly-goal"/);
    assert.doesNotMatch(markup, /<textarea/);
});
test('blank weekly goal submissions do not overwrite the saved reminder', () => {
    const app = journal();
    app.inputGoals('Finish the prototype');
    app.inputGoals('   ');
    assert.equal(app.run('state.weeklyGoals[selectedWeek]'), 'Finish the prototype');
});

test('repeating blocks store and preserve their repeat settings', () => {
    const app = journal();
    app.submit(values({ repeat: 'weekly', repeatEnd: '2026-11-30' }));
    const firstBlock = app.run('state.schedule[0]');
    assert.equal(firstBlock.repeat, 'weekly');
    assert.equal(firstBlock.repeatEnd, '2026-11-30');
    assert.equal(firstBlock.repeatStart, '');
    assert.equal(firstBlock.repeatFrequency, '');
});

test('custom repeat settings are preserved with start and frequency', () => {
    const app = journal();
    app.submit(values({ repeat: 'custom', repeatStart: '2026-11-03', repeatEnd: '2026-11-17', repeatFrequency: 'daily' }));
    const firstBlock = app.run('state.schedule[0]');
    assert.equal(firstBlock.repeat, 'custom');
    assert.equal(firstBlock.repeatStart, '2026-11-03');
    assert.equal(firstBlock.repeatEnd, '2026-11-17');
    assert.equal(firstBlock.repeatFrequency, 'daily');
});

test('non-repeating blocks have repeat set to none', () => {
    const app = journal();
    app.submit(values({ repeat: 'none' }));
    assert.equal(app.run('state.schedule.length'), 1);
    assert.equal(app.run('state.schedule[0].repeat'), 'none');
});

test('only first occurrence in series stores repeat settings', () => {
    const app = journal();
    app.submit(values({ repeat: 'weekly', repeatEnd: '2026-11-23' }));
    const blocks = app.run('state.schedule');
    assert.equal(blocks.length, 4);
    assert.equal(blocks[0].repeat, 'weekly');
    assert.equal(blocks[0].repeatEnd, '2026-11-23');
    assert.equal(blocks[1].repeat, 'none');
    assert.equal(blocks[1].repeatEnd, '');
    assert.equal(blocks[2].repeat, 'none');
    assert.equal(blocks[3].repeat, 'none');
});

test('backup with repeat settings preserves all fields', () => {
    const app = journal();
    app.submit(values({ repeat: 'monthly', repeatEnd: '2027-02-02' }));
    const backup = app.run('parseBackup({ ...state, formatVersion: 1 })');
    const firstBlock = backup.schedule[0];
    assert.equal(firstBlock.repeat, 'monthly');
    assert.equal(firstBlock.repeatEnd, '2027-02-02');
});