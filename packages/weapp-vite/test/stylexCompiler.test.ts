import { describe, expect, it } from 'vitest';
import { stylexCompiler } from '../src/index';

type TestContext = {
  root: string;
  srcRoot: string;
  platform: string;
  outputExtensions: { wxss: string };
  isDev: boolean;
  addWatchFile: (id: string) => void;
  warn: (message: string) => void;
  error: (message: string) => never;
  readFile: (id: string) => Promise<string>;
  resolve: () => Promise<null>;
  invalidate: () => void;
  claimSource: () => void;
  getSourceOwner: () => undefined;
};

function makeContext(overrides: Partial<TestContext> = {}): TestContext {
  return {
    root: '/project',
    srcRoot: '/project/src',
    platform: 'wechat',
    outputExtensions: { wxss: 'wxss' },
    isDev: false,
    addWatchFile: () => undefined,
    warn: () => undefined,
    error: (message) => {
      throw new Error(message);
    },
    readFile: async () => '',
    resolve: async () => null,
    invalidate: () => undefined,
    claimSource: () => undefined,
    getSourceOwner: () => undefined,
    ...overrides,
  };
}

async function compile(code: string, id = '/project/src/pages/index/index.ts') {
  const plugin = stylexCompiler();
  if (typeof plugin === 'function') throw new Error('Expected a compiler provider object');
  const context = makeContext();
  const controller = await plugin.create(context as never);
  const request = { id, code, kind: 'script' as const };
  expect(controller.claimSource?.(request)).toBeTruthy();
  const transformed = await controller.transformSource?.(request);
  expect(transformed).toBeTruthy();
  return { controller, transformed: transformed!, context };
}

describe('stylexCompiler', () => {
  it('transforms static styles and exposes attrs class strings', async () => {
    const { transformed } = await compile(`
      import * as stylex from '@weapp-stylex/core';
      const styles = stylex.create({ root: { padding: 16, backgroundColor: 'white' } });
      const sx = { root: stylex.attrs(styles.root).class };
      Page({ data: { sx } });
    `);

    expect(transformed.code).toContain('class: "sx');
    expect(transformed.code).not.toContain('stylex.create');
    expect(transformed.code).not.toContain('padding: 16');
  });

  it('compiles conditional and merged styles to deterministic class branches', async () => {
    const { transformed } = await compile(`
      import * as stylex from '@stylexjs/stylex';
      const styles = stylex.create({ root: { padding: 16 }, active: { opacity: 0.6 } });
      const sx = stylex.attrs(styles.root, active && styles.active).class;
    `);

    expect(transformed.code).toContain('sx1tamke2');
    expect(transformed.code).toContain('sx197sbye');
    expect(transformed.code).toContain('!!active');
  });

  it('deduplicates rules and emits per-directory WXSS imports without layers', async () => {
    const first = await compile(`
      import * as stylex from '@weapp-stylex/core';
      const styles = stylex.create({ root: { padding: 16 } });
      const sx = stylex.attrs(styles.root).class;
    `);
    const second = await compile(`
      import * as stylex from '@weapp-stylex/core';
      const styles = stylex.create({ root: { padding: 16 } });
      const sx = stylex.attrs(styles.root).class;
    `, '/project/src/components/card.ts');

    const bundle = {
      'pages/index/index.js': { type: 'chunk' as const, fileName: 'pages/index/index.js', code: first.transformed.code },
      'pages/index/index.wxss': { type: 'asset' as const, fileName: 'pages/index/index.wxss', source: '.page{}' },
      'components/card.js': { type: 'chunk' as const, fileName: 'components/card.js', code: second.transformed.code },
      'components/card.wxss': { type: 'asset' as const, fileName: 'components/card.wxss', source: '.card{}' },
    };
    const provider = stylexCompiler();
    if (typeof provider === 'function') throw new Error('Expected a compiler provider object');
    const context = makeContext();
    const controller = await provider.create(context as never);
    const requests = [
      {
        id: '/project/src/pages/index/index.ts',
        code: `import * as stylex from '@weapp-stylex/core'; const styles = stylex.create({root:{padding:16}}); const x=stylex.attrs(styles.root).class;`,
        kind: 'script' as const,
      },
      {
        id: '/project/src/components/card.ts',
        code: `import * as stylex from '@weapp-stylex/core'; const styles = stylex.create({root:{padding:16}}); const x=stylex.attrs(styles.root).class;`,
        kind: 'script' as const,
      },
    ];
    for (const request of requests) {
      controller.claimSource?.(request);
      await controller.transformSource?.(request);
    }
    await controller.generateBundle?.(bundle as never, context as never);

    expect(bundle['pages/index/stylex.wxss'].source).toBe(bundle['components/stylex.wxss'].source);
    expect(String(bundle['pages/index/stylex.wxss'].source)).toContain('.sx1tamke2{padding:16px}');
    expect(String(bundle['pages/index/stylex.wxss'].source)).not.toContain('@layer');
    expect(String(bundle['pages/index/index.wxss'].source)).toContain('@import "./stylex.wxss";');
    expect(String(bundle['components/card.wxss'].source)).toContain('@import "./stylex.wxss";');
    expect(String(bundle['pages/index/stylex.wxss'].source).match(/padding:16px/g)?.length).toBe(1);
  });

  it('creates app.wxss when there is no WXSS entry', async () => {
    const { controller, transformed, context } = await compile(`
      import * as stylex from '@weapp-stylex/core';
      const styles = stylex.create({ root: { color: 'red' } });
      const sx = stylex.attrs(styles.root).class;
    `);
    const bundle = {
      'pages/index/index.js': { type: 'chunk' as const, fileName: 'pages/index/index.js', code: transformed.code },
    };
    await controller.generateBundle?.(bundle as never, context as never);
    expect(bundle['stylex.wxss']).toBeTruthy();
    expect(bundle['app.wxss'].source).toBe('@import "./stylex.wxss";\n');
  });

  it('leaves bundles unchanged when no StyleX source is present', async () => {
    const plugin = stylexCompiler();
    if (typeof plugin === 'function') throw new Error('Expected a compiler provider object');
    const controller = await plugin.create(makeContext() as never);
    const bundle = {
      'pages/index/index.js': { type: 'chunk' as const, fileName: 'pages/index/index.js', code: 'Page({});' },
      'pages/index/index.wxss': { type: 'asset' as const, fileName: 'pages/index/index.wxss', source: '.page{}' },
    };
    const before = JSON.stringify(bundle);
    await controller.generateBundle?.(bundle as never, makeContext() as never);
    expect(JSON.stringify(bundle)).toBe(before);
  });

  it('resets the CSS snapshot at the start of a full rebuild', async () => {
    const plugin = stylexCompiler();
    if (typeof plugin === 'function') throw new Error('Expected a compiler provider object');
    const context = makeContext();
    const controller = await plugin.create(context as never);
    const request = {
      id: '/project/src/pages/index/index.ts',
      code: `import * as stylex from '@weapp-stylex/core'; const styles = stylex.create({root:{color:'red'}}); const x=stylex.attrs(styles.root).class;`,
      kind: 'script' as const,
    };
    controller.claimSource?.(request);
    await controller.transformSource?.(request);
    controller.buildStart?.();
    const bundle = {
      'pages/index/index.js': { type: 'chunk' as const, fileName: 'pages/index/index.js', code: 'Page({});' },
    };
    await controller.generateBundle?.(bundle as never, context as never);
    expect(bundle).not.toHaveProperty('stylex.wxss');
  });

  it('reports stylex.wxss filename conflicts clearly', async () => {
    const { controller, transformed, context } = await compile(`
      import * as stylex from '@weapp-stylex/core';
      const styles = stylex.create({ root: { color: 'red' } });
      const sx = stylex.attrs(styles.root).class;
    `);
    const bundle = {
      'stylex.wxss': { type: 'asset' as const, fileName: 'stylex.wxss', source: '.existing{}' },
      'pages/index/index.js': { type: 'chunk' as const, fileName: 'pages/index/index.js', code: transformed.code },
    };
    await expect(controller.generateBundle?.(bundle as never, context as never)).rejects.toThrow('文件名冲突');
  });
});
