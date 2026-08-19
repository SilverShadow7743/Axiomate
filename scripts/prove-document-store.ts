/**
 * Prove the document store end to end: one real file through put(), read back with get(),
 * bytes compared, and the file left in the library as its own evidence.
 *
 *   npx tsx --conditions=react-server scripts/prove-document-store.ts
 *
 * This is the storage analogue of the intake proof that created OAPIL-143: the configuration
 * can be read all day, but only a file that actually lands in SharePoint proves the token, the
 * consent, the drive id and the path builder are all simultaneously right. Run it after any
 * change to the Entra registration, the client secret, or AXIOMATE_DOCS_DRIVE_ID.
 */
import { config as loadEnv } from 'dotenv'
loadEnv()

import { documentStore } from '../lib/storage/graph'

async function main() {
  const store = documentStore()
  const why = store.unavailable()
  if (why) {
    console.log(`  UNAVAILABLE: ${why}`)
    process.exitCode = 1
    return
  }

  const body = `Axiomate document-storage proof.\nUploaded ${new Date().toISOString()} through lib/storage/graph.ts.\n`
  const bytes = new TextEncoder().encode(body)

  const stored = await store.put({
    tenantId: process.env.AXIOMATE_TENANT ?? 'axiocloud',
    name: 'storage-proof.txt',
    mimeType: 'text/plain',
    bytes,
    folder: 'OAPIL Engagement',
  })
  console.log(`  PUT ok    locator=${stored.locator}`)
  console.log(`            size=${stored.sizeBytes}  checksum=${stored.checksum.slice(0, 16)}…`)

  const back = await store.get(stored.locator)
  if (!back) {
    console.log('  GET returned null — the store cannot find what it just wrote.')
    process.exitCode = 1
    return
  }
  const chunks: Uint8Array[] = []
  const reader = back.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks))
  console.log(`  GET ok    ${text === body ? 'bytes identical to what was written' : 'BYTES DIFFER — investigate before trusting uploads'}`)
  if (text !== body) process.exitCode = 1
}

main().catch((e) => {
  console.error(`  FAILED: ${e instanceof Error ? e.message : e}`)
  process.exitCode = 1
})
