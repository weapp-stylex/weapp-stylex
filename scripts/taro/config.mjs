import { link, lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function ensureTaroConfig(filename) {
  // Reading an existing config must not require write access to its directory.
  try {
    await lstat(filename)
    return
  }
  catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
  }
  const directory = path.dirname(filename)
  await mkdir(directory, { recursive: true })
  const temporary = await mkdtemp(path.join(directory, '.weapp-stylex-config-'))
  try {
    const prepared = path.join(temporary, 'index.json')
    await writeFile(prepared, '{}\n')
    // Taro creates an empty file before writing its defaults. Publish complete
    // JSON atomically so another example can never read that empty-file window.
    try {
      await link(prepared, filename)
    }
    catch (error) {
      if (error.code !== 'EEXIST') {
        throw error
      }
    }
  }
  finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
