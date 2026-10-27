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
const index = { format: 1, title: market.title, ...(market.description ? { description: market.description } : {}), plugins }
writeFileSync('index.json', `${JSON.stringify(index, null, 2)}\n`)
console.log(`index.json: ${plugins.length} plugin(s) from ${repo}`)
for (const p of plugins) console.log(`  ${p.name} ${p.versions[0].version} @ ${p.versions[0].source.commit.slice(0, 12)}`)
