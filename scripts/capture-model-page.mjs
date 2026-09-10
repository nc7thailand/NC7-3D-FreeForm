import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const outDir = '/Users/nc7foamart/NC7Studio3D/.inspect'
mkdirSync(outDir, { recursive: true })

const viewports = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'ipad', width: 820, height: 1180 },
]

const browser = await chromium.launch()
for (const vp of viewports) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } })
  await page.goto('http://127.0.0.1:5173/model', { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(3500)
  const path = `${outDir}/model-${vp.name}.png`
  await page.screenshot({ path, fullPage: false })
  const info = await page.evaluate(() => ({
    title: document.title,
    hasNextHeader: !!document.querySelector('.header-next-btn'),
    hasNextNav: !!document.querySelector('.nav-next'),
    nextNavDisabled: document.querySelector('.nav-next')?.disabled ?? null,
    stepperActive: document.querySelector('.stepper-item.active')?.textContent?.trim() ?? null,
    status: document.querySelector('.status-bar')?.textContent?.trim() ?? null,
    viewportH: window.innerHeight,
    appH: document.querySelector('.app')?.getBoundingClientRect().height ?? 0,
    navVisible: (() => {
      const el = document.querySelector('.page-nav')
      if (!el) return false
      const r = el.getBoundingClientRect()
      return r.top < window.innerHeight && r.bottom > 0
    })(),
  }))
  console.log(JSON.stringify({ viewport: vp.name, path, ...info }))
}
await browser.close()
