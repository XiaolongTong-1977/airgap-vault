// Fix for typeforce type checks failing after webpack minification.
// typeforce's quacksLike('Name') relies on constructor.name, but webpack
// minification renames classes to single letters. We replace quacksLike
// with duck-typing checks in both typeforce native registry and
// bitgo-utxo-lib's types.js.

const fs = require('fs')
const path = require('path')
const glob = require('glob')

const DUCK_TYPES_NATIVE = `
// --- AIRGAP PATCH: typeforce duck types ---
// Duck-typing checks that do NOT rely on constructor.name
// (which breaks under webpack minification).
types.ECPair = function (value) {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof value.compressed === 'boolean' &&
    value.network != null &&
    typeof value.getPublicKeyBuffer === 'function' &&
    (value.d != null || value.__Q != null)
  )
}
types.ECPair.toJSON = function () { return 'ECPair' }

types.Point = function (value) {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof value.add === 'function' &&
    typeof value.multiply === 'function' &&
    typeof value.equals === 'function' &&
    typeof value.negate === 'function'
  )
}
types.Point.toJSON = function () { return 'Point' }

types.BigInteger = function (value) {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof value.signum === 'function' &&
    typeof value.compareTo === 'function' &&
    typeof value.toByteArray === 'function'
  )
}
types.BigInteger.toJSON = function () { return 'BigInteger' }
// --- END AIRGAP PATCH ---
`

const PATCH_MARK = '// --- AIRGAP PATCH: typeforce duck types ---'

// Patch 1: typeforce native.js
const nativeFiles = glob.sync(
  path.join(__dirname, 'node_modules/@airgap/coinlib-core/dependencies/src/typeforce-1.18.0/native.js')
)

nativeFiles.forEach((file) => {
  let content = fs.readFileSync(file, 'utf8')
  if (content.includes(PATCH_MARK)) {
    console.log(`[fix-typeforce] native.js already patched: ${file}`)
    return
  }
  const marker = 'for (var typeName in types) {'
  if (content.includes(marker)) {
    content = content.replace(marker, DUCK_TYPES_NATIVE + '\n' + marker)
    fs.writeFileSync(file, content)
    console.log(`[fix-typeforce] Patched native.js: ${file}`)
  }
})

// Patch 2: bitgo-utxo-lib types.js - replace quacksLike with duck types
const typesFiles = glob.sync(
  path.join(__dirname, 'node_modules/@airgap/coinlib-core/dependencies/src/bitgo-utxo-lib-*/src/types.js')
)

const QUACKS_REPLACEMENT = `// --- AIRGAP PATCH: duck types ---
function BigIntDuck (value) {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof value.signum === 'function' &&
    typeof value.compareTo === 'function' &&
    typeof value.toByteArray === 'function'
  )
}
BigIntDuck.toJSON = function () { return 'BigInteger' }

function ECPointDuck (value) {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof value.add === 'function' &&
    typeof value.multiply === 'function' &&
    typeof value.equals === 'function' &&
    typeof value.negate === 'function'
  )
}
ECPointDuck.toJSON = function () { return 'Point' }

var BigInt = BigIntDuck
var ECPoint = ECPointDuck
// --- END AIRGAP PATCH ---`

typesFiles.forEach((file) => {
  let content = fs.readFileSync(file, 'utf8')
  if (content.includes('// --- AIRGAP PATCH: duck types ---')) {
    console.log(`[fix-typeforce] types.js already patched: ${file}`)
    return
  }
  // Replace the quacksLike definitions
  content = content.replace(
    /var BigInt = typeforce\.quacksLike\('BigInteger'\)\nvar ECPoint = typeforce\.quacksLike\('Point'\)/,
    QUACKS_REPLACEMENT
  )
  fs.writeFileSync(file, content)
  console.log(`[fix-typeforce] Patched types.js: ${file}`)
})
