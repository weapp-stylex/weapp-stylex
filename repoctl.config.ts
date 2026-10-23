import type { MonorepoConfig } from 'repoctl'

const documentedPackages = {
  '@weapp-stylex/compiler': 'packages/compiler',
  '@weapp-stylex/core': 'packages/core',
  '@weapp-stylex/taro': 'packages/taro',
  '@weapp-stylex/uni-app': 'packages/uni-app',
  '@weapp-stylex/weapp-vite': 'packages/weapp-vite',
  'weapp-stylex': 'packages/weapp-stylex',
}

export default {
  commands: {
    release: {
      nightly: {
        provider: 'npm',
        schedule: '17 19 * * *',
      },
    },
    docs: {
      sites: {
        stylex: {
          packages: Object.keys(documentedPackages),
          releaseInputs: Object.fromEntries(Object.entries(documentedPackages).map(([name, directory]) => [name, [
            `${directory}/**`,
            'tsconfig.base.json',
            `!${directory}/README*`,
            `!${directory}/CHANGELOG*`,
            `!${directory}/{docs,test,tests,__tests__,test-d,fixtures}/**`,
            `!${directory}/**/*.{test,spec}.*`,
          ]])),
          buildScript: 'docs:build',
          preview: {
            deployScript: 'docs:deploy:preview',
            url: 'https://preview.stylex.weapp.dev',
          },
          stable: {
            deployScript: 'docs:deploy:stable',
            url: 'https://stylex.weapp.dev',
          },
          patchPaths: [
            'apps/docs/src/content/docs/**/*.{md,mdx}',
            'apps/docs/public/**/*.{png,jpg,jpeg,webp,svg,ico}',
          ],
        },
      },
    },
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
