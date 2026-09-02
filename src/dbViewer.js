import { getBackend, getBackends } from './backendUrl.js';

async function fetchJson(url, opts) {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`${url} -> ${r.status}`);
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('application/json')) return r.json();
    // try json anyway, fallback text
    try { return await r.json(); } catch { return r.text(); }
}

async function timedFetch(url, opts = {}, timeoutMs = 3000) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeoutMs);
    const start = performance.now();
    try {
        const r = await fetch(url, { ...opts, signal: ctrl.signal, cache: 'no-store' });
        const latencyMs = Math.round(performance.now() - start);
        clearTimeout(tid);
        return { r, latencyMs };
    } catch (e) {
        clearTimeout(tid);
        const latencyMs = Math.round(performance.now() - start);
        throw Object.assign(e, { latencyMs });
    }
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

// ---------- 健康检查 ----------
// 统一结构: { ok, base, latencyMs, endpoint, status, error, ts, detail, probeLog }
export async function checkExtremeHealth(timeoutMs = 3000) {
    const base = getBackend('extreme');
    const endpoints = ['/api/status', '/api/souls', '/api/chats'];
    const probeLog = [];
    for (const ep of endpoints) {
        const url = `${base}${ep}`;
        try {
            const { r, latencyMs } = await timedFetch(url, {}, timeoutMs);
            probeLog.push({ ep, status: r.status, latencyMs });
            if (r.ok) {
                let detail = '';
                try { const j = await r.clone().json(); detail = j.count != null ? `${j.count} 条` : j.status || 'ok'; } catch {}
                return { ok: true, base, latencyMs, endpoint: ep, status: r.status, ts: Date.now(), detail, probeLog };
            }
            // 404 etc -> server alive but endpoint missing
            if (r.status === 404 || r.status === 405) continue;
            // other 4xx/5xx视为在线但异常
            return { ok: r.status < 500, base, latencyMs, endpoint: ep, status: r.status, ts: Date.now(), detail: `HTTP ${r.status}`, probeLog };
        } catch (e) {
            probeLog.push({ ep, error: e.message, latencyMs: e.latencyMs || timeoutMs });
            // timeout/network => try next
        }
    }
    const last = probeLog[probeLog.length - 1];
    return { ok: false, base, latencyMs: last?.latencyMs || timeoutMs, endpoint: probeLog.find(p => p.status)?.ep || endpoints[0], status: 0, error: '无法连接', ts: Date.now(), detail: '离线或超时', probeLog };
}

export async function checkVigilHealth(timeoutMs = 3000) {
    const base = getBackend('vigil');
    const endpoints = ['/api/tasks', '/api/status', '/api/souls', '/api/config'];
    const probeLog = [];
    for (const ep of endpoints) {
        const url = `${base}${ep}${ep.includes('?') ? '' : (ep === '/api/tasks' ? '' : '')}`;
        try {
            const { r, latencyMs } = await timedFetch(url, {}, timeoutMs);
            probeLog.push({ ep, status: r.status, latencyMs });
            if (r.ok) {
                let detail = '';
                try {
                    const j = await r.clone().json();
                    if (Array.isArray(j.tasks) || j.tasks) detail = `${(j.tasks||[]).length} tasks`;
                    else if (j.souls) detail = `${j.souls.length} souls`;
                    else detail = 'ok';
                } catch {}
                return { ok: true, base, latencyMs, endpoint: ep, status: r.status, ts: Date.now(), detail, probeLog };
            }
            if (r.status === 404 || r.status === 405) continue;
            return { ok: r.status < 500, base, latencyMs, endpoint: ep, status: r.status, ts: Date.now(), detail: `HTTP ${r.status}`, probeLog };
        } catch (e) {
            probeLog.push({ ep, error: e.message, latencyMs: e.latencyMs || timeoutMs });
        }
    }
    const last = probeLog[probeLog.length - 1];
    return { ok: false, base, latencyMs: last?.latencyMs || timeoutMs, endpoint: probeLog.find(p => p.status)?.ep || endpoints[0], status: 0, error: '无法连接', ts: Date.now(), detail: '离线或超时', probeLog };
}

export async function checkFessHealth(timeoutMs = 3500) {
    const base = getBackend('fess');
    // 优先尝试 JSON 接口，再回退到静态资源 —— 因为 Fess 本质是 vector_server + 静态页，无标准心跳
    const endpoints = [
        { ep: '/tasks_stats', kind: 'json' },
        { ep: '/api/tasks_stats', kind: 'json' },
        { ep: '/status', kind: 'json' },
        { ep: '/health', kind: 'json' },
        { ep: '/api/status', kind: 'json' },
        { ep: '/Arc Databoard.html', kind: 'static' },
        { ep: '/ArcFess_QueryLab.html', kind: 'static' },
        { ep: '/', kind: 'static' },
    ];
    const probeLog = [];
    let anyReachable = false;
    for (const { ep, kind } of endpoints) {
        const url = `${base}${ep}`;
        try {
            const { r, latencyMs } = await timedFetch(url, {}, timeoutMs);
            probeLog.push({ ep, status: r.status, latencyMs, kind });
            if (r.ok) {
                // 进一步小校验静态页是否真返回 HTML
                if (kind === 'static') {
                    const ct = r.headers.get('content-type') || '';
                    const isHtml = ct.includes('text/html') || ep.endsWith('.html');
                    if (!isHtml && r.status !== 200) continue;
                }
                let detail = kind === 'static' ? '静态资源可达' : '接口可达';
                try {
                    if (kind === 'json') {
                        const j = await r.clone().json();
                        if (j && typeof j === 'object') {
                            const keys = Object.keys(j);
                            detail = keys.slice(0, 3).join(', ') || 'json ok';
                            if (j.total || j.count) detail = `${j.count ?? j.total} 条`;
                        }
                    } else {
                        detail = `${r.status} 静态可达`;
                    }
                } catch {}
                return { ok: true, base, latencyMs, endpoint: ep, status: r.status, ts: Date.now(), detail, probeLog, kind };
            }
            // 收到 404 也说明服务器活着（能返回 404）
            if (r.status === 404 || r.status === 405) {
                anyReachable = true;
                continue;
            }
            // 401/403 也算活着
            if (r.status >= 400 && r.status < 500) {
                anyReachable = true;
                return { ok: true, base, latencyMs, endpoint: ep, status: r.status, ts: Date.now(), detail: `HTTP ${r.status} 但服务可达`, probeLog, kind };
            }
            if (r.status >= 500) {
                probeLog[probeLog.length - 1].note = 'server error';
                continue;
            }
        } catch (e) {
            probeLog.push({ ep, error: e.message, latencyMs: e.latencyMs || timeoutMs, kind });
        }
    }
    if (anyReachable) {
        const hit = probeLog.find(p => p.status === 404);
        return { ok: true, base, latencyMs: hit?.latencyMs || timeoutMs, endpoint: hit?.ep || '/', status: 404, ts: Date.now(), detail: '服务可达（静态/接口 404 但端口存活）', probeLog, kind: 'static', warn: true };
    }
    const last = probeLog[probeLog.length - 1];
    return { ok: false, base, latencyMs: last?.latencyMs || timeoutMs, endpoint: probeLog.find(p => p.status)?.ep || endpoints[0].ep, status: 0, error: '无法连接', ts: Date.now(), detail: '离线或超时 · Fess 若未启动 vector_server 则静态资源亦不可达', probeLog };
}

export async function checkAllHealth(timeoutMs) {
    const [extreme, vigil, fess] = await Promise.all([
        checkExtremeHealth(timeoutMs).catch(e => ({ ok: false, base: getBackend('extreme'), error: e.message, ts: Date.now(), latencyMs: timeoutMs })),
        checkVigilHealth(timeoutMs).catch(e => ({ ok: false, base: getBackend('vigil'), error: e.message, ts: Date.now(), latencyMs: timeoutMs })),
        checkFessHealth(timeoutMs).catch(e => ({ ok: false, base: getBackend('fess'), error: e.message, ts: Date.now(), latencyMs: timeoutMs })),
    ]);
    return { extreme, vigil, fess, ts: Date.now() };
}
