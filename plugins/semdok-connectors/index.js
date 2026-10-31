// Semdok Harness plugin: BigQuery, Databricks and Gmail for the agent. Each connector is an MCP server that the
// app's own MCP client connects: Google's MCP Toolbox for BigQuery, Databricks' hosted MCP servers, and
// @klodr/gmail-mcp for Gmail. A server installs the first time its connector is turned on. Secrets never pass
// through the model: Google sign-ins happen in the browser, and the Databricks token is read from the app's
// private credential file, the environment, or the Databricks CLI's configuration.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  DATABRICKS_SERVERS, SERVERS, appRuntime, databricksCliProfile, databricksOrigin, exists, gmailEntry, gmailFiles,
  googleCredentials, installServer, installedVersion, readSettings, run, toolboxBinary, writeSettings,
} from './servers.js'

export const name = 'semdok-connectors'
export const inject = ['tools', 'credentials']

const SKILL = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'skill.md'), 'utf8')
const CONNECTORS = ['bigquery', 'databricks', 'gmail']
const LABEL = { bigquery: 'BigQuery', databricks: 'Databricks', gmail: 'Gmail' }
const STATE = {
  'off': 'off', 'needs-setup': 'needs setup', 'installing': 'installing its server', 'connecting': 'connecting',
  'connected': 'connected', 'error': 'not connected',
}
const SOURCE = {
  'file': 'the app\'s private credential file', 'env': 'the environment', 'project-env': 'the project\'s .env file',
  'user-env': 'the .env file in the Semdok Harness home folder',
}
const GIB = 1024 ** 3
const RECONNECT = { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 }
// Values that look like a secret: Databricks tokens, Google access tokens and API keys, private keys.
const SECRET = /dapi[0-9a-f]{16,}|\bya29\.|\bAIza[0-9A-Za-z_-]{20,}|-----BEGIN|\bsk[-_][A-Za-z0-9_]{12,}/
const GB = bytes => `${(bytes / GIB).toLocaleString('en-US', { maximumFractionDigits: 1 })} GiB`

export function apply(ctx, config = {}) {
  // Safety limits come from the plugin row in cordis.patch.yml, which the agent's tools never change.
  const limits = {
    bigquery: { readOnly: true, maximumBytesBilled: 10 * GIB, maxQueryResultRows: 50, ...config.bigquery },
    databricks: { servers: ['genie_one', 'sql'], ...config.databricks },
    gmail: { allowSend: false, recipientPairing: false, ...config.gmail },
  }
  const home = resolveDshHome()
  const dataDir = join(home, 'plugin-data', 'semdok-connectors')
  const settingsFile = join(dataDir, 'settings.json')
  const status = Object.fromEntries(CONNECTORS.map(key => [key, { state: 'off', lines: ['Turned off.'] }]))
  const fibers = Object.fromEntries(CONNECTORS.map(key => [key, []]))
  const queue = Object.fromEntries(CONNECTORS.map(key => [key, Promise.resolve()]))
  let active = true
  ctx.effect(() => () => { active = false }, 'semdok-connectors.active')

  const settingsOf = key => ({ ...readSettings(settingsFile)[key] })
  const set = (key, state, lines) => { status[key] = { state, lines } }
  const describe = key => `${LABEL[key]}: ${STATE[status[key].state]}\n${status[key].lines.map(line => `- ${line}`).join('\n')}`

  /** Run connector work one piece at a time per connector. */
  function serial(key, work) {
    const next = queue[key].catch(() => {}).then(() => active ? work() : undefined)
    queue[key] = next.catch(() => {})
    return next
  }

  /** Bring one connector in line with its settings: disconnect it, then set up and connect what is turned on. */
  const refresh = (key, signal) => serial(key, () => connect(key, signal))

  async function connect(key, signal) {
    for (const fiber of fibers[key].splice(0)) {
      try { fiber.dispose() } catch { /* already gone */ }
    }
    const settings = settingsOf(key)
    if (!settings.enabled) return set(key, 'off', ['Turned off.'])
    try {
      const plan = await prepare(key, settings, signal)
      if (plan.setup) return set(key, 'needs-setup', plan.setup)
      set(key, 'connecting', ['Connecting…'])
      const lines = [...plan.notes ?? []]
      let connected = 0
      for (const server of plan.servers) {
        const fiber = ctx.plugin(McpClient, {
          failOnStartupError: true, toolCallTimeoutMs: 120_000, maxInstructionBytes: 32_768, reconnect: RECONNECT,
          ...server.config,
        })
        try {
          await fiber
          fibers[key].push(fiber)
          connected += 1
          const prefix = `mcp__${server.config.serverName}__`
          const tools = ctx.tools.schemas().filter(tool => tool.name.startsWith(prefix)).length
          lines.push(`${server.label}: connected, ${tools} tool${tools === 1 ? '' : 's'} (${prefix}…).`)
        } catch (error) {
          try { fiber.dispose() } catch { /* already gone */ }
          lines.push(`${server.label}: could not connect. ${explain(key, error)}`)
        }
      }
      set(key, connected > 0 ? 'connected' : 'error', lines)
    } catch (error) {
      if (signal?.aborted) {
        set(key, 'error', ['Stopped before it finished. Ask me to retry.'])
        throw error
      }
      set(key, 'error', [explain(key, error)])
    }
  }

  /** Install a connector's pinned server on first use. */
  async function ensureServer(key, signal) {
    if (installedVersion(dataDir, key) === SERVERS[key].version) return
    const runtime = appRuntime(home)
    if (!runtime) throw new Error('Semdok Harness\'s own Node.js runtime was not found, so the server cannot be installed.')
    const { package: pkg, version, size } = SERVERS[key]
    set(key, 'installing', [`Downloading ${pkg}@${version} (${size} unpacked). This happens once.`])
    await installServer(dataDir, key, runtime, { signal })
  }

  /** What a connector needs to connect: its MCP servers, or the setup steps still missing. */
  async function prepare(key, settings, signal) {
    if (key === 'bigquery') {
      if (!settings.project) {
        return { setup: ['Choose the Google Cloud project that runs and pays for the queries: ask me to connect BigQuery with its project ID.'] }
      }
      const own = limits.bigquery.command
      if (!own) await ensureServer('bigquery', signal)
      const google = googleCredentials()
      if (!google?.source && !own) {
        return {
          setup: [
            ...google?.problem ? [google.problem] : [],
            `Project ${settings.project}. This computer is not signed in to Google Cloud yet.`,
            'Install the Google Cloud CLI (https://cloud.google.com/sdk/docs/install), then run "gcloud auth application-default login" '
              + 'and sign in with an account that may run BigQuery jobs in the project (roles BigQuery Job User and BigQuery Data Viewer).',
            'Or set GOOGLE_APPLICATION_CREDENTIALS to a service-account key file and restart Semdok Harness.',
            'Then ask me to retry.',
          ],
        }
      }
      const { readOnly, maximumBytesBilled, maxQueryResultRows } = limits.bigquery
      return {
        notes: [`Project ${settings.project}${settings.location ? `, location ${settings.location}` : ''}; Google sign-in from ${google?.source ?? 'your own server command'}. `
          + `${readOnly ? 'Read-only (SELECT queries only)' : 'Writes allowed'}; each query may bill at most ${GB(maximumBytesBilled)}; `
          + `results are cut to ${maxQueryResultRows} rows.`],
        servers: [{
          label: 'BigQuery',
          config: {
            serverName: 'bigquery', transport: 'stdio',
            command: own ?? toolboxBinary(dataDir),
            args: own ? limits.bigquery.args ?? [] : ['--prebuilt', 'bigquery', '--stdio'],
            env: {
              BIGQUERY_PROJECT: settings.project,
              ...settings.location ? { BIGQUERY_LOCATION: settings.location } : {},
              BIGQUERY_READONLY: String(readOnly),
              BIGQUERY_MAXIMUM_BYTES_BILLED: String(maximumBytesBilled),
              BIGQUERY_MAX_QUERY_RESULT_ROWS: String(maxQueryResultRows),
            },
          },
        }],
      }
    }
    if (key === 'databricks') {
      const profile = settings.profile || process.env.DATABRICKS_CONFIG_PROFILE || 'DEFAULT'
      const cli = databricksCliProfile(profile)
      const origin = databricksOrigin(settings.host) ?? databricksOrigin(cli?.host)
      if (!origin) {
        return { setup: ['Set the workspace URL: ask me to connect Databricks with it, for example https://dbc-1234abcd-5678.cloud.databricks.com.'] }
      }
      const token = await databricksToken(profile, cli)
      if (!token) {
        return {
          setup: [
            `Workspace ${origin}. No access token found.`,
            'Create a personal access token in Databricks (your user name, top right → Settings → Developer → Access tokens).',
            'Never paste it into this chat. Save it privately in one of these places, then ask me to retry:',
            `the line "DATABRICKS_TOKEN: <token>" under "refs:" in ${join(home, '.credentials.yaml')} (the app's private credential file, which reloads by itself);`,
            'or the "token" line of a profile in ~/.databrickscfg (the Databricks CLI writes it with "databricks configure");',
            'or a DATABRICKS_TOKEN environment variable (then restart Semdok Harness).',
          ],
        }
      }
      const servers = []
      const notes = [`Workspace ${origin}; token from ${token.source}.`]
      for (const id of settings.servers?.length ? settings.servers : limits.databricks.servers) {
        const server = DATABRICKS_SERVERS[id]
        if (!server) continue
        if (id === 'genie_space' && !settings.genieSpaceId) {
          notes.push('Genie Agent: skipped, no Genie space ID set (it is on the space\'s Settings tab).')
          continue
        }
        servers.push({
          label: server.label,
          config: {
            serverName: server.serverName, transport: 'streamable-http', url: `${origin}${server.path(settings)}`,
            headers: { Authorization: `Bearer ${token.value}` },
          },
        })
      }
      if (servers.length === 0) return { setup: [...notes, 'No Databricks MCP server selected.'] }
      return { notes, servers }
    }
    // Gmail
    const files = gmailFiles(settings)
    const own = limits.gmail.command
    if (!own) await ensureServer('gmail', signal)
    if (!exists(files.credentials)) return { setup: gmailSteps(files) }
    const runtime = appRuntime(home)
    if (!own && !runtime) throw new Error('Semdok Harness\'s own Node.js runtime was not found.')
    return {
      notes: [`Signed in (tokens in ${files.credentials}). Sending is ${limits.gmail.allowSend ? 'allowed if you granted it at sign-in' : 'turned off'}.`],
      servers: [{
        label: 'Gmail',
        config: {
          serverName: 'gmail', transport: 'stdio',
          command: own ?? runtime.node,
          args: own ? limits.gmail.args ?? [] : [gmailEntry(dataDir)],
          env: {
            GMAIL_OAUTH_PATH: files.oauthKeys,
            GMAIL_CREDENTIALS_PATH: files.credentials,
            ...limits.gmail.recipientPairing ? { GMAIL_MCP_RECIPIENT_PAIRING: 'true' } : {},
          },
        },
      }],
    }
  }

  /** The Databricks token and where it came from: the credential store or environment first, then the CLI profile. */
  async function databricksToken(profile, cli) {
    const resolved = await ctx.credentials.resolve('DATABRICKS_TOKEN').catch(() => undefined)
    if (resolved?.value) return { value: resolved.value, source: `DATABRICKS_TOKEN in ${SOURCE[resolved.source] ?? resolved.source}` }
    if (cli?.token) return { value: cli.token, source: `profile [${profile}] of ${cli.file}` }
    return undefined
  }

  function gmailSteps(files) {
    const steps = []
    if (!exists(files.oauthKeys)) {
      steps.push(
        'Gmail needs your own Google Cloud OAuth client, once:',
        'in Google Cloud Console, pick or create a project and enable the Gmail API;',
        'under Google Auth Platform (OAuth consent screen), set up the app and add your Google account as a test user;',
        'under Clients (Credentials), create an OAuth client of type "Desktop app" and download its JSON;',
        `save that file as ${files.oauthKeys}.`,
      )
    } else {
      steps.push(`OAuth client found (${files.oauthKeys}).`)
    }
    steps.push('Then ask me to sign in to Gmail: your browser opens Google\'s consent screen. By default I ask only to read mail and write drafts.')
    return steps
  }

  function explain(key, error) {
    const message = String(error?.cause?.message ?? error?.message ?? error).replace(/\s+/g, ' ').trim()
    const hints = []
    if (key === 'bigquery' && /default credentials|application.default|credential|oauth2|token/i.test(message)) {
      hints.push('Sign in to Google Cloud on this computer with "gcloud auth application-default login" (Google Cloud CLI), '
        + 'or set GOOGLE_APPLICATION_CREDENTIALS to a service-account key file and restart Semdok Harness, then ask me to retry.')
    }
    if (key === 'databricks') {
      if (/\b401\b|unauthori[sz]ed|invalid access token/i.test(message)) hints.push('Databricks refused the token: check that it is current and belongs to a user of this workspace.')
      if (/\b403\b|forbidden|permission/i.test(message)) hints.push('The token\'s user lacks access to this MCP server: ask a workspace admin.')
      if (/\b404\b|not[ _]found|no api found|feature_disabled|not enabled/i.test(message)) {
        hints.push('This MCP server is not available in the workspace. Check its ID (for a Genie Agent, the space ID). Databricks SQL '
          + 'and Genie Agent endpoints need an admin to turn on "Managed MCP Servers" in the workspace Previews page; Genie One needs '
          + 'Unity Gateway access.')
      }
    }
    if (key === 'gmail' && /invalid_grant|expired|revoked|credentials/i.test(message)) hints.push('Ask me to sign in to Gmail again.')
    return [message.slice(0, 600), ...hints].join(' ')
  }

  ctx.tools.register(defineTool({
    name: 'connectors_status',
    description: 'Show the BigQuery, Databricks and Gmail connectors: whether each is on and connected, its MCP tools, its safety '
      + 'limits, and the next setup step. Pass retry: true after the user finished a setup step (a Google sign-in, a saved token) '
      + 'to connect again.',
    parameters: {
      retry: { type: 'boolean', description: 'Connect again every connector that needs setup or failed. Default false.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { report: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.report }],
    },
    presentCall: () => ({ card: 'generic', title: 'Connector status', kind: 'read' }),
    async execute(args, exec) {
      if (args.retry) {
        await Promise.all(CONNECTORS.filter(key => ['needs-setup', 'error'].includes(status[key].state)).map(key => refresh(key, exec.signal)))
      }
      return { report: CONNECTORS.map(describe).join('\n\n') }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'connectors_configure',
    description: 'Turn a connector on or off and set its non-secret settings, then connect it and report the result. BigQuery needs '
      + 'the Google Cloud project ID; Databricks needs the workspace URL. The first time BigQuery or Gmail is turned on, its server '
      + 'downloads once (a few hundred MB), which can take minutes. Never pass tokens, passwords or keys: the user stores secrets '
      + 'outside the chat, as the setup steps explain. Safety limits (read-only, cost cap, sending email) are not settable here.',
    parameters: {
      connector: { type: 'string', enum: CONNECTORS, required: true, description: 'Which connector.' },
      enabled: { type: 'boolean', description: 'Turn it on (default) or off.' },
      project: { type: 'string', description: 'BigQuery: Google Cloud project ID that runs and is billed for the queries, for example my-analytics-123.' },
      location: { type: 'string', description: 'BigQuery: default location of the datasets, for example US, EU or asia-south1. Optional.' },
      host: { type: 'string', description: 'Databricks: workspace URL, for example https://dbc-1234abcd-5678.cloud.databricks.com.' },
      servers: {
        type: 'array', items: { type: 'string', enum: Object.keys(DATABRICKS_SERVERS) },
        description: 'Databricks: MCP servers to connect. genie_one answers business questions in plain language; sql runs SQL on a '
          + 'SQL warehouse; genie_space queries one Genie Agent (needs genie_space_id). Default genie_one and sql.',
      },
      genie_space_id: { type: 'string', description: 'Databricks: the Genie space ID, for the genie_space server.' },
      profile: { type: 'string', description: 'Databricks: profile in ~/.databrickscfg to read the token (and URL) from. Default DEFAULT.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { report: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.report }],
    },
    presentCall: args => ({ card: 'generic', title: `${args?.enabled === false ? 'Turn off' : 'Connect'} ${LABEL[args?.connector] ?? 'connector'}`, kind: 'edit' }),
    async execute(args, exec) {
      for (const value of [args.project, args.location, args.host, args.genie_space_id, args.profile]) {
        if (typeof value === 'string' && SECRET.test(value)) {
          throw new Error('That looks like a secret. Secrets must never go through the chat. Follow the setup steps to store it privately, '
            + 'and if it was a real token, revoke it and create a new one.')
        }
      }
      const all = readSettings(settingsFile)
      const settings = { ...all[args.connector], enabled: args.enabled ?? true }
      if (args.connector === 'bigquery') {
        if (args.project !== undefined) {
          const project = args.project.trim()
          if (project !== '' && !/^([a-z0-9.-]+:)?[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) {
            throw new Error(`"${project}" is not a Google Cloud project ID (6 to 30 lowercase letters, digits or hyphens, starting with a letter).`)
          }
          settings.project = project
        }
        if (args.location !== undefined) settings.location = args.location.trim()
      }
      if (args.connector === 'databricks') {
        if (args.host !== undefined) settings.host = databricksOrigin(args.host) ?? ''
        if (args.servers !== undefined) settings.servers = [...new Set(args.servers)]
        if (args.genie_space_id !== undefined) settings.genieSpaceId = args.genie_space_id.trim()
        if (args.profile !== undefined) settings.profile = args.profile.trim()
      }
      all[args.connector] = settings
      writeSettings(settingsFile, all)
      await refresh(args.connector, exec.signal)
      return { report: describe(args.connector) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'connectors_gmail_sign_in',
    description: 'Sign the user in to Gmail: turns the Gmail connector on, installs its server if needed, and opens Google\'s consent '
      + 'screen in the user\'s browser (waits up to 5 minutes). Asks only to read mail and write drafts unless allow_send is true. '
      + 'Needs the user\'s Google Cloud OAuth client file first; if it is missing, returns the steps to create it.',
    parameters: {
      allow_send: {
        type: 'boolean',
        description: 'Also ask for permission to send email. Only when the user explicitly asked to let the agent send email. Default false.',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { report: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.report }],
    },
    presentCall: () => ({ card: 'generic', title: 'Sign in to Gmail', kind: 'execute' }),
    async execute(args, exec) {
      if (args.allow_send && !limits.gmail.allowSend) {
        throw new Error('Sending email is turned off in the plugin settings (gmail.allowSend in the semdok-connectors row of '
          + 'cordis.patch.yml). Only the user can turn it on there. Drafts still work: the user sends them from Gmail.')
      }
      const all = readSettings(settingsFile)
      all.gmail = { ...all.gmail, enabled: true }
      writeSettings(settingsFile, all)
      const files = gmailFiles(all.gmail)
      await serial('gmail', async () => {
        for (const fiber of fibers.gmail.splice(0)) {
          try { fiber.dispose() } catch { /* already gone */ }
        }
        if (!limits.gmail.command) await ensureServer('gmail', exec.signal)
        if (!exists(files.oauthKeys)) return
        const runtime = appRuntime(home)
        if (!runtime) throw new Error('Semdok Harness\'s own Node.js runtime was not found.')
        const scopes = ['gmail.readonly', 'gmail.compose', ...args.allow_send ? ['gmail.send'] : []]
        set('gmail', 'connecting', ['Waiting for the Google sign-in in your browser (up to 5 minutes)…'])
        try {
          await run(runtime.node, [gmailEntry(dataDir), 'auth', `--scopes=${scopes.join(',')}`], {
            env: { GMAIL_OAUTH_PATH: files.oauthKeys, GMAIL_CREDENTIALS_PATH: files.credentials },
            signal: exec.signal, timeoutMs: 5 * 60_000,
          })
        } catch (error) {
          if (exec.signal.aborted) throw error
          throw new Error(`The Gmail sign-in did not finish: ${String(error.message).slice(0, 500)}`)
        }
      })
      await refresh('gmail', exec.signal)
      return { report: describe('gmail') }
    },
  }))

  ctx.plugin({
    name: 'semdok-connectors-skill',
    inject: ['skills'],
    apply(child) {
      child.skills.register({
        name: 'semdok-connectors',
        description: 'Use BigQuery, Databricks and Gmail through the Semdok Connectors plugin: setup, safe querying, and email rules.',
        whenToUse: 'When the user wants to connect, query or use BigQuery, Databricks, Genie or Gmail, or asks what connectors exist.',
        source: 'runtime',
        content: SKILL,
      })
    },
  })

  // A token saved in the app's credential file takes effect without a restart.
  ctx.on('credentials/reference-updated', (ref) => {
    if (String(ref) === 'DATABRICKS_TOKEN' && settingsOf('databricks').enabled) refresh('databricks').catch(() => {})
  })

  // Connect what was turned on before, in the background: a first-time download must not hold up startup.
  for (const key of CONNECTORS) {
    if (settingsOf(key).enabled) refresh(key).catch(() => {})
  }
}
