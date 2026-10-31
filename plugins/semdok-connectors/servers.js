// Connector helpers with no Semdok Harness imports, so they also run on their own in tests: the pinned
// server packages and their first-use install with the app's own pnpm, the Databricks endpoints and
// token lookup, the Gmail file locations, and the plugin's settings file.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const WINDOWS = process.platform === 'win32'

/**
 * Server packages, pinned to exact versions. Each installs into its own folder the first time its connector is
 * turned on, so nobody downloads a server they do not use.
 */
export const SERVERS = {
  // Google's MCP Toolbox for Databases; the npm package pulls in one platform binary (about 280 MB unpacked).
  bigquery: { package: '@toolbox-sdk/server', version: '1.15.0', size: 'about 280 MB' },
  // Gmail MCP server with scope-gated tools; most of its size is Google's API client library.
  gmail: { package: '@klodr/gmail-mcp', version: '3.0.0', size: 'about 250 MB' },
}

/**
 * The Node.js and pnpm that Semdok Harness ships, used to install and run the servers.
 * @param {string} dshHome - the harness home, where the desktop app unpacks its runtime.
 * @returns {{ node: string, pnpm: string } | undefined}
 */
export function appRuntime(dshHome) {
  const roots = [
    join(dshHome, 'dsh-runtimes', 'dsh-primary-runtime'),
    process.resourcesPath && join(process.resourcesPath, 'runtime', 'primary-runtime'),
    process.env.SEMDOK_HARNESS_APP_DIR && join(process.env.SEMDOK_HARNESS_APP_DIR, 'runtime', 'primary-runtime'),
  ].filter(Boolean)
  for (const root of roots) {
    const node = join(root, 'dependencies', 'node', 'bin', WINDOWS ? 'node.exe' : 'node')
    const pnpm = join(root, 'dependencies', 'pnpm', 'bin', 'pnpm.cjs')
    if (existsSync(node) && existsSync(pnpm)) return { node, pnpm }
  }
  return undefined
}

/** Run a program; resolve with its output, reject with the end of it. */
export function run(command, args, { cwd, env, signal, timeoutMs, onOutput } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, windowsHide: true })
    let output = ''
    const keep = (chunk) => {
      output = (output + chunk).slice(-8000)
      onOutput?.(String(chunk))
    }
    child.stdout.setEncoding('utf8').on('data', keep)
    child.stderr.setEncoding('utf8').on('data', keep)
    const stop = () => child.kill()
    signal?.addEventListener('abort', stop, { once: true })
    const timer = timeoutMs ? setTimeout(stop, timeoutMs) : undefined
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop) }
    child.once('error', (error) => { done(); reject(error) })
    child.once('close', (code) => {
      done()
      if (signal?.aborted) reject(signal.reason ?? new Error('cancelled'))
      else if (code === 0) resolve(output)
      else reject(new Error(`${output.trim().split('\n').slice(-12).join('\n') || `exit code ${code}`}`))
    })
  })
}

/** The folder a connector's server is installed in. */
export function serverDir(dataDir, key) {
  return join(dataDir, 'servers', key)
}

/** The installed version of a connector's server package, or undefined. */
export function installedVersion(dataDir, key) {
  const file = join(serverDir(dataDir, key), 'node_modules', ...SERVERS[key].package.split('/'), 'package.json')
  try {
    return JSON.parse(readFileSync(file, 'utf8')).version
  } catch {
    return undefined
  }
}

/**
 * Install a connector's pinned server package unless that version is already there.
 * pnpm checks every download against the registry's integrity hash; install scripts do not run.
 */
export async function installServer(dataDir, key, runtime, { signal, onOutput } = {}) {
  const spec = SERVERS[key]
  if (installedVersion(dataDir, key) === spec.version) return
  const dir = serverDir(dataDir, key)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: `semdok-connector-${key}`, private: true }, null, 2)}\n`)
  // A flat node_modules keeps paths short: Windows cannot start a program whose path is 260 characters or longer.
  await run(runtime.node, [runtime.pnpm, 'add', `${spec.package}@${spec.version}`, '--save-exact', '--ignore-scripts',
    '--ignore-workspace', '--config.auto-install-peers=false', '--config.node-linker=hoisted'], {
    cwd: dir, signal, onOutput,
    // pnpm starts helper processes with whatever node is on PATH: make that the app's own.
    env: { PATH: `${dirname(runtime.node)}${WINDOWS ? ';' : ':'}${process.env.PATH ?? process.env.Path ?? ''}` },
  })
  if (installedVersion(dataDir, key) !== spec.version) throw new Error(`${spec.package}@${spec.version} did not install`)
}

/** The Toolbox binary for this computer, from the platform package next to @toolbox-sdk/server. */
export function toolboxBinary(dataDir) {
  const platform = `${process.platform}-${process.arch}`
  const binary = dir => join(dir, 'bin', WINDOWS ? 'toolbox.exe' : 'toolbox')
  const modules = join(serverDir(dataDir, 'bigquery'), 'node_modules')
  // The flat layout installServer asks for.
  const flat = binary(join(modules, '@toolbox-sdk', `server-${platform}`))
  if (existsSync(flat)) return flat
  try {
    // An isolated pnpm layout: the platform package sits next to the real location of @toolbox-sdk/server.
    const server = realpathSync(join(modules, '@toolbox-sdk', 'server', 'package.json'))
    return binary(dirname(createRequire(server).resolve(`@toolbox-sdk/server-${platform}/package.json`)))
  } catch {
    throw new Error(`Google's MCP Toolbox has no build for ${platform}.`)
  }
}

/**
 * Google credentials the Toolbox can find (Application Default Credentials): a key file named by
 * GOOGLE_APPLICATION_CREDENTIALS, or the file "gcloud auth application-default login" writes.
 * @returns {{ source: string } | { problem: string } | undefined}
 */
export function googleCredentials() {
  const named = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (named) return existsSync(named) ? { source: `the key file in GOOGLE_APPLICATION_CREDENTIALS (${named})` } : { problem: `GOOGLE_APPLICATION_CREDENTIALS names ${named}, which does not exist.` }
  const config = process.env.CLOUDSDK_CONFIG
    || (WINDOWS ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'gcloud') : join(homedir(), '.config', 'gcloud'))
  const file = join(config, 'application_default_credentials.json')
  return existsSync(file) ? { source: `your gcloud application-default sign-in (${file})` } : undefined
}

/** The Gmail server's entry script. */
export function gmailEntry(dataDir) {
  return join(serverDir(dataDir, 'gmail'), 'node_modules', '@klodr', 'gmail-mcp', 'dist', 'index.js')
}

/** Where the Gmail server keeps the Google OAuth client and the sign-in tokens (its own defaults unless set). */
export function gmailFiles(settings = {}) {
  return {
    oauthKeys: settings.oauthKeysPath || join(homedir(), '.gmail-mcp', 'gcp-oauth.keys.json'),
    credentials: settings.credentialsPath || join(homedir(), '.gmail-mcp', 'credentials.json'),
  }
}

/** Databricks MCP servers this plugin can connect, by settings key. */
export const DATABRICKS_SERVERS = {
  genie_one: { serverName: 'databricks_genie', label: 'Genie One', path: () => '/ai-gateway/mcp-services/system.ai.genie_one_mcp' },
  sql: { serverName: 'databricks_sql', label: 'Databricks SQL', path: () => '/api/2.0/mcp/sql' },
  genie_space: {
    serverName: 'databricks_space', label: 'Genie Agent',
    path: (settings) => `/api/2.0/mcp/genie/${encodeURIComponent(settings.genieSpaceId)}`,
  },
}

/** A workspace URL from what the user typed: https only, except for a server on this computer. */
export function databricksOrigin(host) {
  let value = String(host ?? '').trim().replace(/\/+$/, '')
  if (value === '') return undefined
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`
  const url = new URL(value)
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('The Databricks workspace URL must start with https://')
  }
  return url.origin
}

/**
 * One profile of the Databricks CLI's configuration file (~/.databrickscfg, or DATABRICKS_CONFIG_FILE).
 * @returns {{ host?: string, token?: string, file: string } | undefined}
 */
export function databricksCliProfile(profile = 'DEFAULT') {
  const file = process.env.DATABRICKS_CONFIG_FILE || join(homedir(), '.databrickscfg')
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
  const values = {}
  let section
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue
    const header = /^\[(.+)\]$/.exec(line)
    if (header) {
      section = header[1].trim()
      continue
    }
    const pair = /^([^=]+?)\s*=\s*(.*)$/.exec(line)
    if (pair && section === profile) values[pair[1].trim().toLowerCase()] = pair[2].trim()
  }
  return values.host || values.token ? { host: values.host, token: values.token, file } : undefined
}

/** The plugin's settings file: which connectors are on, and their non-secret settings. */
export function readSettings(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'))
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

export function writeSettings(file, settings) {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`)
  renameSync(temporary, file)
}

/** True when a file exists. */
export const exists = path => existsSync(path)
