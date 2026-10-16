import { randomUUID } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { captureBuildInputs, writeBuildProvenance } from './build-provenance.mjs'
import { examples, targets } from './example-matrix.mjs'
import { buildLibraryPacks, verifyLibraryPacks } from './library-packs.mjs'

const target = process.argv[2] ?? 'all'
if (target !== 'all' && !Object.hasOwn(targets, target)) {
  throw new Error('Usage: build-examples.mjs [all|weapp|alipay|tt|h5]')
}
const selectedTargets = target === 'all' ? Object.keys(targets) : [target]
const selected = examples.filter(example => selectedTargets.includes(example.target))
// A final acceptance run prepares one attested batch, then reuses its exact
// libraries and tarballs across backends and isolated consumers.
const packs = process.env.WEAPP_STYLEX_TEST_PACKS_DIR
const libraries = packs
  ? await verifyLibraryPacks(packs)
  : await buildLibraryPacks({ packs: fileURLToPath(new URL(`../artifacts/library-packs/${randomUUID()}`, import.meta.url)) })
const candidates = libraries.candidates.map(({ name, version, path, sha256 }) => ({ name, version, path, sha256 }))
const inputs = await captureBuildInputs({ candidates })
// Each target runs in a separate CI checkout. Serial workspaces and Taro
// builders keep the host output directories and temporary files independent.
for (const selectedTarget of selectedTargets) {
  for (const name of new Set(selected.filter(example => example.target === selectedTarget).map(example => example.name))) {
    const script = selectedTarget === 'h5' && ['wechat-native', 'wechat-wevu'].includes(name)
      ? 'build:web'
      : `build:${selectedTarget}`
    await execa('corepack', ['pnpm', '--filter', name, script], { stdio: 'inherit' })
  }
}
await verifyLibraryPacks(path.dirname(libraries.manifestPath))
const provenance = await writeBuildProvenance(selected, { inputs })
process.stdout.write(`Build provenance (${inputs.backend}): ${provenance.run.id}\n${provenance.run.manifestPath}\n`)
