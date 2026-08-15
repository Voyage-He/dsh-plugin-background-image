// 主机端插件：
// 1. 注册背景图片设置命名空间，交给 DSH 设置系统统一持久化到 settings.yaml。
// 2. 注册本地图片文件服务路由：浏览器不能直接加载 file:// 资源，这里把 settings
//    当前 image 字段引用的本地绝对路径以同源 http 方式提供给页面（“引用即授权”，
//    与 session.attachment 的授权模型一致）。仅接受本机回环来源。
// 3. 注册原生文件选择路由：浏览器拿不到磁盘绝对路径，由 Host 弹系统原生文件框
//    返回真实路径。
import z from '@deepseek-ai/schemastery'
import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'

export const name = 'dsh-plugin-background-image'

// 命名空间需匹配 /^[a-z][a-z0-9-]*$/（小写 kebab-case）。
const SETTINGS_NAMESPACE = 'background-image'

const SETTINGS_SCHEMA = z.object({
  enabled: z.boolean().default(false),
  mode: z.union(['fullscreen', 'conversation']).default('fullscreen'),
  opacity: z.number().min(0).max(1).default(0.9),
  image: z.string().default(''),
  // 毛玻璃：背景模糊强度（px）与饱和度（0=去色，1=原样，>1=更鲜艳）。
  blur: z.number().min(0).max(48).default(0),
  saturation: z.number().min(0).max(3).default(1),
  // 各区域不透明度：侧边栏与输入区可独立调节，值越小越透明（越沉浸）。
  sidebarOpacity: z.number().min(0).max(1).default(0.5),
  composerOpacity: z.number().min(0).max(1).default(0.72),
})

const FILE_ROUTE_PATH = '/plugins/background-image/file'
const PICK_ROUTE_PATH = '/plugins/background-image/pick'
const CONFIG_ROUTE_PATH = '/plugins/background-image/config'
const MAX_BYTES = 32 * 1024 * 1024

const IMAGE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
}

function isLocalPath(value) {
  if (typeof value !== 'string') return false
  const t = value.trim()
  return t.startsWith('/') || /^[A-Za-z]:[\\/]/.test(t) || t.startsWith('\\\\')
}

function isLoopback(addr) {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

function trimTrailingNewlines(value) {
  return String(value).replace(/[\r\n]+$/, '')
}

// 内联的 execFile 封装（等价于 @deepseek-ai/dsh-native-command 的 runNativeCommand），
// 避免额外的 host 依赖。
function runNativeCommand(command, args, signal) {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], {
      encoding: 'utf8',
      signal,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(Object.assign(new Error(error.message, { cause: error }), {
          code: error.code,
          stdout,
          stderr,
        }))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

async function pickNativeFile(signal) {
  const platform = process.platform
  if (platform === 'darwin') {
    try {
      const out = await runNativeCommand('osascript', [
        '-e', 'set f to choose file with prompt "选择背景图片"',
        '-e', 'POSIX path of f',
      ], signal)
      const path = trimTrailingNewlines(out.stdout)
      return path === '' ? null : path
    } catch (err) {
      if (err && err.code === 1 && /(?:User canceled|-128)/i.test(String(err.stderr || ''))) return null
      throw err
    }
  }
  if (platform === 'linux') {
    try {
      const out = await runNativeCommand('zenity', ['--file-selection', '--title=选择背景图片'], signal)
      const path = trimTrailingNewlines(out.stdout)
      return path === '' ? null : path
    } catch (err) {
      if (err && err.code === 1) return null
      if (err && err.code !== 'ENOENT') throw err
    }
    try {
      const out = await runNativeCommand('kdialog', ['--getopenfilename', '.', '--title', '选择背景图片'], signal)
      const path = trimTrailingNewlines(out.stdout)
      return path === '' ? null : path
    } catch (err) {
      if (err && err.code === 1) return null
      if (err && err.code === 'ENOENT') throw new Error('no supported native file picker found (install zenity or kdialog)')
      throw err
    }
  }
  if (platform === 'win32') {
    try {
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$d = New-Object System.Windows.Forms.OpenFileDialog',
        '$d.Filter = "Images|*.png;*.jpg;*.jpeg;*.webp;*.gif;*.bmp;*.svg;*.avif;*.ico"',
        '$d.Title = "选择背景图片"',
        'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.FileName }',
      ].join('; ')
      const out = await runNativeCommand('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], signal)
      const path = trimTrailingNewlines(out.stdout)
      return path === '' ? null : path
    } catch {
      return null
    }
  }
  throw new Error('native file picker is unsupported on ' + platform)
}

export function apply(ctx) {
  ctx.inject(['settings', 'webServer'], (scoped) => {
    scoped.settings.register(SETTINGS_NAMESPACE, SETTINGS_SCHEMA)

    scoped.effect(() => scoped.webServer.register({
      kind: 'exact',
      path: FILE_ROUTE_PATH,
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405)
          res.end()
          return
        }
        if (!isLoopback(req.socket.remoteAddress)) {
          res.writeHead(403)
          res.end()
          return
        }
        // “引用即授权”：只允许读取 settings 当前 image 字段引用的本地绝对路径。
        const section = scoped.settings.get(SETTINGS_NAMESPACE)
        const authorized = section && typeof section.image === 'string' ? section.image.trim() : ''
        if (authorized === '' || !isLocalPath(authorized)) {
          res.writeHead(404)
          res.end()
          return
        }
        const requested = new URL(req.url ?? '/', 'http://x').searchParams.get('path')
        if (requested === null || requested !== authorized) {
          res.writeHead(403)
          res.end()
          return
        }
        try {
          const info = await stat(authorized)
          if (!info.isFile() || info.size > MAX_BYTES) {
            res.writeHead(404)
            res.end()
            return
          }
          const body = await readFile(authorized)
          res.writeHead(200, {
            'content-type': IMAGE_MIME[extname(authorized).toLowerCase()] ?? 'application/octet-stream',
            'cache-control': 'no-cache',
          })
          res.end(req.method === 'HEAD' ? undefined : body)
        } catch {
          res.writeHead(404)
          res.end()
        }
      },
    }), 'background-image: local file route')

    // 配置读写路由：客户端不走 settingsScope（受核心 API 白名单限制），
    // 改由本插件自己的路由直接读写 host 的 settings 服务。
    scoped.effect(() => scoped.webServer.register({
      kind: 'exact',
      path: CONFIG_ROUTE_PATH,
      handler: async (req, res) => {
        if (!isLoopback(req.socket.remoteAddress)) {
          res.writeHead(403)
          res.end()
          return
        }
        if (req.method === 'GET') {
          const section = scoped.settings.get(SETTINGS_NAMESPACE)
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(section === undefined ? null : section))
          return
        }
        if (req.method === 'POST') {
          let body = ''
          for await (const chunk of req) body += chunk
          try {
            const section = JSON.parse(body)
            await scoped.settings.replace(SETTINGS_NAMESPACE, section)
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: true }))
          } catch (err) {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, error: err && err.message ? err.message : String(err) }))
          }
          return
        }
        res.writeHead(405)
        res.end()
      },
    }), 'background-image: config route')

    scoped.effect(() => scoped.webServer.register({
      kind: 'exact',
      path: PICK_ROUTE_PATH,
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          res.writeHead(405)
          res.end()
          return
        }
        if (!isLoopback(req.socket.remoteAddress)) {
          res.writeHead(403)
          res.end()
          return
        }
        const respond = (payload) => {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(payload))
        }
        try {
          const path = await pickNativeFile()
          respond({ path })
        } catch (err) {
          respond({ path: null, error: err && err.message ? err.message : String(err) })
        }
      },
    }), 'background-image: native file picker')
  })
}
