import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

async function logFiles(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }
    const directory = path.join(root, entry.name, 'WeappLog/logs')
    let names
    try {
      names = await readdir(directory)
    }
    catch (error) {
      if (error.code === 'ENOENT') {
        continue
      }
      throw error
    }
    for (const name of names.filter(name => name.endsWith('.log'))) {
      const file = path.join(directory, name)
      try {
        const info = await stat(file)
        files.push({ file, size: info.size })
      }
      catch (error) {
        // Native log rollover can unlink a file between readdir and stat.
        if (error.code !== 'ENOENT') {
          throw error
        }
      }
    }
  }
  return files
}

// Read only native lifecycle records. Never close, reuse or claim another project.
export async function nativeJournal(projectPath, logRoot) {
  if (!logRoot && process.platform !== 'darwin') {
    return null
  }
  const root = logRoot ?? path.join(homedir(), 'Library/Application Support/微信开发者工具')
  const offsets = new Map((await logFiles(root)).map(info => [info.file, info.size]))
  const observation = { windowId: null, windowClosed: false, webContentsDestroyed: false }
  const observed = new Map()
  let ownerDirectory
  const identifiesProject = line => line.endsWith(`projectpath=${projectPath}`)
    || line.includes(`cacheSubKey: '${projectPath}/`)
    || line.includes(`projectId: '${projectPath}'`)
    || line.includes(`projectPath: '${projectPath}'`)
  return {
    observation,
    async read() {
      for (const { file, size } of await logFiles(root)) {
        let offset = offsets.get(file) ?? 0
        if (size < offset) {
          offset = 0
        }
        if (size !== offset) {
          let data
          try {
            data = await readFile(file)
          }
          catch (error) {
            if (error.code === 'ENOENT') {
              continue
            }
            throw error
          }
          observed.set(file, (observed.get(file) ?? '') + data.subarray(offset).toString('utf8'))
          offsets.set(file, data.length)
        }
      }
      for (const [file, data] of observed) {
        const owner = data.split('\n').find(line => identifiesProject(line) && /win:s\d+|winId: 's\d+'/.test(line))
        if (owner) {
          const identity = /win:(s\d+)|winId: '(s\d+)'/.exec(owner)
          observation.windowId = identity[1] ?? identity[2]
          ownerDirectory = path.dirname(file)
          break
        }
      }
      if (observation.windowId) {
        const identity = `winId: '${observation.windowId}'`
        // Rollover may put close events in a new file. Keep the profile of the owned window.
        const events = [...observed.entries()]
          .filter(([file]) => path.dirname(file) === ownerDirectory)
          .flatMap(([, data]) => data.split('\n'))
          .filter(line => line.includes(identity))
        observation.windowClosed = events.some(line => line.includes('native-window-closed'))
        observation.webContentsDestroyed = events.some(line => line.includes('webcontents-destroyed'))
      }
      return observation
    },
    evidence() {
      return [...observed.entries()]
        .filter(([file]) => path.dirname(file) === ownerDirectory)
        .flatMap(([, data]) => data.split('\n'))
        .filter(line =>
          line.includes(projectPath)
          || (observation.windowId && (
            line.includes(`win:${observation.windowId}]`)
            || line.includes(`winId: '${observation.windowId}'`)
          )),
        )
        .join('\n')
    },
  }
}
