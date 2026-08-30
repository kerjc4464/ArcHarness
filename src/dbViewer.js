import { getBackend, getBackends } from './backendUrl.js';

async function fetchJson(url, opts) {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`${url} -> ${r.status}`);
    return r.json();
}

// EXtreme DB
export async function extremeStatus() {
    const base = getBackend('extreme');
    try { return await fetchJson(`${base}/api/status`); } catch (e) { return { error: e.message, base }; }
}
export async function extremeChats() {
    const base = getBackend('extreme');
    try { return await fetchJson(`${base}/api/chats`); } catch (e) { return { error: e.message }; }
}
export async function extremeEvents(chatId, opts = {}) {
    const base = getBackend('extreme');
    const p = new URLSearchParams({ chat_id: chatId });
    if (opts.with_counters) p.set('with_counters', '1');
    if (opts.soul) p.set('soul', opts.soul);
    if (opts.counter != null && opts.counter !== '') p.set('counter', String(opts.counter));
    if (opts.bucket) p.set('bucket', opts.bucket);
    if (opts.limit) p.set('limit', String(opts.limit));
    if (opts.offset) p.set('offset', String(opts.offset));
    try {
        const d = await fetchJson(`${base}/api/events?${p.toString()}`);
        return d.events || d || [];
    } catch (e) { return { error: e.message }; }
}
export async function extremeShortPool(chatId, cap = 15) {
    const base = getBackend('extreme');
    try { return await fetchJson(`${base}/api/short_pool?chat_id=${encodeURIComponent(chatId)}&perSoulCap=${cap}`); } catch (e) { return { error: e.message }; }
}
export async function extremeDeleteEvent(id) {
    const base = getBackend('extreme');
    const r = await fetch(`${base}/api/events/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(`DELETE ${id} -> ${r.status}`);
    return r.json();
}
export async function extremeClearChat(chatId) {
    const base = getBackend('extreme');
    const r = await fetch(`${base}/api/events/clear`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId }) });
    if (!r.ok) throw new Error(`clear ${chatId} -> ${r.status}`);
    return r.json();
}
export async function extremeSyncShortPool(chatId, evaluations) {
    const base = getBackend('extreme');
    const r = await fetch(`${base}/api/short_pool/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, evaluations }) });
    if (!r.ok) throw new Error(`sync -> ${r.status}`);
    return r.json();
}
// 直接设值: 循环 +1/-1 直达目标
export async function extremeSetCounter(chatId, eventId, soul, targetCounter, reason = 'Harness manual') {
    // fetch current
    const pool = await extremeShortPool(chatId, 50).catch(() => null);
    let cur = null;
    if (pool && pool.events) {
        const found = pool.events.find(e => String(e.id) === String(eventId) && (e.pool_soul || e.soul) === soul);
        if (found) cur = found.counter ?? found.scounter ?? null;
    }
    if (cur == null) {
        // try events list
        const evs = await extremeEvents(chatId, { with_counters: 1, limit: 200 }).catch(() => []);
        const f = Array.isArray(evs) ? evs.find(e => String(e.id) === String(eventId)) : null;
        if (f) cur = f.counter ?? null;
    }
    if (cur == null) throw new Error('无法读取当前 counter');
    cur = Number(cur);
    targetCounter = Number(targetCounter);
    if (cur === targetCounter) return { updated: [], count: 0, note: 'already target' };
    const actions = [];
    let tmp = cur;
    while (tmp !== targetCounter) {
        if (tmp < targetCounter) { actions.push('+1'); tmp++; if (tmp > 3) break; }
        else { actions.push('-1'); tmp--; if (tmp < 0) break; }
        if (actions.length > 10) break;
    }
    let last = null;
    for (const act of actions) {
        const res = await extremeSyncShortPool(chatId, [{ event_id: eventId, soul, action: act, why: reason.slice(0, 200) }]);
        last = res;
    }
    return last || { updated: [], count: 0 };
}

// ViGil DB
export async function vigilTasks() {
    const base = getBackend('vigil');
    try { return await fetchJson(`${base}/api/tasks`); } catch (e) { return { error: e.message }; }
}
export async function vigilMessages(limit = 5, since = 0) {
    const base = getBackend('vigil');
    try { return await fetchJson(`${base}/api/messages?limit=${limit}&since=${since}`); } catch (e) { return { error: e.message }; }
}
export async function vigilConfig() {
    const base = getBackend('vigil');
    try { return await fetchJson(`${base}/api/config`); } catch (e) { return { error: e.message }; }
}

// Fess DB via vector_server
export async function fessStatus() {
    const base = getBackend('fess');
    // try common endpoints
    const endpoints = ['/status', '/health', '/api/status', '/tasks_stats'];
    for (const ep of endpoints) {
        try {
            const j = await fetchJson(`${base}${ep}`);
            return { ok: true, endpoint: ep, data: j, base };
        } catch {}
    }
    return { ok: false, base, error: 'no status endpoint' };
}
export async function fessTasksStats() {
    const base = getBackend('fess');
    try { return await fetchJson(`${base}/tasks_stats`); } catch (e) { try { return await fetchJson(`${base}/api/tasks_stats`); } catch (e2) { return { error: e2.message }; } }
}
export function fessBoardUrl() {
    const b = getBackends();
    return `${b.fess}/Arc Databoard.html`;
}
export function fessQueryLabUrl() { return `${getBackend('fess')}/ArcFess_QueryLab.html`; }
export function fessStoryMapUrl() { return `${getBackend('fess')}/ArcFess_StoryMap.html`; }
export function fessFlowLabUrl() { return `${getBackend('fess')}/ArcFess_FlowLab.html`; }
