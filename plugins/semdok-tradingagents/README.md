# semdok-tradingagents

A Semdok Harness plugin that adds one tool, `trading_agents_analyze`, which runs
[TradingAgents](https://github.com/TauricResearch/TradingAgents) by Tauric Research on your Semdok models.

TradingAgents is a multi-agent LLM framework that mirrors a trading firm: market, sentiment, news and
fundamentals analysts gather live data (Yahoo Finance, SEC EDGAR, Polymarket; no extra keys needed), bull and
bear researchers debate, a trader proposes a plan, and a risk team and portfolio manager decide a rating:
**Buy, Overweight, Hold, Underweight or Sell**.

> TradingAgents is a research framework. Its output is for research and education only and is not financial advice.

## Install

In Semdok Harness: **Plugins → Add plugin**, enter the path of this folder, and click **Install**.

The first analysis installs TradingAgents into a private Python environment under
`~/.dsh/plugin-data/semdok-tradingagents` (about 3–4 minutes, and around 600 MB). On Windows on Arm that
environment uses an x64 Python under Windows' x64 emulation, because one of TradingAgents' libraries
(tiktoken) has no Arm build for Windows.

## Use

Ask the agent, for example:

- *Analyze NVDA with TradingAgents.*
- *Run TradingAgents on RELIANCE.NS as of 2026-10-20 with standard depth, report in Hindi.*
- *Use TradingAgents on BTC-USD with only the market and news analysts.*

Each run saves `tradingagents-reports/<TICKER>-<DATE>/complete_report.md` and `complete_report.html` in the
session's workspace, with one file per agent alongside.

| Option | Values | Default |
|---|---|---|
| `depth` | `quick` (1 debate round), `standard` (2), `deep` (3) | `quick` |
| `analysts` | any of `market`, `social`, `news`, `fundamentals` | all four |
| `asset_type` | `stock`, `crypto` | `stock` (crypto for `-USD` style tickers) |
| `language` | report language | English |

A quick run makes roughly 15–40 model calls and takes several minutes; deeper runs make more. They are
billed to your Semdok plan like any other request.

## Configure

The plugin reads your Semdok API key from Semdok Harness (`SEMDOK_API_KEY`) at each run and passes it only to
the TradingAgents process; it is never written to disk. To change the models or endpoint, override the
`semdok-tradingagents` row in your profile's `cordis.patch.yml`:

```yaml
- id: semdok-tradingagents
  name: semdok-tradingagents
  config:
    baseURL: https://console.semdok.com/v1
    apiKeyEnv: SEMDOK_API_KEY
    deepModel: claude/claude-opus-5
    quickModel: ddgw/gpt-5.4-mini
    # python: C:\path\to\python.exe   (optional: a Python 3.11+ to build the environment from)
```

## Uninstall

**Plugins → Installed → semdok-tradingagents → Uninstall**, then delete
`~/.dsh/plugin-data/semdok-tradingagents` to remove the Python environment.

## Licenses

This plugin: MIT (see `LICENSE`). TradingAgents: Apache License 2.0, © Tauric Research; it is downloaded from
its GitHub repository at a pinned commit during setup and is not bundled here (see `NOTICE`).
