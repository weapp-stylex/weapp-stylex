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
