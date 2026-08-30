import { GITHUB_REPOS } from './config.js';
import { getExtensionManifest } from '../../../../extensions.js';

async function ghFetch(url, token) {
    const headers = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'ArcHarness' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`GH ${r.status} ${url}`);
    return r.json();
}

export async function checkOne(which, token) {
    const meta = GITHUB_REPOS[which];
    if (!meta) return { which, ok: false, error: 'unknown repo' };
    // local version from manifest
    let localVersion = '?';
    let localSha = null;
    try {
        const mf = getExtensionManifest(meta.localKey) || getExtensionManifest(meta.repo);
        if (mf) localVersion = mf.version || '?';
    } catch {}
    try {
        localSha = localStorage.getItem(`archarness_lastSha_${which}`) || null;
    } catch {}
    // remote: latest commit
    const commitsUrl = `https://api.github.com/repos/${meta.owner}/${meta.repo}/commits?per_page=1&sha=${meta.branch}`;
    try {
        const data = await ghFetch(commitsUrl, token);
        const commit = Array.isArray(data) ? data[0] : data;
        const sha = commit?.sha || '';
        const shortSha = sha.slice(0, 7);
        const date = commit?.commit?.committer?.date || commit?.commit?.author?.date || '';
        const msg = commit?.commit?.message || '';
        const isNew = localSha ? (localSha !== sha) : true;
        // store
        try { localStorage.setItem(`archarness_lastSha_${which}_remote`, sha); } catch {}
        return {
            which, ok: true,
            owner: meta.owner, repo: meta.repo, branch: meta.branch,
            localVersion, localSha, remoteSha: sha, shortSha, date, msg: msg.split('\n')[0].slice(0, 200),
            isNew,
            url: `https://github.com/${meta.owner}/${meta.repo}/commit/${sha}`,
            compareUrl: `https://github.com/${meta.owner}/${meta.repo}/compare/${localSha ? localSha + '...' + sha : sha}`,
        };
    } catch (e) {
        return { which, ok: false, error: e.message, localVersion };
    }
}

export async function checkAll(token) {
    const keys = Object.keys(GITHUB_REPOS);
    const results = await Promise.all(keys.map(k => checkOne(k, token).catch(e => ({ which: k, ok: false, error: e.message }))));
    return results;
}

export function markSeen(which) {
    try {
        const sha = localStorage.getItem(`archarness_lastSha_${which}_remote`);
        if (sha) localStorage.setItem(`archarness_lastSha_${which}`, sha);
    } catch {}
}
export function markAllSeen(results) {
    for (const r of results || []) if (r.remoteSha) {
        try { localStorage.setItem(`archarness_lastSha_${r.which}`, r.remoteSha); } catch {}
    }
}
