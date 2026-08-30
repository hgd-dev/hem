import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import syncFs from 'node:fs'

const hemVersion = JSON.parse(syncFs.readFileSync('package.json', 'utf8')).version
await fs.mkdir('artifacts', { recursive: true })
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
})
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const fatal = []
  page.on('pageerror', error => fatal.push(error.message))
  await page.goto('http://127.0.0.1:4174/', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForSelector('#register.active', { timeout: 15_000 })
  await page.waitForFunction(() => document.querySelector('#regSkinPreview')?.dataset.preview === 'webgl-3d', null, { timeout: 15_000 })

  const classic = await page.evaluate(() => {
    const canvas = document.querySelector('#regSkinPreview')
    return Boolean(canvas && canvas.getContext('webgl') && canvas.dataset.preview === 'webgl-3d')
  })
  if (!classic) throw new Error('HEM launcher did not establish the Classic WebGL skin preview')

  await page.setInputFiles('#regSkin', 'tests/system/skins/elise.png')
  await page.click('[data-action="toggle-reg-skin-model"]')
  await page.waitForFunction(() => document.querySelector('#regSkinModel')?.textContent?.includes('Slim'))
  const slim = await page.evaluate(() => document.querySelector('#regSkinPreview')?.dataset.preview === 'webgl-3d')
  if (!slim) throw new Error('HEM launcher lost WebGL preview after Slim skin selection')

  // Legacy Java skins predate the slim-arm model and only carry right-limb pixels.
  // HEM must normalize them into modern 64x64 left-limb regions and select Classic.
  await page.setInputFiles('#regSkin', 'tests/system/skins/legacy.png')
  await page.waitForFunction(() => document.querySelector('#regSkinModel')?.textContent?.includes('Classic'))
  const legacyNormalized = await page.evaluate(() => document.querySelector('#regSkinPreview')?.dataset.preview === 'webgl-3d')
  if (!legacyNormalized) throw new Error('HEM launcher lost 3D preview after legacy 64x32 normalization')

  const box = await page.locator('#regSkinPreview').boundingBox()
  if (!box) throw new Error('HEM launcher skin preview has no layout box')
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.38, { steps: 8 })
  await page.mouse.up()
  const dragged = await page.evaluate(() => document.querySelector('#regSkinPreview')?.__hemPreviewDragged === true)
  if (!dragged) throw new Error('HEM launcher 3D skin preview did not register drag rotation')

  // Exercise HEM's actual Options controls in-browser. The static launcher does
  // not have a Hub API identity, so expose the screen directly, save through the
  // same delegated click handler, reload, and prove applySettings restored it.
  await page.evaluate(() => {
    document.querySelectorAll('.screen').forEach(node => node.classList.remove('active'))
    document.querySelector('#options')?.classList.add('active')
  })
  await page.selectOption('#uiScale', '1.15')
  await page.selectOption('#renderDistance', '12')
  await page.fill('#fov', '92')
  await page.fill('#mouseSensitivity', '1.35')
  await page.fill('#masterVolume', '0.65')
  await page.fill('#musicVolume', '0.25')
  await page.uncheck('#viewBobbing')
  await page.check('#smoothLighting')
  await page.check('#skyEnabled')
  await page.check('#rawMouseInput')
  await page.check('#highContrast')
  await page.check('#openControls')
  await page.check('#reducedMotion')
  await page.click('[data-action="save-options"]')
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForSelector('#register.active', { timeout: 15_000 })
  const settingsPersisted = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('hem.settings.v1') || '{}')
    return saved.scale === 1.15 && saved.renderDistance === 12 && saved.fov === 92 && saved.mouseSensitivity === 1.35
      && saved.masterVolume === .65 && saved.musicVolume === .25 && saved.viewBobbing === false && saved.smoothLighting === true
      && saved.skyEnabled === true && saved.rawMouseInput === true && saved.highContrast === true && saved.openControls === true && saved.reducedMotion === true
      && document.querySelector('#renderDistance')?.value === '12' && document.querySelector('#fov')?.value === '92'
      && document.querySelector('#openControls')?.checked === true && document.body.classList.contains('reduce-motion')
      && document.body.classList.contains('high-contrast')
  })
  if (!settingsPersisted) throw new Error('HEM launcher Options did not persist/apply render-distance, controls, UI-scale and motion settings')

  if (fatal.length) throw new Error(`HEM launcher page errors:\n${fatal.join('\n')}`)
  await page.screenshot({ path: 'artifacts/hem-launcher-3d.png', fullPage: true })
  await fs.writeFile('artifacts/hem-launcher-certification.json', JSON.stringify({
    hemVersion,
    preview: 'webgl-3d',
    classic,
    slim,
    dragRotate: dragged,
    legacyNormalized,
    settingsPersisted,
    completedAt: new Date().toISOString(),
  }, null, 2) + '\n')
  console.log('HEM LAUNCHER 3D SKIN ACCEPTANCE PASSED')
} finally {
  await browser.close()
}
