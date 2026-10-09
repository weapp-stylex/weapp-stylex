import nimbus, { defineConfig as defineNimbusConfig } from '@cloudflare/nimbus-docs'
import { defineConfig } from 'astro/config'

export default defineConfig({
  output: 'static',
  // Keep the Pagefind loader external so Vite finalizes dynamic imports before Astro renders it.
  vite: { build: { assetsInlineLimit: 0 } },
  integrations: [nimbus(defineNimbusConfig({
    site: 'https://stylex.weapp.dev',
    title: 'weapp-stylex',
    description: 'Official StyleX semantics for WeChat mini-programs. Native, Wevu, Taro and uni-app.',
    locale: 'en',
    github: 'https://github.com/weapp-stylex/weapp-stylex',
  }), {
    icons: false,
    rules: {
      'nimbus/frontmatter-shape': 'error',
      'nimbus/internal-link': 'error',
      'nimbus/single-h1': 'error',
    },
    markdown: {
      componentMap: {
        Aside: { revision: '2', render: ({ attrs, children }) => `\n${attrs.title ? `**${attrs.title}**\n\n` : ''}${children}\n` },
        ApiTable: { revision: '1', render: ({ attrs, children }) => `\n${attrs.title ? `**${attrs.title}**\n\n` : ''}${children}\n` },
        Tabs: { revision: '1', render: ({ children }) => children },
        Tab: { revision: '1', render: ({ attrs, children }) => `\n**${attrs.label}**\n\n${children}\n` },
        Steps: { revision: '1', render: ({ children }) => children },
        Step: { revision: '1', render: ({ attrs, children }) => `\n### ${attrs.title}\n\n${children}\n` },
        HomeHero: { revision: '1', render: ({ attrs, children }) => `\n${attrs.description}\n\n${children}\n` },
        CardGrid: { revision: '1', render: ({ children }) => children },
        LinkCard: { revision: '1', render: ({ attrs }) => `\n[${attrs.title}](${attrs.href})\n\n${attrs.description}\n` },
      },
    },
  })],
})
