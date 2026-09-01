import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PATCH_ID = 'hem-prismarine-chunk-1215-nosize-v1'

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

  // Direct + indirect reads: when the length prefix is absent, derive the number
  // of 64-bit words using Mojang's non-spanning SimpleBitStorage sizing rule.
  source = source.replace(
    /(^\s*)const longs = varInt\.read\(smartBuffer\)/gm,
    '$1const longs = this.noSizePrefix\n$1  ? Math.ceil(this.data.capacity / Math.floor(64 / bitsPerValue))\n$1  : varInt.read(smartBuffer)'
  )

  // Older implementations occasionally used the mathematically-wrong ceil(n*b/64)
  // shortcut for no-prefix arrays. It under-reads whenever 64 % bitsPerValue != 0
  // (e.g. 4096 block entries @ 5 bits: 320 vs the correct 342 longs).
  source = source.replace(
    /Math\.ceil\(this\.data\.capacity\s*\*\s*bitsPerValue\s*\/\s*64\)/g,
    'Math.ceil(this.data.capacity / Math.floor(64 / bitsPerValue))'
  )
  source = source.replace(
    /Math\.ceil\((?:constants\.BLOCK_SECTION_VOLUME|constants\.BIOME_SECTION_VOLUME)\s*\*\s*bitsPerValue\s*\/\s*64\)/g,
    'Math.ceil(this.data.capacity / Math.floor(64 / bitsPerValue))'
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
    /Math\.ceil\(this\.data\.capacity \/ Math\.floor\(64 \/ bitsPerValue\)\)/,
    /if \(!this\.noSizePrefix\) smartBuffer\.writeUInt8\(0\)/,
  ]
  for (const pattern of required) if (!pattern.test(source)) throw new Error(`${PATCH_ID}: PaletteContainer invariant missing: ${pattern}`)
  const computedReads = (source.match(/this\.noSizePrefix\s*\n\s*\? Math\.ceil\(this\.data\.capacity \/ Math\.floor\(64 \/ bitsPerValue\)\)/g) || []).length
  if (computedReads < 2) throw new Error(`${PATCH_ID}: PaletteContainer must compute no-prefix word counts for both direct and indirect palettes; found ${computedReads}`)
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
      "$1  // HEM hem-prismarine-chunk-1215-nosize-v1: 1.21.5+ omits palette data length prefixes.\n  const noSizePrefix = mcData.version['>=']('1.21.5')\n",
      'ChunkColumn 1.21.5 noSizePrefix version gate'
    )
  }

  // Initial sections / biomes must know which wire format to write and later mutate.
  source = source.replace(/new ChunkSection\(\{(?![^}]*\bnoSizePrefix\b)/g, 'new ChunkSection({ noSizePrefix,')
  source = source.replace(/new BiomeSection\(\{(?![^}]*\bnoSizePrefix\b)/g, 'new BiomeSection({ noSizePrefix,')

  // Network decode is the critical RC22 fix.
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
  for (const [name, file] of Object.entries(files)) {
    const before = await fsp.readFile(file, 'utf8')
    const after = transforms[name](before)
    hashes[name] = { before: sha256(before), after: sha256(after), changed: before !== after }
    await fsp.writeFile(file, after)
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  }

  // Mathematical sentinels for the exact bug seen in live RC21 logs.
  const sizing = {
    blocks5Bits: packedLongCount(4096, 5),
    biomes3Bits: packedLongCount(64, 3),
  }
  if (sizing.blocks5Bits !== 342 || sizing.biomes3Bits !== 4) throw new Error(`${PATCH_ID}: packed-long sizing invariant failed: ${JSON.stringify(sizing)}`)

  let version = 'unknown'
  try { version = JSON.parse(await fsp.readFile(path.join(packageRoot, 'package.json'), 'utf8')).version || version } catch {}
  return { patchId: PATCH_ID, packageVersion: version, sizing, files: hashes }
}

async function findPrismarineChunkRoots (upstreamRoot) {
  const req = createRequire(path.join(upstreamRoot, 'package.json'))
  const roots = new Set()
  try {
    let cursor = path.dirname(fs.realpathSync(req.resolve('prismarine-chunk')))
    while (cursor !== path.dirname(cursor)) {
      const pkg = path.join(cursor, 'package.json')
      if (fs.existsSync(pkg)) {
        try {
          if (JSON.parse(fs.readFileSync(pkg, 'utf8')).name === 'prismarine-chunk') { roots.add(cursor); break }
        } catch {}
      }
      cursor = path.dirname(cursor)
    }
  } catch (error) {
    throw new Error(`${PATCH_ID}: cannot resolve installed prismarine-chunk: ${error.message}`)
  }

  const pnpmDir = path.join(upstreamRoot, 'node_modules', '.pnpm')
  if (fs.existsSync(pnpmDir)) {
    for (const entry of await fsp.readdir(pnpmDir)) {
      const candidate = path.join(pnpmDir, entry, 'node_modules', 'prismarine-chunk')
      if (!fs.existsSync(candidate)) continue
      try {
        const real = fs.realpathSync(candidate)
        const pkg = JSON.parse(await fsp.readFile(path.join(real, 'package.json'), 'utf8'))
        if (pkg.name === 'prismarine-chunk') roots.add(real)
      } catch {}
    }
  }
  return [...roots]
}

export async function main (upstreamRoot = process.argv[2] || process.cwd()) {
  const roots = await findPrismarineChunkRoots(path.resolve(upstreamRoot))
  if (!roots.length) throw new Error(`${PATCH_ID}: no installed prismarine-chunk package roots found`)
  const reports = []
  for (const root of roots) reports.push({ root: path.relative(path.resolve(upstreamRoot), root), ...(await patchPackageRoot(root)) })
  const report = {
    patchId: PATCH_ID,
    minecraft: '1.21.5',
    reason: 'Minecraft 1.21.5 paletted chunk/biome arrays omit the legacy VarInt data-length prefix; compute fixed long counts instead.',
    reports,
  }
  const reportPath = path.join(path.resolve(upstreamRoot), '.hem-prismarine-chunk-1215.json')
  await fsp.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log(`HEM ${PATCH_ID} applied to ${reports.length} prismarine-chunk package root(s); 4096@5=${packedLongCount(4096, 5)} longs, 64@3=${packedLongCount(64, 3)} longs`)
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exit(1) })
}
