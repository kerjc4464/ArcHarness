// @ts-nocheck
import { eventSource, event_types, getCurrentChatId, saveSettingsDebounced, extension_prompt_types } from '../../../../script.js';
import { extension_settings, getContext, renderExtensionTemplateAsync } from '../../../extensions.js';
import { SETTINGS_KEY, defaultSettings, mergeDefaults } from './src/config.js';
import { getBackends, getBackend } from './src/backendUrl.js';
import { listExtreme, listVigil, buildDiff, syncManyToVigil } from './src/soulHub.js';
import { extremeStatus, extremeChats, extremeEvents, extremeShortPool, extremeDeleteEvent, extremeClearChat, extremeSetCounter, vigilTasks, vigilMessages, fessStatus, fessTasksStats, fessBoardUrl, fessQueryLabUrl, fessStoryMapUrl, fessFlowLabUrl, checkExtremeHealth, checkVigilHealth, checkFessHealth, checkAllHealth } from './src/dbViewer.js';
import { applyBulk, testOne, getCurrentSnapshot } from './src/llmHub.js';
import { getBudgetSnapshot, getMaxBudget } from './src/budget.js';
import { installFetchPatch, capturePredicted, diagnosticStore, loadStore, getLastReal, getLastPredicted, filterPrompts, simulateCurrent, simulateSwipe } from './src/diagnostic.js';
import { checkAll, markAllSeen } from './src/updater.js';

const S = () => extension_settings[SETTINGS_KEY];

function ensureSettings() {
    if (!extension_settings[SETTINGS_KEY]) extension_settings[SETTINGS_KEY] = defaultSettings();
    else mergeDefaults(extension_settings[SETTINGS_KEY], defaultSettings());
    // also ensure subobjects
    const s = S();
    if (!s.backend) s.backend = defaultSettings().backend;
    if (!s.llm) s.llm = defaultSettings().llm;
}

function pushToast(type, msg) {
    const box = document.getElementById('ah-toast');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'ah-toast-item';
    el.textContent = msg;
    if (type === 'ok') el.style.borderLeftColor = '#22c55e';
    else if (type === 'warn') el.style.borderLeftColor = '#eab308';
    else if (type === 'fail') el.style.borderLeftColor = '#ef4444';
    box.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(10px)'; }, 2400);
    setTimeout(() => el.remove(), 2800);
}

function log(msg) {
    if (S()?.debug) console.log(`[ArcHarness] ${msg}`);
    // also to soul log etc.
}

function setStatus(text, ok = true) {
    const el = document.getElementById('ah-status');
    if (el) {
        el.textContent = text;
        el.className = 'ah-badge ' + (ok ? 'ok' : 'warn');
    }
}

// ---------------- Fetch 双轨 + Interceptor ----------------
let lastContextSize = 0;
let lastChatSnapshot = null;

export async function archarness_generate(chat, contextSize, abort, type) {
    const s = S();
    if (!s?.enabled) return;
    if (type === 'quiet') return;
    lastContextSize = Number(contextSize) || getMaxBudget();
    lastChatSnapshot = chat ? JSON.parse(JSON.stringify(chat.slice(-20))) : null;
    try {
        await capturePredicted(chat, contextSize, type);
        log(`predicted captured type=${type} contextSize=${contextSize} chatLen=${chat?.length}`);
        // also update budget UI if visible
        try { refreshBudget(chat, contextSize); } catch {}
    } catch (e) { console.warn('[ArcHarness] capturePredicted fail', e); }
}
window['archarness_generate'] = archarness_generate;

// ---------------- UI ----------------
function bindTabs() {
    document.querySelectorAll('.ah-tab[data-tab]').forEach(el => {
        el.addEventListener('click', () => {
            const tab = el.getAttribute('data-tab');
            document.querySelectorAll('.ah-tab[data-tab]').forEach(x => x.classList.remove('active'));
            el.classList.add('active');
            document.querySelectorAll('.ah-pane[id^="ah-pane-"]').forEach(p => p.classList.remove('active'));
            const pane = document.getElementById(`ah-pane-${tab}`);
            if (pane) pane.classList.add('active');
            if (tab === 'db' && Date.now() - _healthLastTs > 30000) {
                // 切到数据库时若超过 30s 未检测，静默刷新一次，不闪屏
                setTimeout(() => refreshAllHealth(false, true), 150);
            }
        });
    });
    document.querySelectorAll('.ah-tab[data-dbtab]').forEach(el => {
        el.addEventListener('click', () => {
            const tab = el.getAttribute('data-dbtab');
            el.parentElement.querySelectorAll('.ah-tab').forEach(x => x.classList.remove('active'));
            el.classList.add('active');
            document.getElementById('ah-db-extreme')?.classList.remove('active');
            document.getElementById('ah-db-vigil')?.classList.remove('active');
            document.getElementById('ah-db-fess')?.classList.remove('active');
            const pane = document.getElementById(`ah-db-${tab}`);
            if (pane) pane.classList.add('active');
        });
    });
}

// Soul
let soulDiffRows = [];
async function refreshSoul() {
    const statusEl = document.getElementById('ah-soul-status');
    const tbody = document.querySelector('#ah-soul-table tbody');
    if (statusEl) statusEl.textContent = '加载中...';
    try {
        const [ext, vig] = await Promise.all([listExtreme(), listVigil()]);
        soulDiffRows = buildDiff(ext, vig);
        if (tbody) {
            tbody.innerHTML = '';
            for (const r of soulDiffRows) {
                const tr = document.createElement('tr');
                const enabled = ext.enabledMap ? ext.enabledMap[r.name] !== false : true;
                const badge = r.state === 'both' ? '<span class="ah-badge ok">一致</span>' : r.state === 'only_extreme' ? '<span class="ah-badge warn">仅EXtreme</span>' : '<span class="ah-badge">仅ViGil</span>';
                tr.innerHTML = `<td data-label=""><input type="checkbox" class="ah-soul-check" data-name="${r.name}" ${r.state !== 'both' || r.note ? 'checked' : ''} /></td><td data-label="名称">${r.name} ${enabled === false ? '<small style="color:#f87171;">(禁用)</small>' : ''}</td><td data-label="状态">${badge}</td><td data-label="EXtreme">${r.extreme ? (r.extreme.filename + (r.extreme.size_bytes ? ` ${r.extreme.size_bytes}B` : '')) : '-'}</td><td data-label="ViGil">${r.vigil ? r.vigil.filename : '-'}</td><td data-label="备注">${r.note || ''}</td>`;
                tbody.appendChild(tr);
            }
        }
        if (statusEl) statusEl.textContent = `EXtreme ${ext.souls.length} | ViGil ${vig.souls.length} | 差异 ${soulDiffRows.filter(r => r.state !== 'both').length}`;
        setStatus('Soul 已刷新', true);
    } catch (e) {
        if (statusEl) statusEl.textContent = `加载失败: ${e.message}`;
        pushToast('fail', `Soul刷新失败: ${e.message}`);
    }
    document.getElementById('ah-soul-checkall')?.addEventListener('change', (e) => {
        document.querySelectorAll('.ah-soul-check').forEach(c => c.checked = e.target.checked);
    });
}

async function doSoulSync(selectedOnlyMissing = false) {
    const checks = [...document.querySelectorAll('.ah-soul-check:checked')].map(c => c.getAttribute('data-name'));
    let names = checks;
    if (selectedOnlyMissing) {
        names = soulDiffRows.filter(r => r.state === 'only_extreme').map(r => r.name);
        if (!names.length) { pushToast('warn', '无仅EXtreme的条目'); return; }
    }
    if (!names.length) { pushToast('warn', '未选中任何 Soul'); return; }
    const logEl = document.getElementById('ah-soul-log');
    if (logEl) logEl.textContent = `开始同步 ${names.length} 个: ${names.join(', ')}\n`;
    const results = await syncManyToVigil(names, soulDiffRows);
    let ok = 0, fail = 0;
    for (const r of results) {
        if (r.ok) ok++; else fail++;
        if (logEl) logEl.textContent += `${r.ok ? '✅' : '❌'} ${r.name}: ${r.ok ? '同步成功 ' + r.endpoint : (r.error + (r.content ? `\n  → ViGil无写接口, 已读取EXtreme原文 ${r.content.length}字, 请手动复制到 ${r.vigilBase}/souls/${r.filename} 或在 ViGil-Backend 新增 POST /api/souls/write` : ''))}\n`;
    }
    pushToast(ok && !fail ? 'ok' : 'warn', `同步完成 ✅${ok} ❌${fail}`);
    // update soul last sync
    try { S().soul.lastSync = Date.now(); saveSettingsDebounced(); } catch {}
}

// Budget
async function refreshBudget(chat, contextSize) {
    const maxEl = document.getElementById('ah-budget-max');
    const usedEl = document.getElementById('ah-budget-used');
    const injEl = document.getElementById('ah-budget-inj');
    const remEl = document.getElementById('ah-budget-rem');
    const pctEl = document.getElementById('ah-budget-pct');
    const bar = document.getElementById('ah-budget-bar');
    const breakdownEl = document.getElementById('ah-budget-breakdown');
    const perExtEl = document.getElementById('ah-budget-perExt');
    if (!maxEl) return;
    const ctx = getContext();
    const cs = Number(contextSize) || Number(lastContextSize) || getMaxBudget();
    maxEl.textContent = String(cs);
    try {
        const snap = await getBudgetSnapshot(chat || ctx.chat || lastChatSnapshot, cs);
        if (usedEl) usedEl.textContent = String(snap.chatTokens + snap.injectionTokens);
        if (injEl) injEl.textContent = String(snap.injectionTokens);
        if (remEl) remEl.textContent = String(snap.remaining);
        const pct = snap.usedPct.toFixed(1);
        if (pctEl) { pctEl.textContent = pct + '%'; pctEl.className = 'ah-badge ' + (snap.usedPct > (S()?.budget?.warnThreshold || 85) ? 'warn' : 'ok'); }
        if (bar) { bar.style.width = Math.min(100, snap.usedPct).toFixed(1) + '%'; bar.style.background = snap.usedPct > 90 ? '#ef4444' : snap.usedPct > 75 ? '#eab308' : 'linear-gradient(90deg,#d01e3b,#7c3aed)'; }
        if (breakdownEl) {
            breakdownEl.textContent = `总 ${snap.injectionTokens} tokens (注入) + ${snap.chatTokens} (对话) = ${snap.chatTokens + snap.injectionTokens} / ${cs}\n` +
                snap.breakdown.map(b => `[${b.type}] ${b.tokens} tokens`).join('\n') +
                `\n--- Arc细分 ---\n` + (snap.arcSubset.length ? snap.arcSubset.map(x => `${x.key}: ${x.tokens} tokens (depth ${x.depth})`).join('\n') : '无Arc注入');
        }
        if (perExtEl) {
            perExtEl.innerHTML = snap.perExt.length ? snap.perExt.map(x => `<div class="ah-kv"><b>${x.key}</b><span>${x.tokens} tok | depth ${x.depth ?? '-'}</span></div>`).join('') : '暂无扩展注入';
        }
    } catch (e) {
        if (breakdownEl) breakdownEl.textContent = `刷新失败: ${e.message}`;
    }
}

// Diagnostic
function renderDiagnostic() {
    const mode = document.getElementById('ah-diag-mode')?.value || 'real';
    const filter = document.getElementById('ah-diag-filter')?.value || '';
    const metaEl = document.getElementById('ah-diag-meta');
    const listEl = document.getElementById('ah-diag-list');
    if (!metaEl || !listEl) return;
    let entry = null;
    if (mode === 'real') entry = getLastReal();
    else if (mode === 'predicted') entry = getLastPredicted();
    else if (mode === 'current') entry = diagnosticStore.lastPredicted; // will be refreshed on capture
    else if (mode === 'swipe') entry = getLastPredicted();

    if (!entry) {
        metaEl.textContent = '暂无数据 — 请先发送一条消息或点击“捕获当前”';
        listEl.textContent = '';
        return;
    }
    if (mode === 'real') {
        metaEl.innerHTML = `<div class="ah-kv"><b>类型</b><span>Fetch 真实发送</span></div><div class="ah-kv"><b>时间</b><span>${new Date(entry.ts).toLocaleString()}</span></div><div class="ah-kv"><b>URL</b><span style="word-break:break-all;">${entry.url || '-'}</span></div><div class="ah-kv"><b>messages 条数</b><span>${entry.messages ? entry.messages.length : '-'}</span></div>${entry.usage ? `<div class="ah-kv"><b>usage</b><span>${JSON.stringify(entry.usage)}</span></div>` : ''}`;
        let text = '';
        if (entry.messages) {
            const filtered = filter ? entry.messages.filter(m => JSON.stringify(m).toLowerCase().includes(filter.toLowerCase())) : entry.messages;
            text = filtered.map((m, i) => `--- [${i}] ${m.role || m.name || 'unknown'} ---\n${String(m.content || m.text || '').slice(0, 6000)}`).join('\n\n');
        } else if (entry.body) {
            text = JSON.stringify(entry.body, null, 2).slice(0, 12000);
        }
        listEl.textContent = text || '（空）';
    } else {
        // predicted
        const prompts = entry.extensionPrompts || {};
        const filtered = filter ? filterPrompts(prompts, filter) : prompts;
        metaEl.innerHTML = `<div class="ah-kv"><b>类型</b><span>预测 (${entry.genType || entry.type})</span></div><div class="ah-kv"><b>时间</b><span>${new Date(entry.ts).toLocaleString()}</span></div><div class="ah-kv"><b>contextSize</b><span>${entry.contextSize}</span></div><div class="ah-kv"><b>chatLen</b><span>${entry.chatLen}</span></div>`;
        let text = '';
        const keys = Object.keys(filtered);
        if (!keys.length) text = '无匹配的扩展提示词';
        else {
            text = keys.map(k => {
                const v = filtered[k];
                return `### ${k} (tokens ${v.tokens ?? '?'} | role ${v.role ?? '-'} | depth ${v.depth ?? '-'} | type ${v.type ?? '-'})\n${String(v.value || '').slice(0, 6000)}`;
            }).join('\n\n----------------\n\n');
            // also byType
            if (entry.byType) {
                text += '\n\n===== 按类型聚合 =====\n';
                for (const [t, txt] of Object.entries(entry.byType)) {
                    if (filter && !String(txt).toLowerCase().includes(filter.toLowerCase()) && !t.toLowerCase().includes(filter.toLowerCase())) continue;
                    text += `\n-- type ${t} (${String(txt).length} chars) --\n${String(txt).slice(0, 6000)}\n`;
                }
            }
        }
        listEl.textContent = text;
    }
}

// ---------- DB 健康仪表 ----------
function formatTs(ts) { try { return new Date(ts).toLocaleString(); } catch { return '-'; } }
function counterLabel(c) { return ['0 强拒','1 弱拒','2 弱接','3 强接'][c] || `${c}`; }
function counterBadgeClass(c) { return ['ah-badge-c0','ah-badge-c1','ah-badge-c2','ah-badge-c3'][c] || ''; }
function safeParseJsonMaybe(str) {
    if (!str) return null;
    if (typeof str !== 'string') return str;
    try { return JSON.parse(str); } catch { return str; }
}
function decodeParticipants(raw) {
    // ViGil participants is JSON string like '["\\u6731..."]' or array
    if (!raw) return [];
    let arr = raw;
    if (typeof raw === 'string') {
        try { arr = JSON.parse(raw); } catch {
            // try single quoted?
            try { arr = JSON.parse(raw.replace(/'/g,'"')); } catch { return [String(raw)]; }
        }
    }
    if (Array.isArray(arr)) return arr.map(s => String(s)).filter(Boolean);
    if (typeof arr === 'object') return Object.values(arr).map(String);
    return [String(arr)];
}
function humanDelay(v) {
    if (v == null) return '-';
    const n = Number(v);
    if (Number.isNaN(n)) return String(v);
    if (n < 1) return `${Math.round(n*60)} 分钟`;
    if (n < 24) return `${n} 小时`;
    return `${(n/24).toFixed(1)} 天`;
}
function formatTriggerAt(v) {
    if (!v) return '-';
    const n = Number(v);
    if (Number.isFinite(n)) {
        // ViGil trigger_at is unix seconds with fraction
        const ms = n > 1e12 ? n : n * 1000;
        const d = new Date(ms);
        if (!isNaN(d.getTime())) return d.toLocaleString();
    }
    return String(v);
}

function setHealthCard(which, res) {
    const dot = document.getElementById(`ah-health-dot-${which}`);
    const badge = document.getElementById(`ah-health-badge-${which}`);
    const latEl = document.getElementById(`ah-health-latency-${which}`);
    const epEl = document.getElementById(`ah-health-endpoint-${which}`);
    const baseEl = document.getElementById(`ah-health-base-${which}`);
    const detailEl = document.getElementById(`ah-health-detail-${which}`);
    const card = document.getElementById(`ah-health-card-${which}`);
    if (!dot || !badge) return;
    const ok = !!res?.ok;
    const latency = res?.latencyMs != null ? `${res.latencyMs} ms` : '—';
    if (latEl) latEl.textContent = latency;
    if (epEl) epEl.textContent = res?.endpoint || '—';
    if (baseEl) baseEl.textContent = res?.base || getBackends()[which] || '—';
    // badge & dot
    dot.className = 'ah-dot';
    if (card) card.className = 'ah-health-card';
    if (!res) {
        dot.classList.add('checking');
        badge.textContent = '检测中';
        badge.className = 'ah-badge';
        if (detailEl) detailEl.textContent = '等待检测…';
        return;
    }
    if (ok) {
        const isWarn = !!res.warn;
        dot.classList.add(isWarn ? 'warn' : 'ok');
        if (card) card.classList.add(isWarn ? 'ah-health-warn' : 'ah-health-ok');
        badge.textContent = isWarn ? '可达' : '在线';
        badge.className = 'ah-badge ' + (isWarn ? 'warn' : 'ok');
        if (detailEl) detailEl.textContent = res.detail || `${res.endpoint} · ${latency}`;
    } else {
        dot.classList.add('fail');
        if (card) card.classList.add('ah-health-fail');
        badge.textContent = '离线';
        badge.className = 'ah-badge warn';
        if (detailEl) detailEl.textContent = res.error || res.detail || '离线或超时';
    }
    // also sync legacy status badges
    if (which === 'extreme') {
        const s = document.getElementById('ah-extreme-status');
        const line = document.getElementById('ah-extreme-statline');
        if (s) { s.textContent = ok ? `在线 · ${res.detail||''}`.trim() : '离线'; s.className = 'ah-badge ' + (ok ? 'ok' : 'warn'); }
        if (line) line.textContent = ok ? `${res.endpoint} · ${latency}` : (res.error||'');
    } else if (which === 'vigil') {
        const s = document.getElementById('ah-vigil-status');
        const line = document.getElementById('ah-vigil-statline');
        if (s) { s.textContent = ok ? '在线' : '离线'; s.className = 'ah-badge ' + (ok ? 'ok' : 'warn'); }
        if (line) line.textContent = ok ? `${res.endpoint} · ${latency} · ${res.detail||''}` : (res.error||'');
    } else if (which === 'fess') {
        const s = document.getElementById('ah-fess-status');
        if (s) { s.textContent = ok ? `在线 · ${res.endpoint}` : '离线'; s.className = 'ah-badge ' + (ok ? 'ok' : 'warn'); }
        const probeLine = document.getElementById('ah-fess-probe-line');
        if (probeLine) probeLine.textContent = ok ? `${res.detail||''} · ${latency}` : (res.error||'');
    }
}

let _healthTimer = null;
let _healthLastTs = 0;
let _healthInFlight = false;
function isDbVisible() {
    const panel = document.getElementById('archarness-panel');
    if (!panel || panel.offsetParent === null) return false;
    if (document.hidden) return false;
    const dbPane = document.getElementById('ah-pane-db');
    return !!dbPane && dbPane.classList.contains('active');
}
function scheduleHealthPoll(delayMs) {
    if (_healthTimer) clearTimeout(_healthTimer);
    _healthTimer = setTimeout(async () => {
        if (!isDbVisible()) { scheduleHealthPoll(30000); return; }
        await refreshAllHealth(false, true);
    }, delayMs);
}
async function refreshAllHealth(showToast = false, silent = false) {
    if (_healthInFlight) return;
    const lastEl = document.getElementById('ah-health-last');
    const shouldShowChecking = !silent;
    if (shouldShowChecking) {
        ['extreme','vigil','fess'].forEach(w => setHealthCard(w, null));
        if (lastEl) lastEl.textContent = '检测中…';
    } else {
        // 静默刷新不在卡片上闪“检测中”，仅在底部给微妙提示，避免切 Tab 时全卡抖动
        if (lastEl && isDbVisible()) lastEl.textContent = '后台检测中…';
    }
    _healthInFlight = true;
    try {
        const all = await checkAllHealth(3800);
        setHealthCard('extreme', all.extreme);
        setHealthCard('vigil', all.vigil);
        setHealthCard('fess', all.fess);
        _healthLastTs = Date.now();
        if (lastEl) lastEl.textContent = `上次检测: ${formatTs(all.ts)} · 点击卡片查看详情`;
        if (showToast) {
            const okCount = [all.extreme.ok, all.vigil.ok, all.fess.ok].filter(Boolean).length;
            pushToast(okCount === 3 ? 'ok' : 'warn', `健康检查: ${okCount}/3 在线`);
        }
        renderFessProbeDetail(all.fess);
        const allOk = !!(all.extreme.ok && all.vigil.ok && all.fess.ok);
        scheduleHealthPoll(allOk ? 60000 : 20000);
        return all;
    } catch (e) {
        if (lastEl) lastEl.textContent = `检测失败: ${e.message}`;
        if (!silent) pushToast('fail', `健康检查失败: ${e.message}`);
        scheduleHealthPoll(20000);
    } finally {
        _healthInFlight = false;
    }
}

function renderFessProbeDetail(fessRes) {
    const el = document.getElementById('ah-fess-probe-detail');
    if (!el || !fessRes) return;
    if (!fessRes.probeLog || !fessRes.probeLog.length) { el.textContent = fessRes.detail || ''; return; }
    const lines = fessRes.probeLog.map(p => {
        if (p.status) return `${p.ep} → ${p.status} (${p.latencyMs}ms)`;
        if (p.error) return `${p.ep} → ✗ ${p.error}`;
        return `${p.ep} → ?`;
    }).join('  ·  ');
    const prefix = fessRes.ok ? (fessRes.warn ? '⚠️ 探测到端口存活但标准接口缺失，已回退到静态资源: ' : '✅ ') : '❌ ';
    el.textContent = prefix + lines;
    if (!fessRes.ok) el.innerHTML += '<br><span style="color:#f87171;">Fess 无标准心跳接口，本模块通过多端点探测（含 /Arc Databoard.html）判断存活；若全部超时请检查 :8999 是否已启动 vectors_enhanced / vector_server。</span>';
}

function renderFessStats(stats) {
    const grid = document.getElementById('ah-fess-stats-grid');
    const raw = document.getElementById('ah-fess-stats');
    if (!grid) return;
    if (!stats || stats.error) {
        grid.innerHTML = `<div class="ah-fess-stat"><b>状态</b><span style="color:#f87171;">${stats?.error||'无数据'}</span></div>`;
        if (raw) raw.textContent = JSON.stringify(stats, null, 2);
        return;
    }
    // stats may be { tasks:..., total, counts, ... } or generic
    if (typeof stats === 'object' && !Array.isArray(stats)) {
        const entries = Object.entries(stats);
        // limit to 8 prioritized keys
        const prio = ['total','count','tasks','pending','processing','done','failed','vectors','collections','embedding'];
        entries.sort((a,b) => {
            const ia = prio.indexOf(a[0].toLowerCase()); const ib = prio.indexOf(b[0].toLowerCase());
            const pa = ia === -1 ? 99 : ia; const pb = ib === -1 ? 99 : ib;
            return pa - pb;
        });
        const show = entries.slice(0, 8);
        grid.innerHTML = show.map(([k,v]) => {
            let val = v;
            if (Array.isArray(v)) val = `${v.length} 项`;
            else if (typeof v === 'object' && v !== null) val = JSON.stringify(v).slice(0, 80);
            else val = String(v);
            return `<div class="ah-fess-stat"><b>${k}</b><span>${val}</span></div>`;
        }).join('');
        if (entries.length > 8) {
            grid.innerHTML += `<div class="ah-fess-stat"><b>更多</b><span style="font-size:11px; color:var(--ah-sub);">${entries.length - 8} 项未展示，进入 Databoard 查看</span></div>`;
        }
        if (raw) raw.textContent = JSON.stringify(stats, null, 2);
    } else {
        grid.innerHTML = `<div class="ah-fess-stat"><b>数据</b><span>${String(stats).slice(0,200)}</span></div>`;
    }
}

// DB Extreme
let extremeChatCache = [];
async function refreshExtreme(dbChatId) {
    const statusEl = document.getElementById('ah-extreme-status');
    const chatSel = document.getElementById('ah-extreme-chat');
    const statline = document.getElementById('ah-extreme-statline');
    // quick health probe for extreme alone to update badge quickly (not full checkAll)
    try {
        const st = await extremeStatus();
        if (statusEl) {
            const isOk = !st.error;
            statusEl.textContent = isOk ? `在线 ${st.count ?? ''}条`.trim() : `离线 ${st.error||''}`.slice(0,40);
            statusEl.className = 'ah-badge ' + (isOk ? 'ok' : 'warn');
            if (statline) statline.textContent = isOk ? (st.endpoint||'/api/status') : '';
        }
    } catch {}
    try {
        const chats = await extremeChats();
        if (chats && !chats.error && Array.isArray(chats.chat_ids || chats.chats || chats)) {
            const list = chats.chat_ids || chats.chats || chats;
            const ids = Array.isArray(list) ? list.map(x => typeof x === 'string' ? x : x.chat_id || x.id) : [];
            extremeChatCache = ids.filter(Boolean);
            if (chatSel) {
                const cur = chatSel.value || getCurrentChatId() || '';
                chatSel.innerHTML = '<option value="">选择 chat_id</option>' + extremeChatCache.map(id => `<option value="${id}" ${id === cur ? 'selected' : ''}>${id}</option>`).join('');
            }
        } else if (chats && chats.chats) {
            // alternative format
        }
        // fallback: use current chat
        if (chatSel && !chatSel.value) {
            const cur = getCurrentChatId();
            if (cur && !extremeChatCache.includes(cur)) {
                const opt = document.createElement('option');
                opt.value = cur; opt.textContent = cur + ' (当前)';
                chatSel.appendChild(opt);
                chatSel.value = cur;
            }
        }
        // populate soul filter from shortpool or keep existing; we will populate after shortpool
    } catch {}
    // short pool
    const cid = dbChatId || document.getElementById('ah-extreme-chat')?.value || getCurrentChatId();
    if (cid) {
        try {
            const sp = await extremeShortPool(cid, 15);
            const el = document.getElementById('ah-extreme-shortpool');
            if (el) {
                if (sp.error) {
                    el.innerHTML = `<div style="color:#f87171; font-size:11px;">ShortPool 拉取失败: ${sp.error}</div>`;
                } else {
                    const pools = sp.pools || {};
                    const count = sp.count ?? (sp.events ? sp.events.length : 0);
                    // populate soul filter
                    const soulSel = document.getElementById('ah-extreme-soul-filter');
                    if (soulSel) {
                        const cur = soulSel.value;
                        const souls = Object.keys(pools).sort();
                        soulSel.innerHTML = '<option value="">全部Soul</option>' + souls.map(s => `<option value="${s}" ${s===cur?'selected':''}>${s}</option>`).join('');
                    }
                    if (!Object.keys(pools).length) {
                        el.innerHTML = `<div style="font-size:11px; color:var(--ah-sub);">短期池为空 · 本 chat 暂无事件 (cap 15)</div>`;
                    } else {
                        let html = `<div class="ah-row" style="justify-content:space-between; margin-bottom:6px;"><b style="font-size:11px;">短期池 ${count} 条 · 按 Soul 分组</b><span style="font-size:10px; color:var(--ah-sub);">perSoulCap 15 · 下拉改 2bit 直达</span></div>`;
                        for (const [soul, items] of Object.entries(pools)) {
                            html += `<div class="ah-sp-group"><div class="ah-sp-head"><span class="ah-sp-title">${soul}</span><span class="ah-sp-count">${items.length} 条</span></div>`;
                            for (const it of items.slice(0, 10)) {
                                const c = Number(it.counter ?? 0);
                                const label = counterLabel(c);
                                const badgeCls = counterBadgeClass(c);
                                const txt = String(it.event_text || it.event || '').replace(/</g,'&lt;');
                                html += `<div class="ah-sp-item"><span class="ah-badge ${badgeCls}" title="${label}">${c}</span><span class="ah-sp-cid" title="${txt.slice(0,200)}">${txt.slice(0, 90) || '(空)'}</span><select data-eid="${it.id}" data-soul="${it.pool_soul||it.soul||soul}" class="ah-select ah-counter-edit"><option value="0" ${c==0?'selected':''}>0强拒</option><option value="1" ${c==1?'selected':''}>1弱拒</option><option value="2" ${c==2?'selected':''}>2弱接</option><option value="3" ${c==3?'selected':''}>3强接</option></select></div>`;
                            }
                            if (items.length > 10) html += `<div style="font-size:10px; color:var(--ah-sub); padding-left:4px;">… 还有 ${items.length-10} 条未展示，请查询事件</div>`;
                            html += `</div>`;
                        }
                        el.innerHTML = html;
                        el.querySelectorAll('.ah-counter-edit').forEach(sel => {
                            sel.addEventListener('change', async (e) => {
                                const eid = e.target.getAttribute('data-eid');
                                const soul = e.target.getAttribute('data-soul');
                                const target = Number(e.target.value);
                                try {
                                    pushToast('info', `设置 ${soul}#${eid} -> ${target}...`);
                                    const res = await extremeSetCounter(cid, eid, soul, target, 'Harness manual edit');
                                    pushToast('ok', `已更新 ${res.count ?? 1} 条`);
                                    refreshExtreme(cid);
                                } catch (err) { pushToast('fail', `更新失败: ${err.message}`); }
                            });
                        });
                    }
                }
            }
        } catch (e) {
            const el = document.getElementById('ah-extreme-shortpool');
            if (el) el.innerHTML = `<div style="color:#f87171; font-size:11px;">ShortPool 异常: ${e.message}</div>`;
        }
    } else {
        const el = document.getElementById('ah-extreme-shortpool');
        if (el) el.innerHTML = `<div style="font-size:11px; color:var(--ah-sub);">请选择 chat_id 以加载短期池</div>`;
    }
}

async function queryExtremeEvents() {
    const cid = document.getElementById('ah-extreme-chat')?.value || getCurrentChatId();
    if (!cid) { pushToast('warn', '请选择 chat_id'); return; }
    const soul = document.getElementById('ah-extreme-soul-filter')?.value || '';
    const counter = document.getElementById('ah-extreme-counter-filter')?.value;
    const limit = Number(document.getElementById('ah-extreme-limit')?.value) || 50;
    const out = document.getElementById('ah-extreme-events');
    const countEl = document.getElementById('ah-extreme-events-count');
    const emptyEl = document.getElementById('ah-extreme-events-empty');
    if (out) out.innerHTML = '<div style="text-align:center; padding:16px; color:var(--ah-sub); font-size:11px;">查询中…</div>';
    if (countEl) countEl.textContent = '查询中…';
    if (emptyEl) emptyEl.style.display = 'none';
    try {
        const evs = await extremeEvents(cid, { with_counters: 1, soul: soul || undefined, counter: counter !== '' ? counter : undefined, limit });
        if (evs && evs.error) {
            if (out) out.innerHTML = `<div style="color:#f87171; padding:10px; font-size:11px;">错误: ${evs.error}</div>`;
            if (countEl) countEl.textContent = '错误';
            return;
        }
        if (!Array.isArray(evs) || !evs.length) {
            if (out) out.innerHTML = '';
            if (emptyEl) emptyEl.style.display = 'block';
            if (countEl) countEl.textContent = '0 条';
            return;
        }
        if (countEl) countEl.textContent = `${evs.length} 条` + (soul ? ` · ${soul}` : '') + (counter!=='' ? ` · 2bit=${counter}` : '');
        if (out) {
            out.innerHTML = '';
            for (const e of evs) {
                const card = document.createElement('div');
                card.className = 'ah-event-card';
                const c = e.counter != null ? Number(e.counter) : null;
                const bucket = e.time_bucket || '';
                const souls = (() => {
                    const s = e.souls || e.souls_str || e.soul || '';
                    if (Array.isArray(s)) return s;
                    if (typeof s === 'string') {
                        try { const j = JSON.parse(s); return Array.isArray(j)? j : [s]; } catch { return s ? s.split(',').map(x=>x.trim()).filter(Boolean) : []; }
                    }
                    return [];
                })();
                const soulTags = souls.slice(0,4).map(s => `<span class="ah-event-soul">${String(s).slice(0,18)}</span>`).join('') + (souls.length>4 ? `<span style="font-size:10px; color:var(--ah-sub);">+${souls.length-4}</span>` : '');
                const bodyRaw = String(e.event_text || e.event || e.text || '').trim();
                const preview = bodyRaw ? bodyRaw.slice(0,600) : '(空事件)';
                card.innerHTML = `<div class="ah-event-head"><span class="ah-event-id">#${e.id}</span>${c!=null?`<span class="ah-badge ${counterBadgeClass(c)}" title="${counterLabel(c)}">${c} ${['强拒','弱拒','弱接','强接'][c]||''}</span>`:''}<span class="ah-event-bucket">${bucket}</span><span class="ah-event-souls">${soulTags || '<span style="font-size:10px;color:#71717a;">—</span>'}</span><span style="margin-left:auto; font-size:10px; color:#71717a;">${e.created_at ? formatTs(e.created_at) : (e.timestamp? formatTs(e.timestamp): '')}</span></div><div class="ah-event-body" title="点击展开/收起">${preview.replace(/</g,'&lt;')}${bodyRaw.length>600?' …':''}</div><div class="ah-event-actions"><select data-eid="${e.id}" data-soul="${(souls[0]||e.pool_soul||'').toString()}" class="ah-select ah-counter-edit" title="快速改 2bit"><option value="" disabled ${c==null?'selected':''}>改2bit</option><option value="0" ${c==0?'selected':''}>0 强拒</option><option value="1" ${c==1?'selected':''}>1 弱拒</option><option value="2" ${c==2?'selected':''}>2 弱接</option><option value="3" ${c==3?'selected':''}>3 强接</option></select><div class="ah-btn secondary" data-act="del" style="padding:3px 8px; font-size:11px;">删除</div><span style="font-size:10px; color:#71717a; margin-left:auto;">${souls.length? souls.join(', ').slice(0,40):''}</span></div>`;
                const body = card.querySelector('.ah-event-body');
                body.addEventListener('click', () => body.classList.toggle('expanded'));
                const sel = card.querySelector('select.ah-counter-edit');
                if (sel) sel.addEventListener('change', async (ev) => {
                    const val = ev.target.value;
                    if (val === '') return;
                    const target = Number(val);
                    const sName = ev.target.getAttribute('data-soul') || souls[0] || soul || '';
                    if (!sName) { pushToast('warn','无法确定 Soul'); return; }
                    try {
                        pushToast('info', `设置 #${e.id} → ${target}…`);
                        await extremeSetCounter(cid, e.id, sName, target, 'Harness event list edit');
                        pushToast('ok', `已更新 #${e.id}`);
                        queryExtremeEvents();
                        refreshExtreme(cid);
                    } catch (err) { pushToast('fail', err.message); }
                });
                const delBtn = card.querySelector('[data-act="del"]');
                delBtn.addEventListener('click', async () => {
                    if (!confirm(`删除事件 ${e.id} ?`)) return;
                    try { await extremeDeleteEvent(e.id); pushToast('ok', `已删 ${e.id}`); card.remove(); const cnt = document.getElementById('ah-extreme-events-count'); if (cnt) cnt.textContent = `${out.children.length} 条`; queryExtremeEvents(); } catch (err) { pushToast('fail', err.message); }
                });
                out.appendChild(card);
            }
        }
    } catch (e) {
        if (out) out.innerHTML = `<div style="color:#f87171; padding:10px; font-size:11px;">查询失败: ${e.message}</div>`;
        if (countEl) countEl.textContent = '失败';
    }
}

// ViGil
async function refreshVigil() {
    const tasksEl = document.getElementById('ah-vigil-tasks');
    const msgsEl = document.getElementById('ah-vigil-messages');
    const tasksCount = document.getElementById('ah-vigil-tasks-count');
    const msgsCount = document.getElementById('ah-vigil-messages-count');
    if (tasksEl) tasksEl.innerHTML = '<div style="text-align:center; padding:18px; color:var(--ah-sub); font-size:11px;">加载中…</div>';
    if (msgsEl) msgsEl.innerHTML = '<div style="text-align:center; padding:18px; color:var(--ah-sub); font-size:11px;">加载中…</div>';
    // tasks
    try {
        const t = await vigilTasks();
        if (t && t.error) {
            if (tasksEl) tasksEl.innerHTML = `<div style="color:#f87171; font-size:11px; padding:8px;">加载失败: ${t.error}</div>`;
            if (tasksCount) { tasksCount.textContent = '失败'; tasksCount.className='ah-badge warn'; }
        } else {
            const list = t.tasks || t.data || (Array.isArray(t) ? t : []);
            const arr = Array.isArray(list) ? list : [];
            if (tasksCount) { tasksCount.textContent = `${arr.length} 条`; tasksCount.className = arr.length? 'ah-badge ok':'ah-badge'; }
            if (tasksEl) {
                if (!arr.length) tasksEl.innerHTML = '<div style="text-align:center; padding:16px; color:var(--ah-sub); font-size:11px;">暂无 Tasks</div>';
                else {
                    tasksEl.innerHTML = '';
                    for (const item of arr.slice(0, 20)) {
                        const participants = decodeParticipants(item.participants || item.participant || item.targets);
                        const partTags = participants.slice(0,3).map(p=>`<span class="ah-part-tag">${p.slice(0,14)}</span>`).join('') + (participants.length>3? `<span style="font-size:10px;color:var(--ah-sub);">+${participants.length-3}</span>`:'');
                        const trigger = formatTriggerAt(item.trigger_at || item.triggerAt || item.next_run);
                        const delay = humanDelay(item.delay_hours ?? item.delay);
                        const status = item.status || '—';
                        const statusCls = status.includes('sched')? 'ok' : status.includes('done')? '':'warn';
                        const topic = String(item.topic || item.title || item.event || '').trim() || '(无主题)';
                        const card = document.createElement('div');
                        card.className = 'ah-vigil-card';
                        card.innerHTML = `<div class="ah-vigil-head"><span class="ah-vigil-id">#${item.id ?? '?'}</span><span class="ah-badge ${statusCls} ah-vigil-status">${status}</span></div><div class="ah-vigil-field"><b>参与者</b><span>${partTags || '—'}</span></div><div class="ah-vigil-field"><b>延迟</b><span>${delay}</span></div><div class="ah-vigil-field"><b>触发</b><span>${trigger}</span></div><div class="ah-vigil-field"><b>模式</b><span>${item.schedule_mode || item.mode || '—'}</span></div>${item.resend_email_id? `<div class="ah-vigil-field"><b>邮件ID</b><span style="font-family:monospace; font-size:10px;">${String(item.resend_email_id).slice(0,22)}</span></div>`:''}<div class="ah-vigil-topic" title="点击展开">${topic.replace(/</g,'&lt;').slice(0,280)}</div>`;
                        const topicEl = card.querySelector('.ah-vigil-topic');
                        topicEl.addEventListener('click', ()=> topicEl.classList.toggle('expanded'));
                        tasksEl.appendChild(card);
                    }
                    if (arr.length>20) {
                        const more = document.createElement('div');
                        more.style.cssText='text-align:center; font-size:11px; color:var(--ah-sub); padding:6px;';
                        more.textContent = `还有 ${arr.length-20} 条未展示`;
                        tasksEl.appendChild(more);
                    }
                }
            }
        }
    } catch (e) {
        if (tasksEl) tasksEl.innerHTML = `<div style="color:#f87171; font-size:11px; padding:8px;">失败: ${e.message}</div>`;
        if (tasksCount) { tasksCount.textContent='失败'; tasksCount.className='ah-badge warn'; }
    }
    try {
        const m = await vigilMessages(8, 0);
        if (m && m.error) {
            if (msgsEl) msgsEl.innerHTML = `<div style="color:#f87171; font-size:11px; padding:8px;">加载失败: ${m.error}</div>`;
            if (msgsCount) { msgsCount.textContent='失败'; msgsCount.className='ah-badge warn'; }
        } else {
            const list = m.messages || m.data || (Array.isArray(m) ? m : []);
            const arr = Array.isArray(list)? list: [];
            if (msgsCount) { msgsCount.textContent = `${arr.length} 条`; msgsCount.className = arr.length? 'ah-badge ok':'ah-badge'; }
            if (msgsEl) {
                if (!arr.length) msgsEl.innerHTML = '<div style="text-align:center; padding:16px; color:var(--ah-sub); font-size:11px;">暂无 Messages</div>';
                else {
                    msgsEl.innerHTML = '';
                    for (const item of arr.slice(0, 20)) {
                        const subject = String(item.subject || item.topic || item.title || item.sub_topic || '').trim() || '(无主题)';
                        const from = String(item.from || item.sender || '').trim();
                        const content = String(item.content || item.body || item.text || item.message || '').trim();
                        const ts = formatTs(item.timestamp || item.created_at || item.sent_at);
                        const id = item.id ?? item.msg_id ?? '?';
                        const card = document.createElement('div');
                        card.className = 'ah-vigil-card';
                        card.innerHTML = `<div class="ah-vigil-head"><span class="ah-vigil-id">#${id}</span><span style="font-size:10px; color:var(--ah-sub);">${ts}</span></div>${from? `<div class="ah-vigil-field"><b>来自</b><span>${from.slice(0,40).replace(/</g,'&lt;')}</span></div>`:''}<div style="font-size:11px; font-weight:600; margin:4px 0; color:#e4e4e7; line-height:1.4;">${subject.slice(0,120).replace(/</g,'&lt;')}</div>${content? `<div class="ah-vigil-topic" title="点击展开">${content.slice(0,240).replace(/</g,'&lt;')}</div>`:''}`;
                        const tEl = card.querySelector('.ah-vigil-topic');
                        if (tEl) tEl.addEventListener('click', ()=> tEl.classList.toggle('expanded'));
                        msgsEl.appendChild(card);
                    }
                }
            }
        }
    } catch (e) { if (msgsEl) msgsEl.innerHTML = `<div style="color:#f87171; font-size:11px; padding:8px;">失败: ${e.message}</div>`; }
}

// Fess
async function refreshFess() {
    const statusEl = document.getElementById('ah-fess-status');
    const probeLine = document.getElementById('ah-fess-probe-line');
    // use health check for richer status
    try {
        const health = await checkFessHealth(3500);
        setHealthCard('fess', health);
        renderFessProbeDetail(health);
        if (statusEl) { statusEl.textContent = health.ok ? `在线 · ${health.endpoint}` : '离线'; statusEl.className='ah-badge '+(health.ok?'ok':'warn'); }
        if (probeLine) probeLine.textContent = health.ok ? `${health.detail} · ${health.latencyMs}ms` : (health.error||'离线');
    } catch (e) {
        if (statusEl) { statusEl.textContent='失败'; statusEl.className='ah-badge warn'; }
    }
    try {
        const stats = await fessTasksStats();
        renderFessStats(stats);
    } catch (e) {
        renderFessStats({ error: e.message });
    }
}
function openFess(which) {
    const map = { board: fessBoardUrl(), query: fessQueryLabUrl(), story: fessStoryMapUrl(), flow: fessFlowLabUrl() };
    const url = map[which] || map.board;
    const iframe = document.getElementById('ah-fess-iframe');
    const wrap = document.querySelector('.ah-iframe-wrap');
    const placeholder = document.getElementById('ah-fess-iframe-placeholder');
    if (iframe) {
        iframe.src = url;
        if (wrap) wrap.classList.add('has-src');
        if (placeholder) placeholder.textContent = `加载中: ${which} …`;
        // tab active
        document.querySelectorAll('.ah-fess-tab').forEach(el => el.classList.remove('active'));
        const active = document.getElementById(`ah-fess-tab-${which}`);
        if (active) active.classList.add('active');
        // hide placeholder after load
        iframe.onload = () => { if (placeholder) placeholder.style.display = 'none'; };
        iframe.onerror = () => { if (placeholder) { placeholder.textContent = '加载失败，请新窗打开或检查 Fess 是否在线'; placeholder.style.display = 'flex'; } };
    }
}

// LLM
function refreshLLMSnapshot() {
    const el = document.getElementById('ah-llm-snapshot');
    if (!el) return;
    const snap = getCurrentSnapshot();
    el.textContent = JSON.stringify(snap, null, 2).slice(0, 12000);
}
async function doLLMApply() {
    const url = document.getElementById('ah-llm-url')?.value.trim();
    const key = document.getElementById('ah-llm-key')?.value.trim();
    const model = document.getElementById('ah-llm-model')?.value.trim();
    if (!url && !key && !model) { pushToast('warn', '请至少填写 URL/Key/Model 之一'); return; }
    const groups = {
        extreme: document.getElementById('ah-llm-group-extreme')?.checked,
        vigil: document.getElementById('ah-llm-group-vigil')?.checked,
        fess: document.getElementById('ah-llm-group-fess')?.checked,
    };
    if (!groups.extreme && !groups.vigil && !groups.fess) { pushToast('warn', '请选择至少一个插件分组'); return; }
    const includeEmbedding = document.getElementById('ah-llm-include-embedding')?.checked;
    const includeRerank = document.getElementById('ah-llm-include-rerank')?.checked;
    const results = applyBulk({ groups, includeEmbedding, includeRerank, globalUrl: url, globalKey: key, globalModel: model });
    const logEl = document.getElementById('ah-llm-log');
    if (logEl) logEl.textContent = results.map(r => `${r.group}: ${r.ok ? '✅已应用' : '❌'+r.error}`).join('\n');
    pushToast('ok', `批量应用完成: ${results.filter(r=>r.ok).length}/${results.length} 成功`);
    refreshLLMSnapshot();
    // persist grouping prefs
    try {
        S().llm.groups = groups;
        S().llm.includeEmbedding = includeEmbedding;
        S().llm.includeRerank = includeRerank;
        S().llm.global = { apiUrl: url, apiKey: key, model };
        saveSettingsDebounced();
    } catch {}
}
async function doLLMTest() {
    const logEl = document.getElementById('ah-llm-log');
    const groups = {
        extreme: document.getElementById('ah-llm-group-extreme')?.checked,
        vigil: document.getElementById('ah-llm-group-vigil')?.checked,
        fess: document.getElementById('ah-llm-group-fess')?.checked,
    };
    if (logEl) logEl.textContent = '测试中...\n';
    for (const k of Object.keys(groups)) if (groups[k]) {
        try {
            const r = await testOne(k);
            if (logEl) logEl.textContent += `${k}: ${r.ok ? '✅' : '❌'} ${r.ok ? JSON.stringify(r.data).slice(0,400) : r.error}\n`;
        } catch (e) { if (logEl) logEl.textContent += `${k}: ❌ ${e.message}\n`; }
    }
}

// Updater
async function doCheckUpdates() {
    const token = document.getElementById('ah-gh-token')?.value.trim() || S()?.updater?.githubToken || '';
    const btn = document.getElementById('ah-check-updates');
    if (btn) btn.textContent = '检查中...';
    try {
        const results = await checkAll(token);
        const wrap = document.getElementById('ah-updater-results');
        if (wrap) {
            wrap.innerHTML = '';
            for (const r of results) {
                const card = document.createElement('div');
                card.className = 'ah-card';
                if (r.ok) {
                    card.innerHTML = `<div class="ah-row" style="justify-content:space-between;"><b>${r.repo}</b><span class="ah-badge ${r.isNew ? 'warn' : 'ok'}">${r.isNew ? '有更新' : '已最新'}</span></div><div style="font-size:11px; color:#a1a1aa; margin-top:4px;">本地 ${r.localVersion} (${(r.localSha||'').slice(0,7)||'?'}) → 远端 ${r.shortSha} ${r.date ? new Date(r.date).toLocaleString() : ''}</div><div style="font-size:11px; margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${r.msg}</div><div class="ah-row" style="margin-top:6px;"><a href="${r.url}" target="_blank" class="ah-btn secondary" style="padding:4px 8px; text-decoration:none;">查看提交</a><a href="${r.compareUrl}" target="_blank" class="ah-btn secondary" style="padding:4px 8px; text-decoration:none;">对比</a><span style="font-size:11px; color:#71717a; margin-left:auto;">${r.owner}/${r.repo}:${r.branch}</span></div>`;
                } else {
                    card.innerHTML = `<div class="ah-row"><b>${r.which}</b><span class="ah-badge warn">失败</span></div><div style="font-size:11px; color:#f87171;">${r.error}</div>`;
                }
                wrap.appendChild(card);
            }
        }
        pushToast('ok', '更新检查完成');
        // save token
        try { S().updater.githubToken = token; saveSettingsDebounced(); } catch {}
    } catch (e) { pushToast('fail', `检查失败: ${e.message}`); }
    if (btn) btn.textContent = '检查更新';
}

// ---------------- Init ----------------
async function initUI() {
    ensureSettings();
    loadStore();
    installFetchPatch();

    const s = S();
    // bind settings html if not yet rendered — renderExtensionTemplateAsync will have done before initUI if called via extensions.js
    // but we call init after render
    bindTabs();

    // enabled/debug
    const enEl = document.getElementById('ah-enabled');
    const dbgEl = document.getElementById('ah-debug');
    if (enEl) { enEl.checked = !!s.enabled; enEl.addEventListener('change', () => { s.enabled = !!enEl.checked; saveSettingsDebounced(); setStatus(s.enabled ? '已启用' : '已停用', s.enabled); }); }
    if (dbgEl) { dbgEl.checked = !!s.debug; dbgEl.addEventListener('change', () => { s.debug = !!dbgEl.checked; saveSettingsDebounced(); }); }

    // backends
    const be = document.getElementById('ah-backend-extreme');
    const bv = document.getElementById('ah-backend-vigil');
    const bf = document.getElementById('ah-backend-fess');
    if (be) { be.value = s.backend.extreme; be.addEventListener('change', () => { s.backend.extreme = be.value.trim(); saveSettingsDebounced(); updateBackendEffective(); }); }
    if (bv) { bv.value = s.backend.vigil; bv.addEventListener('change', () => { s.backend.vigil = bv.value.trim(); saveSettingsDebounced(); updateBackendEffective(); }); }
    if (bf) { bf.value = s.backend.fess; bf.addEventListener('change', () => { s.backend.fess = bf.value.trim(); saveSettingsDebounced(); updateBackendEffective(); }); }
    function updateBackendEffective() {
        const el = document.getElementById('ah-backend-effective');
        if (el) {
            const b = getBackends();
            el.textContent = `生效: EX ${b.extreme} | ViGil ${b.vigil} | Fess ${b.fess}`;
        }
        clearTimeout(window._ahHealthDebounce);
        window._ahHealthDebounce = setTimeout(() => refreshAllHealth(), 600);
    }
    updateBackendEffective();

    // soul
    document.getElementById('ah-soul-refresh')?.addEventListener('click', refreshSoul);
    document.getElementById('ah-soul-sync-selected')?.addEventListener('click', () => doSoulSync(false));
    document.getElementById('ah-soul-sync-all')?.addEventListener('click', () => doSoulSync(true));

    // budget
    document.getElementById('ah-budget-refresh')?.addEventListener('click', () => refreshBudget());
    document.getElementById('ah-budget-sim')?.addEventListener('click', async () => {
        const ctx = getContext();
        await simulateCurrent(ctx.chat, getMaxBudget());
        pushToast('ok', '已模拟当前');
        renderDiagnostic();
        refreshBudget();
    });

    // diagnostic
    document.getElementById('ah-diag-refresh')?.addEventListener('click', renderDiagnostic);
    document.getElementById('ah-diag-mode')?.addEventListener('change', renderDiagnostic);
    document.getElementById('ah-diag-filter')?.addEventListener('input', () => { clearTimeout(window._ahDiagFilterTimer); window._ahDiagFilterTimer = setTimeout(renderDiagnostic, 300); });
    document.getElementById('ah-diag-capture')?.addEventListener('click', async () => {
        const ctx = getContext();
        const cs = lastContextSize || getMaxBudget();
        await simulateCurrent(ctx.chat, cs);
        renderDiagnostic(); pushToast('ok', '已捕获当前');
    });
    document.getElementById('ah-diag-copy')?.addEventListener('click', async () => {
        const mode = document.getElementById('ah-diag-mode')?.value;
        const data = mode === 'real' ? getLastReal() : getLastPredicted();
        if (!data) { pushToast('warn', '无数据'); return; }
        try { await navigator.clipboard.writeText(JSON.stringify(data, null, 2)); pushToast('ok', '已复制 JSON'); } catch { pushToast('fail', '复制失败'); }
    });
    document.getElementById('ah-diag-export')?.addEventListener('click', () => {
        const mode = document.getElementById('ah-diag-mode')?.value;
        const data = mode === 'real' ? getLastReal() : getLastPredicted();
        if (!data) { pushToast('warn', '无数据'); return; }
        const txt = document.getElementById('ah-diag-list')?.textContent || JSON.stringify(data, null, 2);
        const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `archarness_${mode}_${Date.now()}.txt`; a.click(); URL.revokeObjectURL(url);
    });
    // swipe simulate
    document.getElementById('ah-diag-swipeId')?.addEventListener('change', async () => {
        const mode = document.getElementById('ah-diag-mode')?.value;
        if (mode !== 'swipe') return;
        const id = Number(document.getElementById('ah-diag-swipeId')?.value);
        if (Number.isFinite(id)) {
            const ctx = getContext();
            await simulateSwipe(ctx.chat, lastContextSize || getMaxBudget(), id);
            renderDiagnostic();
        }
    });

    // db health
    document.getElementById('ah-health-refresh')?.addEventListener('click', () => refreshAllHealth(true));
    document.getElementById('ah-health-card-extreme')?.addEventListener('click', async () => {
        const r = await checkExtremeHealth(3000); setHealthCard('extreme', r); pushToast(r.ok ? 'ok' : 'warn', `EXtreme ${r.ok?'在线':'离线'} · ${r.latencyMs}ms ${r.endpoint}`);
    });
    document.getElementById('ah-health-card-vigil')?.addEventListener('click', async () => {
        const r = await checkVigilHealth(3000); setHealthCard('vigil', r); pushToast(r.ok ? 'ok' : 'warn', `ViGil ${r.ok?'在线':'离线'} · ${r.latencyMs}ms ${r.endpoint}`);
    });
    document.getElementById('ah-health-card-fess')?.addEventListener('click', async () => {
        const r = await checkFessHealth(3500); setHealthCard('fess', r); renderFessProbeDetail(r); pushToast(r.ok ? 'ok' : 'warn', `Fess ${r.ok?'在线':'离线'} · ${r.detail}`);
    });

    // db extreme
    document.getElementById('ah-extreme-reload')?.addEventListener('click', () => refreshExtreme());
    document.getElementById('ah-extreme-query')?.addEventListener('click', queryExtremeEvents);
    document.getElementById('ah-extreme-chat')?.addEventListener('change', () => refreshExtreme());
    document.getElementById('ah-extreme-clear')?.addEventListener('click', async () => {
        const cid = document.getElementById('ah-extreme-chat')?.value || getCurrentChatId();
        if (!cid) return;
        if (!confirm(`清空 EXtreme 全部事件 for ${cid} ?`)) return;
        try { await extremeClearChat(cid); pushToast('ok', `已清空 ${cid}`); refreshExtreme(cid); queryExtremeEvents(); } catch (e) { pushToast('fail', e.message); }
    });

    // vigil
    document.getElementById('ah-vigil-refresh')?.addEventListener('click', refreshVigil);

    // fess
    document.getElementById('ah-fess-refresh')?.addEventListener('click', refreshFess);
    document.getElementById('ah-fess-open-board')?.addEventListener('click', () => window.open(fessBoardUrl(), '_blank'));
    document.getElementById('ah-fess-tab-board')?.addEventListener('click', () => openFess('board'));
    document.getElementById('ah-fess-tab-query')?.addEventListener('click', () => openFess('query'));
    document.getElementById('ah-fess-tab-story')?.addEventListener('click', () => openFess('story'));
    document.getElementById('ah-fess-tab-flow')?.addEventListener('click', () => openFess('flow'));

    // llm
    // restore prefs
    const g = s.llm?.groups || { extreme: true, vigil: true, fess: false };
    const ge = document.getElementById('ah-llm-group-extreme'); if (ge) ge.checked = !!g.extreme;
    const gv = document.getElementById('ah-llm-group-vigil'); if (gv) gv.checked = !!g.vigil;
    const gf = document.getElementById('ah-llm-group-fess'); if (gf) gf.checked = !!g.fess;
    const ie = document.getElementById('ah-llm-include-embedding'); if (ie) ie.checked = !!s.llm.includeEmbedding;
    const ir = document.getElementById('ah-llm-include-rerank'); if (ir) ir.checked = !!s.llm.includeRerank;
    if (s.llm?.global) {
        const u = document.getElementById('ah-llm-url'); if (u && s.llm.global.apiUrl) u.value = s.llm.global.apiUrl;
        const k = document.getElementById('ah-llm-key'); if (k && s.llm.global.apiKey) k.value = s.llm.global.apiKey;
        const m = document.getElementById('ah-llm-model'); if (m && s.llm.global.model) m.value = s.llm.global.model;
    }
    document.getElementById('ah-llm-apply')?.addEventListener('click', doLLMApply);
    document.getElementById('ah-llm-test')?.addEventListener('click', doLLMTest);

        // Turbo Max — 三段点：ESR32 → ESR64 → 温柔（循环，15s 气泡 + 温柔红）
    (function bindTurboGentle() {
        const btn = document.getElementById('ah-turbo-max-gentle');
        const bubble = document.getElementById('ah-gentle-bubble');
        if (!btn || !bubble) return;
        let hideTimer = null;
        let fadeTimer = null;
        let step = 0;
        const texts = ['Turbo ESR32', 'Turbo ESR64', '休息一下吧，也对自己温柔一点'];
        function showGentle() {
            btn.classList.add('is-active');
            bubble.textContent = texts[step % texts.length];
            step = (step + 1) % texts.length;
            bubble.classList.add('show');
            bubble.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
            bubble.style.opacity = '';
            if (hideTimer) clearTimeout(hideTimer);
            if (fadeTimer) clearTimeout(fadeTimer);
            // 13s 后开始 2s 淡出，合计 15s
            hideTimer = setTimeout(() => {
                bubble.style.transition = 'opacity 2s ease, transform 2s ease';
                bubble.classList.remove('show');
                fadeTimer = setTimeout(() => {
                    bubble.style.transition = '';
                }, 2050);
            }, 13000);
        }
        function dismissGentle() {
            if (hideTimer) clearTimeout(hideTimer);
            if (fadeTimer) clearTimeout(fadeTimer);
            bubble.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
            bubble.classList.remove('show');
            setTimeout(() => { bubble.style.transition = ''; }, 400);
        }
        btn.addEventListener('click', showGentle);
        btn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showGentle(); }
        });
        bubble.addEventListener('click', dismissGentle);
    })();

    // updater
    const tok = document.getElementById('ah-gh-token'); if (tok) tok.value = s.updater.githubToken || '';
    const ac = document.getElementById('ah-auto-check'); if (ac) { ac.checked = !!s.updater.autoCheck; ac.addEventListener('change', () => { s.updater.autoCheck = !!ac.checked; saveSettingsDebounced(); }); }
    document.getElementById('ah-check-updates')?.addEventListener('click', doCheckUpdates);
    document.getElementById('ah-mark-seen')?.addEventListener('click', () => { try { const wrap = document.getElementById('ah-updater-results'); markAllSeen([...wrap.querySelectorAll('.ah-card')].map(()=>({which:'extreme'}))); } catch {}; pushToast('ok','已标为已读 (本地)'); });

    // initial refreshes
    try { refreshBudget(); } catch {}
    try { refreshSoul(); } catch {}
    try { refreshExtreme(); } catch {}
    try { refreshVigil(); } catch {}
    try { refreshFess(); } catch {}
    try { refreshAllHealth(false, false); } catch {}
    // 优雅轮询：仅在 数据库 Tab 可见时静默刷新，成功 60s / 失败 20s，无闪烁
    try { scheduleHealthPoll(60000); } catch {}
    try {
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && isDbVisible() && Date.now() - _healthLastTs > 15000) refreshAllHealth(false, true);
        });
    } catch {}
    try { refreshLLMSnapshot(); } catch {}
    renderDiagnostic();

    if (s.updater?.autoCheck) {
        setTimeout(doCheckUpdates, 2000);
    }
    setStatus(s.enabled ? '就绪' : '已停用', s.enabled);
    log('ArcHarness ready');
}

function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve) => {
        const el = document.querySelector(selector);
        if (el) return resolve(el);
        const started = Date.now();
        const timer = setInterval(() => {
            const found = document.querySelector(selector);
            if (found || Date.now() - started > timeout) {
                clearInterval(timer);
                resolve(found || null);
            }
        }, 200);
    });
}

async function loadAndInit() {
    ensureSettings();
    try {
        const html = await renderExtensionTemplateAsync('third-party/ArcHarness', 'settings');
        const container = await waitForElement('#extensions_settings2');
        if (!container) throw new Error('#extensions_settings2 不存在');
        if (typeof html === 'string') container.insertAdjacentHTML('beforeend', html);
        else container.appendChild(html);
    } catch (e) {
        console.warn('[ArcHarness] template load fail', e);
        const target = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
        if (target && !document.getElementById('archarness-panel')) {
            try {
                const resp = await fetch('/scripts/extensions/third-party/ArcHarness/settings.html');
                const html2 = await resp.text();
                target.insertAdjacentHTML('beforeend', html2);
            } catch {}
        }
    }
    setTimeout(initUI, 400);
}

(async function init() {
    await loadAndInit();
    eventSource.on(event_types.CHAT_CHANGED, () => {
        try { refreshExtreme(getCurrentChatId()); refreshBudget(); } catch {}
    });
})();
