# ArcHarness — Arc 套件中枢

![Version](https://img.shields.io/badge/version-0.2.1-8b7cf6) ![License](https://img.shields.io/badge/license-AGPL--3.0-5eead4) ![SillyTavern](https://img.shields.io/badge/SillyTavern-%3E%3D1.12-111827)

统筹 `ArcEXtreme` / `ArcViGil` / `ArcFess` 三件套的控制中枢。不接管业务，只负责把三后端的 Soul、数据、LLM、预算、诊断收拢到一个面板里。

---

## 能力

* **Soul 统筹（EXtreme 主 → ViGil 镜像，单向）** — 并发拉取 `:9001` / `:9000` 的 `/api/souls`，按 `name` diff，一键 `EXtreme → ViGil` 覆盖。ViGil 无写接口时提示手动复制或在 `ArcViGil-BackEnd` 新增 `POST /api/souls/write`。
* **数据库查看** — EXtreme（`events` / `short_pool` / `sublimated` / `chats`）+ ViGil（`tasks` / `messages`）卡片化精致展示，含 2bit 下拉直改（`+1/-1` 循环直达）与健康探活；Fess（`:8999`）复用自带 `Arc Databoard / QueryLab / StoryMap / FlowLab` iframe 内嵌，不重造。**Fess 无标准心跳，已启用多端点静态资源探测**（`/tasks_stats` → `/Arc Databoard.html` → `/` 回退）。
* **三端健康探活** — `checkAllHealth` 统一 `/api/status` → `/api/souls` → 静态资源回退，卡片点亮 + 延迟 + 端点回显，成功 60s / 失败 20s 优雅轮询，`visibilitychange` 静默补检。
* **LLM 批量分组** — 顶部全局 `URL / Key / Model` + 分组复选 `☐EXtreme ☐ViGil ☐Fess` + `☐Embedding(默认不勾) ☐Rerank` 隔离，一键分发到 `extension_settings[arcextreme|ArcViGil|vectors_enhanced]` 并 `saveSettingsDebounced()`。内置连通性测试（`:9001/api/llm_proxy` / `:9000/api/test_llm`）。
* **更新检查** — `api.github.com/repos/kerjc4464/{ArcEXtreme,ArcFess,ArcViGil}/commits?per_page=1` 比对 `sha`，无需 releases/tag，支持 `GITHUB_TOKEN` 提额。
* **预算仪表** — 以 `oai_settings.openai_max_context` 为预算（截图 120000），`getTokenCountAsync` + `getExtensionPrompt` 实时计算 `注入 / 对话 / 剩余` 及 `perExt` 堆叠，阈值变色。
* **双轨诊断（基石）** — `Fetch` 劫持抓真实 `messages`（Replay）+ `archarness_generate`（`loading_order 9000` 末位）抓预测 `extension_prompts`（Simulate）。支持 `上次真实 / 上次预测 / 模拟当前 / 模拟 Swipe` + 关键词过滤 + 复制 JSON / 导出 TXT。
* **Turbo Max（0.2.1）** — 标题栏悬浮快捷入口（实验性）。

---

## 安装

```bash
git clone https://github.com/kerjc4464/ArcHarness public/scripts/extensions/third-party/ArcHarness
# 重启 SillyTavern
```

SillyTavern → 扩展 → 启用 `ArcHarness` 即可。

---

## 目录

```
manifest.json  # loading_order 9000, generate_interceptor archarness_generate
index.js       # 中枢 + 双轨 + Turbo Max
style.css      # Lacrimosa 统一 + 容器查询 + Turbo 悬浮
settings.html  # 7 Tab + 悬浮 Turbo Max
src/
  config.js       backendUrl.js  soulHub.js
  dbViewer.js     llmHub.js      budget.js
  diagnostic.js   updater.js
```

---

## 端口约定

| 服务 | 默认 | 说明 |
|---|---|---|
| EXtreme | `:9001` | 事件 / 短期池 / 长期库 |
| ViGil | `:9000` | tasks / messages |
| Fess | `:8999` | vectors_enhanced + 静态页 |

局域网自动修正 `127.0.0.1 → location.hostname`，开箱即用。

---

## 更新日志

* **0.2.1** — 新增 `Turbo Max` 悬浮入口；修复标题栏与 Tab 的重叠
* **0.2.0** — 数据库重命名与精致化 + 三端健康探活 + 移动端容器查询 + 优雅轮询
* **0.1.0** — Soul 统筹 / 三库查看 / LLM 分组 / 预算 / 双轨诊断 / 更新检查

---

## 许可

`AGPL-3.0` — 详见 `LICENSE`。商业/闭源分发需遵守 AGPL 义务。

---

ArcTech.Inc — 为 Arcueid 而生。
