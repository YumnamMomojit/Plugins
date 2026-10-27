// Semdok Harness plugin: the trading_agents_analyze tool runs TradingAgents
// (https://github.com/TauricResearch/TradingAgents) in a private Python environment
// on the Semdok models and saves its full report into the session's workspace.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

export const name = 'semdok-tradingagents'
export const inject = ['tools', 'credentials', 'workingDirectory']

const RUNNER = join(dirname(fileURLToPath(import.meta.url)), 'runner', 'ta_runner.py')
const DISCLAIMER = 'TradingAgents is a research framework. Its output is for research and education only and is not financial advice.'
const WINDOWS = process.platform === 'win32'

function today() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Run one Python process; resolve its "TA_*" lines, reject with the tail of its output. */
function runPython(python, args, env, signal, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-u', RUNNER, ...args], {
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...env },
      windowsHide: true,
    })
    let result
    let tail = ''
    let buffer = ''
    const abort = () => { child.kill() }
    signal.addEventListener('abort', abort, { once: true })
    const keep = text => { tail = (tail + text).slice(-4000) }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      let index
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (line.startsWith('TA_RESULT ')) result = JSON.parse(line.slice(10))
        else if (line.startsWith('TA_PROGRESS ')) onProgress?.(line.slice(12))
        else keep(`${line}\n`)
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', keep)
    child.once('error', (error) => { signal.removeEventListener('abort', abort); reject(error) })
    child.once('close', (code) => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) reject(signal.reason ?? new Error('TradingAgents run was cancelled'))
      else if (code === 0) resolve(result)
      else reject(new Error(`TradingAgents exited with code ${code}:\n${tail.trim().split('\n').slice(-15).join('\n')}`))
    })
  })
}

/** A Python 3.11+ to create the private environment from: the one Semdok Harness ships, else the system's. */
function basePython(config, home) {
  if (config.python) return config.python
  const bundled = join(home, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'python', ...(WINDOWS ? ['python.exe'] : ['bin', 'python3']))
  if (existsSync(bundled)) return bundled
  // Desktop resources, or the Linux package's own folder.
  for (const root of [process.resourcesPath, process.env.SEMDOK_HARNESS_APP_DIR]) {
    const shipped = root && join(root, 'runtime', 'primary-runtime', 'dependencies', 'python', ...(WINDOWS ? ['python.exe'] : ['bin', 'python3']))
    if (shipped && existsSync(shipped)) return shipped
  }
  return WINDOWS ? 'python' : 'python3'
}

export function apply(ctx, config = {}) {
  const settings = {
    baseURL: 'https://console.semdok.com/v1',
    apiKeyEnv: 'SEMDOK_API_KEY',
    deepModel: 'claude/claude-sonnet-4-5-20250929',
    quickModel: 'ddgw/gpt-5.4-mini',
    ...config,
  }
  const home = resolveDshHome()
  const data = join(home, 'plugin-data', 'semdok-tradingagents')
  const venvPython = join(data, 'venv', ...(WINDOWS ? ['Scripts', 'python.exe'] : ['bin', 'python']))
  let preparing

  const prepare = (signal) => {
    preparing ??= (async () => {
      mkdirSync(data, { recursive: true })
      await runPython(basePython(settings, home), ['setup', data], {}, signal)
    })().catch((error) => { preparing = undefined; throw error })
    return preparing
  }

  ctx.tools.register(defineTool({
    name: 'trading_agents_analyze',
    description: 'Analyze one stock or crypto ticker with TradingAgents (Tauric Research), a multi-agent LLM trading-research framework: '
      + 'market, sentiment, news and fundamentals analysts gather live data; bull and bear researchers debate; a trader proposes a plan; '
      + 'a risk team and a portfolio manager decide a rating of Buy, Overweight, Hold, Underweight or Sell. Saves the full report '
      + '(Markdown and HTML) in the workspace under tradingagents-reports/. A run takes several minutes and many model calls; the first '
      + `run also installs TradingAgents. ${DISCLAIMER} Always tell the user that.`,
    parameters: {
      ticker: { type: 'string', required: true, description: 'Ticker symbol, e.g. NVDA, AAPL, RELIANCE.NS, 7203.T, BTC-USD' },
      date: { type: 'string', description: 'Analysis date as YYYY-MM-DD (data up to that date). Defaults to today.' },
      depth: { type: 'string', enum: ['quick', 'standard', 'deep'], description: 'Debate rounds: quick 1, standard 2, deep 3 (more model calls). Default quick.' },
      analysts: {
        type: 'array', items: { type: 'string', enum: ['market', 'social', 'news', 'fundamentals'] },
        description: 'Which analysts to run. Default all four.',
      },
      asset_type: { type: 'string', enum: ['stock', 'crypto'], description: 'Default stock; use crypto for tickers such as BTC-USD.' },
      language: { type: 'string', description: 'Language of the reports, e.g. English, Hindi, Chinese. Default English.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ticker: { type: 'string', required: true },
          date: { type: 'string', required: true },
          rating: { type: 'string', required: true },
          report: { type: 'string', required: true },
          html: { type: 'string', required: true },
          decision: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `TradingAgents rating for ${value.ticker} on ${value.date}: ${value.rating}\n`
          + `Full report: ${value.report}\nWeb page: ${value.html}\n\nPortfolio manager decision:\n${value.decision}\n\n${DISCLAIMER}`,
      }],
    },
    presentCall: args => ({ card: 'generic', title: `TradingAgents: ${String(args?.ticker ?? '').toUpperCase()}`, kind: 'execute' }),
    async execute(args, exec) {
      const ticker = args.ticker.trim().toUpperCase()
      if (!/^[A-Z0-9.^=-]{1,20}$/.test(ticker)) throw new Error(`"${args.ticker}" does not look like a ticker symbol`)
      const date = args.date?.trim() || today()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date must be YYYY-MM-DD')
      const key = await ctx.credentials.resolve(settings.apiKeyEnv)
      if (key === undefined) throw new Error(`No ${settings.apiKeyEnv} is configured. Add your Semdok API key under More > Add Semdok API key.`)
      await prepare(exec.signal)
      const workspace = exec.agent === undefined ? join(data, 'reports') : await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const outDir = join(workspace, 'tradingagents-reports', `${ticker}-${date}`)
      const request = {
        ticker, date, out_dir: outDir,
        depth: args.depth ?? 'quick',
        analysts: args.analysts?.length ? [...args.analysts] : undefined,
        asset_type: args.asset_type ?? (/-(USD|USDT|EUR|INR)$/.test(ticker) ? 'crypto' : 'stock'),
        language: args.language ?? 'English',
        deep_model: settings.deepModel,
        quick_model: settings.quickModel,
      }
      const result = await runPython(venvPython, ['run', data, JSON.stringify(request)], {
        OPENAI_COMPATIBLE_API_KEY: key.value,
        TA_BACKEND_URL: settings.baseURL,
      }, exec.signal)
      if (result === undefined) throw new Error('TradingAgents finished without a result')
      return { ticker, date, rating: result.rating, report: result.report, html: result.html, decision: result.decision }
    },
  }))
}
