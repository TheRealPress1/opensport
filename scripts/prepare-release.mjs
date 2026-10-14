import { createHash } from 'node:crypto'
import { readFile, readdir, mkdir, lstat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const roots = ['src', 'public', 'supabase', 'deploy', 'desktop', 'scripts', 'tests', '.github', 'docs', 'api', 'server']
const files = ['package.json', 'package-lock.json', 'index.html', 'vite.config.js', 'eslint.config.js', 'playwright.config.js', '.gitignore', '.dockerignore', '.env.example', '.nvmrc', 'Dockerfile', 'vercel.json', 'README.md', 'LICENSE', 'CONTRIBUTING.md', 'CHANGELOG.md']
const omit = new Set(['node_modules', '.git', '.context', '.opensport', 'downloads', 'dist', 'out', 'resources', 'test-results', 'playwright-report', 'videos'])
async function walk(relative) {
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    if (omit.has(entry.name) || (entry.name.startsWith('.env') && entry.name !== '.env.example')) continue
    const next = `${relative}/${entry.name}`
    if (entry.isDirectory()) await walk(next)
    else if (entry.isFile()) files.push(next)
    // Never follow symlinks into files outside the release tree.
  }
}
for (const directory of roots) await walk(directory)
const archive = {}
const manifest = []
for (const relative of [...new Set(files)].sort()) {
  const absolute = path.join(root, relative)
  const stat = await lstat(absolute)
  if (stat.isFile()) {
    const bytes = await readFile(absolute)
    archive[`opensport-${version}/${relative}`] = [new Uint8Array(bytes), { mtime: new Date('2026-01-01T00:00:00Z'), os: 3, attrs: ((stat.mode & 0xffff) << 16) >>> 0 }]
    manifest.push(`${createHash('sha256').update(bytes).digest('hex')}  ${relative}`)
  }
}
archive[`opensport-${version}/SOURCE_MANIFEST.sha256`] = [new TextEncoder().encode(`${manifest.join('\n')}\n`), { mtime: new Date('2026-01-01T00:00:00Z') }]
const bytes = zipSync(archive, { level: 6 })
const output = path.join(root, 'public', 'downloads')
await mkdir(output, { recursive: true })
const name = `opensport-${version}-source.zip`
await writeFile(path.join(output, name), bytes)
await writeFile(path.join(output, `${name}.sha256`), `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`)
console.log(`Prepared ${name} (${files.length} source files). Release checks must pass before publishing.`)
