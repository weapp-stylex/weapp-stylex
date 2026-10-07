# weapp-stylex

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
