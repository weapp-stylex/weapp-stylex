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
      keep: [
        {
          file: 'pnpm-workspace.yaml',
          path: ['overrides', 'esbuild'],
          reason: 'Preserve audited major-version boundaries for framework hosts and legacy CommonJS consumers.',
          upstreamHash: '45a74a90c77cf503bee888730d4f7cb3447778d78a417efbe7798985dfd46614',
          localHash: '398b676e47d03a29016ee92fe378b8b4f1b3e965390c4c64ce78d27f79df74d1',
        },
        {
          file: 'pnpm-workspace.yaml',
          path: ['overrides', 'js-yaml'],
          reason: 'Preserve audited major-version boundaries for framework hosts and legacy CommonJS consumers.',
          upstreamHash: '019afad1553edbfee1a8b07c9ec626709a2a450a26deb960869169e9ce33ba71',
          localHash: '398b676e47d03a29016ee92fe378b8b4f1b3e965390c4c64ce78d27f79df74d1',
        },
        {
          file: 'pnpm-workspace.yaml',
          path: ['overrides', 'nanoid'],
          reason: 'Preserve audited major-version boundaries for framework hosts and legacy CommonJS consumers.',
          upstreamHash: 'b1eb47f82e58672bc881ddaf68203265a9e09bb30fb6311cad73ccd9a7c8a909',
          localHash: '398b676e47d03a29016ee92fe378b8b4f1b3e965390c4c64ce78d27f79df74d1',
        },
        {
          file: 'pnpm-workspace.yaml',
          path: ['overrides', 'postcss-selector-parser'],
          reason: 'Preserve audited major-version boundaries for framework hosts and legacy CommonJS consumers.',
          upstreamHash: 'd90648f3bc494eeb7089596b38bc9f911284bd7fa7916022235ba56a38f57027',
          localHash: '398b676e47d03a29016ee92fe378b8b4f1b3e965390c4c64ce78d27f79df74d1',
        },
        {
          file: 'pnpm-workspace.yaml',
          path: ['overrides', 'uuid'],
          reason: 'Preserve audited major-version boundaries for framework hosts and legacy CommonJS consumers.',
          upstreamHash: 'bc5e15e67a58149431173e9d4c5ebd5105ba996e97ee3ac49bf69bebd072a138',
          localHash: '398b676e47d03a29016ee92fe378b8b4f1b3e965390c4c64ce78d27f79df74d1',
        },
        {
          file: 'pnpm-workspace.yaml',
          path: ['overrides', 'vite'],
          reason: 'Preserve audited major-version boundaries for framework hosts and legacy CommonJS consumers.',
          upstreamHash: 'e8d3cfbaf8b625932f38899c955c7bac831057406f56fc205790680fd1b83747',
          localHash: '398b676e47d03a29016ee92fe378b8b4f1b3e965390c4c64ce78d27f79df74d1',
        },
      ],
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
