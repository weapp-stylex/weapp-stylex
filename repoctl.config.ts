import type { MonorepoConfig } from 'repoctl'

export default {
  commands: {
    deps: {
      groups: [
        {
          name: 'taro-vite4',
          workspaces: ['examples/taro-react', 'examples/taro-vue3'],
          dependencies: ['vite'],
          reason: 'Taro 4.3 runner requires Vite 4.',
        },
        {
          name: 'uni-vue3',
          workspaces: ['examples/uni-vue3'],
          dependencies: ['vite', 'vue'],
          reason: 'DCloud vue3 channel pins Vite 5.2.8 and Vue 3.4.21.',
        },
      ],
    },
    create: {
      defaultTemplate: 'tsdown',
      renameJson: false,
    },
    clean: {
      autoConfirm: false,
      includePrivate: true,
    },
    upgrade: {
      skipOverwrite: false,
      mergeTargets: true,
    },
  },
  tooling: {
    commitlint: {
      extends: ['@commitlint/config-conventional'],
    },
    eslint: {
      astro: true,
      ignores: ['**/fixtures/**', '.repoctl/template-baselines/**'],
      svelte: true,
      vue: true,
    },
    stylelint: {
      rules: {
        'media-feature-range-notation': 'prefix',
      },
    },
    lintStaged: {
      repoCommand: 'pnpm exec repo',
    },
    vitest: {
      includeWorkspaceRootConfig: false,
      coverageExclude: ['**/dist/**'],
      coverageSkipFull: true,
    },
    vitestProject: {
      globals: true,
      testTimeout: 60_000,
    },
  },
} satisfies MonorepoConfig
