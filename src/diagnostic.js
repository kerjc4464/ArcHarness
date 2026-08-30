// 双轨诊断: fetch 劫持抓真实 + generate_interceptor 抓预测
import { extension_prompt_types, extension_prompt_roles } from '../../../../../script.js';
import { getExtensionPrompt } from '../../../../../script.js';
import { getTokenCountAsync } from '../../../../tokenizers.js';

const STORAGE_KEY = 'archarness_diagnostic';
const MAX_KEEP = 5;

function safeJsonParse(s, fallback = null) { try { return JSON.parse(s); } catch { return fallback; } }

export const diagnosticStore = {
    lastReal: null, // from fetch
    lastPredicted: null, // from interceptor
    history: [], // array of {ts, type, data}
};

function pushHistory(entry) {
    diagnosticStore.history.unshift(entry);
    if (diagnosticStore.history.length > MAX_KEEP * 2) diagnosticStore.history.length = MAX_KEEP * 2;
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(diagnosticStore)); } catch {}
}
export function loadStore() {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (raw) {
            const d = safeJsonParse(raw);
            if (d) Object.assign(diagnosticStore, d);
        }
    } catch {}
}

// --- Fetch monkey patch ---
let originalFetch = null;
let fetchPatched = false;

export function installFetchPatch() {
    if (fetchPatched) return;
    if (!window.fetch) return;
    originalFetch = window.fetch.bind(window);
    window.fetch = async function(input, init) {
        const url = typeof input === 'string' ? input : input?.url || '';
        const method = (init?.method || (typeof input !== 'string' ? input?.method : 'GET') || 'GET').toUpperCase();
        // capture before
        let bodyText = null;
        let bodyJson = null;
        if (method === 'POST' && url.includes('/api/') && (url.includes('chat/completions') || url.includes('/v1/chat') || url.includes('generate') || url.includes('openai'))) {
            try {
                if (init?.body) {
                    bodyText = typeof init.body === 'string' ? init.body : null;
                    if (bodyText) {
                        bodyJson = safeJsonParse(bodyText);
                        // ST sends {messages:[...]} or {prompt:...}
                        if (bodyJson && (bodyJson.messages || bodyJson.prompt || bodyJson.input)) {
                            const entry = {
                                ts: Date.now(),
                                type: 'fetch_real',
                                url,
                                body: bodyJson,
                                messages: bodyJson.messages || null,
                                prompt: bodyJson.prompt || null,
                            };
                            diagnosticStore.lastReal = entry;
                            pushHistory(entry);
                        }
                    }
                }
            } catch {}
        }
        const res = await originalFetch(input, init);
        // also capture response for token usage if present
        try {
            if (bodyJson && url.includes('/api/') && method === 'POST') {
                res.clone().json().then(j => {
                    if (j && (j.usage || j.choices)) {
                        diagnosticStore.lastReal.usage = j.usage || null;
                        diagnosticStore.lastReal.responsePreview = JSON.stringify(j).slice(0, 2000);
                        try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(diagnosticStore)); } catch {}
                    }
                }).catch(() => {});
            }
        } catch {}
        return res;
    };
    fetchPatched = true;
    console.log('[ArcHarness] fetch patch installed (real prompt capture)');
}

export function uninstallFetchPatch() {
    if (!fetchPatched || !originalFetch) return;
    window.fetch = originalFetch;
    fetchPatched = false;
}

// --- predicted capture via generate_interceptor ---
export async function capturePredicted(chat, contextSize, type) {
    const ts = Date.now();
    const allPrompts = {};
    // capture all known extension_prompts values
    try {
        const extPrompts = window.extension_prompts || {};
        for (const [k, v] of Object.entries(extPrompts)) {
            allPrompts[k] = {
                value: String(v.value || '').slice(0, 8000),
                fullLen: String(v.value || '').length,
                role: v.role,
                depth: v.depth,
                type: v.type,
            };
        }
    } catch {}
    // capture via getExtensionPrompt for types
    const byType = {};
    for (const t of [extension_prompt_types.IN_CHAT, extension_prompt_types.IN_PROMPT, extension_prompt_types.BEFORE_PROMPT]) {
        try {
            const txt = await getExtensionPrompt(t);
            byType[String(t)] = (txt || '').slice(0, 12000);
        } catch { byType[String(t)] = ''; }
    }
    // chat preview (last 3 msgs)
    const chatPreview = (chat || []).slice(-3).map(m => ({ name: m.name, is_user: m.is_user, mes: String(m.mes || '').slice(0, 600) }));
    const entry = {
        ts, type: 'predicted',
        contextSize,
        genType: type,
        chatLen: (chat || []).length,
        chatPreview,
        extensionPrompts: allPrompts,
        byType,
    };
    // token counts for top prompts
    try {
        for (const [k, v] of Object.entries(allPrompts)) {
            const t = await getTokenCountAsync(String(v.value || ''), 0).catch(() => 0);
            v.tokens = t;
        }
    } catch {}
    diagnosticStore.lastPredicted = entry;
    pushHistory(entry);
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(diagnosticStore)); } catch {}
    return entry;
}

// Simulated: re-run capture for swipe / current
export async function simulateCurrent(chat, contextSize) {
    return capturePredicted(chat, contextSize, 'simulate_current');
}
export async function simulateSwipe(chat, contextSize, swipeId) {
    const sliced = Array.isArray(chat) ? chat.slice(0, Math.max(0, swipeId + 1)) : chat;
    const e = await capturePredicted(sliced, contextSize, 'simulate_swipe');
    e.swipeId = swipeId;
    return e;
}

export function getLastReal() { return diagnosticStore.lastReal; }
export function getLastPredicted() { return diagnosticStore.lastPredicted; }
export function getHistory() { return diagnosticStore.history; }

// filter helper
export function filterPrompts(prompts, query) {
    if (!query) return prompts;
    const q = query.toLowerCase();
    const out = {};
    for (const [k, v] of Object.entries(prompts)) {
        const hay = `${k} ${String(v.value||'')} ${String(v.role||'')}`.toLowerCase();
        if (hay.includes(q)) out[k] = v;
    }
    return out;
}
