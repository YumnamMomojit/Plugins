// Build the plugin market index at the repository root: index.json and icons/.
// Semdok Harness reads it from https://raw.githubusercontent.com/<owner>/<repo>/main/index.json.
// Every folder under plugins/ whose package.json declares dsh.bundle becomes one plugin,
// pinned to the last commit that changed that folder. Usage: node scripts/build-index.mjs
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const repo = process.env.GITHUB_REPOSITORY
  ? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}`
  : git('remote', 'get-url', 'origin').replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/')
if (!repo.startsWith('https://')) throw new Error(`repository URL must be https: ${repo}`)
const market = JSON.parse(readFileSync('market.json', 'utf8'))

rmSync('icons', { recursive: true, force: true })
mkdirSync('icons', { recursive: true })
const plugins = []
for (const dir of readdirSync('plugins', { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort()) {
  const path = `plugins/${dir}`
  const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))
  if (!pkg.dsh?.bundle) continue
  const commit = git('log', '-1', '--format=%H', '--', path)
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`${path} has no commit yet; commit it first`)
  const extra = market.plugins?.[pkg.name] ?? {}
  const entry = {
    name: pkg.name,
    title: extra.title ?? pkg.name,
    description: extra.description ?? pkg.description,
    ...(extra.author ? { author: extra.author } : {}),
    homepage: `${repo}/tree/main/${path}#readme`,
    repository: { url: repo, directory: path },
    versions: [{
      version: pkg.version,
      publishTimestamp: Number(git('log', '-1', '--format=%ct', '--', path)),
      ...(pkg.engines?.dsh ? { engines: { dsh: pkg.engines.dsh } } : {}),
      source: { type: 'git', url: repo, commit, path },
    }],
  }
  if (existsSync(join(path, 'icon.svg'))) {
    copyFileSync(join(path, 'icon.svg'), join('icons', `${dir}.svg`))
    entry.icon = `icons/${dir}.svg`
  }
  plugins.push(entry)
}
// Plugins kept in their own repositories: market.json entries with "repository" and no plugins/ folder.
// Each is pinned to the repository's current main commit; its package.json sits at the repository root.
for (const [name, extra] of Object.entries(market.plugins ?? {})) {
  const url = extra.repository?.replace(/\/$/, '')
  if (!url || plugins.some(p => p.name === name)) continue
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(url)
  if (!match) throw new Error(`${name}: repository must be https://github.com/<owner>/<repo>`)
  const [, owner, repoName] = match
  const commit = git('ls-remote', `${url}.git`, 'refs/heads/main').split(/\s+/)[0]
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`${name}: cannot read the main branch of ${url}`)
  const raw = file => fetch(`https://raw.githubusercontent.com/${owner}/${repoName}/${commit}/${file}`)
  const pkgResponse = await raw('package.json')
  if (!pkgResponse.ok) throw new Error(`${name}: ${url} has no package.json at ${commit}`)
  const pkg = await pkgResponse.json()
  if (pkg.name !== name || !pkg.dsh?.bundle) throw new Error(`${name}: ${url} is not the "${name}" dsh bundle`)
  const info = await (await fetch(`https://api.github.com/repos/${owner}/${repoName}/commits/${commit}`, { headers: { accept: 'application/vnd.github+json' } })).json()
  const entry = {
    name,
    title: extra.title ?? name,
    description: extra.description ?? pkg.description,
    ...(extra.author ? { author: extra.author } : {}),
    homepage: `${url}#readme`,
    repository: { url },
    versions: [{
      version: pkg.version,
      publishTimestamp: Math.floor(Date.parse(info.commit.committer.date) / 1000),
      ...(pkg.engines?.dsh ? { engines: { dsh: pkg.engines.dsh } } : {}),
      source: { type: 'git', url, commit },
    }],
  }
  const icon = await raw('icon.svg')
  if (icon.ok) {
    writeFileSync(join('icons', `${name}.svg`), Buffer.from(await icon.arrayBuffer()))
    entry.icon = `icons/${name}.svg`
  }
  plugins.push(entry)
}
plugins.sort((a, b) => a.name.localeCompare(b.name))

const index = { format: 1, title: market.title, ...(market.description ? { description: market.description } : {}), plugins }
writeFileSync('index.json', `${JSON.stringify(index, null, 2)}\n`)
console.log(`index.json: ${plugins.length} plugin(s) from ${repo}`)
for (const p of plugins) console.log(`  ${p.name} ${p.versions[0].version} @ ${p.versions[0].source.commit.slice(0, 12)}`)
