// Vercel for the agent through Vercel's REST API with one token. Vercel's hosted MCP server signs in only through
// OAuth, so this connector calls the API itself. Every tool reads; none deploys, deletes or changes settings, and
// environment variables are listed by name only, never by value.
import { defineTool } from '@deepseek-ai/dsh-tools'

const API = 'https://api.vercel.com'
const REPORT = {
  schema: { type: 'object', additionalProperties: false, properties: { report: { type: 'string', required: true } } },
  render: (_args, value) => [{ type: 'text', text: value.report }],
}
const TEAM = { type: 'string', description: 'Team ID or slug, for a project that belongs to a team. Omit for your personal account. vercel_teams lists them.' }
const when = ms => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'unknown')

/** Call the Vercel API with the token; errors carry Vercel's own message. */
export async function vercelApi(token, path, { team, base = API, signal } = {}) {
  const url = new URL(path, base)
  if (team) url.searchParams.set(/^team_/.test(team) ? 'teamId' : 'slug', team)
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal })
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  if (!response.ok) {
    const message = body?.error?.message ?? (typeof body === 'string' ? body.slice(0, 200) : response.statusText)
    throw new Error(`Vercel ${response.status}: ${message}`)
  }
  return body
}

/**
 * Register the Vercel tools.
 * @param {object} ctx - the plugin context with `tools`.
 * @param {(signal?: AbortSignal) => Promise<string>} token - resolves the saved token or throws the setup step.
 * @param {string} [base] - API origin, for tests.
 */
export function registerVercelTools(ctx, token, base = API) {
  const call = async (path, team, signal) => vercelApi(await token(signal), path, { team, base, signal })
  const tool = (name, title, description, parameters, run) => ctx.tools.register(defineTool({
    name, description, parameters, output: REPORT,
    presentCall: () => ({ card: 'generic', title, kind: 'read' }),
    async execute(args, exec) { return { report: await run(args, exec.signal) } },
  }))

  tool('vercel_teams', 'Vercel teams', 'List the Vercel teams the saved token can see, with their IDs and slugs.', {}, async (_args, signal) => {
    const { teams = [] } = await call('/v2/teams?limit=50', undefined, signal)
    return teams.length === 0 ? 'No teams: only the personal account.' : teams.map(t => `- ${t.name} (slug ${t.slug}, id ${t.id})`).join('\n')
  })

  tool('vercel_projects', 'Vercel projects', 'List Vercel projects with their framework, production address and last update.', {
    search: { type: 'string', description: 'Only projects whose name contains this.' }, team: TEAM,
  }, async (args, signal) => {
    const query = new URLSearchParams({ limit: '50', ...args.search ? { search: args.search } : {} })
    const { projects = [] } = await call(`/v9/projects?${query}`, args.team, signal)
    if (projects.length === 0) return 'No projects found.'
    return projects.map((p) => {
      const production = p.targets?.production?.alias?.[0] ?? p.alias?.[0]?.domain
      return `- ${p.name} (id ${p.id}): ${p.framework ?? 'no framework'}${production ? `, https://${production}` : ''}, updated ${when(p.updatedAt)}`
    }).join('\n')
  })

  tool('vercel_deployments', 'Vercel deployments', 'List recent deployments of a project (or of every project): state, target, address, branch and commit message.', {
    project: { type: 'string', description: 'Project name or ID. Omit for all projects.' },
    target: { type: 'string', enum: ['production', 'preview'], description: 'Only production or only preview deployments.' },
    limit: { type: 'number', description: 'How many, 1 to 20. Default 10.' },
    team: TEAM,
  }, async (args, signal) => {
    const query = new URLSearchParams({ limit: String(Math.min(20, Math.max(1, Math.round(args.limit ?? 10)))) })
    if (args.project) query.set('projectId', args.project)
    if (args.target) query.set('target', args.target)
    const { deployments = [] } = await call(`/v6/deployments?${query}`, args.team, signal)
    if (deployments.length === 0) return 'No deployments found.'
    return deployments.map((d) => {
      const meta = d.meta ?? {}
      const commit = meta.githubCommitMessage ?? meta.gitlabCommitMessage ?? meta.bitbucketCommitMessage
      const branch = meta.githubCommitRef ?? meta.gitlabCommitRef ?? meta.bitbucketCommitRef
      return `- ${d.name} ${d.uid}: ${d.state ?? d.readyState} (${d.target ?? 'preview'}), https://${d.url}, ${when(d.created ?? d.createdAt)}`
        + `${branch ? `, branch ${branch}` : ''}${commit ? `, "${String(commit).split('\n')[0].slice(0, 80)}"` : ''}`
    }).join('\n')
  })

  tool('vercel_deployment_logs', 'Vercel build logs', 'Read the build log of one deployment, to find why a build failed. Returns the last lines and every line that mentions an error.', {
    deployment: { type: 'string', required: true, description: 'Deployment ID (dpl_…) or its address.' },
    lines: { type: 'number', description: 'How many final lines, 10 to 200. Default 60.' },
    team: TEAM,
  }, async (args, signal) => {
    const id = String(args.deployment).replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    const events = await call(`/v3/deployments/${encodeURIComponent(id)}/events?limit=-1`, args.team, signal)
    const rows = (Array.isArray(events) ? events : []).map(e => e.payload?.text ?? e.text).filter(Boolean)
    if (rows.length === 0) return 'The deployment has no build log yet.'
    const count = Math.min(200, Math.max(10, Math.round(args.lines ?? 60)))
    const errors = rows.filter(row => /error|failed|cannot|not found|exit code [1-9]/i.test(row)).slice(-20)
    return [`Build log of ${id} (${rows.length} lines).`, ...errors.length ? ['Lines mentioning errors:', ...errors.map(r => `! ${r}`)] : [],
      `Last ${Math.min(count, rows.length)} lines:`, ...rows.slice(-count)].join('\n')
  })

  tool('vercel_domains', 'Vercel domains', 'List the domains in the account or team, and whether each is verified.', { team: TEAM }, async (args, signal) => {
    const { domains = [] } = await call('/v5/domains?limit=50', args.team, signal)
    return domains.length === 0 ? 'No domains.' : domains.map(d => `- ${d.name}: ${d.verified ? 'verified' : 'not verified'}${d.serviceType ? `, ${d.serviceType}` : ''}`).join('\n')
  })

  tool('vercel_env_names', 'Vercel environment variables', 'List the environment variable NAMES of a project and which environments use them. Values are never read or shown.', {
    project: { type: 'string', required: true, description: 'Project name or ID.' }, team: TEAM,
  }, async (args, signal) => {
    const { envs = [] } = await call(`/v10/projects/${encodeURIComponent(args.project)}/env`, args.team, signal)
    return envs.length === 0 ? 'No environment variables.' : envs.map(e => `- ${e.key}: ${(e.target ?? []).join(', ') || 'no environment'} (${e.type})`).join('\n')
  })
}
