// Patch @airgap/angular-core MetamaskGenerator whitelist to include the
// 'arbitrum' protocol identifier so MetaMask/Rabby/imToken sync QR codes are
// generated for Arbitrum accounts (same address format as ETH).
//
// The upstream whitelist only covers ETH/OPTIMISM/BNB/BASE. Arbitrum uses the
// same 0x address format and derivation path (m/44'/60'/0'), so the UR
// encoding produced by the generator is identical in structure.
//
// Applied via postinstall so it survives `yarn install`.

const fs = require('fs')
const path = require('path')
const glob = require('glob')

const PATCH_MARK = '// --- AIRGAP PATCH: arbitrum in MetamaskGenerator whitelist ---'

const TARGETS = [
  'node_modules/@airgap/angular-core/esm2022/lib/services/qr/qr-generators/metamask-generator.mjs',
  'node_modules/@airgap/angular-core/fesm2022/airgap-angular-core.mjs'
]

// Replace the closing paren of the protocol OR-chain with an added arbitrum term.
const NEEDLE = 'element.protocol === MainProtocolSymbols.BASE) &&'
const REPLACEMENT = "element.protocol === MainProtocolSymbols.BASE ||\n                    element.protocol === 'arbitrum' /* AIRGAP PATCH: arbitrum whitelist */) &&"

TARGETS.forEach((rel) => {
  const file = path.join(__dirname, rel)
  if (!fs.existsSync(file)) {
    console.log(`[patch-metamask] SKIP (not found): ${rel}`)
    return
  }
  let content = fs.readFileSync(file, 'utf8')
  if (content.includes(PATCH_MARK) || content.includes("element.protocol === 'arbitrum'")) {
    console.log(`[patch-metamask] Already patched: ${rel}`)
    return
  }
  if (!content.includes(NEEDLE)) {
    console.log(`[patch-metamask] WARN: needle not found in ${rel}`)
    return
  }
  content = content.replace(NEEDLE, REPLACEMENT)
  fs.writeFileSync(file, content)
  console.log(`[patch-metamask] Patched: ${rel}`)
})
