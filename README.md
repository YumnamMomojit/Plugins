# Semdok Plugins

Plugins for [Semdok Harness](https://console.semdok.com).

| Plugin | What it does |
|---|---|
| [TradingAgents](plugins/semdok-tradingagents) | Multi-agent stock and crypto research on your Semdok models (research only, not financial advice) |

## Install in Semdok Harness

1. Open **Plugins → Discover → Add index source**.
2. Paste the market link: `https://yumnammomojit.github.io/Plugins/index.json`
3. Open a plugin card and click **Install**.

## Add or update a plugin

- New plugin: add a folder under `plugins/` with a `package.json` that declares `"dsh": { "bundle": ... }`, and an optional `icon.svg`. Give it a title in `market.json`.
- Update: change the files and raise `version` in its `package.json`.

Every push to `main` rebuilds the market index (`scripts/build-index.mjs`) and publishes it with GitHub Pages
(`.github/workflows/pages.yml`). Each plugin is pinned to the last commit that changed its folder.
