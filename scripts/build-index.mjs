// Build the plugin market site: <out>/index.json, <out>/icons/, <out>/index.html.
// Every folder under plugins/ whose package.json declares dsh.bundle becomes one plugin,
// pinned to the last commit that changed that folder. Usage: node scripts/build-index.mjs [out]
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const out = process.argv[2] ?? 'site'
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const repo = process.env.GITHUB_REPOSITORY
  ? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}`
  : git('remote', 'get-url', 'origin').replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/')
if (!repo.startsWith('https://')) throw new Error(`repository URL must be https: ${repo}`)
const market = JSON.parse(readFileSync('market.json', 'utf8'))

rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'icons'), { recursive: true })
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
    copyFileSync(join(path, 'icon.svg'), join(out, 'icons', `${dir}.svg`))
    entry.icon = `icons/${dir}.svg`
  }
  plugins.push(entry)
}
const index = { format: 1, title: market.title, ...(market.description ? { description: market.description } : {}), plugins }
writeFileSync(join(out, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)
const pages = repo.replace(/^https:\/\/github\.com\/([^/]+)\/(.+)$/, (_m, owner, name) => `https://${owner.toLowerCase()}.github.io/${name}`)
writeFileSync(join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>${market.title.en}</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px;color:#033226}code{background:#eef6f2;padding:2px 6px;border-radius:4px}</style>
<h1>${market.title.en}</h1><p>To browse these plugins in Semdok Harness: <b>Plugins → Discover → Add index source</b>, then paste</p>
<p><code>${pages}/index.json</code></p><ul>${plugins.map(p => `<li><b>${p.title.en ?? p.name}</b> ${p.versions[0].version}: ${p.description.en ?? p.description}</li>`).join('')}</ul>\n`)
console.log(`${out}/index.json: ${plugins.length} plugin(s) from ${repo}`)
for (const p of plugins) console.log(`  ${p.name} ${p.versions[0].version} @ ${p.versions[0].source.commit.slice(0, 12)}`)
