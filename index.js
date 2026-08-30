// @ts-nocheck
import { eventSource, event_types, getCurrentChatId, saveSettingsDebounced, extension_prompt_types } from '../../../../script.js';
import { extension_settings, getContext, renderExtensionTemplateAsync } from '../../../extensions.js';
import { SETTINGS_KEY, defaultSettings, mergeDefaults } from './src/config.js';
import { getBackends, getBackend } from './src/backendUrl.js';
import { listExtreme, listVigil, buildDiff, syncManyToVigil } from './src/soulHub.js';
import { extremeStatus, extremeChats, extremeEvents, extremeShortPool, extremeDeleteEvent, extremeClearChat, extremeSetCounter, vigilTasks, vigilMessages, fessStatus, fessTasksStats, fessBoardUrl, fessQueryLabUrl, fessStoryMapUrl, fessFlowLabUrl } from './src/dbViewer.js';
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
                tr.innerHTML = `<td><input type="checkbox" class="ah-soul-check" data-name="${r.name}" ${r.state !== 'both' || r.note ? 'checked' : ''} /></td><td>${r.name} ${enabled === false ? '<small style="color:#f87171;">(禁用)</small>' : ''}</td><td>${badge}</td><td>${r.extreme ? (r.extreme.filename + (r.extreme.size_bytes ? ` ${r.extreme.size_bytes}B` : '')) : '-'}</td><td>${r.vigil ? r.vigil.filename : '-'}</td><td>${r.note || ''}</td>`;
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

// DB Extreme
let extremeChatCache = [];
async function refreshExtreme(dbChatId) {
    const statusEl = document.getElementById('ah-extreme-status');
    const chatSel = document.getElementById('ah-extreme-chat');
    try {
        const st = await extremeStatus();
        if (statusEl) statusEl.textContent = st.error ? `离线 ${st.error}` : `在线 ${st.count ?? ''}条`;
        if (st.error) statusEl.className = 'ah-badge warn'; else statusEl.className = 'ah-badge ok';
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
    } catch {}
    // short pool
    const cid = dbChatId || document.getElementById('ah-extreme-chat')?.value || getCurrentChatId();
    if (cid) {
        try {
            const sp = await extremeShortPool(cid, 15);
            const el = document.getElementById('ah-extreme-shortpool');
            if (el) {
                if (sp.error) el.textContent = `ShortPool 拉取失败: ${sp.error}`;
                else {
                    const pools = sp.pools || {};
                    const count = sp.count ?? (sp.events ? sp.events.length : 0);
                    let html = `<b>短期池 ${count} 条 (perSoulCap 15)</b><div style="margin-top:4px;">`;
                    for (const [soul, items] of Object.entries(pools)) {
                        html += `<div style="margin-top:6px; font-weight:600;">${soul} (${items.length})</div>`;
                        for (const it of items.slice(0, 8)) {
                            html += `<div style="display:flex; gap:6px; align-items:center; margin:2px 0;"><span class="ah-badge">${it.counter ?? '?'} ${['强拒','弱拒','弱接','强接'][it.counter]||''}</span><span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${String(it.event_text || it.event || '').slice(0, 80)}</span><select data-eid="${it.id}" data-soul="${it.pool_soul||it.soul}" class="ah-select ah-counter-edit" style="width:90px;"><option value="0" ${it.counter==0?'selected':''}>0强拒</option><option value="1" ${it.counter==1?'selected':''}>1弱拒</option><option value="2" ${it.counter==2?'selected':''}>2弱接</option><option value="3" ${it.counter==3?'selected':''}>3强接</option></select></div>`;
                        }
                    }
                    html += `</div>`;
                    el.innerHTML = html;
                    el.querySelectorAll('.ah-counter-edit').forEach(sel => {
                        sel.addEventListener('change', async (e) => {
                            const eid = e.target.getAttribute('data-eid');
                            const soul = e.target.getAttribute('data-soul');
                            const target = Number(e.target.value);
                            try {
                                pushToast('info', `设置 ${soul}#${eid} -> ${target}...`);
                                const res = await extremeSetCounter(cid, eid, soul, target, 'Harness manual edit');
                                pushToast('ok', `已更新 ${res.count ?? ''} 条`);
                                refreshExtreme(cid);
                            } catch (err) { pushToast('fail', `更新失败: ${err.message}`); }
                        });
                    });
                }
            }
        } catch {}
    }
}

async function queryExtremeEvents() {
    const cid = document.getElementById('ah-extreme-chat')?.value || getCurrentChatId();
    if (!cid) { pushToast('warn', '请选择 chat_id'); return; }
    const soul = document.getElementById('ah-extreme-soul-filter')?.value || '';
    const counter = document.getElementById('ah-extreme-counter-filter')?.value;
    const limit = Number(document.getElementById('ah-extreme-limit')?.value) || 50;
    const out = document.getElementById('ah-extreme-events');
    if (out) out.textContent = '查询中...';
    try {
        const evs = await extremeEvents(cid, { with_counters: 1, soul: soul || undefined, counter: counter !== '' ? counter : undefined, limit });
        if (evs.error) { if (out) out.textContent = `错误: ${evs.error}`; return; }
        if (!Array.isArray(evs) || !evs.length) { if (out) out.textContent = '无结果'; return; }
        let html = '';
        for (const e of evs) {
            html += `id:${e.id} [${e.time_bucket||''}] counter:${e.counter ?? '-'} souls:${(e.souls_str||e.souls||'').toString()} \n${e.event_text || e.event || ''}\n---\n`;
        }
        // also render with delete buttons via DOM
        if (out) {
            out.textContent = '';
            for (const e of evs) {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex; gap:6px; align-items:flex-start; border-bottom:1px solid rgba(255,255,255,0.06); padding:6px 0;';
                row.innerHTML = `<div style="flex:1; white-space:pre-wrap; word-break:break-all; font-size:11px;">id:${e.id} [${e.time_bucket||''}] c:${e.counter ?? '-'} souls:${(e.souls_str||JSON.stringify(e.souls)||'').toString().slice(0,80)}\n${String(e.event_text||'').slice(0,600)}</div><div class="ah-btn secondary" style="padding:4px 6px; font-size:11px;">删</div>`;
                const btn = row.querySelector('.ah-btn');
                btn.addEventListener('click', async () => {
                    if (!confirm(`删除事件 ${e.id} ?`)) return;
                    try { await extremeDeleteEvent(e.id); pushToast('ok', `已删 ${e.id}`); queryExtremeEvents(); } catch (err) { pushToast('fail', err.message); }
                });
                out.appendChild(row);
            }
        }
    } catch (e) { if (out) out.textContent = `查询失败: ${e.message}`; }
}

// ViGil
async function refreshVigil() {
    const tasksEl = document.getElementById('ah-vigil-tasks');
    const msgsEl = document.getElementById('ah-vigil-messages');
    if (tasksEl) tasksEl.textContent = '加载中...';
    try {
        const t = await vigilTasks();
        if (tasksEl) tasksEl.textContent = JSON.stringify(t, null, 2).slice(0, 8000);
    } catch (e) { if (tasksEl) tasksEl.textContent = `失败: ${e.message}`; }
    try {
        const m = await vigilMessages(5, 0);
        if (msgsEl) msgsEl.textContent = JSON.stringify(m, null, 2).slice(0, 8000);
    } catch (e) { if (msgsEl) msgsEl.textContent = `失败: ${e.message}`; }
}

// Fess
async function refreshFess() {
    const statusEl = document.getElementById('ah-fess-status');
    const statsEl = document.getElementById('ah-fess-stats');
    try {
        const st = await fessStatus();
        if (statusEl) { statusEl.textContent = st.ok ? `在线 ${st.endpoint}` : `离线`; statusEl.className = 'ah-badge ' + (st.ok ? 'ok' : 'warn'); }
        const stats = await fessTasksStats();
        if (statsEl) statsEl.textContent = JSON.stringify(stats, null, 2).slice(0, 6000);
    } catch (e) {
        if (statusEl) { statusEl.textContent = '失败'; statusEl.className = 'ah-badge warn'; }
        if (statsEl) statsEl.textContent = e.message;
    }
}
function openFess(which) {
    const map = { board: fessBoardUrl(), query: fessQueryLabUrl(), story: fessStoryMapUrl(), flow: fessFlowLabUrl() };
    const url = map[which] || map.board;
    const iframe = document.getElementById('ah-fess-iframe');
    if (iframe) iframe.src = url;
    // also allow new window
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

    // db extreme
    document.getElementById('ah-extreme-reload')?.addEventListener('click', () => refreshExtreme());
    document.getElementById('ah-extreme-query')?.addEventListener('click', queryExtremeEvents);
    document.getElementById('ah-extreme-chat')?.addEventListener('change', () => refreshExtreme());
    document.getElementById('ah-extreme-clear')?.addEventListener('click', async () => {
        const cid = document.getElementById('ah-extreme-chat')?.value || getCurrentChatId();
        if (!cid) return;
        if (!confirm(`清空 EXtreme 全部事件 for ${cid} ?`)) return;
        try { await extremeClearChat(cid); pushToast('ok', `已清空 ${cid}`); refreshExtreme(cid); } catch (e) { pushToast('fail', e.message); }
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
