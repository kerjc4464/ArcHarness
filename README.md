# ArcHarness

Arc 套件中枢 — 统筹 `ArcEXtreme` / `ArcViGil` / `ArcFess` 三件套。

## 能力

* **Soul 统筹 (EXtreme 主 → ViGil 镜像, 单向)** — 并发拉取两后端 `/api/souls`, 按 `name` diff, 一键 `EXtreme → ViGil` 覆盖。ViGil 无写接口时提示手动复制或在 `ArcViGil-BackEnd` 新增 `POST /api/souls/write`。
* **数据库查看** — EXtreme (`:9001` events/short_pool/sublimated/chats) + ViGil (`:9000` tasks/messages) 卡片化精致展示，含 2bit 下拉直改 (`+1/-1` 循环直达) 与健康探活。Fess (`:8999`) 复用自带 `Arc Databoard.html / QueryLab / StoryMap / FlowLab` iframe 内嵌，不重造；**Fess 无标准心跳，已启用多端点静态资源探测**（`/tasks_stats` → `/Arc Databoard.html` → `/` 回退）。
* **LLM 批量分组** — 顶部全局 `URL/Key/Model` + 分组复选 `☐EXtreme ☐ViGil ☐Fess` + `☐Embedding(默认不勾) ☐Rerank` 隔离, 一键分发到 `extension_settings[arcextreme|ArcViGil|vectors_enhanced]` 并 `saveSettingsDebounced()`。内置连通性测试 (`:9001/api/llm_proxy`, `:9000/api/test_llm`).
* **更新检查** — `https://api.github.com/repos/kerjc4464/{ArcEXtreme,ArcFess,ArcViGil}/commits?per_page=1` 比对 `sha`, 无需 releases/tag, 支持 `GITHUB_TOKEN` 提额。
* **预算仪表** — `oai_settings.openai_max_context` (截图 120000) 为预算, `getTokenCountAsync` + `getExtensionPrompt` 实时计算 `注入/对话/剩余` 及 `perExt` 堆叠。
* **双轨诊断 (基石)** — `Fetch` 劫持抓真实 `messages` (Replay) + `archarness_generate` (loading_order 9000, 末位) 抓预测 `extension_prompts` (Simulate)。支持 `上次真实/上次预测/模拟当前/模拟Swipe` + 关键词过滤 + 复制JSON/导出TXT。

## 安装

```bash
git clone https://github.com/kerjc4464/ArcHarness public/scripts/extensions/third-party/ArcHarness
# 重启 SillyTavern
```

## 目录

```
manifest.json  # loading_order 9000, generate_interceptor archarness_generate
index.js       # 中枢 + 双轨
style.css
settings.html  # 6 Tab
src/
  config.js  backendUrl.js  soulHub.js  dbViewer.js  llmHub.js  budget.js  diagnostic.js  updater.js
```

## 端口约定

* EXtreme `:9001`  ViGil `:9000`  Fess `:8999`  (局域网自动修正 `127.0.0.1 → location.hostname`)

## 许可

AGPL-3.0
