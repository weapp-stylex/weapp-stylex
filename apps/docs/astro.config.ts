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
        Aside: { revision: '1', render: ({ children }) => children },
      },
    },
  })],
})
