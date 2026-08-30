// ArcHarness config & defaults
export const EXTENSION_NAME = 'ArcHarness';
export const SETTINGS_KEY = 'archarness';

export function defaultSettings() {
    return {
        enabled: true,
        debug: false,
        backend: {
            extreme: 'http://127.0.0.1:9001',
            vigil: 'http://127.0.0.1:9000',
            fess: 'http://127.0.0.1:8999',
        },
        soul: {
            autoSync: false,
            lastSync: 0,
        },
        llm: {
            includeEmbedding: false,
            includeRerank: false,
            groups: { extreme: true, vigil: true, fess: false },
            global: { apiUrl: '', apiKey: '', model: '' },
        },
        budget: {
            enabled: true,
            warnThreshold: 85,
        },
        diagnostic: {
            keepLast: 2,
            captureFetch: true,
        },
        updater: {
            autoCheck: false,
            githubToken: '',
        },
    };
}

export function mergeDefaults(target, defaults) {
    if (!target || typeof target !== 'object') return structuredClone(defaults);
    for (const k of Object.keys(defaults)) {
        const dv = defaults[k];
        if (dv && typeof dv === 'object' && !Array.isArray(dv)) {
            if (!target[k] || typeof target[k] !== 'object') target[k] = {};
            mergeDefaults(target[k], dv);
        } else if (!(k in target)) {
            target[k] = Array.isArray(dv) ? structuredClone(dv) : dv;
        }
    }
    // sanitize legacy
    if (target.backend && !target.backend.fess) target.backend.fess = 'http://127.0.0.1:8999';
    if (target.llm && target.llm.groups === undefined) target.llm.groups = { extreme: true, vigil: true, fess: false };
    if (target.llm && target.llm.includeEmbedding === undefined) target.llm.includeEmbedding = false;
    return target;
}

// SillyTavern budget source map: oai_settings.openai_max_context is screenshot 120000
export const GITHUB_REPOS = {
    extreme: { owner: 'kerjc4464', repo: 'ArcEXtreme', branch: 'master', localKey: 'arcextreme' },
    fess: { owner: 'kerjc4464', repo: 'ArcFess', branch: 'main', localKey: 'vectors_enhanced' },
    vigil: { owner: 'kerjc4464', repo: 'ArcViGil', branch: 'master', localKey: 'ArcViGil' },
};
