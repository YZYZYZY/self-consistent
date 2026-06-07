import { cpSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const webDist = resolve(root, 'apps/web/dist')
const rootDist = resolve(root, 'dist')

if (!existsSync(webDist)) {
  throw new Error(`Vite output was not found: ${webDist}`)
}

rmSync(rootDist, { recursive: true, force: true })
cpSync(webDist, rootDist, { recursive: true })

console.log(`Synced Cloudflare Pages root output: ${rootDist}`)
