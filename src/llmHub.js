// LLM 批量分组更新 — 插件分组 + Embedding 默认隔离
import { extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';

// 映射元数据：描述如何从 extension_settings 读写
export const LLM_GROUPS = {
    extreme: {
        label: 'ArcEXtreme',
        settingsKey: 'arcextreme',
        // path within extension_settings[arcextreme]
        llmPaths: [
            { path: 'extractLLM', label: '事件提取' },
            { path: 'routeLLM', label: '路由' },
            { path: 'subAgentLLM', label: 'SubAgent 裁判' },
            { path: 'sublimationLLM', label: '升华' },
        ],
        embeddingPaths: [
            { path: 'embedding', label: 'Embedding' },
        ],
        rerankPaths: [
            { path: 'rerank', label: 'Rerank' },
        ],
    },
    vigil: {
        label: 'ArcViGil',
        settingsKey: 'ArcViGil',
        llmPaths: [
            { path: null, label: '主LLM', fields: ['apiUrl', 'apiKey', 'apiModel'] },
            { path: null, label: '摘要LLM', fields: ['summaryApiUrl','summaryApiKey','summaryApiModel'] },
        ],
        embeddingPaths: [],
        rerankPaths: [],
    },
    fess: {
        label: 'ArcFess',
        settingsKey: 'vectors_enhanced',
        llmPaths: [
            { path: null, label: 'ThoughtEngine', fields: ['thought_engine_url','thought_engine_key','thought_engine_model','thought_engine_step1_url','thought_engine_step1_key','thought_engine_step2_url','thought_engine_step2_key','thought_engine_step3_url','thought_engine_step3_key'] },
            { path: null, label: 'Summary/Compression', fields: ['compression_url','compression_key','compression_model'] },
            { path: null, label: 'OpenAI 直连', fields: ['openai_url','openai_key'] },
        ],
        embeddingPaths: [
            { path: null, label: 'Vector Source', fields: ['vllm_url','vllm_key','vllm_model','embedding_provider','embedding_model'] },
        ],
        rerankPaths: [
            { path: null, label: 'Rerank', fields: ['rerank_url','rerank_key','rerank_model'] },
        ],
    },
};

function getByPath(obj, path) {
    if (!path) return obj;
    return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
}
function setByPath(obj, path, value) {
    if (!path) Object.assign(obj, value);
    else {
        const parts = path.split('.');
        const last = parts.pop();
        const parent = parts.reduce((o, k) => (o[k] = o[k] || {}), obj);
        parent[last] = value;
    }
}

export function readExtremeLLMConfig() {
    const s = extension_settings[LLM_GROUPS.extreme.settingsKey];
    if (!s) return null;
    return s;
}

export function applyBulk({ groups, includeEmbedding, includeRerank, globalUrl, globalKey, globalModel }) {
    const results = [];
    for (const gKey of Object.keys(LLM_GROUPS)) {
        if (!groups[gKey]) continue;
        const meta = LLM_GROUPS[gKey];
        const settings = extension_settings[meta.settingsKey];
        if (!settings) { results.push({ group: gKey, ok: false, error: '未加载' }); continue; }
        try {
            // LLM
            for (const p of meta.llmPaths) {
                if (!globalUrl && !globalKey && !globalModel) continue;
                if (p.path) {
                    const tgt = getByPath(settings, p.path);
                    if (!tgt) continue;
                    if (globalUrl) tgt.apiUrl = globalUrl;
                    if (globalKey) tgt.apiKey = globalKey;
                    if (globalModel) tgt.model = globalModel;
                } else if (p.fields) {
                    for (const f of p.fields) {
                        if (f.toLowerCase().includes('url') && globalUrl) settings[f] = globalUrl;
                        else if (f.toLowerCase().includes('key') && globalKey) settings[f] = globalKey;
                        else if (f.toLowerCase().includes('model') && globalModel) settings[f] = globalModel;
                    }
                }
            }
            // embedding
            if (includeEmbedding) {
                for (const p of meta.embeddingPaths) {
                    if (p.path) {
                        const tgt = getByPath(settings, p.path);
                        if (!tgt) continue;
                        if (globalUrl) tgt.apiUrl = globalUrl;
                        if (globalKey) tgt.apiKey = globalKey;
                        if (globalModel) tgt.model = globalModel;
                    } else if (p.fields) {
                        for (const f of p.fields) {
                            if (f.toLowerCase().includes('url') && globalUrl) settings[f] = globalUrl;
                            else if (f.toLowerCase().includes('key') && globalKey) settings[f] = globalKey;
                            else if (f.toLowerCase().includes('model') && globalModel) settings[f] = globalModel;
                        }
                    }
                }
            }
            // rerank
            if (includeRerank) {
                for (const p of meta.rerankPaths) {
                    if (p.path) {
                        const tgt = getByPath(settings, p.path);
                        if (!tgt) continue;
                        if (globalUrl) tgt.apiUrl = globalUrl;
                        if (globalKey) tgt.apiKey = globalKey;
                        if (globalModel) tgt.model = globalModel;
                    } else if (p.fields) {
                        for (const f of p.fields) {
                            if (f.toLowerCase().includes('url') && globalUrl) settings[f] = globalUrl;
                            else if (f.toLowerCase().includes('key') && globalKey) settings[f] = globalKey;
                            else if (f.toLowerCase().includes('model') && globalModel) settings[f] = globalModel;
                        }
                    }
                }
            }
            results.push({ group: gKey, ok: true });
        } catch (e) {
            results.push({ group: gKey, ok: false, error: e.message });
        }
    }
    try { saveSettingsDebounced(); } catch {}
    return results;
}

export async function testOne(groupKey) {
    // dispatch to backend test endpoints
    try {
        if (groupKey === 'vigil') {
            const s = extension_settings['ArcViGil'];
            if (!s) return { ok: false, error: 'ViGil 未加载' };
            const base = s.backendUrl || 'http://127.0.0.1:9000';
            const r = await fetch(`${base.replace(/\/+$/, '')}/api/test_llm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiUrl: s.apiUrl, apiKey: s.apiKey, apiModel: s.apiModel }) });
            const j = await r.json();
            return { ok: j.status === 'ok', data: j };
        }
        if (groupKey === 'extreme') {
            const s = extension_settings['arcextreme'];
            if (!s || !s.extractLLM?.apiUrl) return { ok: false, error: 'EXtreme LLM 未配置' };
            const { extractLLM } = s;
            const base = (s.backendUrl || 'http://127.0.0.1:9001').replace(/\/+$/, '');
            const r = await fetch(`${base}/api/llm_proxy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiUrl: extractLLM.apiUrl, apiKey: extractLLM.apiKey, model: extractLLM.model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5 }) });
            if (!r.ok) return { ok: false, error: `proxy ${r.status}` };
            const j = await r.json();
            return { ok: true, data: j };
        }
        if (groupKey === 'fess') {
            return { ok: false, error: 'Fess 无统一 test 端点，请在面板内单独测试' };
        }
    } catch (e) { return { ok: false, error: e.message }; }
    return { ok: false, error: 'unknown group' };
}

export function getCurrentSnapshot() {
    const out = {};
    for (const [k, meta] of Object.entries(LLM_GROUPS)) {
        const s = extension_settings[meta.settingsKey];
        if (!s) { out[k] = null; continue; }
        out[k] = JSON.parse(JSON.stringify(s));
    }
    return out;
}
