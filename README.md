# Semdok Plugins

Plugins for [Semdok Harness](https://console.semdok.com).

| Plugin | What it does |
|---|---|
| [Sem Live Assistant](plugins/semdok-live) | Add Sem, Semdok's 3D conversational assistant, to any website |
| [TradingAgents](plugins/semdok-tradingagents) | Multi-agent stock and crypto research on your Semdok models (research only, not financial advice) |

## Install in Semdok Harness

1. Open **Plugins → Discover → Add index source**.
2. Paste the market link: `https://raw.githubusercontent.com/YumnamMomojit/Plugins/main/index.json`
3. Open a plugin card and click **Install**.

## Add or update a plugin

- New plugin: add a folder under `plugins/` with a `package.json` that declares `"dsh": { "bundle": ... }`, and an optional `icon.svg`. Give it a title in `market.json`.
- Update: change the files and raise `version` in its `package.json`.
- Plugin in another repository: add it to `market.json` with `"repository": "https://github.com/<owner>/<repo>"`
  (its `package.json` at the repository root). The index pins that repository's latest `main` commit.

Every push to `main` that changes a plugin, and a daily check of external plugin repositories, rebuilds `index.json` and `icons/` (`scripts/build-index.mjs`) and commits
them (`.github/workflows/index.yml`). Each plugin is pinned to the last commit that changed its folder.
