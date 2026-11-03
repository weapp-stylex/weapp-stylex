import { randomUUID } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'

export function waitForWatchedSources(watcher, directory, sources, { timeout = 10000, interval = 10 } = {}) {
  return new Promise((resolve, reject) => {
    let pollTimer
    let timeoutTimer
    let check
    let onError
    let settled = false
    let missing = [...sources]
    const cleanup = () => {
      clearInterval(pollTimer)
      clearTimeout(timeoutTimer)
      watcher.off('ready', check)
      watcher.off('error', onError)
    }
    const finish = (error) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      if (error) {
        reject(error)
      }
      else {
        resolve()
      }
    }
    onError = error => finish(error)
    check = () => {
      if (settled) {
        return
      }
      try {
        const registered = watcher.getWatched()[directory] ?? []
        missing = sources.filter(file => !registered.includes(file))
        if (!missing.length) {
          finish()
        }
      }
      catch (error) {
        finish(error)
      }
    }
    watcher.on('error', onError)
    watcher.on('ready', check)
    // Missing paths can make NodeFs emit ready before the root scan finishes.
    // With ignoreInitial, registration itself emits no public add events.
    pollTimer = setInterval(check, interval)
    timeoutTimer = setTimeout(() => finish(new Error(
      `Watcher source registration timed out in ${directory}: ${missing.join(', ')}`,
    )), timeout)
    check()
  })
}

// Watchers can emit an extra build after the previous END. A test mutation must
// wait for its own invalidation and transformed input, not whichever END is next.
export function createWatchBuildWaiter({ timeout = 30000 } = {}) {
  let generation = 0
  let bundledGeneration = 0
  let endedGeneration = 0
  let failure
  let pending
  const finish = (error) => {
    if (!pending) {
      return
    }
    const request = pending
    pending = undefined
    clearTimeout(request.timer)
    if (error) {
      request.reject(error)
    }
    else {
      request.resolve()
    }
  }
  const complete = () => {
    if (!pending) {
      return
    }
    if (!pending.file) {
      if (endedGeneration > 0) {
        finish()
      }
      return
    }
    if (pending.changedGeneration !== undefined
      && endedGeneration >= pending.changedGeneration
      && pending.transformedGeneration === endedGeneration) {
      finish()
    }
  }
  return {
    plugin: {
      name: 'fixture-watch-build-generation',
      enforce: 'pre',
      watchChange(id) {
        if (pending?.file === id && pending.changedGeneration === undefined) {
          // watchChange may happen while an earlier build is still running.
          pending.changedGeneration = generation + 1
        }
      },
      buildStart() {
        generation += 1
      },
      transform: {
        order: 'pre',
        handler(source, id) {
          if (pending?.file === id
            && pending.changedGeneration !== undefined
            && generation >= pending.changedGeneration
            && source === pending.source) {
            pending.transformedGeneration = generation
          }
        },
      },
    },
    onEvent(event) {
      if (event.code === 'ERROR') {
        failure = event.error
        finish(failure)
      }
      else if (event.code === 'BUNDLE_END') {
        bundledGeneration = generation
      }
      else if (event.code === 'END') {
        endedGeneration = bundledGeneration
        complete()
      }
    },
    waitForBuild({ file, source } = {}) {
      if (pending) {
        throw new Error('A watch build request is already pending')
      }
      if (failure) {
        return Promise.reject(failure)
      }
      return new Promise((resolve, reject) => {
        pending = { file, source, resolve, reject }
        pending.timer = setTimeout(() => finish(new Error(
          `Vite watch rebuild timed out${file ? ` for ${file}` : ''}`,
        )), timeout)
        complete()
      })
    },
  }
}

// A source save must expose either the previous complete file or the next one.
// Truncating the watched file can let an already-running build read empty input.
export async function replaceWatchedSource(filename, source) {
  const staged = `${filename}.${randomUUID()}.tmp`
  try {
    await writeFile(staged, source)
    await rename(staged, filename)
  }
  finally {
    await rm(staged, { force: true })
  }
}
