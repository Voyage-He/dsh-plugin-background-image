// 背景图片插件 client 半（v32）。用法见 README.md。
// 装载方式：读取本文件全文，作为 cordis_define 的 code.client 传入
// （新插件，idPrefix: bgimg），然后 cordis_run 激活。
const SOURCE = 'ui-background-image'

const PRESETS = [
  { id: 'aurora', label: '极光', css: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
  { id: 'sky', label: '晴空', css: 'linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%)' },
  { id: 'sakura', label: '樱花', css: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)' },
  { id: 'sunset', label: '落日', css: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)' },
  { id: 'mint', label: '薄荷', css: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)' },
  { id: 'ocean', label: '深海', css: 'linear-gradient(160deg, #0f2027 0%, #203a43 50%, #2c5364 100%)' }
]

const MODES = [
  { id: 'fullscreen', label: '沉浸式全屏', desc: '图片铺满整个窗口背景，侧栏呈现半透明玻璃效果，浮层面板保持清晰' },
  { id: 'conversation', label: '仅对话区域', desc: '图片只显示在对话工作区，侧栏与浮层面板保持原样' }
]

const store = { enabled: false, mode: 'fullscreen', opacity: 0.9, image: '' }
const listeners = new Set()
let themeService = null
let timerService = null
let layerDispose = null
let lastError = ''
let chosenLabel = '未应用'

function notify() {
  for (const fn of [...listeners]) fn()
}

function isImageValue(v) {
  if (typeof v !== 'string') return false
  const t = v.trim()
  if (t === '') return false
  return /^(linear|radial|conic)-gradient\(/i.test(t) || /^data:image\//i.test(t) || /^https?:\/\//i.test(t) || /^blob:/i.test(t)
}

function safeImage(v) {
  return String(v).trim().replace(/["'\\\r\n]/g, '')
}

function imageLayer(v) {
  const img = safeImage(v)
  if (/^(linear|radial|conic)-gradient\(/i.test(img)) return img
  return 'url("' + img + '")'
}

function veilAlpha() {
  const a = 1 - Math.max(0, Math.min(1, Number(store.opacity) || 0))
  return a.toFixed(3)
}

function cssSupports(v) {
  try {
    if (typeof document !== 'undefined' && document.createElement) {
      const d = document.createElement('div')
      d.style.background = v
      return d.style.background !== ''
    }
    return true
  } catch (err) {
    return true
  }
}

function buildCandidates() {
  const out = []
  if (!store.image || !isImageValue(store.image)) return out
  const a = veilAlpha()
  const img = imageLayer(store.image)
  const veilL = 'linear-gradient(rgba(255,255,255,' + a + '), rgba(255,255,255,' + a + '))'
  const veilD = 'linear-gradient(rgba(21,21,23,' + a + '), rgba(21,21,23,' + a + '))'
  const colorL = 'rgb(255,255,255)'
  const colorD = 'rgb(21,21,23)'
  out.push({ label: 'A', light: veilL + ', ' + img + ' center / cover no-repeat ' + colorL, dark: veilD + ', ' + img + ' center / cover no-repeat ' + colorD })
  out.push({ label: 'B', light: img + ' center / cover no-repeat ' + colorL, dark: img + ' center / cover no-repeat ' + colorD })
  out.push({ label: 'C', light: img + ' center / cover no-repeat', dark: img + ' center / cover no-repeat' })
  return out
}

function pickValue(scheme) {
  const cands = buildCandidates()
  for (const c of cands) {
    const v = scheme === 'dark' ? c.dark : c.light
    if (cssSupports(v)) return { value: v, label: c.label }
  }
  return { value: scheme === 'dark' ? 'rgb(21,21,23)' : 'rgb(255,255,255)', label: 'D' }
}

function buildTokens() {
  const tokens = {}
  if (store.enabled && store.image && isImageValue(store.image)) {
    const l = pickValue('light')
    const d = pickValue('dark')
    chosenLabel = l.label + ' / ' + d.label
    tokens['--dsw-alias-bg-base'] = { light: l.value, dark: d.value }
    if (store.mode === 'fullscreen') {
      tokens['--dsw-specific-sidebar-fill'] = { light: 'rgba(249,250,251,0.72)', dark: 'rgba(27,27,28,0.60)' }
    }
  } else {
    chosenLabel = '未应用'
  }
  return tokens
}

function applyTheme() {
  if (themeService === null) return
  try {
    const dispose = themeService.overrideTokens(SOURCE, buildTokens())
    if (layerDispose !== null) layerDispose()
    layerDispose = dispose
    lastError = ''
  } catch (err) {
    lastError = '应用主题失败: ' + (err && err.message ? err.message : String(err))
    console.error(lastError)
  }
}

function update(patch) {
  Object.assign(store, patch)
  applyTheme()
  notify()
}

function preloadImage(url, ok, fail) {
  try {
    if (typeof Image === 'undefined') { ok(); return }
    const im = new Image()
    let done = false
    const finish = (fn) => {
      if (done) return
      done = true
      fn()
    }
    im.onload = () => finish(ok)
    im.onerror = () => finish(fail)
    im.src = url
    if (timerService !== null) {
      timerService.timeout(() => finish(fail), 10000)
    }
  } catch (err) {
    ok()
  }
}

function useStore() {
  const [, force] = React.useState(0)
  React.useEffect(() => {
    const fn = () => force((x) => x + 1)
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])
  return store
}

function ChevronIcon() {
  return React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
    React.createElement('path', {
      d: 'M4 6 L8 10 L12 6',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round'
    })
  )
}

function SettingsPage(props) {
  const s = useStore()
  const [url, setUrl] = React.useState('')
  const [error, setError] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [open, setOpen] = React.useState(false)

  const onToggle = (e) => update({ enabled: e.target.checked })
  const onMode = (id) => update({ mode: id })
  const onOpacity = (e) => update({ opacity: Number(e.target.value) / 100 })

  const applyUrl = () => {
    const v = url.trim()
    if (v === '') { setError('请输入图片地址'); return }
    if (!/^https?:\/\//i.test(v) && !/^data:image\//i.test(v)) {
      setError('仅支持 http(s):// 图片地址或 data:image/ 数据地址')
      return
    }
    setError('')
    setLoading(true)
    preloadImage(v, () => {
      setLoading(false)
      update({ image: v })
    }, () => {
      setLoading(false)
      setError('图片加载失败：地址无效、被网络拦截，或格式不受浏览器支持')
    })
  }

  const onFile = (e) => {
    const input = e.target
    const file = input && input.files && input.files[0]
    if (input) input.value = ''
    if (!file) return
    if (file.size > 8 * 1024 * 1024) { setError('图片超过 8MB，请选择更小的图片'); return }
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      try {
        const blobUrl = URL.createObjectURL(file)
        setError('')
        preloadImage(blobUrl, () => {
          update({ image: blobUrl })
        }, () => {
          setError('图片解码失败：该格式可能不受浏览器支持（如 HEIC），请转换为 JPG/PNG/WebP 后重试')
        })
        return
      } catch (err) { /* fall through to FileReader */ }
    }
    if (typeof FileReader === 'undefined') { setError('当前环境不支持读取本地文件，请改用图片 URL'); return }
    try {
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          if (reader.result.length > 2 * 1024 * 1024) {
            setError('图片已应用，但体积较大时 data URL 方式可能无法显示；建议改用网络图片 URL')
          } else {
            setError('')
          }
          update({ image: reader.result })
        }
      }
      reader.onerror = () => setError('读取文件失败，请重试')
      reader.readAsDataURL(file)
    } catch (err) {
      setError('当前环境不支持读取本地文件，请改用图片 URL')
    }
  }

  let scheme = 'light'
  if (themeService !== null) {
    try {
      const snap = themeService.getTheme()
      if (snap && snap.active && snap.active.colorScheme) scheme = snap.active.colorScheme
    } catch (err) { /* keep light */ }
  }
  let previewBg = ''
  if (s.image && isImageValue(s.image)) {
    const a = veilAlpha()
    const rgb = scheme === 'dark' ? 'rgba(21,21,23,' + a + ')' : 'rgba(255,255,255,' + a + ')'
    const img = imageLayer(s.image)
    const v = 'linear-gradient(' + rgb + ', ' + rgb + '), ' + img + ' center / cover no-repeat'
    previewBg = cssSupports(v) ? v : img + ' center / cover no-repeat'
  }
  const activeMode = MODES.filter((m) => m.id === s.mode)[0] || MODES[0]
  const statusText = s.enabled && s.image ? '已启用 · ' + activeMode.label + ' · ' + Math.round(s.opacity * 100) + '%' : (s.image ? '已关闭' : '未选择图片')

  const details = React.createElement('div', { className: 'bgimg-details' },
    React.createElement('div', { className: 'bgimg-card' },
      React.createElement('div', { className: 'bgimg-label' }, '图片显示区域'),
      React.createElement('div', { className: 'bgimg-modes' },
        MODES.map((m) => React.createElement('button', {
          type: 'button',
          key: m.id,
          className: 'bgimg-mode' + (s.mode === m.id ? ' bgimg-active' : ''),
          onClick: () => onMode(m.id)
        },
          React.createElement('b', null, m.label),
          React.createElement('span', null, m.desc)
        ))
      )
    ),
    React.createElement('div', { className: 'bgimg-card' },
      React.createElement('div', { className: 'bgimg-slider-row' },
        React.createElement('div', { className: 'bgimg-label' }, '图片不透明度'),
        React.createElement('div', { className: 'bgimg-slider-value' }, Math.round(s.opacity * 100) + '%')
      ),
      React.createElement('input', {
        type: 'range',
        className: 'bgimg-slider',
        min: 0,
        max: 100,
        step: 1,
        value: Math.round(s.opacity * 100),
        onChange: onOpacity
      })
    ),
    React.createElement('div', { className: 'bgimg-card' },
      React.createElement('div', { className: 'bgimg-label' }, '选择图片'),
      React.createElement('div', { className: 'bgimg-url-row' },
        React.createElement('input', {
          type: 'text',
          className: 'bgimg-input',
          placeholder: 'https://picsum.photos/1920/1080 或 data:image/... 数据地址',
          value: url,
          onChange: (e) => setUrl(e.target.value),
          onKeyDown: (e) => { if (e.key === 'Enter') applyUrl() }
        }),
        React.createElement('button', { type: 'button', className: 'bgimg-btn bgimg-btn-primary', onClick: applyUrl }, loading ? '加载中…' : '应用')
      ),
      React.createElement('div', { className: 'bgimg-url-row' },
        React.createElement('label', { className: 'bgimg-btn', style: { cursor: 'pointer' } },
          '选择本地图片',
          React.createElement('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: onFile })
        ),
        s.image
          ? React.createElement('button', { type: 'button', className: 'bgimg-btn', onClick: () => update({ image: '' }) }, '移除图片')
          : null
      ),
      error ? React.createElement('div', { className: 'bgimg-error' }, error) : null,
      React.createElement('div', { className: 'bgimg-label', style: { marginTop: 12 } }, '预设背景'),
      React.createElement('div', { className: 'bgimg-presets' },
        PRESETS.map((p) => React.createElement('button', {
          type: 'button',
          key: p.id,
          className: 'bgimg-preset' + (s.image === p.css ? ' bgimg-preset-active' : ''),
          style: { backgroundImage: p.css },
          title: p.label,
          onClick: () => { setError(''); update({ image: p.css }) }
        },
          React.createElement('span', { className: 'bgimg-preset-name' }, p.label)
        ))
      )
    ),
    React.createElement('div', { className: 'bgimg-card' },
      React.createElement('div', { className: 'bgimg-label' }, '预览'),
      React.createElement('div', {
        className: 'bgimg-preview',
        style: previewBg
          ? { background: previewBg + ' rgb(136,136,136)' }
          : { background: 'var(--dsw-alias-bg-layer-2)' }
      },
        React.createElement('span', { className: 'bgimg-note' }, statusText)
      )
    ),
    React.createElement('button', {
      type: 'button',
      className: 'bgimg-btn',
      onClick: () => { setUrl(''); setError(''); update({ enabled: false, mode: 'fullscreen', opacity: 0.9, image: '' }) }
    }, '恢复默认设置'),
    React.createElement('div', { className: 'bgimg-sub' },
      '提示：图片作为应用背景层显示，位于界面内容之后；浮层、Cordis 卡片与控件保持纯色背景以保证可读性。设置仅在本次运行期间保留。')
  )

  return React.createElement('div', { className: 'bgimg-root' },
    React.createElement('div', {
      className: 'bgimg-header',
      onClick: () => setOpen(!open)
    },
      React.createElement('div', null,
        React.createElement('div', { className: 'bgimg-title' }, '启用背景图片'),
        React.createElement('div', { className: 'bgimg-sub' }, statusText)
      ),
      React.createElement('div', { className: 'bgimg-trailing' },
        React.createElement('label', { className: 'bgimg-switch', onClick: (e) => e.stopPropagation() },
          React.createElement('input', { type: 'checkbox', checked: s.enabled, onChange: onToggle }),
          React.createElement('span', { className: 'bgimg-track' },
            React.createElement('span', { className: 'bgimg-thumb' }))
        ),
        React.createElement('span', {
          className: 'bgimg-chevron' + (open ? ' bgimg-chevron-open' : ''),
          title: open ? '收起设置' : '展开设置'
        }, React.createElement(ChevronIcon))
      )
    ),
    open ? details : null
  )
}

function RunCard() {
  const s = useStore()
  const activeMode = MODES.filter((m) => m.id === s.mode)[0] || MODES[0]
  return React.createElement('div', { className: 'bgimg-quick' },
    React.createElement('label', { className: 'bgimg-switch' },
      React.createElement('input', { type: 'checkbox', checked: s.enabled, onChange: (e) => update({ enabled: e.target.checked }) }),
      React.createElement('span', { className: 'bgimg-track' },
        React.createElement('span', { className: 'bgimg-thumb' }))
    ),
    React.createElement('span', { className: 'bgimg-quick-title' }, '界面背景'),
    React.createElement('div', { className: 'bgimg-quick-modes' },
      MODES.map((m) => React.createElement('button', {
        type: 'button',
        key: m.id,
        className: 'bgimg-chip' + (s.mode === m.id ? ' bgimg-chip-active' : ''),
        onClick: () => update({ mode: m.id })
      }, m.label))
    ),
    React.createElement('input', {
      type: 'range',
      className: 'bgimg-slider bgimg-quick-slider',
      min: 0,
      max: 100,
      step: 1,
      value: Math.round(s.opacity * 100),
      onChange: (e) => update({ opacity: Number(e.target.value) / 100 })
    }),
    React.createElement('span', { className: 'bgimg-quick-note' },
      s.enabled && s.image ? Math.round(s.opacity * 100) + '% · ' + activeMode.label : '未显示')
  )
}

const CSS = `.bgimg-root{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;min-width:0;overflow:hidden}
.bgimg-header{box-sizing:border-box;width:100%;min-height:52px;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 14px;cursor:pointer;user-select:none;color:inherit;font:inherit;text-align:left}
.bgimg-header:hover{background:var(--dsw-alias-interactive-bg-hover)}
.bgimg-title{min-width:0;font-size:14px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary)}
.bgimg-trailing{color:var(--dsw-alias-label-tertiary);flex:none;align-items:center;gap:7px;display:inline-flex}
.bgimg-chevron{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;transition:transform .14s var(--ds-ease-in-out)}
.bgimg-chevron-open{transform:rotate(180deg)}
.bgimg-details{border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);padding:10px 14px 12px;display:flex;flex-direction:column;gap:10px}
.bgimg-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px 14px}
.bgimg-label{font-weight:600;font-size:13px;color:var(--dsw-alias-label-primary)}
.bgimg-sub{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:2px}
.bgimg-switch{position:relative;display:inline-block;width:38px;height:22px;flex:none}
.bgimg-switch input{position:absolute;opacity:0;width:0;height:0}
.bgimg-track{position:absolute;inset:0;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);cursor:pointer;transition:background .15s ease}
.bgimg-thumb{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-button-elevated-fill);box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s ease}
.bgimg-switch input:checked + .bgimg-track{background:var(--dsw-alias-brand-primary)}
.bgimg-switch input:checked + .bgimg-track .bgimg-thumb{transform:translateX(16px)}
.bgimg-modes{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
.bgimg-mode{display:flex;flex-direction:column;gap:4px;text-align:left;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:8px 10px;cursor:pointer;font:inherit}
.bgimg-mode:hover{border-color:var(--dsw-alias-border-l3)}
.bgimg-mode.bgimg-active{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover-accent)}
.bgimg-mode b{font-size:13px;color:var(--dsw-alias-label-primary)}
.bgimg-mode span{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:16px}
.bgimg-slider-row{display:flex;align-items:center;justify-content:space-between}
.bgimg-slider-value{font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.bgimg-slider{width:100%;margin:10px 0 2px;accent-color:var(--dsw-alias-brand-primary)}
.bgimg-url-row{display:flex;gap:8px;margin-top:8px}
.bgimg-input{flex:1;min-width:0;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:6px 10px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);outline:none}
.bgimg-input:focus{border-color:var(--dsw-alias-brand-primary)}
.bgimg-btn{display:inline-flex;align-items:center;gap:6px;background:var(--dsw-alias-button-elevated-fill);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:6px 12px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);cursor:pointer;flex:none}
.bgimg-btn:hover{background:var(--dsw-alias-button-floating-hover)}
.bgimg-btn-primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-foreground)}
.bgimg-btn-primary:hover{background:var(--dsw-alias-button-primary-hover)}
.bgimg-error{font-size:12px;color:var(--dsw-alias-state-error-primary);margin-top:8px}
.bgimg-presets{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:8px}
.bgimg-preset{position:relative;height:52px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);cursor:pointer;padding:0;overflow:hidden;background-size:cover;background-position:center}
.bgimg-preset:hover{border-color:var(--dsw-alias-border-l3)}
.bgimg-preset-active{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.bgimg-preset-name{position:absolute;left:6px;bottom:5px;font-size:11px;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.5)}
.bgimg-preview{position:relative;height:130px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background-size:cover;background-position:center;overflow:hidden;margin-top:8px}
.bgimg-note{position:absolute;left:10px;bottom:8px;background:rgba(15,15,15,.55);color:#fff;border-radius:999px;padding:2px 10px;font-size:11px}
.bgimg-quick{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px;padding:6px 2px}
.bgimg-quick-title{font-weight:600;color:var(--dsw-alias-label-primary)}
.bgimg-quick-modes{display:flex;gap:4px}
.bgimg-chip{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-elevated-fill);border-radius:999px;padding:3px 10px;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.bgimg-chip:hover{background:var(--dsw-alias-button-floating-hover)}
.bgimg-chip-active{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-label-primary-foreground)}
.bgimg-quick-slider{width:140px;margin:0}
.bgimg-quick-note{color:var(--dsw-alias-label-secondary);font-size:12px}
.cvtE3a_card,.Nqubda_panel,.Nqubda_header,.Nqubda_row,.cvtE3a_business,.gNWCoW_inspectButton,.o3BgMG_inspectButton,.iWrAna_inspectButton,.Y0dWHa_panelImage,.Y0dWHa_toolCatalogDefinition,._7yHdaG_editor,.nLMEza_objectiveInput{background:var(--dsw-alias-bg-layer-2) !important}
.cvtE3a_business select,.Nqubda_row select,.Nqubda_panel select,.cvtE3a_card select{background:var(--dsw-alias-bg-layer-2) !important}
.wSkVaW_composerSeat{background:linear-gradient(180deg,transparent 0px,var(--dsw-alias-bg-layer-2) 36px) !important}`

return {
  apply(ctx) {
    console.log('背景图片插件 v32 已加载')
    const theme = ctx.get('theme')
    if (theme !== undefined) {
      themeService = theme
      ctx.effect(() => () => {
        if (layerDispose !== null) { layerDispose(); layerDispose = null }
      })
    }
    const timer = ctx.get('timer')
    if (timer !== undefined) {
      timerService = timer
      ctx.effect(() => () => { timerService = null })
    }
    if (typeof styles !== 'undefined' && styles.insert) {
      ctx.effect(() => styles.insert(CSS))
    }
    const slots = ctx.get('slots')
    if (slots !== undefined) {
      slots.inject('settings.plugin.item', () => slots.register(
        { name: 'settings.plugin.item', id: 'bgimg-1', order: 5, label: '背景图片设置' },
        () => React.createElement(SettingsPage)
      ))
      slots.inject('tool.view.cordis', () => slots.register(
        { name: 'tool.view.cordis', key: 'self' },
        () => React.createElement(RunCard)
      ))
    }
  }
}
