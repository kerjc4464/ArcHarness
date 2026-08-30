// Soul 统筹: EXtreme 主 → ViGil 镜像 (单向)
import { getBackend } from './backendUrl.js';

function fnameToName(fname) {
    const i = fname.lastIndexOf('.');
    return i > 0 ? fname.slice(0, i) : fname;
}

async function fetchJson(url, opts = {}) {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('application/json')) return r.json();
    return r.text();
}

export async function listExtreme() {
    const base = getBackend('extreme');
    // EXtreme supports /api/souls full with enabled_map
    try {
        const data = await fetchJson(`${base}/api/souls`);
        const souls = data.souls || [];
        const enabledMap = data.enabled_map || data.enabled || {};
        return { souls, enabledMap, base };
    } catch (e) {
        return { souls: [], enabledMap: {}, base, error: e.message };
    }
}

export async function listVigil() {
    const base = getBackend('vigil');
    try {
        const data = await fetchJson(`${base}/api/souls`);
        const souls = data.souls || data || [];
        // ViGil returns flat array without enabled
        return { souls: Array.isArray(souls) ? souls : [], base };
    } catch (e) {
        return { souls: [], base, error: e.message };
    }
}

export async function getSoulContent(which, filename) {
    const base = getBackend(which);
    const r = await fetch(`${base}/api/souls/${encodeURIComponent(filename)}`);
    if (!r.ok) throw new Error(`get ${filename} -> ${r.status}`);
    return r.text();
}

// diff by name
export function buildDiff(extremeData, vigilData) {
    const eMap = new Map();
    for (const s of (extremeData.souls || [])) {
        const name = s.name || fnameToName(s.filename);
        eMap.set(name, s);
    }
    const vMap = new Map();
    for (const s of (vigilData.souls || [])) {
        const name = s.name || fnameToName(s.filename);
        vMap.set(name, s);
    }
    const allNames = new Set([...eMap.keys(), ...vMap.keys()]);
    const rows = [];
    for (const name of allNames) {
        const e = eMap.get(name);
        const v = vMap.get(name);
        let state = 'unknown';
        if (e && v) state = 'both';
        else if (e && !v) state = 'only_extreme';
        else if (!e && v) state = 'only_vigil';
        // size check if both, compare size_bytes if available
        let note = '';
        if (state === 'both') {
            const es = e.size_bytes ?? e.size ?? null;
            const vs = v.size_bytes ?? v.size ?? null;
            if (es != null && vs != null && es !== vs) note = `size diff ${es}↔${vs}`;
        }
        rows.push({ name, extreme: e, vigil: v, state, note });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
}

// 单向同步: EXtreme filename -> ViGil
// ViGil 无写接口, 需走 ST 文件代理或 Harness 代理。
// Phase1: 尝试 POST :9000/api/souls/write, 失败则提示手动
export async function syncOneToVigil(name, extremeSoul) {
    const vigilBase = getBackend('vigil');
    const extremeBase = getBackend('extreme');
    const filename = extremeSoul.filename || `${name}.md`;
    let content;
    try {
        content = await getSoulContent('extreme', filename);
    } catch (e) {
        throw new Error(`读取 EXtreme ${filename} 失败: ${e.message}`);
    }
    // try known write endpoints
    const tryEndpoints = [
        { url: `${vigilBase}/api/souls/write`, method: 'POST', body: { filename, content, name } },
        { url: `${vigilBase}/api/souls/${encodeURIComponent(filename)}`, method: 'PUT', body: content, isText: true },
        { url: `${vigilBase}/api/souls`, method: 'POST', body: { filename, content } },
    ];
    let lastErr = null;
    for (const ep of tryEndpoints) {
        try {
            const opts = { method: ep.method, headers: {} };
            if (ep.isText) {
                opts.headers['Content-Type'] = 'text/plain; charset=utf-8';
                opts.body = content;
            } else {
                opts.headers['Content-Type'] = 'application/json';
                opts.body = JSON.stringify(ep.body);
            }
            const r = await fetch(ep.url, opts);
            if (r.ok) return { ok: true, endpoint: ep.url };
            lastErr = `${ep.url} -> ${r.status} ${await r.text().catch(() => '')}`;
        } catch (e) {
            lastErr = `${ep.url} -> ${e.message}`;
        }
    }
    // fallback: 给用户可复制路径
    return { ok: false, error: lastErr || 'ViGil 后端无写接口', content, filename, vigilBase, extremeBase };
}

export async function syncManyToVigil(names, diffRows) {
    const map = new Map(diffRows.map(r => [r.name, r]));
    const results = [];
    for (const n of names) {
        const row = map.get(n);
        if (!row || !row.extreme) {
            results.push({ name: n, ok: false, error: '无 EXtreme 源文件' });
            continue;
        }
        try {
            const r = await syncOneToVigil(n, row.extreme);
            results.push({ name: n, ...r });
        } catch (e) {
            results.push({ name: n, ok: false, error: e.message });
        }
    }
    return results;
}
