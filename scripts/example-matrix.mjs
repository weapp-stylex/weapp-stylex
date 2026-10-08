import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
export const examples = [
  ['wechat-native', 'dist'],
  ['wechat-wevu', 'dist'],
  ['taro-react', 'dist/weapp-webpack'],
  ['taro-react', 'dist/weapp-vite'],
  ['taro-vue3', 'dist/weapp-webpack'],
  ['taro-vue3', 'dist/weapp-vite'],
  ['uni-vue3', 'dist/build/mp-weixin'],
].map(([name, directory]) => ({
  name,
  directory,
  project: path.join(root, 'examples', name, directory),
}))
