import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const [directory, name] = process.argv.slice(2)
const config = JSON.parse(await readFile('project.config.json', 'utf8'))
await writeFile(
  path.join(directory, 'project.config.json'),
  JSON.stringify(
    {
      ...config,
      appid: process.env.WEAPP_STYLEX_APPID ?? config.appid,
      miniprogramRoot: '.',
      projectname: name,
    },
    null,
    2,
  ),
)
