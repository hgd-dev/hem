import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PATCH_ID = 'hem-prismarine-chunk-1215-nosize-v4'

export function packedLongCount (capacity, bitsPerValue) {
  if (!Number.isInteger(capacity) || capacity <= 0) throw new Error(`invalid palette capacity ${capacity}`)
  if (!Number.isInteger(bitsPerValue) || bitsPerValue <= 0 || bitsPerValue > 64) throw new Error(`invalid bitsPerValue ${bitsPerValue}`)
  return Math.ceil(capacity / Math.floor(64 / bitsPerValue))
}

const sha256 = value => createHash('sha256').update(value).digest('hex')
const normalize = value => value.replace(/\r\n/g, '\n')

function replaceOnce (source, pattern, replacement, label, { optionalWhen = null } = {}) {
  if (optionalWhen?.test(source)) return source
  const matches = source.match(pattern)
  if (!matches) throw new Error(`${PATCH_ID}: cannot locate ${label}; installed prismarine-chunk source shape is not recognized`)
  const next = source.replace(pattern, replacement)
  if (next === source) throw new Error(`${PATCH_ID}: ${label} replacement made no change`)
  return next
}

function replaceAllRequired (source, pattern, replacement, label, minimum = 1) {
  let count = 0
  const next = source.replace(pattern, (...args) => {
    count++
    return typeof replacement === 'function' ? replacement(...args) : replacement
  })
  if (count < minimum) throw new Error(`${PATCH_ID}: expected at least ${minimum} ${label} occurrence(s), found ${count}`)
  return next
}

function addConstructorFlag (source, className) {
  const already = new RegExp(`class ${className}[\\s\\S]*?constructor \\(options\\) \\{[\\s\\S]{0,180}?this\\.noSizePrefix\\s*=`)
  if (already.test(source)) return source
  return replaceOnce(
    source,
    new RegExp(`(class ${className}\\s*\\{\\s*\\n\\s*constructor \\(options\\) \\{\\s*\\n)`),
    `$1    this.noSizePrefix = options?.noSizePrefix // HEM ${PATCH_ID}: Minecraft 1.21.5+ omits palette data length prefixes\n`,
    `${className}.noSizePrefix constructor flag`
  )
}

export function patchPaletteContainerSource (input) {
  let source = normalize(input)
  source = addConstructorFlag(source, 'DirectPaletteContainer')
  source = addConstructorFlag(source, 'IndirectPaletteContainer')
  source = addConstructorFlag(source, 'SingleValueContainer')

  // Direct + indirect container writes: 1.21.5+ omits the data-array VarInt length.
  source = source.replace(
    /(^\s*)(?!if \(!this\.noSizePrefix\) )varInt\.write\(smartBuffer, this\.data\.length\(\)\)/gm,
    '$1if (!this.noSizePrefix) varInt.write(smartBuffer, this.data.length())'
  )

  // Historical zardoy/prismarine-chunk snapshots do expose readBuffer, but the
  // second parameter is not consistently named bitsPerValue.  Discover each
  // method structurally, capture its real bits variable, and patch only inside
  // that method body.  This is what RC25 got wrong by hard-coding the signature.
  const methodHeader = /readBuffer\s*\(\s*smartBuffer\s*,\s*([A-Za-z_$][\w$]*)\s*\)\s*\{/g
  const methods = []
  let match
  while ((match = methodHeader.exec(source))) {
    const open = source.indexOf('{', match.index)
    let depth = 0
    let close = -1
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') {
        depth--
        if (depth === 0) { close = i + 1; break }
      }
    }
    if (close < 0) throw new Error(`${PATCH_ID}: unterminated readBuffer method near offset ${match.index}`)
    methods.push({ start: match.index, end: close, bits: match[1] })
    methodHeader.lastIndex = close
  }
  if (methods.length < 1) throw new Error(`${PATCH_ID}: PaletteContainer exposes no structurally recognizable readBuffer methods`)

  let patchedMethods = 0
  for (const method of [...methods].reverse()) {
    let body = source.slice(method.start, method.end)
    const formula = `Math.ceil(this.data.capacity / Math.floor(64 / ${method.bits}))`
    const marker = `// HEM ${PATCH_ID}: fixed 1.21.5 packed-long count (${method.bits})`
    if (!body.includes(marker)) {
      let changed = false
      body = body.replace(
        /(^\s*)const\s+([A-Za-z_$][\w$]*)\s*=\s*varInt\.read\(smartBuffer\)/m,
        (_all, indent, name) => {
          changed = true
          return `${indent}${marker}\n${indent}const ${name} = this.noSizePrefix\n${indent}  ? ${formula}\n${indent}  : varInt.read(smartBuffer)`
        }
      )
      if (!changed) {
        body = body.replace(
          /(^\s*)this\.data\.readBuffer\(smartBuffer,\s*varInt\.read\(smartBuffer\)\s*\*\s*2\)/m,
          (_all, indent) => {
            changed = true
            return `${indent}${marker}\n${indent}const hemLongs = this.noSizePrefix\n${indent}  ? ${formula}\n${indent}  : varInt.read(smartBuffer)\n${indent}this.data.readBuffer(smartBuffer, hemLongs * 2)`
          }
        )
      }
      if (!changed && !body.includes(formula)) {
        throw new Error(`${PATCH_ID}: readBuffer(smartBuffer, ${method.bits}) has no recognized legacy length read; source shape is not recognized`)
      }
      if (!body.includes(marker) && body.includes(formula)) body = body.replace('{', `{\n    ${marker}`)
    }
    if (!body.includes(formula)) throw new Error(`${PATCH_ID}: readBuffer(smartBuffer, ${method.bits}) lacks the computed 1.21.5 word-count formula after patch`)
    patchedMethods++
    source = source.slice(0, method.start) + body + source.slice(method.end)
  }

  // Older implementations occasionally used the mathematically-wrong ceil(n*b/64)
  // shortcut for no-prefix arrays. It under-reads whenever 64 % bits != 0.
  source = source.replace(
    /Math\.ceil\(this\.data\.capacity\s*\*\s*([A-Za-z_$][\w$]*)\s*\/\s*64\)/g,
    'Math.ceil(this.data.capacity / Math.floor(64 / $1))'
  )
  source = source.replace(
    /Math\.ceil\((?:constants\.BLOCK_SECTION_VOLUME|constants\.BIOME_SECTION_VOLUME)\s*\*\s*([A-Za-z_$][\w$]*)\s*\/\s*64\)/g,
    'Math.ceil(this.data.capacity / Math.floor(64 / $1))'
  )

  // Single-value containers also carried a zero-length byte in <=1.21.4.
  source = source.replace(
    /(varInt\.write\(smartBuffer, this\.value\)\s*\n\s*)(?!if \(!this\.noSizePrefix\) )smartBuffer\.writeUInt8\(0\)/g,
    '$1if (!this.noSizePrefix) smartBuffer.writeUInt8(0)'
  )

  // Preserve the wire-format flag when a container changes representation after load.
  source = source.replace(
    /(convertToDirect\s*\([^)]*\)\s*\{[\s\S]*?new DirectPaletteContainer\(\{\s*\n)(?!\s*noSizePrefix:)/,
    '$1      noSizePrefix: this.noSizePrefix,\n'
  )
  source = source.replace(
    /(set \(index, value\) \{[\s\S]*?return new IndirectPaletteContainer\(\{\s*\n)(?!\s*noSizePrefix:)/,
    '$1      noSizePrefix: this.noSizePrefix,\n'
  )

  const required = [
    /this\.noSizePrefix = options\?\.noSizePrefix/,
    /if \(!this\.noSizePrefix\) varInt\.write\(smartBuffer, this\.data\.length\(\)\)/,
    /if \(!this\.noSizePrefix\) smartBuffer\.writeUInt8\(0\)/,
  ]
  for (const pattern of required) if (!pattern.test(source)) throw new Error(`${PATCH_ID}: PaletteContainer invariant missing: ${pattern}`)
  const markerCount = (source.match(new RegExp(`HEM ${PATCH_ID}: fixed 1\\.21\\.5 packed-long count`, 'g')) || []).length
  if (markerCount !== patchedMethods) throw new Error(`${PATCH_ID}: PaletteContainer must patch every discovered readBuffer path; methods=${patchedMethods}, markers=${markerCount}`)
  return source
}

export function patchPaletteBiomeSource (input) {
  let source = normalize(input)
  if (!/constructor \(options\) \{[\s\S]{0,160}?this\.noSizePrefix/.test(source)) {
    source = replaceOnce(source, /(class BiomeSection\s*\{\s*\n\s*constructor \(options\) \{\s*\n)/, `$1    this.noSizePrefix = options?.noSizePrefix // HEM ${PATCH_ID}\n`, 'BiomeSection.noSizePrefix constructor flag')
  }
  source = source.replace(
    /(this\.data = options\?\.data \?\? new SingleValueContainer\(\{\s*\n)(?!\s*noSizePrefix:)/,
    '$1      noSizePrefix: this.noSizePrefix,\n'
  )

  source = source.replace(/static fromLocalPalette \(\{ palette, data \}\)/, 'static fromLocalPalette ({ palette, data, noSizePrefix })')
  source = source.replace(
    /(static fromLocalPalette \([^)]*\) \{\s*\n\s*return new BiomeSection\(\{\s*\n)(?!\s*noSizePrefix)/,
    '$1      noSizePrefix,\n'
  )
  // Both local-palette branches need the flag.
  const localStart = source.indexOf('static fromLocalPalette')
  const localEnd = localStart >= 0 ? source.indexOf('\n  write (smartBuffer)', localStart) : -1
  if (localStart >= 0 && localEnd > localStart) {
    let segment = source.slice(localStart, localEnd)
    segment = segment.replace(/(new SingleValueContainer\(\{\s*\n)(?!\s*noSizePrefix)/, '$1          noSizePrefix,\n')
    segment = segment.replace(/(new IndirectPaletteContainer\(\{\s*\n)(?!\s*noSizePrefix)/, '$1          noSizePrefix,\n')
    source = source.slice(0, localStart) + segment + source.slice(localEnd)
  }

  source = source.replace(
    /static read \(smartBuffer, maxBitsPerBiome = constants\.GLOBAL_BITS_PER_BIOME\)/,
    'static read (smartBuffer, maxBitsPerBiome = constants.GLOBAL_BITS_PER_BIOME, noSizePrefix)'
  )
  const readStart = source.indexOf('static read (smartBuffer')
  const classEnd = readStart >= 0 ? source.length : -1
  if (readStart < 0) throw new Error(`${PATCH_ID}: cannot locate BiomeSection.read body`)
  let read = source.slice(readStart, classEnd)
  // Every BiomeSection produced while parsing should retain the flag.
  read = read.replace(/(new BiomeSection\(\{\s*\n)(?!\s*noSizePrefix)/g, '$1        noSizePrefix,\n')
  read = read.replace(/(new DirectPaletteContainer\(\{\s*\n)(?!\s*noSizePrefix)/g, '$1          noSizePrefix,\n')
  read = read.replace(/(new IndirectPaletteContainer\(\{\s*\n)(?!\s*noSizePrefix)/g, '$1        noSizePrefix,\n')
  // Single-value old format contains a trailing zero data-array length byte.
  read = read.replace(/(^\s*)(?!if \(!noSizePrefix\) )smartBuffer\.readUInt8\(\)(\s*\n\s*return section)/m, '$1if (!noSizePrefix) smartBuffer.readUInt8()$2')
  source = source.slice(0, readStart) + read + source.slice(classEnd)

  for (const pattern of [
    /this\.noSizePrefix = options\?\.noSizePrefix/,
    /static read \(smartBuffer, maxBitsPerBiome = constants\.GLOBAL_BITS_PER_BIOME, noSizePrefix\)/,
    /if \(!noSizePrefix\) smartBuffer\.readUInt8\(\)/,
    /new DirectPaletteContainer\(\{\s*\n\s*noSizePrefix/,
    /new IndirectPaletteContainer\(\{\s*\n\s*noSizePrefix/,
  ]) if (!pattern.test(source)) throw new Error(`${PATCH_ID}: PaletteBiome invariant missing: ${pattern}`)
  return source
}

export function patchPaletteChunkSectionSource (input) {
  let source = normalize(input)
  if (!/constructor \(options\) \{[\s\S]{0,180}?this\.noSizePrefix/.test(source)) {
    source = replaceOnce(source, /(class ChunkSection\s*\{\s*\n\s*constructor \(options\) \{\s*\n)/, `$1      this.noSizePrefix = options?.noSizePrefix // HEM ${PATCH_ID}\n`, 'ChunkSection.noSizePrefix constructor flag')
  }

  // Default / provided palette containers created by the section must retain the flag.
  const ctorStart = source.indexOf('constructor (options)')
  const ctorEnd = ctorStart >= 0 ? source.indexOf('\n    toJson ()', ctorStart) : -1
  if (ctorStart >= 0 && ctorEnd > ctorStart) {
    let segment = source.slice(ctorStart, ctorEnd)
    segment = segment.replace(/(new SingleValueContainer\(\{\s*\n)(?!\s*noSizePrefix)/g, '$1          noSizePrefix: this.noSizePrefix,\n')
    segment = segment.replace(/(new DirectPaletteContainer\(\{\s*\n)(?!\s*noSizePrefix)/g, '$1          noSizePrefix: this.noSizePrefix,\n')
    segment = segment.replace(/(new IndirectPaletteContainer\(\{\s*\n)(?!\s*noSizePrefix)/g, '$1          noSizePrefix: this.noSizePrefix,\n')
    source = source.slice(0, ctorStart) + segment + source.slice(ctorEnd)
  }

  source = source.replace(/static fromLocalPalette \(\{ data, palette \}\)/, 'static fromLocalPalette ({ data, palette, noSizePrefix })')
  const localStart = source.indexOf('static fromLocalPalette')
  const localEnd = localStart >= 0 ? source.indexOf('\n    static read (smartBuffer', localStart) : -1
  if (localStart >= 0 && localEnd > localStart) {
    let segment = source.slice(localStart, localEnd)
    segment = segment.replace(/(return new ChunkSection\(\{\s*\n)(?!\s*noSizePrefix)/, '$1        noSizePrefix,\n')
    segment = segment.replace(/(new SingleValueContainer\(\{\s*\n)(?!\s*noSizePrefix)/, '$1            noSizePrefix,\n')
    segment = segment.replace(/(new IndirectPaletteContainer\(\{\s*\n)(?!\s*noSizePrefix)/, '$1            noSizePrefix,\n')
    source = source.slice(0, localStart) + segment + source.slice(localEnd)
  }

  source = source.replace(
    /static read \(smartBuffer, maxBitsPerBlock = constants\.GLOBAL_BITS_PER_BLOCK\)/,
    'static read (smartBuffer, maxBitsPerBlock = constants.GLOBAL_BITS_PER_BLOCK, noSizePrefix)'
  )
  const readStart = source.indexOf('static read (smartBuffer')
  const classEnd = readStart >= 0 ? source.length : -1
  if (readStart < 0) throw new Error(`${PATCH_ID}: cannot locate ChunkSection.read body`)
  let read = source.slice(readStart, classEnd)
  read = read.replace(/(new ChunkSection\(\{\s*\n)(?!\s*noSizePrefix)/g, '$1        noSizePrefix,\n')
  read = read.replace(/(new DirectPaletteContainer\(\{\s*\n)(?!\s*noSizePrefix)/g, '$1          noSizePrefix,\n')
  read = read.replace(/(new IndirectPaletteContainer\(\{\s*\n)(?!\s*noSizePrefix)/g, '$1        noSizePrefix,\n')
  read = read.replace(/(^\s*)(?!if \(!noSizePrefix\) )smartBuffer\.readUInt8\(\)(\s*\n\s*return section)/m, '$1if (!noSizePrefix) smartBuffer.readUInt8()$2')
  source = source.slice(0, readStart) + read + source.slice(classEnd)

  for (const pattern of [
    /this\.noSizePrefix = options\?\.noSizePrefix/,
    /static read \(smartBuffer, maxBitsPerBlock = constants\.GLOBAL_BITS_PER_BLOCK, noSizePrefix\)/,
    /if \(!noSizePrefix\) smartBuffer\.readUInt8\(\)/,
    /new DirectPaletteContainer\(\{\s*\n\s*noSizePrefix/,
    /new IndirectPaletteContainer\(\{\s*\n\s*noSizePrefix/,
  ]) if (!pattern.test(source)) throw new Error(`${PATCH_ID}: PaletteChunkSection invariant missing: ${pattern}`)
  return source
}

export function patchChunkColumnSource (input) {
  let source = normalize(input)
  if (!/const noSizePrefix = mcData\.version\['>='\]\('1\.21\.5'\)/.test(source)) {
    source = replaceOnce(
      source,
      /(module\.exports = \(Block, mcData\) => \{\s*\n)/,
      "$1  // HEM hem-prismarine-chunk-1215-nosize-v4: 1.21.5+ omits palette data length prefixes.\n  const noSizePrefix = mcData.version['>=']('1.21.5')\n",
      'ChunkColumn 1.21.5 noSizePrefix version gate'
    )
  }

  // Initial sections / biomes must know which wire format to write and later mutate.
  source = source.replace(/new ChunkSection\(\{(?![^}]*\bnoSizePrefix\b)/g, 'new ChunkSection({ noSizePrefix,')
  source = source.replace(/new BiomeSection\(\{(?![^}]*\bnoSizePrefix\b)/g, 'new BiomeSection({ noSizePrefix,')

  // Network decode carries the critical live fix first isolated in RC22; RC25 patches only prismarine-chunk package roots that are actually reachable from runtime consumers.
  source = source.replace(/ChunkSection\.read\(reader, this\.maxBitsPerBlock\)(?![,\w])/, 'ChunkSection.read(reader, this.maxBitsPerBlock, noSizePrefix)')
  source = source.replace(/BiomeSection\.read\(reader, this\.maxBitsPerBiome\)(?![,\w])/, 'BiomeSection.read(reader, this.maxBitsPerBiome, noSizePrefix)')

  // Disk/local-palette construction should preserve the same flag so later dumps use
  // the correct 1.21.5 wire shape.
  source = source.replace(/(ChunkSection\.fromLocalPalette\(\{\s*\n)(?!\s*noSizePrefix)/g, '$1        noSizePrefix,\n')
  source = source.replace(/(BiomeSection\.fromLocalPalette\(\{\s*\n)(?!\s*noSizePrefix)/g, '$1        noSizePrefix,\n')

  for (const pattern of [
    /const noSizePrefix = mcData\.version\['>='\]\('1\.21\.5'\)/,
    /ChunkSection\.read\(reader, this\.maxBitsPerBlock, noSizePrefix/,
    /BiomeSection\.read\(reader, this\.maxBitsPerBiome, noSizePrefix\)/,
  ]) if (!pattern.test(source)) throw new Error(`${PATCH_ID}: ChunkColumn invariant missing: ${pattern}`)
  return source
}

export async function patchPackageRoot (packageRoot) {
  const files = {
    paletteContainer: path.join(packageRoot, 'src/pc/common/PaletteContainer.js'),
    paletteBiome: path.join(packageRoot, 'src/pc/common/PaletteBiome.js'),
    paletteChunkSection: path.join(packageRoot, 'src/pc/common/PaletteChunkSection.js'),
    chunkColumn: path.join(packageRoot, 'src/pc/1.18/ChunkColumn.js'),
  }
  for (const [name, file] of Object.entries(files)) if (!fs.existsSync(file)) throw new Error(`${PATCH_ID}: ${name} source missing at ${file}`)
  const transforms = {
    paletteContainer: patchPaletteContainerSource,
    paletteBiome: patchPaletteBiomeSource,
    paletteChunkSection: patchPaletteChunkSectionSource,
    chunkColumn: patchChunkColumnSource,
  }
  const hashes = {}
  let paletteContainerAfter = ''
  for (const [name, file] of Object.entries(files)) {
    const before = await fsp.readFile(file, 'utf8')
    const after = transforms[name](before)
    hashes[name] = { before: sha256(before), after: sha256(after), changed: before !== after }
    if (name === 'paletteContainer') paletteContainerAfter = after
    await fsp.writeFile(file, after)
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  }

  // Mathematical sentinels for the exact bug seen in live RC21 logs.
  const sizing = {
    blocks5Bits: packedLongCount(4096, 5),
    biomes3Bits: packedLongCount(64, 3),
  }
  if (sizing.blocks5Bits !== 342 || sizing.biomes3Bits !== 4) throw new Error(`${PATCH_ID}: packed-long sizing invariant failed: ${JSON.stringify(sizing)}`)

  const decoderPaths = {
    readBufferMethods: (paletteContainerAfter.match(/readBuffer\s*\(\s*smartBuffer\s*,\s*[A-Za-z_$][\w$]*\s*\)\s*\{/g) || []).length,
    computedReadPaths: (paletteContainerAfter.match(new RegExp(`HEM ${PATCH_ID}: fixed 1\\.21\\.5 packed-long count`, 'g')) || []).length,
  }
  if (decoderPaths.readBufferMethods < 1 || decoderPaths.computedReadPaths !== decoderPaths.readBufferMethods) throw new Error(`${PATCH_ID}: decoder-path attestation mismatch ${JSON.stringify(decoderPaths)}`)

  let version = 'unknown'
  try { version = JSON.parse(await fsp.readFile(path.join(packageRoot, 'package.json'), 'utf8')).version || version } catch {}
  return { patchId: PATCH_ID, packageVersion: version, sizing, decoderPaths, files: hashes }
}

function packageRootFromResolved (resolved, expectedName = 'prismarine-chunk') {
  let cursor = path.dirname(fs.realpathSync(resolved))
  while (cursor !== path.dirname(cursor)) {
    const pkgPath = path.join(cursor, 'package.json')
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
        if (pkg.name === expectedName) return cursor
      } catch {}
    }
    cursor = path.dirname(cursor)
  }
  return null
}

function topLevelPackageJsons (nodeModulesRoot) {
  if (!fs.existsSync(nodeModulesRoot)) return []
  const out = []
  for (const name of fs.readdirSync(nodeModulesRoot)) {
    if (name === '.pnpm' || name.startsWith('.')) continue
    const first = path.join(nodeModulesRoot, name)
    if (name.startsWith('@')) {
      if (!fs.existsSync(first) || !fs.statSync(first).isDirectory()) continue
      for (const child of fs.readdirSync(first)) {
        const pkg = path.join(first, child, 'package.json')
        if (fs.existsSync(pkg)) out.push(pkg)
      }
    } else {
      const pkg = path.join(first, 'package.json')
      if (fs.existsSync(pkg)) out.push(pkg)
    }
  }
  return out
}

export async function findRuntimePrismarineChunkRoots (upstreamRoot) {
  const absolute = path.resolve(upstreamRoot)
  const roots = new Map()
  const register = (consumer, req) => {
    let resolved
    try { resolved = req.resolve('prismarine-chunk') } catch { return }
    const root = packageRootFromResolved(resolved)
    if (!root) throw new Error(`${PATCH_ID}: ${consumer} resolves prismarine-chunk but its package root could not be identified`)
    const real = fs.realpathSync(root)
    if (!roots.has(real)) roots.set(real, new Set())
    roots.get(real).add(consumer)
  }

  // The application root is always a runtime consumer because minecraft-web-client
  // imports prismarine-chunk directly in addition to Mineflayer using it internally.
  const rootRequire = createRequire(path.join(absolute, 'package.json'))
  register('minecraft-web-client', rootRequire)

  // pnpm can keep several historical prismarine-chunk copies in .pnpm.  Only a
  // copy reachable through a package that actually declares prismarine-chunk can
  // affect the bundle.  Discover those consumers through their real Node resolver
  // instead of blindly patching every package-store copy.
  for (const pkgPath of topLevelPackageJsons(path.join(absolute, 'node_modules'))) {
    let pkg
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) } catch { continue }
    const declares = {
      ...(pkg.dependencies || {}),
      ...(pkg.optionalDependencies || {}),
      ...(pkg.peerDependencies || {}),
    }
    if (!Object.prototype.hasOwnProperty.call(declares, 'prismarine-chunk')) continue
    register(pkg.name || path.basename(path.dirname(pkgPath)), createRequire(pkgPath))
  }

  if (!roots.size) throw new Error(`${PATCH_ID}: no runtime-resolved prismarine-chunk package roots found`)
  return [...roots.entries()].map(([root, consumers]) => ({ root, consumers: [...consumers].sort() }))
}

export async function main (upstreamRoot = process.argv[2] || process.cwd()) {
  const runtimeRoots = await findRuntimePrismarineChunkRoots(path.resolve(upstreamRoot))
  const reports = []
  for (const entry of runtimeRoots) {
    const relativeRoot = path.relative(path.resolve(upstreamRoot), entry.root) || '.'
    try {
      reports.push({ root: relativeRoot, consumers: entry.consumers, runtimeResolved: true, ...(await patchPackageRoot(entry.root)) })
    } catch (error) {
      throw new Error(`${PATCH_ID}: failed runtime-resolved prismarine-chunk root ${relativeRoot} for consumer(s) ${entry.consumers.join(', ')}: ${error.message}`)
    }
  }
  const report = {
    patchId: PATCH_ID,
    minecraft: '1.21.5',
    reason: 'Minecraft 1.21.5 paletted chunk/biome arrays omit the legacy VarInt data-length prefix; compute fixed long counts instead.',
    reports,
  }
  const reportPath = path.join(path.resolve(upstreamRoot), '.hem-prismarine-chunk-1215.json')
  await fsp.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log(`HEM ${PATCH_ID} applied to ${reports.length} runtime-resolved prismarine-chunk package root(s); consumers=${reports.map(r => r.consumers.join('+')).join(',')}; 4096@5=${packedLongCount(4096, 5)} longs, 64@3=${packedLongCount(64, 3)} longs`)
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exit(1) })
}
