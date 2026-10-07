# weapp-stylex

## Create packages and apps

```bash
pnpm exec repo templates
pnpm exec repo new <name> --template <key>
```

| Intent                   | Template key  |
| ------------------------ | ------------- |
| Vue / full-stack web app | `vue-hono`    |
| API / Hono service       | `hono-server` |
| TypeScript library / SDK | `tsdown`      |
| Vue component library    | `vue-lib`     |
| Documentation site       | `vitepress`   |
| CLI                      | `cli`         |

Preview without writing files: `pnpm exec repo new <name> --template <key> --dry-run`.

## Create a new project

If the user asks you to create a new business project, do not add it inside an
existing unrelated repository. Use a new or empty directory outside the repoctl
source checkout. Start a new workspace with:

```bash
pnpm create repoctl@latest <dir> -- --yes --templates <keys>
cd <dir>
corepack enable
pnpm install
pnpm exec repo init
pnpm exec repo doctor
```

## Verify

```bash
pnpm exec repo doctor
pnpm exec repo check
```

## Do not

- Do not add packages by copying folders. Use `repo new`.
- Do not hand-edit managed root configs that `repo init` / `repo upgrade` own.
- Do not invent publish versions by hand. Use `pnpm change` for publishable packages.

## Requirements

- Node.js 22.13 or newer
- pnpm (run `corepack enable` so the declared workspace version is used)
- CLI output is English by default; `--lang zh-CN` or `REPOCTL_LANG=zh-CN` selects Simplified Chinese

## Scope

This repository contains the native WeChat mini-program StyleX adapter. The
first release targets `Page`/`Component` projects using WXML, WXSS and
TypeScript, built with `weapp-vite`.

## Development

- Node.js `>=22.12.0` and pnpm are required.
- Run `pnpm install` before the first build.
- Run `pnpm test` for unit tests and `pnpm build` for package builds.
- Run `pnpm --filter wechat-native build` to build the example.

The compiler uses the official StyleX Babel plugin. Keep generated WXSS
compatible with the WeChat runtime: CSS Layers and browser-only specificity
polyfills are disabled by design.

## WXML contract

StyleX declarations are compiled away. Expose class strings through
`stylex.attrs(style).class` and place those strings in Page or Component data.
The adapter does not parse WXML or add a custom `sx` attribute.

## Release boundary

The stable first-release scope is the WeChat main package, pages, components
and ordinary subpackages. Independent subpackages, other mini-program
platforms, stateful HMR patches and WXML `sx` syntax require a later release.
