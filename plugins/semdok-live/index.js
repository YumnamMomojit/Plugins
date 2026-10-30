// Semdok Harness plugin: the semdok_live_embed_code tool builds a validated Sem live assistant
// tag (https://live.semdok.com) for one kind of website, and the semdok-live skill tells the
// agent how to place it. Only public sem_pub_ keys are accepted: the widget passes its key to
// the browser, so a secret key on a website would be visible to every visitor.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'semdok-live'
export const inject = ['tools']

const SKILL = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'skill.md'), 'utf8')
const PUBLIC_KEY = /^sem_pub_(?:live_[0-9a-f]{16}|demo)$/
const FRAMEWORKS = ['html', 'react-vite', 'nextjs-app', 'nextjs-pages', 'wordpress', 'shopify', 'wix', 'webflow']

const PLACEMENT = {
  'html': 'Paste the tag just before </body> on every page that should show Sem (or in the shared footer template).',
  'react-vite': 'Paste the tag just before </body> in index.html at the project root (Create React App: public/index.html). Do not put it in a component.',
  'nextjs-app': 'In app/layout.tsx (or .jsx/.js), paste the tag as the last child inside <body>. Use a plain <script> element as given: next/script loads scripts dynamically, and the widget then cannot read its own settings.',
  'nextjs-pages': 'In pages/_document.tsx (create it from the Next.js default if missing), paste the tag right after <NextScript /> inside <body>.',
  'wordpress': 'Easiest: install the "WPCode" (or "Insert Headers and Footers") plugin and paste the tag into the Footer section. Or: Appearance → Theme File Editor → footer.php, just before </body> (use a child theme so updates keep it).',
  'shopify': 'Online Store → Themes → … → Edit code → layout/theme.liquid, paste just before </body>, then Save.',
  'wix': 'Settings → Custom code → Add custom code: paste the tag, choose "All pages", place it in "Body - end". Needs a Wix premium plan with a connected domain.',
  'webflow': 'Site settings → Custom code → Footer code: paste the tag, save, and publish. Needs a paid Webflow site plan.',
}

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

export function apply(ctx, config = {}) {
  const widgetUrl = config.widgetUrl ?? 'https://live.semdok.com/widget/sem-widget.js'

  ctx.tools.register(defineTool({
    name: 'semdok_live_embed_code',
    description: 'Build the script tag that adds the Sem live 3D AI assistant (live.semdok.com) to a website, with placement '
      + 'instructions for the site type. Requires the assistant\'s PUBLIC key (sem_pub_live_…) from Semdok Console → Assistants; '
      + 'never use a secret sk… key on a website. Load the semdok-live skill first for the full procedure.',
    parameters: {
      public_key: { type: 'string', required: true, description: 'Public assistant key, sem_pub_live_ followed by 16 hex characters (sem_pub_demo for testing)' },
      framework: { type: 'string', enum: FRAMEWORKS, description: 'Kind of website. Default html.' },
      brand: { type: 'string', description: 'Name shown on the assistant, e.g. "Apex Cloud". Default "SEM Assistant".' },
      greeting: { type: 'string', description: 'First message the assistant shows.' },
      avatar: { type: 'string', enum: ['female', 'male'], description: 'Default female.' },
      theme: { type: 'string', description: 'Colour theme name from the Console, e.g. cyan. Default cyan.' },
      background: { type: 'string', description: 'Avatar background name from the Console, e.g. cyber or studio_dark. Default cyber.' },
      position: { type: 'string', enum: ['bottom-right', 'bottom-left', 'top-right', 'top-left'], description: 'Launcher corner. Default bottom-right.' },
      button_label: { type: 'string', description: 'Launcher button text. Default "Ask SEM".' },
      auto_open: { type: 'boolean', description: 'Open the assistant when the page loads. Default false.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          snippet: { type: 'string', required: true },
          placement: { type: 'string', required: true },
          warnings: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Snippet:\n\n${value.snippet}\n\nWhere to put it: ${value.placement}`
          + (value.warnings.length ? `\n\nNotes:\n${value.warnings.map(w => `- ${w}`).join('\n')}` : ''),
      }],
    },
    presentCall: args => ({ card: 'generic', title: `Sem live widget${args?.brand ? `: ${args.brand}` : ''}`, kind: 'read' }),
    async execute(args) {
      const key = args.public_key.trim()
      if (/^sk[-_]/i.test(key)) {
        throw new Error('That is a SECRET key. Never put it on a website: every visitor could read it and spend your credits. '
          + 'Use the assistant\'s public key (sem_pub_live_…) from Semdok Console → Assistants, and consider rotating the secret key if it was shared.')
      }
      if (!PUBLIC_KEY.test(key)) throw new Error('The public key must look like sem_pub_live_ followed by 16 hex characters (or sem_pub_demo for testing).')
      const framework = args.framework ?? 'html'
      const attributes = [
        ['src', widgetUrl],
        ['data-api-key', key],
        // Without it, the widget on a localhost page loads the assistant from the local server.
        ['data-origin', new URL(widgetUrl).origin],
        ['data-brand', args.brand],
        ['data-greeting', args.greeting],
        ['data-avatar', args.avatar],
        ['data-theme', args.theme],
        ['data-bg', args.background],
        ['data-position', args.position],
        ['data-trigger-label', args.button_label],
        ['data-auto-open', args.auto_open === undefined ? undefined : String(args.auto_open)],
      ].filter(([, value]) => value !== undefined && String(value).trim() !== '')
      const lines = attributes.map(([attr, value]) => `  ${attr}="${escape(String(value).trim())}"`)
      const jsx = framework === 'nextjs-app' || framework === 'nextjs-pages'
      const snippet = `<!-- Sem live assistant: https://live.semdok.com -->\n<script\n${lines.join('\n')}\n  defer${jsx ? '\n/>' : '>\n</script>'}`
      const warnings = []
      if (key === 'sem_pub_demo') warnings.push('sem_pub_demo is a demo key for testing. Use your assistant\'s own public key before going live.')
      warnings.push('In Semdok Console → Assistants, limit the assistant to your own website domains so the public key cannot be reused on other sites.')
      if (jsx) warnings.push('In JSX, an HTML comment is not allowed: drop the first line or turn it into {/* … */}.')
      return { snippet, placement: PLACEMENT[framework], warnings }
    },
  }))

  // Skills are optional: the tool works without them.
  ctx.plugin({
    name: 'semdok-live-skill',
    inject: ['skills'],
    apply(child) {
      child.skills.register({
        name: 'semdok-live',
        description: 'Add, update, or remove the Sem live 3D AI assistant (live.semdok.com) on a website.',
        whenToUse: 'The user wants Sem, the Semdok assistant, a 3D avatar chat, or a Semdok chat widget on a website or web app.',
        source: 'runtime',
        content: SKILL,
      })
    },
  })
}
