import type { PluginHost } from '@weapp-stylex/compiler'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'

const forwardingPackages = new Map([
  ['@weapp-stylex/core', 'weapp-stylex'],
  ['@stylexjs/stylex', '@weapp-stylex/core'],
])

async function physicalId(id: string) {
  const boundary = id.search(/[?#]/)
  const file = boundary < 0 ? id : id.slice(0, boundary)
  if (!path.isAbsolute(file)) {
    return id
  }
  try {
    return await realpath(file) + (boundary < 0 ? '' : id.slice(boundary))
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') {
      return id
    }
    throw error
  }
}

async function packageName(id: string) {
  let directory = path.dirname(id.split(/[?#]/, 1)[0]!)
  while (directory !== path.dirname(directory)) {
    try {
      return (JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')) as { name?: string }).name
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
    directory = path.dirname(directory)
  }
}

/** Preserve DCloud's resolution policy while locating runtime forwarding edges. */
export function createRuntimeResolver() {
  return {
    name: 'weapp-stylex:uni-runtime-resolution',
    enforce: 'pre' as const,
    async resolveId(this: Pick<PluginHost, 'resolve'>, source: string, importer?: string) {
      const owner = forwardingPackages.get(source)
      if (!owner || !importer || importer.startsWith('\0') || !path.isAbsolute(importer)) {
        return null
      }
      const physicalImporter = await physicalId(importer)
      if (await packageName(physicalImporter) !== owner) {
        return null
      }
      // DCloud preserves symlinks. A top-level facade symlink has no adjacent
      // transitive dependencies in pnpm's isolated layout; its physical package
      // does. Let the host choose exports/conditions using that real importer.
      const resolved = await this.resolve(source, physicalImporter, { skipSelf: true })
      if (!resolved || resolved.external) {
        return resolved
      }
      return { ...resolved, id: await physicalId(resolved.id) }
    },
  }
}
