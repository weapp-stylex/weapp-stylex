import { defineConfig } from 'weapp-vite/config';
import { stylexCompiler } from '@weapp-stylex/weapp-vite';

export default defineConfig({
  weapp: {
    srcRoot: 'src',
    compilerPlugins: [stylexCompiler()],
  },
});
