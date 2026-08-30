import { extension_settings, getContext } from '../../../../extensions.js';
import { getTokenCountAsync } from '../../../../tokenizers.js';
import { getExtensionPrompt, extension_prompt_types } from '../../../../../script.js';
import { oai_settings } from '../../../../openai.js';

// budget source = oai_settings.openai_max_context (screenshot 120000)
export function getMaxBudget() {
    try {
        const v = Number(oai_settings?.openai_max_context);
        if (Number.isFinite(v) && v > 0) return v;
    } catch {}
    try {
        const alt = Number(document.getElementById('openai_max_context')?.value);
        if (Number.isFinite(alt) && alt > 0) return alt;
    } catch {}
    return 8192;
}

export async function collectInjectionTokens() {
    const types = [extension_prompt_types.IN_CHAT, extension_prompt_types.IN_PROMPT, extension_prompt_types.BEFORE_PROMPT];
    const breakdown = [];
    let total = 0;
    for (const type of types) {
        try {
            const txt = await getExtensionPrompt(type);
            const t = txt ? await getTokenCountAsync(txt, 0) : 0;
            // also per-extension breakdown via extension_prompts global
            breakdown.push({ type: String(type), tokens: t, preview: String(txt || '').slice(0, 120) });
            total += t;
        } catch { breakdown.push({ type: String(type), tokens: 0, error: true }); }
    }
    // per extension key via global extension_prompts
    const perExt = [];
    try {
        const extPrompts = (window.extension_prompts || window['extension_prompts'] || {});
        for (const [key, obj] of Object.entries(extPrompts)) {
            if (!obj || !obj.value) continue;
            const t = await getTokenCountAsync(String(obj.value), 0).catch(() => 0);
            perExt.push({ key, tokens: t, role: obj.role, depth: obj.depth, type: obj.type });
            // total already counted but perExt useful for chart
        }
    } catch {}
    // arc-specific filter
    const arcKeys = ['arcextreme_mem', 'arcextreme_sublimated_', '3_vectors_enhanced', 'vectors_enhanced'];
    const arcSubset = perExt.filter(x => arcKeys.some(k => x.key.includes(k)));
    return { total, breakdown, perExt, arcSubset };
}

export async function collectChatTokens(chat) {
    try {
        const ctx = getContext();
        const ch = chat || ctx.chat || [];
        const text = ch.map(m => String(m.mes || '')).join('\n');
        const t = await getTokenCountAsync(text, 0).catch(() => 0);
        return t;
    } catch { return 0; }
}

export async function getBudgetSnapshot(chat, contextSize) {
    const max = Number(contextSize) > 0 ? Number(contextSize) : getMaxBudget();
    const chatTokens = await collectChatTokens(chat);
    const inj = await collectInjectionTokens();
    const remaining = Math.max(0, max - chatTokens - inj.total);
    const usedPct = max > 0 ? ((chatTokens + inj.total) / max) * 100 : 0;
    const injectionPct = max > 0 ? (inj.total / max) * 100 : 0;
    return {
        max, chatTokens, injectionTokens: inj.total, remaining, usedPct, injectionPct,
        breakdown: inj.breakdown,
        perExt: inj.perExt,
        arcSubset: inj.arcSubset,
        ts: Date.now(),
    };
}
