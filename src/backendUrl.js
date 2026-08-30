import { SETTINGS_KEY } from './config.js';

function resolveOne(raw, fallbackPort) {
    let u = String(raw || '').trim();
    if (!u) {
        const pageHost = window.location.hostname;
        if (pageHost && pageHost !== '' && pageHost !== '127.0.0.1' && pageHost !== 'localhost') {
            return `http://${pageHost}:${fallbackPort}`;
        }
        return `http://127.0.0.1:${fallbackPort}`;
    }
    u = u.replace(/\/+$/, '');
    try {
        const pageHost = window.location.hostname;
        const backendHost = new URL(u).hostname;
        if ((backendHost === '127.0.0.1' || backendHost === 'localhost') && pageHost && pageHost !== '127.0.0.1' && pageHost !== 'localhost' && pageHost !== '') {
            const fixed = u.replace(backendHost, pageHost);
            console.warn(`[ArcHarness] backend auto-fix ${u} -> ${fixed} (${pageHost})`);
            return fixed;
        }
    } catch {}
    return u;
}

export function getBackends() {
    const s = window.extension_settings?.[SETTINGS_KEY];
    const b = s?.backend || {};
    return {
        extreme: resolveOne(b.extreme, 9001),
        vigil: resolveOne(b.vigil, 9000),
        fess: resolveOne(b.fess, 8999),
    };
}

export function getBackend(which) {
    return getBackends()[which];
}

export async function pingBackend(which, timeoutMs = 2500) {
    const base = getBackend(which);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const r = await fetch(`${base}/api/status`, { signal: ctrl.signal }).catch(() => fetch(`${base}/api/souls`, { signal: ctrl.signal }).catch(() => null));
        clearTimeout(t);
        if (!r) return { ok: false, base, status: 0 };
        return { ok: r.ok, base, status: r.status };
    } catch (e) {
        clearTimeout(t);
        return { ok: false, base, error: e.message };
    }
}
