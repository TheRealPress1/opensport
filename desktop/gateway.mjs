import http from 'node:http'
import path from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import httpProxy from 'http-proxy'

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }
export function publicPathAllowed(raw) {
  const pathname = raw.split('?')[0]
  if (/%|\\|\.\./.test(pathname)) return false
  return /^\/api\/(auth\/v1(?:\/|$)|rest\/v1(?:\/|$)|storage\/v1(?:\/|$))/.test(pathname)
    && !/^\/api\/auth\/v1\/admin(?:\/|$)/.test(pathname)
    || pathname === '/api/realtime/v1/websocket'
    || pathname === '/api/functions/v1/team-admin'
}

export async function readAsset(directory, pathname) {
  const decoded = decodeURIComponent(pathname)
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(part => part.startsWith('.'))) return null
  const resolved = path.resolve(directory, `.${decoded}`)
  if (!resolved.startsWith(`${path.resolve(directory)}${path.sep}`)) return null
  try {
    if (!(await stat(resolved)).isFile()) return null
    return { body: await readFile(resolved), type: MIME[path.extname(resolved)] || 'application/octet-stream' }
  } catch { return null }
}

export class TeamGateway {
  constructor({ staticDir, getRuntimeConfig }) {
    this.staticDir = staticDir
    this.getRuntimeConfig = getRuntimeConfig
    this.connections = new Set()
    this.proxy = httpProxy.createProxyServer({ ws: true, proxyTimeout: 30000, timeout: 30000 })
    this.proxy.on('error', (_error, _req, res) => {
      if (res?.writeHead && !res.headersSent) res.writeHead(503, { 'Content-Type': 'application/json' })
      res?.end?.(JSON.stringify({ error: 'Your team server is starting or unavailable. Try again shortly.' }))
    })
  }
  async start(port = 0) {
    if (!Number.isInteger(port) || (port !== 0 && (port < 1024 || port > 65535))) throw new Error('The saved local server port is invalid. Restore the OpenSport settings from a valid backup.')
    this.server = http.createServer((req, res) => this.handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500)
      res.end('OpenSport could not load this request.')
    }))
    this.server.on('connection', socket => {
      this.connections.add(socket)
      socket.once('close', () => this.connections.delete(socket))
    })
    this.server.on('upgrade', (req, socket, head) => {
      if (!this.allowedRequest(req) || req.url.split('?')[0] !== '/api/realtime/v1/websocket') return socket.destroy()
      const config = this.getRuntimeConfig()
      if (!config) return socket.destroy()
      req.url = req.url.slice(4)
      this.proxy.ws(req, socket, head, { target: config.apiUrl })
    })
    await new Promise((resolve, reject) => {
      this.server.once('error', reject)
      // Never listen on the LAN: native Supabase is a local preview runtime.
      this.server.listen(port, '127.0.0.1', resolve)
    })
    this.origin = `http://127.0.0.1:${this.server.address().port}`
    return this.origin
  }
  allowedRequest(req) {
    return req.headers.host === new URL(this.origin).host
      && (!req.headers.origin || req.headers.origin === this.origin)
  }
  async handle(req, res) {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    if (!this.allowedRequest(req)) { res.writeHead(403); return res.end('This local host does not accept that origin.') }
    const pathname = req.url.split('?')[0]
    if (pathname.startsWith('/api/')) {
      if (!publicPathAllowed(req.url)) { res.writeHead(404); return res.end('Not found') }
      const config = this.getRuntimeConfig()
      if (!config) { res.writeHead(503); return res.end('Your team server is starting.') }
      req.url = req.url.slice(4)
      return this.proxy.web(req, res, { target: config.apiUrl })
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end('Use GET') }
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws://127.0.0.1:*; object-src 'none'; frame-ancestors 'none'; base-uri 'self'")
    if (pathname === '/runtime-config.js') {
      const config = this.getRuntimeConfig()
      if (!config) { res.writeHead(503); return res.end('/* Start your team server in OpenSport, then reload. */') }
      const data = JSON.stringify({ supabaseUrl: `${this.origin}/api`, anonKey: config.anonKey }).replace(/</g, '\\u003c')
      res.setHeader('Content-Type', MIME['.js'])
      return res.end(`window.__OPENSPORT_CONFIG__=Object.freeze(${data});`)
    }
    const asset = await readAsset(this.staticDir, pathname === '/' ? '/index.html' : pathname)
    if (!asset) { res.writeHead(404); return res.end('Not found') }
    res.setHeader('Content-Type', asset.type)
    const body = pathname === '/' || pathname === '/index.html'
      ? asset.body.toString().replace('<head>', '<head><script src="/runtime-config.js"></script>') : asset.body
    res.end(req.method === 'HEAD' ? undefined : body)
  }
  async stop() {
    this.proxy.close()
    this.server?.closeAllConnections()
    // HTTP closeAllConnections excludes upgraded WebSockets. End those too so
    // an open team browser cannot prevent a cold backup or application quit.
    for (const socket of this.connections) socket.destroy()
    this.connections.clear()
    if (this.server?.listening) await new Promise(resolve => this.server.close(resolve))
  }
}
