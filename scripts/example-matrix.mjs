import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
export const targets = {
  weapp: { templateExtension: '.wxml', styleExtension: '.wxss', rootSelector: 'page', uniPlatform: 'mp-weixin' },
  alipay: { templateExtension: '.axml', styleExtension: '.acss', rootSelector: 'page', uniPlatform: 'mp-alipay' },
  tt: { templateExtension: '.ttml', styleExtension: '.ttss', rootSelector: 'page', uniPlatform: 'mp-toutiao' },
  h5: { styleExtension: '.css', rootSelector: ':root', uniPlatform: 'h5' },
}

export const examples = Object.entries(targets).flatMap(([target, profile]) => [
  ...['wechat-native', 'wechat-wevu'].map(name => ({
    name,
    directory: target === 'weapp' ? 'dist' : `dist/${target === 'h5' ? 'web' : target}`,
    cssDelivery: target === 'h5' ? 'weapp-web' : 'mini-program',
  })),
  ...['taro-react', 'taro-vue3'].flatMap(name => ['webpack', 'vite'].map(builder => ({
    name,
    builder,
    directory: `dist/${target}-${builder}`,
    cssDelivery: target === 'h5' ? 'stylesheet' : 'mini-program',
  }))),
  { name: 'uni-vue3', directory: `dist/build/${profile.uniPlatform}`, cssDelivery: target === 'h5' ? 'stylesheet' : 'mini-program' },
].map(example => ({
  ...profile,
  ...example,
  target,
  ...(target === 'h5' ? { devScript: example.builder === 'webpack' ? 'dev:h5:webpack' : 'dev:h5' } : {}),
  project: path.join(root, 'examples', example.name, example.directory),
})))
