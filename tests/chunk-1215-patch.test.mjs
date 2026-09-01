import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PATCH_ID,
  packedLongCount,
  patchPaletteContainerSource,
  patchPaletteBiomeSource,
  patchPaletteChunkSectionSource,
  patchChunkColumnSource,
} from '../apps/client/patch-prismarine-chunk-1215.mjs'

test('1.21.5 fixed palette sizing uses Mojang non-spanning long count', () => {
  assert.equal(PATCH_ID, 'hem-prismarine-chunk-1215-nosize-v1')
  assert.equal(packedLongCount(4096, 4), 256)
  assert.equal(packedLongCount(4096, 5), 342)
  assert.equal(packedLongCount(4096, 6), 410)
  assert.equal(packedLongCount(64, 3), 4)
  // These were the tempting but wrong ceil(entries * bits / 64) results that
  // under-read the real 1.21.5 stream and desynchronize the following biome data.
  assert.equal(Math.ceil(4096 * 5 / 64), 320)
  assert.equal(Math.ceil(64 * 3 / 64), 3)
})

test('RC22 patch upgrades legacy palette containers to no-size-prefix reads and writes', () => {
  const legacy = `
const BitArray = require('./BitArrayNoSpan')
const constants = require('./constants')
const varInt = require('./varInt')
class DirectPaletteContainer {
  constructor (options) {
    this.data = new BitArray({ bitsPerValue: options?.bitsPerValue, capacity: options?.capacity })
  }
  write (smartBuffer) {
    smartBuffer.writeUInt8(this.data.bitsPerValue)
    varInt.write(smartBuffer, this.data.length())
    this.data.writeBuffer(smartBuffer)
  }
  readBuffer (smartBuffer, bitsPerValue) {
    const longs = varInt.read(smartBuffer)
    this.data.readBuffer(smartBuffer, longs * 2)
    return this
  }
}
class IndirectPaletteContainer {
  constructor (options) {
    this.data = options?.data ?? new BitArray({ bitsPerValue: options?.bitsPerValue, capacity: options?.capacity })
    this.palette = options?.palette ?? [0]
  }
  set (index, value) {
    return this
  }
  convertToDirect (bitsPerValue) {
    const direct = new DirectPaletteContainer({
      bitsPerValue,
      capacity: this.data.capacity
    })
    return direct
  }
  write (smartBuffer) {
    smartBuffer.writeUInt8(this.data.bitsPerValue)
    varInt.write(smartBuffer, this.data.length())
    this.data.writeBuffer(smartBuffer)
  }
  readBuffer (smartBuffer, bitsPerValue) {
    const longs = varInt.read(smartBuffer)
    this.data.readBuffer(smartBuffer, longs * 2)
    return this
  }
}
class SingleValueContainer {
  constructor (options) {
    this.value = options?.value ?? 0
  }
  set (index, value) {
    if (value === this.value) return this
    return new IndirectPaletteContainer({
      palette: [this.value, value]
    })
  }
  write (smartBuffer) {
    smartBuffer.writeUInt8(0)
    varInt.write(smartBuffer, this.value)
    smartBuffer.writeUInt8(0)
  }
}
`
  const patched = patchPaletteContainerSource(legacy)
  assert.match(patched, /this\.noSizePrefix = options\?\.noSizePrefix/)
  assert.equal((patched.match(/if \(!this\.noSizePrefix\) varInt\.write\(smartBuffer, this\.data\.length\(\)\)/g) || []).length, 2)
  assert.equal((patched.match(/Math\.ceil\(this\.data\.capacity \/ Math\.floor\(64 \/ bitsPerValue\)\)/g) || []).length, 2)
  assert.match(patched, /if \(!this\.noSizePrefix\) smartBuffer\.writeUInt8\(0\)/)
  assert.match(patched, /convertToDirect[\s\S]*?noSizePrefix: this\.noSizePrefix/)
})

test('RC22 patch threads 1.21.5 no-size-prefix through block and biome chunk decoders', () => {
  const biomeLegacy = `
const constants = require('./constants')
const paletteContainer = require('./PaletteContainer')
const varInt = require('../common/varInt')
const SingleValueContainer = paletteContainer.SingleValueContainer
const IndirectPaletteContainer = paletteContainer.IndirectPaletteContainer
const DirectPaletteContainer = paletteContainer.DirectPaletteContainer
class BiomeSection {
  constructor (options) {
    this.data = options?.data ?? new SingleValueContainer({
      value: options?.singleValue ?? 0,
      bitsPerValue: constants.MIN_BITS_PER_BIOME,
      capacity: constants.BIOME_SECTION_VOLUME,
      maxBits: constants.MAX_BITS_PER_BIOME
    })
  }
  static fromLocalPalette ({ palette, data }) {
    return new BiomeSection({
      data: palette.length === 1
        ? new SingleValueContainer({
          value: palette[0]
        })
        : new IndirectPaletteContainer({
          palette,
          data
        })
    })
  }
  write (smartBuffer) { this.data.write(smartBuffer) }
  static read (smartBuffer, maxBitsPerBiome = constants.GLOBAL_BITS_PER_BIOME) {
    const bitsPerBiome = smartBuffer.readUInt8()
    if (bitsPerBiome === 0) {
      const section = new BiomeSection({
        singleValue: varInt.read(smartBuffer)
      })
      smartBuffer.readUInt8()
      return section
    }
    if (bitsPerBiome > constants.MAX_BITS_PER_BIOME) {
      return new BiomeSection({
        data: new DirectPaletteContainer({
          bitsPerValue: maxBitsPerBiome,
          capacity: constants.BIOME_SECTION_VOLUME
        }).readBuffer(smartBuffer, bitsPerBiome)
      })
    }
    const palette = []
    const paletteLength = varInt.read(smartBuffer)
    for (let i = 0; i < paletteLength; ++i) palette.push(varInt.read(smartBuffer))
    return new BiomeSection({
      data: new IndirectPaletteContainer({
        bitsPerValue: bitsPerBiome,
        capacity: constants.BIOME_SECTION_VOLUME,
        palette
      }).readBuffer(smartBuffer, bitsPerBiome)
    })
  }
}
module.exports = BiomeSection
`
  const biome = patchPaletteBiomeSource(biomeLegacy)
  assert.match(biome, /static read \(smartBuffer, maxBitsPerBiome = constants\.GLOBAL_BITS_PER_BIOME, noSizePrefix\)/)
  assert.match(biome, /if \(!noSizePrefix\) smartBuffer\.readUInt8\(\)/)
  assert.match(biome, /new DirectPaletteContainer\(\{\s*\n\s*noSizePrefix/)
  assert.match(biome, /new IndirectPaletteContainer\(\{\s*\n\s*noSizePrefix/)

  const sectionLegacy = `
module.exports = (Block) => {
  class ChunkSection {
    constructor (options) {
      this.data = options?.data ?? new SingleValueContainer({
        value: options?.singleValue ?? 0
      })
    }
    toJson () { return '{}' }
    static fromLocalPalette ({ data, palette }) {
      return new ChunkSection({
        data: palette.length === 1
          ? new SingleValueContainer({
            value: palette[0]
          })
          : new IndirectPaletteContainer({
            data,
            palette
          })
      })
    }
    static read (smartBuffer, maxBitsPerBlock = constants.GLOBAL_BITS_PER_BLOCK) {
      const solidBlockCount = smartBuffer.readInt16BE()
      const bitsPerBlock = smartBuffer.readUInt8()
      if (bitsPerBlock === 0) {
        const section = new ChunkSection({
          solidBlockCount,
          singleValue: varInt.read(smartBuffer),
          maxBitsPerBlock
        })
        smartBuffer.readUInt8()
        return section
      }
      if (bitsPerBlock > constants.MAX_BITS_PER_BLOCK) {
        return new ChunkSection({
          solidBlockCount,
          data: new DirectPaletteContainer({
            bitsPerValue: maxBitsPerBlock,
            capacity: constants.BLOCK_SECTION_VOLUME
          }).readBuffer(smartBuffer, bitsPerBlock)
        })
      }
      const palette = []
      const paletteLength = varInt.read(smartBuffer)
      for (let i = 0; i < paletteLength; ++i) palette.push(varInt.read(smartBuffer))
      return new ChunkSection({
        solidBlockCount,
        data: new IndirectPaletteContainer({
          bitsPerValue: bitsPerBlock,
          capacity: constants.BLOCK_SECTION_VOLUME,
          palette
        }).readBuffer(smartBuffer, bitsPerBlock)
      })
    }
  }
}
`
  const section = patchPaletteChunkSectionSource(sectionLegacy)
  assert.match(section, /static read \(smartBuffer, maxBitsPerBlock = constants\.GLOBAL_BITS_PER_BLOCK, noSizePrefix\)/)
  assert.match(section, /if \(!noSizePrefix\) smartBuffer\.readUInt8\(\)/)
  assert.match(section, /new DirectPaletteContainer\(\{\s*\n\s*noSizePrefix/)

  const columnLegacy = `
module.exports = (Block, mcData) => {
  const ChunkSection = require('../common/PaletteChunkSection')(Block)
  return class ChunkColumn {
    constructor (options) {
      this.sections = Array.from({ length: 24 }, _ => new ChunkSection({ maxBitsPerBlock: this.maxBitsPerBlock }))
      this.biomes = Array.from({ length: 24 }, _ => new BiomeSection({}))
    }
    load (data) {
      const reader = SmartBuffer.fromBuffer(data)
      for (let i = 0; i < this.numSections; ++i) {
        this.sections[i] = ChunkSection.read(reader, this.maxBitsPerBlock)
        this.biomes[i] = BiomeSection.read(reader, this.maxBitsPerBiome)
      }
    }
    loadSection (y, blockStates, biomes) {
      this.sections[y] = ChunkSection.fromLocalPalette({
        data: blockStates.data,
        palette: blockStates.palette
      })
      this.biomes[y] = BiomeSection.fromLocalPalette({
        data: biomes.data,
        palette: biomes.palette
      })
    }
  }
}
`
  const column = patchChunkColumnSource(columnLegacy)
  assert.match(column, /mcData\.version\['>='\]\('1\.21\.5'\)/)
  assert.match(column, /ChunkSection\.read\(reader, this\.maxBitsPerBlock, noSizePrefix\)/)
  assert.match(column, /BiomeSection\.read\(reader, this\.maxBitsPerBiome, noSizePrefix\)/)
})
