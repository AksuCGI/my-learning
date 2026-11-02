const STORAGE_KEY = 'cgi-learning-journal-v1';
const images = {
    Technology: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=700&q=80',
    Design: 'https://images.unsplash.com/photo-1558655146-9f40138edfeb?auto=format&fit=crop&w=700&q=80',
    'Professional skills': 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=700&q=80',
};
const initialState = {
    topics: [],
    entries: [],
    sampleGoalsRemoved: true,
};
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const safeUrl = (value) => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? escapeHtml(url.href) : ''; } catch { return ''; } };
const dateLabel = (value, options = { day: 'numeric', month: 'short' }) => new Date(`${value}T12:00:00`).toLocaleDateString('en-GB', options);
const durationLabel = (minutes) => `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}h` : ''}${minutes % 60 ? ` ${minutes % 60}m` : ''}`.trim() || '0h';
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
function validState(value) {
    return value && Array.isArray(value.topics) && value.topics.every((topic) => typeof topic.id === 'string' && typeof topic.name === 'string' && typeof topic.goal === 'string' && Object.hasOwn(images, topic.category) && /^\d{4}-\d{2}-\d{2}$/.test(topic.start)) && Array.isArray(value.entries) && value.entries.every((entry) => typeof entry.id === 'string' && (entry.topic === '' || value.topics.some((topic) => topic.id === entry.topic)) && Number.isFinite(entry.duration) && entry.duration > 0 && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && ['studied', 'learned', 'notes', 'questions', 'evidence', 'evidenceUrl', 'next'].every((field) => typeof entry[field] === 'string'));
}
function isIsoDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function parseBackup(value) {
    if (!value || value.formatVersion !== 1 || !Array.isArray(value.topics) || !Array.isArray(value.entries) || !Array.isArray(value.schedule)) throw new Error('This is not a supported learning journal backup.');
    const fiscalYear = value.fiscalYear;
    if (!fiscalYear || !isIsoDate(fiscalYear.start) || !isIsoDate(fiscalYear.end) || fiscalYear.end < fiscalYear.start) throw new Error('The backup has an invalid fiscal year.');
    const topicIds = new Set();
    for (const topic of value.topics) {
        if (!topic || typeof topic.id !== 'string' || !topic.id || topicIds.has(topic.id) || typeof topic.name !== 'string' || !topic.name.trim() || typeof topic.goal !== 'string' || !Object.hasOwn(images, topic.category) || !isIsoDate(topic.start) || !['high', 'medium', 'low'].includes(topic.priority)) throw new Error('The backup has an invalid or duplicate learning goal.');
        topicIds.add(topic.id);
    }
    const entryIds = new Set();
    const entryFields = ['studied', 'learned', 'notes', 'questions', 'evidence', 'evidenceUrl', 'next'];
    for (const entry of value.entries) {
        if (!entry || typeof entry.id !== 'string' || !entry.id || entryIds.has(entry.id) || (entry.topic !== '' && !topicIds.has(entry.topic)) || !Number.isInteger(entry.duration) || entry.duration <= 0 || !isIsoDate(entry.date) || entryFields.some((field) => typeof entry[field] !== 'string') || (entry.scheduleId !== undefined && typeof entry.scheduleId !== 'string')) throw new Error('The backup has an invalid or duplicate learning entry.');
        entryIds.add(entry.id);
    }
    if (!value.schedule.every((block) => validBlock(block, value.topics))) throw new Error('The backup has an invalid weekly schedule.');
    const imported = {
        sampleGoalsRemoved: true,
        fiscalYear: { start: fiscalYear.start, end: fiscalYear.end },
        topics: value.topics.map((topic) => ({ id: topic.id, name: topic.name, category: topic.category, goal: topic.goal, start: topic.start, priority: topic.priority })),
        entries: value.entries.map((entry) => ({ id: entry.id, scheduleId: entry.scheduleId || '', date: entry.date, duration: entry.duration, topic: entry.topic, ...Object.fromEntries(entryFields.map((field) => [field, entry[field]])) })),
        schedule: value.schedule.map((block) => ({ id: block.id, kind: block.kind, topic: block.topic, title: block.title, date: block.date, start: block.start, duration: block.duration, notes: block.notes, status: block.status, entryId: block.entryId || '' })),
    };
    if (!validState(imported)) throw new Error('The backup data is incomplete or inconsistent.');
    return imported;
}
async function importBackup(file) {
    if (!file) return;
    if (file.size > 5_000_000) { notify('Backup file is too large to import.'); return; }
    let imported;
    try { imported = parseBackup(JSON.parse(await file.text())); }
    catch (error) { notify(error instanceof SyntaxError ? 'The selected file is not valid JSON.' : error.message); return; }
    const summary = `${imported.topics.length} goals, ${imported.entries.length} learning entries, and ${imported.schedule.length} scheduled blocks`;
    if (!confirm(`Replace the journal saved in this browser with the backup containing ${summary}? This cannot be undone.`)) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(imported)); }
    catch { notify('Could not save the imported backup in this browser.'); return; }
    state = imported;
    selectedWeek = mondayOf(today());
    render();
    notify(`Imported ${summary}.`);
}
function removeSampleGoals(saved) {
    if (saved.sampleGoalsRemoved) return saved;
    const sampleTopics = new Set(['ai', 'design', 'communication']);
    const sampleEntries = new Set(['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
    return {
        ...saved,
        sampleGoalsRemoved: true,
        topics: saved.topics.filter((topic) => !sampleTopics.has(topic.id)),
        entries: saved.entries.filter((entry) => !sampleEntries.has(entry.id)).map((entry) => sampleTopics.has(entry.topic) ? { ...entry, topic: '' } : entry),
        schedule: (saved.schedule || []).map((block) => ({ ...block, topic: sampleTopics.has(block.topic) ? '' : block.topic, ...(sampleEntries.has(block.entryId) ? { entryId: '', status: 'planned' } : {}) })),
    };
}
function loadState() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (validState(parsed)) {
                const cleaned = upgradeState(removeSampleGoals(parsed));
                if (JSON.stringify(parsed) !== JSON.stringify(cleaned)) {
                    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned)); } catch { }
                }
                return cleaned;
            }
        }
    } catch { }
    return structuredClone(initialState);
}
function defaultFiscalYear() {
    const date = new Date();
    const year = date.getFullYear() - (date.getMonth() < 9 ? 1 : 0);
    return { start: `${year}-10-01`, end: `${year + 1}-09-30` };
}
function upgradeState(saved) {
    const fiscalYear = saved.fiscalYear;
    const validYear = fiscalYear && /^\d{4}-\d{2}-\d{2}$/.test(fiscalYear.start) && /^\d{4}-\d{2}-\d{2}$/.test(fiscalYear.end) && fiscalYear.end >= fiscalYear.start;
    return {
        ...saved,
        fiscalYear: validYear ? fiscalYear : defaultFiscalYear(),
        topics: saved.topics.map((topic) => {
            const goal = { ...topic };
            ['progress', 'targetHours', 'weeklyHours', 'target'].forEach((field) => delete goal[field]);
            goal.priority = ['high', 'medium', 'low'].includes(goal.priority) ? goal.priority : 'medium';
            goal.goal = goal.goal.replace(/\n\nThe planning time budget is not a billable-hours target\./g, '');
            return goal;
        }),
        schedule: Array.isArray(saved.schedule) ? saved.schedule.filter((block) => validBlock(block, saved.topics)) : [],
    };
}
let state = upgradeState(loadState());
let activeView = 'dashboard';
let selectedWeek = mondayOf(today());
let toastTimer;
const main = document.querySelector('#main');
const sortedEntries = () => [...state.entries].sort((first, second) => second.date.localeCompare(first.date) || second.id.localeCompare(first.id));
const topicById = (id) => state.topics.find((topic) => topic.id === id);
const inFiscalYear = (date) => date >= state.fiscalYear.start && date <= state.fiscalYear.end;
const yearTopics = () => state.topics.filter((topic) => topic.start <= state.fiscalYear.end);
const yearEntries = () => sortedEntries().filter((entry) => inFiscalYear(entry.date));
const topicEntries = (id) => sortedEntries().filter((entry) => entry.topic === id);
const topicTime = (id) => topicEntries(id).reduce((sum, entry) => sum + entry.duration, 0);
const fiscalLabel = () => `FY ${state.fiscalYear.start.slice(0, 4)} / ${state.fiscalYear.end.slice(0, 4)}`;
function annualMarkup(readonly = false) {
    const topics = yearTopics();
    const entries = yearEntries();
    const minutes = entries.reduce((sum, entry) => sum + entry.duration, 0);
    return `<section class="annual-overview" aria-label="Fiscal year activity"><div><span class="eyebrow">${fiscalLabel()}</span><h2>${topics.length} learning ${topics.length === 1 ? 'goal' : 'goals'}</h2><p>${dateLabel(state.fiscalYear.start, { day: 'numeric', month: 'short', year: 'numeric' })} – ${dateLabel(state.fiscalYear.end, { day: 'numeric', month: 'short', year: 'numeric' })}</p></div><div class="annual-activity"><span><strong>${durationLabel(minutes)}</strong> recorded this fiscal year</span>${readonly ? '' : '<button class="text-button" data-action="edit-year">Edit fiscal year ↗</button><a class="text-button" href="#planner">Open weekly plan ↗</a>'}</div></section>`;
}
function notify(message) { const toast = document.querySelector('#toast'); toast.textContent = message; toast.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('visible'), 4000); }
function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); document.querySelector('.save-status').innerHTML = '<i></i> Saved on this device'; return true; }
    catch { document.querySelector('.save-status').textContent = 'Not saved · storage unavailable'; notify('Browser storage is unavailable. Export a snapshot to keep your journal.'); return false; }
}
function heading(title, subtitle, shared = false) {
    const primaryAction = state.topics.length ? '<button class="button primary" data-action="add"><span>+</span> Add learning entry</button>' : '<button class="button primary" data-action="add-topic"><span>+</span> Add first goal</button>';
    return `<div class="page-heading"><div><span class="eyebrow">${shared ? 'GROWTH, MADE VISIBLE' : 'A LITTLE PROGRESS, EVERY DAY'}</span><h1>${title}</h1><p class="subtitle">${subtitle}</p></div><div class="heading-actions">${shared ? '<button class="button secondary" data-action="export">↓ Download snapshot</button>' : `<button class="button secondary" data-action="share">↗ Share progress</button>${primaryAction}`}</div></div>`;
}
function focusMarkup(readonly = false) {
    const upcoming = state.schedule.filter((block) => block.kind === 'learning' && block.status === 'planned' && block.date >= today() && inFiscalYear(block.date)).sort((first, second) => `${first.date}${first.start}`.localeCompare(`${second.date}${second.start}`))[0];
    const latest = yearEntries().find((entry) => topicById(entry.topic));
    const topic = (upcoming && topicById(upcoming.topic)) || (latest && topicById(latest.topic)) || yearTopics()[0];
    if (!topic) return '';
    return `<section class="current-focus" aria-label="Current learning goal"><div><div class="focus-kicker">CURRENT FOCUS <span>${upcoming?.topic === topic.id ? 'NEXT SCHEDULED' : latest?.topic === topic.id ? 'LATEST ACTIVITY' : 'LEARNING GOAL'}</span></div><h2>${escapeHtml(topic.name)}</h2><p>${escapeHtml(topic.goal)}</p><div class="focus-dates"><span>Started <strong>${dateLabel(topic.start)}</strong></span><span>${topicEntries(topic.id).length} recorded ${topicEntries(topic.id).length === 1 ? 'session' : 'sessions'}</span></div></div><div class="focus-activity"><div class="focus-time">${durationLabel(topicTime(topic.id))}</div><div class="activity-caption">Total time recorded</div>${readonly ? '' : `<button class="text-button" data-action="log-topic" data-id="${escapeHtml(topic.id)}">+ Record learning</button><button class="text-button" data-action="edit-topic" data-id="${escapeHtml(topic.id)}">Edit learning goal ↗</button>`}</div></section>`;
}
function statsMarkup() {
    const entries = yearEntries();
    const minutes = entries.reduce((sum, entry) => sum + entry.duration, 0);
    const evidence = entries.filter((entry) => entry.evidence.trim()).length;
    const activeGoals = new Set(entries.filter((entry) => topicById(entry.topic)).map((entry) => entry.topic)).size;
    return `<section class="stats" aria-label="Learning at a glance">${[
        ['Time invested', durationLabel(minutes), 'Logged during this fiscal year', '◷'],
        ['Learning sessions', entries.length, 'Small steps. Meaningful progress.', '☷'],
        ['Goals with activity', activeGoals, 'With recorded work this fiscal year', '◇'],
        ['Evidence collected', evidence, 'Turning knowledge into practice', '↗'],
    ].map(([label, value, foot, icon]) => `<div class="stat"><div class="stat-top">${label}<span class="stat-symbol" aria-hidden="true">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></div>`).join('')}</section>`;
}
function categoryClass(category) { return category === 'Design' ? 'design' : category === 'Professional skills' ? 'professional' : ''; }
function entryMarkup(entry, readonly = false, expanded = false) {
    const topic = topicById(entry.topic) || { name: 'Unassigned learning', category: 'Technology' };
    const url = safeUrl(entry.evidenceUrl);
    const detail = [['What I studied', entry.studied], ['What I learned', entry.learned], ['My notes', entry.notes], ['Questions / still unclear', entry.questions], ['Next action', entry.next]].filter(([, value]) => value.trim()).map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(value)}</dd>`).join('');
    return `<article class="entry"><div class="entry-meta"><time class="entry-date" datetime="${escapeHtml(entry.date)}">${dateLabel(entry.date, { day: 'numeric', month: 'short', year: 'numeric' })}</time><span>·</span><span>${durationLabel(entry.duration)}</span><span class="pill ${categoryClass(topic.category)}">${escapeHtml(topic.name)}</span></div><h3>${escapeHtml(entry.studied)}</h3><p class="entry-summary">${escapeHtml(entry.learned)}</p><div class="entry-bottom">${entry.evidence ? (url ? `<a class="evidence-tag" href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(entry.evidence)}</a>` : `<span class="evidence-tag">${escapeHtml(entry.evidence)}</span>`) : '<span></span>'}<button class="entry-expand" data-action="expand" aria-expanded="${expanded}">${expanded ? 'Less' : 'Read entry'} <span>${expanded ? '−' : '↗'}</span></button></div><div class="entry-details" ${expanded ? '' : 'hidden'}><dl>${detail}</dl>${readonly ? '' : `<div class="entry-tools"><button class="text-button" data-action="edit-entry" data-id="${escapeHtml(entry.id)}">Edit entry</button><button class="text-button danger" data-action="delete-entry" data-id="${escapeHtml(entry.id)}">Delete entry</button></div>`}</div></article>`;
}
function activityMarkup() {
    const end = new Date(`${today()}T12:00:00`);
    const days = Array.from({ length: 7 }, (_, index) => { const date = new Date(end); date.setDate(end.getDate() - 6 + index); const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; return { label: date.toLocaleDateString('en-GB', { weekday: 'short' }), minutes: state.entries.filter((entry) => entry.date === iso).reduce((sum, entry) => sum + entry.duration, 0), iso }; });
    const max = Math.max(120, ...days.map((day) => day.minutes));
    const total = days.reduce((sum, day) => sum + day.minutes, 0);
    return `<section class="activity-section"><div class="section-heading"><h2>Learning rhythm</h2><span class="sub">Last 7 days</span></div><div class="activity-chart"><div class="chart-top"><div class="chart-total">${durationLabel(total)}<small>invested</small></div><span class="chart-key">Study time</span></div><div class="chart" role="img" aria-label="Study time over the last seven days: ${days.map((day) => `${day.label} ${durationLabel(day.minutes)}`).join(', ')}">${days.map((day) => `<div class="chart-bar" title="${dateLabel(day.iso)}: ${durationLabel(day.minutes)}"><div style="height:${Math.max(3, day.minutes / max * 100)}%"></div></div>`).join('')}</div><div class="chart-labels">${days.map((day) => `<span>${day.label}</span>`).join('')}</div></div></section>`;
}
function reflectionMarkup() {
    const entry = yearEntries().find((item) => item.notes.trim());
    if (!entry) return '';
    return `<section class="reflection"><div class="section-heading"><h2>A moment of reflection</h2></div><div class="quote-mark">“</div><blockquote>${escapeHtml(entry.notes)}</blockquote><div class="reflection-credit">From my journal · ${dateLabel(entry.date)}</div>${entry.next ? `<div class="next-step"><span class="arrow">↗</span><div><strong>MY NEXT STEP</strong><p>${escapeHtml(entry.next)}</p></div></div>` : ''}</section>`;
}
function topicMarkup(topic, readonly = false) {
    const entries = topicEntries(topic.id);
    const latest = entries[0];
    return `<article class="topic-card"><div class="topic-image"><img src="${images[topic.category]}" alt="${topic.category === 'Technology' ? 'Earth at night connected by networks' : topic.category === 'Design' ? 'Colorful visual design materials' : 'Colleagues collaborating around a table'}" loading="lazy"><span class="topic-category">${escapeHtml(topic.category)}</span></div><div class="topic-content"><div class="topic-title-row"><h3>${escapeHtml(topic.name)}</h3>${readonly ? '' : `<button class="icon-button" data-action="edit-topic" data-id="${escapeHtml(topic.id)}" aria-label="Edit ${escapeHtml(topic.name)}" title="Edit topic">↗</button>`}</div><p>${escapeHtml(topic.goal)}</p><div class="goal-meta"><span class="pill">${escapeHtml(topic.priority)} priority</span><span>Started ${dateLabel(topic.start)}</span></div><div class="goal-recorded-time"><strong>${durationLabel(topicTime(topic.id))}</strong><span>total time recorded</span></div><div class="topic-footer"><span>${entries.length} recorded sessions</span><span>${latest ? `Last entry ${dateLabel(latest.date)}` : 'No entries yet'}</span></div>${readonly ? '' : `<div class="goal-actions"><button class="text-button" data-action="log-topic" data-id="${escapeHtml(topic.id)}">+ Record learning</button><button class="text-button" data-action="plan-topic" data-id="${escapeHtml(topic.id)}">Schedule time ↗</button></div>`}</div></article>`;
}
function dashboardMarkup(readonly = false) {
    return `${readonly ? '<div class="shared-banner"><span>READ-ONLY VIEW</span>A snapshot of my learning, the work behind it, and where I’m heading next.</div>' : ''}${heading(readonly ? 'Learning, in the making.' : 'My learning journey', readonly ? 'An open look at my progress, discoveries, and reflections.' : 'My goals for the year, and the small steps that move them forward.', readonly)}${annualMarkup(readonly)}${focusMarkup(readonly)}${statsMarkup()}<div class="content-grid"><section><div class="section-heading"><h2>Recent learning <span>${yearEntries().length}</span></h2><a class="text-button" href="${readonly ? '#shared-timeline' : '#timeline'}">View timeline <span>↗</span></a></div><div class="timeline-list">${yearEntries().slice(0, 3).map((entry) => entryMarkup(entry, readonly)).join('') || '<div class="empty">Your next learning moment starts here.</div>'}</div></section><div class="side-column">${activityMarkup()}${reflectionMarkup()}</div></div><section class="topics-section"><div class="section-heading"><h2>Yearly goals</h2>${readonly ? '' : '<a class="text-button" href="#topics">All goals <span>↗</span></a>'}</div><div class="topic-grid">${yearTopics().map((topic) => topicMarkup(topic, readonly)).join('') || '<div class="empty">No goals overlap this fiscal year yet.</div>'}</div></section>`;
}
function entrySummaryMarkup(entries) {
    const minutes = entries.reduce((sum, entry) => sum + entry.duration, 0);
    return `<strong>${durationLabel(minutes)} recorded</strong><span>${entries.length} learning ${entries.length === 1 ? 'session' : 'sessions'}</span>`;
}
function timelineMarkup(readonly = false) {
    return `${heading(readonly ? 'Learning, recorded' : 'Learning timeline', 'The ideas, experiments, and work behind each learning goal.', readonly)}<div class="toolbar"><div class="search-wrap"><span aria-hidden="true">⌕</span><input id="search" type="search" placeholder="Search your learning journal" aria-label="Search learning entries"></div><select id="topic-filter" aria-label="Filter by topic"><option value="">All topics</option>${state.topics.map((topic) => `<option value="${escapeHtml(topic.id)}">${escapeHtml(topic.name)}</option>`).join('')}</select><select id="sort-order" aria-label="Sort entries"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></div><div id="timeline-summary" class="journal-summary" aria-live="polite">${entrySummaryMarkup(sortedEntries())}</div><div id="timeline-results" class="timeline-list full-timeline">${sortedEntries().map((entry) => entryMarkup(entry, readonly)).join('') || '<div class="empty">No learning recorded yet.</div>'}</div>`;
}
function isoDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function addDays(value, amount) {
    const date = new Date(`${value}T12:00:00`);
    date.setDate(date.getDate() + amount);
    return isoDate(date);
}
function mondayOf(value) {
    const date = new Date(`${value}T12:00:00`);
    return addDays(value, -((date.getDay() + 6) % 7));
}
function timeMinutes(value) {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
}
function endTime(block) {
    const minutes = timeMinutes(block.start) + block.duration;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
function validBlock(block, topics) {
    return block && typeof block.id === 'string' && ['learning', 'task', 'buffer'].includes(block.kind) && typeof block.title === 'string' && typeof block.notes === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(block.date) && /^([01]\d|2[0-3]):[0-5]\d$/.test(block.start) && Number.isInteger(block.duration) && block.duration > 0 && timeMinutes(block.start) + block.duration <= 1440 && ['planned', 'done'].includes(block.status) && (block.kind !== 'learning' || block.topic === '' || topics.some((topic) => topic.id === block.topic));
}
function weekBlocks(week = selectedWeek) {
    return state.schedule.filter((block) => block.date >= week && block.date <= addDays(week, 4)).sort((first, second) => `${first.date}${first.start}`.localeCompare(`${second.date}${second.start}`));
}
function overlappingBlock(candidate, blocks = state.schedule) {
    return blocks.find((block) => block.id !== candidate.id && block.date === candidate.date && timeMinutes(candidate.start) < timeMinutes(block.start) + block.duration && timeMinutes(block.start) < timeMinutes(candidate.start) + candidate.duration);
}
function blockMarkup(block) {
    const topic = topicById(block.topic) || { name: 'Unassigned learning' };
    const kind = { learning: 'Learning', task: 'Task', buffer: 'Buffer' }[block.kind];
    return `<article class="plan-block ${block.kind} ${block.status === 'done' ? 'is-done' : ''}"><div class="block-top"><span>${escapeHtml(block.start)} – ${endTime(block)}</span><div><button class="icon-button" data-action="edit-block" data-id="${escapeHtml(block.id)}" aria-label="Edit ${escapeHtml(block.title)}" title="Edit or move block">↗</button><button class="icon-button" data-action="delete-block" data-id="${escapeHtml(block.id)}" aria-label="Delete ${escapeHtml(block.title)}" title="Delete time block">×</button></div></div><span class="block-kind">${kind}${block.status === 'done' ? ' · Done' : ''}</span><h3>${escapeHtml(block.title)}</h3>${block.kind === 'learning' ? `<p>${escapeHtml(topic.name)}</p>` : ''}${block.notes ? `<p class="block-notes">${escapeHtml(block.notes)}</p>` : ''}<div class="block-bottom"><span>${durationLabel(block.duration)}</span>${block.kind === 'learning' ? `<button class="text-button" data-action="complete-learning" data-id="${escapeHtml(block.id)}">${block.entryId && state.entries.some((entry) => entry.id === block.entryId) ? 'View entry ↗' : 'Log learning ↗'}</button>` : `<button class="text-button" data-action="toggle-task" data-id="${escapeHtml(block.id)}">${block.status === 'done' ? 'Reopen' : 'Mark done'}</button>`}</div></article>`;
}
function weeklyGoalMarkup() {
    const end = addDays(selectedWeek, 4);
    const topics = state.topics.filter((topic) => topic.start <= end);
    if (!topics.length) return '<div class="empty">No active goals for this week. Add a yearly goal or choose another week.</div>';
    return `<div class="weekly-goals"><div class="weekly-goal-row weekly-goal-header"><span>Learning goal</span><span>Scheduled this week</span><span>Recorded this week</span><span>Total recorded</span><span></span></div>${topics.map((topic) => {
        const scheduled = weekBlocks().filter((block) => block.kind === 'learning' && block.topic === topic.id).reduce((sum, block) => sum + block.duration, 0);
        const logged = state.entries.filter((entry) => entry.topic === topic.id && entry.date >= selectedWeek && entry.date <= end).reduce((sum, entry) => sum + entry.duration, 0);
        return `<div class="weekly-goal-row"><span><strong>${escapeHtml(topic.name)}</strong><small>${escapeHtml(topic.priority)} priority</small></span><span>${durationLabel(scheduled)}</span><span>${durationLabel(logged)}</span><span>${durationLabel(topicTime(topic.id))}</span><button class="text-button" data-action="plan-topic" data-id="${escapeHtml(topic.id)}">+ Plan</button></div>`;
    }).join('')}</div>`;
}
function plannerMarkup() {
    const blocks = weekBlocks();
    const learning = blocks.filter((block) => block.kind === 'learning').reduce((sum, block) => sum + block.duration, 0);
    const tasks = blocks.filter((block) => block.kind === 'task').reduce((sum, block) => sum + block.duration, 0);
    const buffer = blocks.filter((block) => block.kind === 'buffer').reduce((sum, block) => sum + block.duration, 0);
    const logged = state.entries.filter((entry) => entry.date >= selectedWeek && entry.date <= addDays(selectedWeek, 4)).reduce((sum, entry) => sum + entry.duration, 0);
    return `<div class="page-heading"><div><span class="eyebrow">${fiscalLabel()}</span><h1>A week with intention</h1><p class="subtitle">Learning, everyday work, and a little breathing room.</p></div><div class="heading-actions"><button class="button secondary" data-action="copy-week">Copy to next week ↗</button><button class="button primary" data-action="add-block">+ Add time block</button></div></div><div class="week-toolbar"><div class="week-navigation"><button class="icon-button" data-action="previous-week" aria-label="Previous week" title="Previous week">←</button><h2>${dateLabel(selectedWeek)} – ${dateLabel(addDays(selectedWeek, 4), { day: 'numeric', month: 'short', year: 'numeric' })}</h2><button class="icon-button" data-action="next-week" aria-label="Next week" title="Next week">→</button></div><div class="week-picker"><button class="text-button" data-action="this-week">This week</button><label>Week of<input id="week-date" type="date" value="${selectedWeek}" aria-label="Choose week"></label></div></div><section class="plan-totals" aria-label="Week totals"><span><i class="legend-dot learning-dot"></i><strong>${durationLabel(learning)}</strong> learning scheduled</span><span><i class="legend-dot task-dot"></i><strong>${durationLabel(tasks)}</strong> tasks</span><span><i class="legend-dot buffer-dot"></i><strong>${durationLabel(buffer)}</strong> buffer</span><span><strong>${durationLabel(logged)}</strong> learning logged</span></section><section class="week-grid" aria-label="Weekly schedule">${Array.from({ length: 5 }, (_, index) => {
        const date = addDays(selectedWeek, index);
        const dayBlocks = blocks.filter((block) => block.date === date);
        return `<section class="plan-day ${date === today() ? 'is-today' : ''}"><div class="day-heading"><div><span>${dateLabel(date, { weekday: 'short' })}</span><h2>${dateLabel(date)}</h2></div><button class="icon-button" data-action="add-block" data-date="${date}" aria-label="Add block on ${dateLabel(date)}" title="Add time block">+</button></div><div class="day-blocks">${dayBlocks.map(blockMarkup).join('') || '<p class="day-empty">Room to plan</p>'}</div></section>`;
    }).join('')}</section><section class="weekly-targets"><div class="section-heading"><h2>Make room for each goal</h2><a class="text-button" href="#topics">Manage yearly goals ↗</a></div>${weeklyGoalMarkup()}</section>`;
}
function updateScheduleKind() {
    const form = document.querySelector('#schedule-form');
    const learning = form.elements.kind.value === 'learning';
    document.querySelector('#schedule-topic-label').hidden = !learning;
    form.elements.topic.required = learning;
    form.elements.topic.disabled = !learning;
}
function openBlock(id, date, topicId) {
    const form = document.querySelector('#schedule-form');
    const block = state.schedule.find((item) => item.id === id);
    if (!state.topics.length && block?.kind === 'learning') { openTopic(); notify('Add your first goal before editing this learning block.'); return; }
    form.reset();
    form.elements.kind.querySelector('[value="learning"]').disabled = !state.topics.length;
    form.elements.topic.innerHTML = state.topics.map((topic) => `<option value="${escapeHtml(topic.id)}">${escapeHtml(topic.name)}</option>`).join('');
    const blockDate = date || (today() >= selectedWeek && today() <= addDays(selectedWeek, 4) ? today() : selectedWeek);
    const defaults = { id: '', kind: state.topics.length ? 'learning' : 'task', topic: topicId || state.topics[0]?.id || '', title: topicId ? topicById(topicId).name : '', date: blockDate, start: '09:00', duration: 60, notes: '' };
    ['id', 'kind', 'topic', 'title', 'date', 'start', 'duration', 'notes'].forEach((field) => { form.elements[field].value = block?.[field] ?? defaults[field]; });
    document.querySelector('#schedule-title').textContent = block ? 'Edit or move time block' : 'Plan a time block';
    updateScheduleKind();
    document.querySelector('#schedule-dialog').showModal();
}
function copyWeek() {
    const source = weekBlocks().filter((block) => block.kind !== 'task');
    if (!source.length) { notify('Add learning or buffer blocks before copying this week.'); return; }
    const copies = source.map((block) => ({ ...block, id: crypto.randomUUID(), date: addDays(block.date, 7), status: 'planned', entryId: '' }));
    const collision = copies.find((block) => overlappingBlock(block, [...state.schedule, ...copies]));
    if (collision) { notify(`Cannot copy: a block overlaps on ${dateLabel(collision.date)}. Move it first.`); return; }
    if (!confirm(`Copy ${copies.length} learning / buffer blocks to next week? Tasks will not be copied.`)) return;
    state.schedule.push(...copies);
    selectedWeek = addDays(selectedWeek, 7);
    const saved = persist(); render(); if (saved) notify('Week copied. Each time block can be adjusted independently.');
}
function render() {
    const route = location.hash.slice(1) || 'dashboard';
    activeView = ['dashboard', 'planner', 'timeline', 'topics', 'shared', 'shared-timeline'].includes(route) ? route : 'dashboard';
    document.querySelectorAll('[data-nav]').forEach((link) => { const selected = link.dataset.nav === (activeView === 'shared-timeline' ? 'shared' : activeView); link.classList.toggle('active', selected); if (selected) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
    document.querySelector('#breadcrumb').textContent = { dashboard: 'Overview', planner: 'Weekly plan', timeline: 'Learning timeline', topics: 'Yearly goals', shared: 'Shared view', 'shared-timeline': 'Shared timeline' }[activeView];
    main.innerHTML = activeView === 'dashboard' ? dashboardMarkup() : activeView === 'planner' ? plannerMarkup() : activeView === 'shared' ? dashboardMarkup(true) : activeView === 'timeline' || activeView === 'shared-timeline' ? timelineMarkup(activeView === 'shared-timeline') : `${heading('My goals for the year', 'What I want to learn and achieve, with time set aside to get there.')}${annualMarkup()}<div class="section-heading"><h2>Yearly goals <span>${yearTopics().length}</span></h2><button class="text-button" data-action="add-topic">+ Add a yearly goal</button></div><div class="topic-grid topic-page">${yearTopics().map((topic) => topicMarkup(topic)).join('') || '<div class="empty">No goals overlap this fiscal year yet.</div>'}</div>`;
    main.classList.remove('view-enter');
    requestAnimationFrame(() => main.classList.add('view-enter'));
}
function filterTimeline() {
    const search = document.querySelector('#search').value.toLowerCase();
    const topic = document.querySelector('#topic-filter').value;
    let entries = sortedEntries().filter((entry) => (!topic || entry.topic === topic) && [entry.studied, entry.learned, entry.notes, entry.questions, entry.evidence, entry.next, topicById(entry.topic)?.name || 'Unassigned learning'].some((value) => value.toLowerCase().includes(search)));
    if (document.querySelector('#sort-order').value === 'oldest') entries = entries.reverse();
    document.querySelector('#timeline-results').innerHTML = entries.map((entry) => entryMarkup(entry, activeView === 'shared-timeline')).join('') || '<div class="empty">No entries match. Try another topic or search.</div>';
    document.querySelector('#timeline-summary').innerHTML = entrySummaryMarkup(entries);
}
function openEntry(id, scheduleId) {
    if (!state.topics.length) { openTopic(); notify('Add your first learning goal, then record your progress.'); return; }
    const form = document.querySelector('#entry-form');
    form.reset();
    form.elements.topic.innerHTML = state.topics.map((topic) => `<option value="${escapeHtml(topic.id)}">${escapeHtml(topic.name)}</option>`).join('');
    const block = state.schedule.find((item) => item.id === scheduleId);
    const entry = state.entries.find((item) => item.id === (id || block?.entryId));
    form.elements.id.value = entry?.id || '';
    form.elements.scheduleId.value = block?.id || entry?.scheduleId || '';
    document.querySelector('#entry-title').textContent = entry ? 'Edit learning entry' : 'Add learning entry';
    form.elements.date.value = entry?.date || today();
    if (entry) {
        ['topic', 'studied', 'learned', 'notes', 'questions', 'evidence', 'evidenceUrl', 'next'].forEach((field) => { form.elements[field].value = entry[field]; });
        if (!entry.topic) form.elements.topic.selectedIndex = 0;
        form.elements.hours.value = Math.floor(entry.duration / 60);
        form.elements.minutes.value = entry.duration % 60;
    } else if (block) {
        form.elements.date.value = block.date;
        form.elements.topic.value = block.topic;
        form.elements.studied.value = block.title;
        form.elements.notes.value = block.notes;
        form.elements.hours.value = Math.floor(block.duration / 60);
        form.elements.minutes.value = block.duration % 60;
    }
    form.elements.minutes.setCustomValidity('');
    document.querySelector('#entry-dialog').showModal();
}
function openTopic(id) {
    const form = document.querySelector('#topic-form');
    const topic = topicById(id);
    form.reset();
    form.elements.id.value = topic?.id || '';
    document.querySelector('#topic-title').textContent = topic ? 'Edit learning topic' : 'Add a learning topic';
    ['name', 'goal', 'category', 'start', 'priority'].forEach((field) => { form.elements[field].value = topic?.[field] ?? ({ start: state.fiscalYear.start, category: 'Technology', priority: 'medium' }[field] ?? ''); });
    document.querySelector('#topic-dialog').showModal();
}
function exportSnapshot() {
    const css = 'body{font:14px/1.7 sans-serif;color:#252333;background:#f7f8fa;margin:0}*{box-sizing:border-box}main{max-width:1100px;margin:auto;padding:35px}h1,h2,h3,p{margin:0}h1{font-size:30px;margin:8px 0}h2{font-size:21px}h3{font-size:16px}.brand{color:#e11937;font:bold 48px Arial}.brand span{display:block;font:12px sans-serif;color:#777}.eyebrow,.focus-kicker{font-size:11px;color:#5236ab;font-weight:bold}.subtitle,.entry-summary{color:#716778}.current-focus{background:#eee9f7;padding:25px;margin:25px 0;border-radius:6px}.focus-dates{display:flex;gap:20px;flex-wrap:wrap;font-size:12px;margin:15px 0}.focus-progress{max-width:240px;margin-top:20px}.progress-number{font-size:28px;font-weight:bold;color:#5236ab}.progress-track{height:5px;background:#dfd7eb;margin-top:8px;border-radius:3px;overflow:hidden}.progress-fill{background:#5236ab;height:100%}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:15px;margin:25px 0}.stat,.topic-card{background:white;border:1px solid #e6e1eb;border-radius:6px;overflow:hidden}.stat{padding:18px}.stat-top,.stat-foot,.topic-footer,.reflection-credit,.entry-meta{font-size:11px;color:#82748f}.stat-value{font-size:28px;font-weight:bold}.stat-value small{font-size:14px}.stat-symbol{display:none}.entry{padding:22px 0;border-bottom:1px solid #e1dbe8;break-inside:avoid}.entry-meta{display:flex;gap:12px;flex-wrap:wrap}.entry h3{margin:8px 0}.entry-details{padding:15px 20px;background:#fff;margin-top:15px;border-left:2px solid #c5b4df}.entry-details dt{font-weight:bold;font-size:12px;color:#5236ab;margin-top:12px}.entry-details dd{margin:4px 0;white-space:pre-wrap;overflow-wrap:anywhere}.evidence-tag{font-size:12px;color:#5236ab}.section-heading{margin:25px 0 12px}.topic-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:15px}.topic-image{height:100px;position:relative;overflow:hidden}.topic-image img{width:100%;height:100%;object-fit:cover}.topic-category{position:absolute;bottom:8px;left:10px;font-size:10px;background:white;padding:2px 6px}.topic-content{padding:16px}.topic-content p{font-size:12px;color:#82748f;margin:8px 0}.topic-progress-label,.topic-footer{display:flex;justify-content:space-between;font-size:11px;gap:12px}.topic-footer{margin-top:15px}.topics-section,.reflection{margin-top:35px}.reflection blockquote{margin:10px 0;font-size:17px;color:#685178}.quote-mark{display:none}.next-step{margin-top:15px}.shared-banner{font-size:12px;color:#82748f;margin-bottom:20px}.shared-banner span{font-weight:bold;color:#5236ab;margin-right:10px}.heading-actions,.text-button,.entry-expand,.activity-section{display:none!important}.entry-details[hidden]{display:block!important}@media(max-width:650px){main{padding:22px}.stats{grid-template-columns:repeat(2,1fr)}.topic-grid{grid-template-columns:1fr}h1{font-size:25px}}@media print{body{background:white}main{padding:0}.stats,.topic-card{break-inside:avoid}}';
    const goalStyles = '.annual-overview{padding:20px 0;border-bottom:1px solid #e1dbe8}.annual-activity{display:flex;flex-wrap:wrap;gap:25px;margin-top:15px}.annual-activity strong{color:#5236ab;margin-right:5px}.goal-meta{display:flex;flex-wrap:wrap;gap:12px;font-size:11px;color:#82748f;margin:12px 0}.goal-actions{display:none}.topic-content p{overflow-wrap:anywhere}.goal-recorded-time{display:flex;align-items:baseline;gap:10px;margin:15px 0}.goal-recorded-time strong,.focus-time{font-size:26px;font-weight:bold;color:#5236ab}.goal-recorded-time span,.activity-caption{font-size:11px;color:#82748f}.focus-activity{margin-top:20px}.journal-summary{display:flex;flex-wrap:wrap;gap:20px;font-size:12px;margin:15px 0}.journal-summary strong{color:#5236ab}';
    const content = `${dashboardMarkup(true)}<section class="topics-section"><h2>Full learning journal</h2><div class="journal-summary">${entrySummaryMarkup(sortedEntries())}</div>${sortedEntries().map((entry) => entryMarkup(entry, true, true)).join('')}</section>`;
    const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>My learning journey · Shared snapshot</title><style>${css}${goalStyles}</style></head><body><main><div class="brand" style="margin-bottom:35px">cgi<span>Learning journal · Snapshot ${dateLabel(today(), { day: 'numeric', month: 'long', year: 'numeric' })}</span></div>${content}</main></body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `learning-journal-${today()}.html`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Read-only snapshot downloaded. Share the HTML file with your reviewer.');
}
document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (event.target.closest('.close-dialog')) event.target.closest('dialog').close();
    if (!button) return;
    const { action, id } = button.dataset;
    const readonly = activeView.startsWith('shared');
    if (action === 'import') { document.querySelector('#backup-file').click(); return; }
    if (readonly && !['share', 'export', 'expand'].includes(action)) return;
    if (action === 'add' || action === 'edit-entry') openEntry(id);
    if (action === 'edit-topic' || action === 'add-topic') openTopic(id);
    if (action === 'log-topic') { openEntry(); document.querySelector('#entry-form').elements.topic.value = id; }
    if (action === 'plan-topic') openBlock(undefined, undefined, id);
    if (action === 'add-block' || action === 'edit-block') openBlock(id, button.dataset.date);
    if (action === 'previous-week' || action === 'next-week') { selectedWeek = addDays(selectedWeek, action === 'previous-week' ? -7 : 7); render(); }
    if (action === 'this-week') { selectedWeek = mondayOf(today()); render(); }
    if (action === 'copy-week') copyWeek();
    if (action === 'complete-learning') openEntry(undefined, id);
    if (action === 'toggle-task') { const block = state.schedule.find((item) => item.id === id); if (block && block.kind !== 'learning') { block.status = block.status === 'done' ? 'planned' : 'done'; const saved = persist(); render(); if (saved) notify(block.status === 'done' ? 'Task completed.' : 'Task reopened.'); } }
    if (action === 'delete-block' && confirm('Remove this time block? Any logged learning entry will be kept.')) { state.schedule = state.schedule.filter((block) => block.id !== id); state.entries.forEach((entry) => { if (entry.scheduleId === id) delete entry.scheduleId; }); const saved = persist(); render(); if (saved) notify('Time block removed. Logged learning is unchanged.'); }
    if (action === 'edit-year') { const form = document.querySelector('#year-form'); form.elements.start.value = state.fiscalYear.start; form.elements.end.value = state.fiscalYear.end; form.elements.end.setCustomValidity(''); document.querySelector('#year-dialog').showModal(); }
    if (action === 'share') location.hash = 'shared';
    if (action === 'export') exportSnapshot();
    if (action === 'expand') { const details = button.closest('.entry').querySelector('.entry-details'); details.hidden = !details.hidden; button.setAttribute('aria-expanded', String(!details.hidden)); button.innerHTML = details.hidden ? 'Read entry <span>↗</span>' : 'Less <span>−</span>'; }
    if (action === 'delete-entry' && confirm('Delete this learning entry? This cannot be undone.')) { state.entries = state.entries.filter((entry) => entry.id !== id); state.schedule.forEach((block) => { if (block.entryId === id) { block.entryId = ''; block.status = 'planned'; } }); const saved = persist(); render(); if (saved) notify('Learning entry deleted. Its time block is planned again.'); }
});
document.querySelector('#backup-file').addEventListener('change', async (event) => {
    const input = event.currentTarget;
    const [file] = input.files;
    await importBackup(file);
    input.value = '';
});
document.addEventListener('input', (event) => { if (event.target.id === 'search') filterTimeline(); if (['hours', 'minutes'].includes(event.target.name)) document.querySelector('#entry-form').elements.minutes.setCustomValidity(''); });
document.addEventListener('change', (event) => {
    if (['topic-filter', 'sort-order'].includes(event.target.id)) filterTimeline();
    if (event.target.id === 'week-date' && event.target.value) { selectedWeek = mondayOf(event.target.value); render(); }
    if (event.target.matches('#schedule-form [name="kind"]')) updateScheduleKind();
});
document.querySelector('#entry-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.target;
    const values = Object.fromEntries(new FormData(form));
    const duration = Number(values.hours) * 60 + Number(values.minutes);
    if (duration <= 0) { form.elements.minutes.setCustomValidity('Enter a duration greater than zero.'); form.elements.minutes.reportValidity(); return; }
    const linkedBlock = state.schedule.find((block) => block.id === values.scheduleId && block.kind === 'learning');
    if (linkedBlock?.topic && linkedBlock.topic !== values.topic) { notify('Keep the scheduled goal selected, or log a separate learning entry.'); return; }
    const entry = { id: values.id || crypto.randomUUID(), scheduleId: linkedBlock?.id || '', date: values.date, duration, topic: values.topic, ...Object.fromEntries(['studied', 'learned', 'notes', 'questions', 'evidence', 'evidenceUrl', 'next'].map((field) => [field, values[field].trim()])) };
    if (!entry.studied || !entry.learned || !entry.next) { notify('Please add what you studied, learned, and your next action.'); return; }
    if (values.id) state.entries = state.entries.map((item) => item.id === values.id ? entry : item); else state.entries.push(entry);
    if (linkedBlock) { linkedBlock.topic = entry.topic; linkedBlock.status = 'done'; linkedBlock.entryId = entry.id; }
    const saved = persist(); document.querySelector('#entry-dialog').close(); render(); if (saved) notify(values.id ? 'Learning entry updated.' : 'A little more learned. Entry saved.');
});
document.querySelector('#topic-form').addEventListener('submit', (event) => {
    event.preventDefault(); const form = event.target; const values = Object.fromEntries(new FormData(form));
    if (!values.name.trim() || !values.goal.trim()) { notify('Please add a topic name and learning goal.'); return; }
    const topic = { ...values, name: values.name.trim(), goal: values.goal.trim(), id: values.id || crypto.randomUUID() };
    if (values.id) state.topics = state.topics.map((item) => item.id === values.id ? topic : item); else state.topics.push(topic);
    const saved = persist(); document.querySelector('#topic-dialog').close(); render(); if (saved) notify('Learning topic saved.');
});
document.querySelector('#year-form').addEventListener('input', (event) => event.currentTarget.elements.end.setCustomValidity(''));
document.querySelector('#schedule-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    const previous = state.schedule.find((block) => block.id === values.id);
    const block = { ...values, id: values.id || crypto.randomUUID(), topic: values.kind === 'learning' ? values.topic : '', title: values.title.trim(), notes: values.notes.trim(), duration: Number(values.duration), status: previous?.status || 'planned', entryId: previous?.entryId || '' };
    if (!block.title) { notify('Give this time block an activity.'); return; }
    if ([0, 6].includes(new Date(`${block.date}T12:00:00`).getDay())) { notify('Choose a weekday, Monday to Friday.'); return; }
    if (!validBlock(block, state.topics)) { notify('Choose a valid date, goal, and duration. Time blocks must end by midnight.'); return; }
    if (previous?.entryId && (previous.kind !== block.kind || previous.topic !== block.topic)) { notify('A logged block must keep its original learning goal. Add a separate block instead.'); return; }
    const overlap = overlappingBlock(block);
    if (overlap) { notify(`Overlaps with “${overlap.title}” (${overlap.start}–${endTime(overlap)}). Move or shorten a block first.`); return; }
    if (previous) state.schedule = state.schedule.map((item) => item.id === block.id ? block : item); else state.schedule.push(block);
    selectedWeek = mondayOf(block.date);
    const saved = persist(); document.querySelector('#schedule-dialog').close(); if (activeView !== 'planner') location.hash = 'planner'; else render(); if (saved) notify(previous ? 'Time block updated.' : 'Time set aside. Your block is saved.');
});
document.querySelector('#year-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.target;
    if (form.elements.end.value < form.elements.start.value) { form.elements.end.setCustomValidity('End date must be on or after the start date.'); form.elements.end.reportValidity(); return; }
    state.fiscalYear = { start: form.elements.start.value, end: form.elements.end.value };
    const saved = persist(); document.querySelector('#year-dialog').close(); render(); if (saved) notify('Fiscal year updated. Existing goals and entries are preserved.');
});
window.addEventListener('hashchange', () => { render(); window.scrollTo({ top: 0 }); });
render();