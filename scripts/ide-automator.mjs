// SDK launch checks the app-service version as soon as its socket connects.
// Native page readiness must precede that public SDK connection/version check.
export async function launchIdeAutomator(launchOptions, {
  sdk,
  runCli,
  journal,
  until,
  phase = async () => {},
  report = async () => {},
}) {
  if (!journal) {
    await phase('launch')
    const mini = await sdk.launch(launchOptions)
    return { mini, nativeReady: false, cli: null }
  }

  const checkpoint = await journal.checkpoint()
  await phase('launch via selected CLI')
  const args = ['auto', '--project', launchOptions.projectPath, '--auto-port', String(launchOptions.port)]
  if (launchOptions.trustProject) {
    args.push('--trust-project')
  }
  let cli
  try {
    const result = await runCli(launchOptions.cliPath, args, { timeout: 60000 })
    cli = { stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
  }
  catch (error) {
    await report({ cli: { stdout: error.stdout ?? '', stderr: error.stderr ?? '' }, nativeReady: false })
    throw error
  }
  await report({ cli, nativeReady: false })
  await phase('post-launch native readiness')
  await until(
    () => journal.pageReadyAfter(checkpoint),
    'Owned simulator did not become ready after automation CLI launch',
    45000,
  )
  await report({ nativeReady: true })
  await phase('connect automator')
  const mini = await sdk.connect({ wsEndpoint: `ws://127.0.0.1:${launchOptions.port}` })
  return { mini, nativeReady: true, cli }
}
