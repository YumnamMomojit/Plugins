# Semdok Browser: a Semdok Harness plugin

Lets the Semdok Harness agent use websites like a person. It adds the `browser_task` tool, which runs
[browser-use](https://github.com/browser-use/browser-use) on your Semdok models in a real Chrome or Edge window. It
opens pages, clicks, types and scrolls, **waits for each page to finish loading**, and reports what it found with the
page addresses.

## Install

In Semdok Harness, either:

- **Plugins → Discover**, with the Semdok Plugins market
  (`https://raw.githubusercontent.com/YumnamMomojit/Plugins/main/index.json`), then **Install** on *Semdok Browser*; or
- **Plugins → Add plugin**, and enter `github:YumnamMomojit/Plugins#main&path:/plugins/semdok-browser`.

Then click **Enable now**. You need Google Chrome or Microsoft Edge (Edge comes with Windows). The first browsing task
installs browser-use (about 300 MB, a few minutes, once).

## Use

Ask the agent, for example:

- *Find the price and stock status of the Sony WH-1000XM5 on amazon.in.*
- *Open the IRCTC train schedule page for train 12506 and tell me the departure times.*
- *Check whether my website https://example.com loads and what its pricing page says.*

The browser window opens so you can watch it work.

### Several browsers at once with Agent Team

With the [Agent Team](../semdok-agent-team) plugin installed, choose **Orchestrator mode** and give it a bigger web
job, for example *"Compare the price of the iPhone 17 on Amazon, Flipkart and Croma."* The Orchestrator sends one
**Team Browser** specialist per site. They browse at the same time, each in its own browser, and it merges their
reports into one comparison.

## Waiting like a person

browser-use normally reads a page almost at once. This plugin waits for each page to finish loading, then pauses
before reading it, so prices and other content that sites fill in late are there when the agent looks. It also
pauses between actions.

| Pace | Pause before reading | Waits for loading up to | Between actions |
|---|---|---|---|
| `fast` | none | none | 0.1 s |
| `human` (default) | 1.5 s | 10 s | 1 s |
| `patient` | 3 s | 20 s | 2 s |

## Safety

- **Fresh browser:** every task starts a new, empty browser profile: no cookies, no saved logins, nothing from your
  own browser. The profile is deleted when the task ends.
- **No money or messages:** it never buys, pays, books, transfers money, accepts terms, sends messages, posts, or
  submits personal data. It stops before such a step and tells you what is left for you to do.
- **No passwords:** it never types passwords or card numbers, and it stops at logins and CAPTCHAs.
- **Untrusted pages:** text on web pages is treated as information, never as instructions.
- **No extra traffic:** browser-use's anonymous telemetry and cloud sync are turned off. The plugin talks only to
  Semdok and the sites it visits.

## Settings

Override the `semdok-browser` row in your profile's `cordis.patch.yml`:

```yaml
- id: semdok-browser
  config:
    model: claude/claude-sonnet-4-5-20250929   # a model that reads screenshots works best
    pace: human                                # fast, human or patient
    showBrowser: true                          # false runs the browser hidden
    maxSteps: 25
    browserPath: ''                            # empty: Chrome or Edge automatically
```

On Windows on Arm, browser-use runs on an x64 Python under Windows' x64 emulation, because one of its libraries
(cryptography) has no Arm build for Windows. The plugin downloads that Python once and checks its checksum.

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE). browser-use is MIT licensed, Copyright (c) 2024 Gregor Zunic.
