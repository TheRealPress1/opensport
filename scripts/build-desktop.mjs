import { build } from 'vite'
import { packager } from '@electron/packager'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, writeFile, readdir, rm, stat, symlink } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareNativeLauncher } from './build-native-cli.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktop = path.join(root, 'desktop')
const resources = path.join(desktop, 'resources')
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
async function run(command, args, cwd = root) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', env: process.env })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code})`)))
  })
}
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Build this Mac hosting preview on an Apple silicon Mac.')
await prepareNativeLauncher(resources)
await rm(path.join(resources, 'supabase'), { recursive: true, force: true })
for (const directory of ['migrations', 'functions']) {
  await cp(path.join(root, 'supabase', directory), path.join(resources, 'supabase', directory), { recursive: true,
    filter: source => !path.basename(source).startsWith('.') })
}
await cp(path.join(root, 'LICENSE'), path.join(resources, 'OpenSport-LICENSE'))
await cp(path.join(desktop, 'licenses'), path.join(resources, 'licenses'), { recursive: true })
await cp(path.join(desktop, 'runtime-lock.json'), path.join(resources, 'runtime-lock.json'))
await writeFile(path.join(resources, 'THIRD-PARTY-NOTICES.txt'), 'OpenSport includes Electron (MIT), a source-built and modified Supabase CLI (MIT) compiled with Bun, and other dependencies with their own licenses.\nSupabase native services download on first setup; their notices accompany upstream service archives.\nBun and embedded JavaScriptCore license/relinking information: licenses/Bun-LICENSE.md; source: https://github.com/oven-sh/bun/tree/bun-v1.4.2\nSupabase CLI source: https://github.com/supabase/cli/tree/753520fa7202ed5f8b25883a4c0aa7e5e9ad1fc4\nOpenSport patch and reproducible build inputs: desktop/patches and desktop/runtime-lock.json in https://github.com/TheRealPress1/opensport\nBundled native/opensport-build.json identifies the source patch and executable. The unmodified supabase-go compatibility sidecar comes from the pinned upstream release archive.\nElectron source: https://github.com/electron/electron\n')
// Never inherit a workspace's production credentials into either app bundle.
process.env.VITE_SUPABASE_URL = ''
process.env.VITE_SUPABASE_ANON_KEY = ''
for (const [mode, directory] of [['desktop', 'shell'], ['team', 'team']]) {
  process.env.VITE_APP_MODE = mode
  await build({ root, base: '/', publicDir: false, build: { outDir: path.join(desktop, 'dist', directory), emptyOutDir: true } })
  await cp(path.join(root, 'public', 'favicon.svg'), path.join(desktop, 'dist', directory, 'favicon.svg'))
}
if (!process.argv.includes('--bundle')) {
  console.log('Mac app prepared. Run npm run desktop:dev to open it.')
  process.exit(0)
}
const output = path.join(desktop, 'out')
const stage = path.join(output, 'stage')
await rm(stage, { recursive: true, force: true })
await mkdir(path.join(stage, 'desktop'), { recursive: true })
for (const entry of await readdir(desktop, { withFileTypes: true })) {
  if (entry.isFile() && /\.(mjs|cjs|json)$/.test(entry.name)) await cp(path.join(desktop, entry.name), path.join(stage, 'desktop', entry.name))
}
await cp(path.join(desktop, 'dist'), path.join(stage, 'desktop', 'dist'), { recursive: true })
await cp(resources, path.join(stage, 'desktop', 'resources'), { recursive: true, filter: source => !source.endsWith('.tar.gz') })
await cp(path.join(root, 'LICENSE'), path.join(stage, 'LICENSE'))
await writeFile(path.join(stage, 'package.json'), JSON.stringify({ ...pkg, main: 'desktop/main.mjs', scripts: {}, devDependencies: {} }, null, 2))
await cp(path.join(root, 'package-lock.json'), path.join(stage, 'package-lock.json'))
await run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], stage)
const iconset = path.join(output, 'OpenSport.iconset')
await mkdir(iconset, { recursive: true })
const icon = path.join(iconset, 'icon_512x512@2x.png')
await run('/usr/bin/swift', [path.join(desktop, 'icon.swift'), icon])
for (const [pixels, filename] of [[16, 'icon_16x16'], [32, 'icon_16x16@2x'], [32, 'icon_32x32'], [64, 'icon_32x32@2x'], [128, 'icon_128x128'], [256, 'icon_128x128@2x'], [256, 'icon_256x256'], [512, 'icon_256x256@2x'], [512, 'icon_512x512']]) {
  await run('/usr/bin/sips', ['-z', String(pixels), String(pixels), icon, '--out', path.join(iconset, `${filename}.png`)])
}
await run('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(output, 'OpenSport.icns')])
const outputs = await packager({ dir: stage, out: output, name: 'OpenSport', platform: 'darwin', arch: 'arm64',
  electronVersion: pkg.devDependencies.electron, overwrite: true, asar: false, prune: false,
  appBundleId: 'org.opensport.desktop', appCategoryType: 'public.app-category.sports',
  appVersion: pkg.version, icon: path.join(output, 'OpenSport.icns'),
  // Repair Electron's resource seal for this local preview without selecting a
  // developer certificate. Public distribution needs Developer ID/notarization.
  osxSign: { identity: '-', identityValidation: false, preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    optionsForFile: () => ({ hardenedRuntime: false, timestamp: 'none' }),
  },
  extendInfo: { LSMinimumSystemVersion: '14.0', NSLocalNetworkUsageDescription: 'OpenSport hosts your private team on this Mac.' },
})
const packagedApp = path.join(outputs[0], 'OpenSport.app')
// Electron's signer can replace the nested launcher's ad-hoc signature. Record
// those final bytes, then re-seal only the outer app so its resource seal agrees.
const packagedNative = path.join(packagedApp, 'Contents/Resources/app/desktop/resources/native')
const packagedManifestPath = path.join(packagedNative, 'opensport-build.json')
const packagedManifest = JSON.parse(await readFile(packagedManifestPath, 'utf8'))
packagedManifest.binarySha256 = createHash('sha256').update(await readFile(path.join(packagedNative, 'supabase'))).digest('hex')
await writeFile(packagedManifestPath, `${JSON.stringify(packagedManifest, null, 2)}\n`)
await run('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', packagedApp])
await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', packagedApp])
const dmg = path.join(output, `OpenSport-${pkg.version}-Mac-preview-arm64.dmg`)
await rm(path.join(outputs[0], 'Applications'), { force: true })
await symlink('/Applications', path.join(outputs[0], 'Applications'))
await writeFile(path.join(outputs[0], 'Read me first.txt'), 'OpenSport for Mac — local testing preview\n\nDrag OpenSport into Applications, then open it. Apple silicon and macOS 14 or later are required.\n\nThe setup wizard does not require Docker or Terminal. First setup downloads the native services and may take several minutes.\n\nUse fictional team data while release checks are completed. New installations use private database credentials and authenticated startup. Internet sharing is disabled.\n\nThis preview is not Developer ID signed or notarized. Do not disable macOS security settings to open it.\n\nSource and current documentation: https://github.com/TheRealPress1/opensport\n')
await rm(dmg, { force: true })
await run('/usr/bin/hdiutil', ['create', '-volname', 'OpenSport preview', '-srcfolder', outputs[0], '-ov', '-format', 'UDZO', dmg])
const digest = createHash('sha256').update(await readFile(dmg)).digest('hex')
await writeFile(`${dmg}.sha256`, `${digest}  ${path.basename(dmg)}\n`)
console.log(`Built ${dmg} (${Math.round((await stat(dmg)).size / 1024 / 1024)} MB). Local preview only; sign and notarize before public distribution.`)
