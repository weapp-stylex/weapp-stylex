import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const sourcePath = path.join(root, 'project.config.json')
const distPath = path.join(root, 'dist', 'project.config.json')
const config = JSON.parse(await readFile(sourcePath, 'utf8'))

// The source project points weapp-vite at dist/. Once the output directory is
// opened directly in DevTools, its own miniprogramRoot is the current folder.
config.miniprogramRoot = '.'
await mkdir(path.dirname(distPath), { recursive: true })
await writeFile(distPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
