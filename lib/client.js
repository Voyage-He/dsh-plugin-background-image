// 客户端 bundle：注册进 DSH 客户端模块系统。
// 由 dsh-client-modules 主机端通过 /plugins/<id>/client.js 提供，
// 浏览器按 __DSH_BOOT__ 启动图加载本脚本后完成注册。
window.__ModuleLoader__.load({
  id: 'dsh-plugin-background-image',
  factory: function (require) {
    var module = { exports: {} }
    var React = require('react')

    const PRESETS = [
      { id: 'aurora', label: '极光', css: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
      { id: 'sky', label: '晴空', css: 'linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%)' },
      { id: 'sakura', label: '樱花', css: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)' },
      { id: 'sunset', label: '落日', css: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)' },
      { id: 'mint', label: '薄荷', css: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)' },
      { id: 'ocean', label: '深海', css: 'linear-gradient(160deg, #0f2027 0%, #203a43 50%, #2c5364 100%)' }
    ]

    const MODES = [
      { id: 'fullscreen', label: '沉浸式全屏', desc: '图片铺满整个窗口背景，侧栏呈现毛玻璃效果，浮层面板保持清晰' },
      { id: 'conversation', label: '仅对话区域', desc: '图片只显示在对话工作区，侧栏与浮层面板保持原样' }
    ]

    const store = {
      enabled: false,
      mode: 'fullscreen',
      opacity: 0.9,
      image: '',
      blur: 0,
      saturation: 1,
      sidebarOpacity: 0.5,
      composerOpacity: 0.72,
      contentOffset: 0,
    }
    // 本地图片失效提示：启用状态下引用的本地文件不可读时记录原因，设置页醒目提示。
    let localImageWarning = ''
    const listeners = new Set()
    let layerDispose = null
    let glassStyleTag = null
    // 覆写 DSH 内部样式的两张样式表：仅在对应状态激活时存在于文档中，
    // 关闭/切换模式时整体移除，保证 DSH 原生样式完整还原。
    let overrideStyleTag = null
    let sidebarStyleTag = null

    const CONFIG_URL = '/plugins/background-image/config'

    // 持久化写盘：滑杆等高频变更经防抖合并，请求严格串行且只在发送时读取最新值，
    // 并只提交本次变更的字段（配合 Host 端浅合并），避免高频全量覆盖与乱序回写旧值。
    const SETTINGS_KEYS = ['enabled', 'mode', 'opacity', 'image', 'blur', 'saturation', 'sidebarOpacity', 'composerOpacity', 'contentOffset']
    const PERSIST_DEBOUNCE_MS = 400
    const persistDirty = new Set()
    let persistTimer = null
    let persistQueue = Promise.resolve()

    function notify() {
      for (const fn of [...listeners]) fn()
    }

    function isLocalPath(v) {
      if (typeof v !== 'string') return false
      const t = v.trim()
      return t.startsWith('/') || /^[A-Za-z]:[\\/]/.test(t) || t.startsWith('\\\\')
    }

    function isImageValue(v) {
      if (typeof v !== 'string') return false
      const t = v.trim()
      if (t === '') return false
      return /^(linear|radial|conic)-gradient\(/i.test(t) || /^data:image\//i.test(t) || /^https?:\/\//i.test(t) || /^blob:/i.test(t) || isLocalPath(t)
    }

    function safeImage(v) {
      return String(v).trim().replace(/["'\\\r\n]/g, '')
    }

    function fileUrl(v) {
      return '/plugins/background-image/file?path=' + encodeURIComponent(String(v).trim())
    }

    function imageLayer(v) {
      const t = String(v).trim()
      if (/^(linear|radial|conic)-gradient\(/i.test(t)) return t
      if (isLocalPath(t)) return 'url("' + fileUrl(t) + '")'
      return 'url("' + safeImage(t) + '")'
    }

    const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif', '.bmp', '.ico']

    function extOf(path) {
      const m = /(\.[^.\\/]+)$/.exec(path)
      return m ? m[1].toLowerCase() : ''
    }

    async function checkLocalImage(path) {
      let resp
      try {
        resp = await fetch(fileUrl(path))
      } catch (err) {
        return { ok: false, reason: '无法请求文件路由：' + (err && err.message ? err.message : String(err)) }
      }
      if (resp.status === 403) return { ok: false, reason: '无权限（路由拒绝该路径）' }
      if (resp.status === 404) return { ok: false, reason: '文件不存在或不可读' }
      if (!resp.ok) return { ok: false, reason: 'HTTP ' + resp.status }
      const type = resp.headers.get('content-type') || ''
      if (type !== '' && type !== 'application/octet-stream' && type.indexOf('image/') !== 0) {
        return { ok: false, reason: '非图片类型 ' + type }
      }
      return { ok: true }
    }

    // 静默探测当前引用的本地图片是否仍可读（HEAD 请求，不传输文件内容）；
    // 失效时记录原因并刷新界面，在设置页顶部与状态行醒目提示。
    async function verifyLocalImage() {
      if (typeof fetch === 'undefined') return
      if (!store.enabled || !isLocalPath(store.image)) {
        if (localImageWarning !== '') { localImageWarning = ''; notify() }
        return
      }
      let next = ''
      try {
        const resp = await fetch(fileUrl(store.image.trim()), { method: 'HEAD' })
        if (resp.status === 403) next = '无权限（路由拒绝该路径）'
        else if (resp.status === 404) next = '文件不存在或不可读'
        else if (!resp.ok) next = 'HTTP ' + resp.status
      } catch (err) {
        next = '无法请求文件路由：' + (err && err.message ? err.message : String(err))
      }
      if (next !== localImageWarning) {
        localImageWarning = next
        notify()
      }
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

    function clamp01(v, fallback) {
      const n = Number(v)
      return Math.max(0, Math.min(1, isFinite(n) ? n : fallback))
    }

    function buildTokens() {
      const tokens = {}
      if (store.enabled && store.image && isImageValue(store.image)) {
        const l = pickValue('light')
        const d = pickValue('dark')
        tokens['--dsw-alias-bg-base'] = { light: l.value, dark: d.value }
        const sideO = clamp01(store.sidebarOpacity, 0.5).toFixed(3)
        const compO = clamp01(store.composerOpacity, 0.72).toFixed(3)
        if (store.mode === 'fullscreen') {
          // 侧边栏仅在“沉浸式全屏”下玻璃化；仅对话区域模式保持原样。
          tokens['--dsw-specific-sidebar-fill'] = {
            light: 'rgba(249,250,251,' + sideO + ')',
            dark: 'rgba(27,27,28,' + sideO + ')',
          }
        }
        // 输入区（含输入框卡片）在两种模式下都叠加在对话区之上，可独立调透明。
        tokens['--dsw-specific-input-major'] = {
          light: 'rgba(255,255,255,' + compO + ')',
          dark: 'rgba(44,44,46,' + compO + ')',
        }
      }
      return tokens
    }

    function syncGlassVars() {
      if (typeof document === 'undefined') return
      const active = store.enabled && store.image && isImageValue(store.image)
      const blur = active ? Math.max(0, Math.min(48, Number(store.blur) || 0)) : 0
      const sat = active ? Math.max(0, Math.min(3, isFinite(Number(store.saturation)) ? Number(store.saturation) : 1)) : 1
      const compO = clamp01(store.composerOpacity, 0.72)
      // 对话区主体水平偏移：仅在启用时生效，关闭回 0（覆写样式表也已移除）。
      const offset = active
        ? Math.max(-320, Math.min(320, Math.round(isFinite(Number(store.contentOffset)) ? Number(store.contentOffset) : 0)))
        : 0
      // 座面渐变端色：激活时随输入区不透明度半透明；关闭时回退不透明表面色
      //（此时座面覆写样式表已被移除，回退值仅作防御性兜底）。
      const seatLight = active ? 'rgba(255,255,255,' + compO.toFixed(3) + ')' : 'rgb(255,255,255)'
      const seatDark = active ? 'rgba(44,44,46,' + compO.toFixed(3) + ')' : 'rgb(21,21,23)'
      // 侧栏毛玻璃只在「已启用 + 沉浸式全屏」下生效；模糊/饱和度承载在侧栏 ::before 伪元素上，
      // 其它情况（未启用 / 仅对话区域）置 none，避免侧栏伪元素残留模糊。
      const sideFilter = (active && store.mode === 'fullscreen')
        ? 'blur(' + blur.toFixed(2) + 'px) saturate(' + sat.toFixed(3) + ')'
        : 'none'
      // 侧栏底部滚动淡出遮罩 .qDHVXG_fade 以 --dsw-specific-sidebar-fill 为渐变终点。
      // 全屏玻璃模式下该 token 已被覆写为半透明白（玻璃 ::before 已覆盖整栏），
      // 遮罩再叠加一层半透明白会让列表底部更白，形成一条“白边”。因此全屏模式把
      // 淡出终点改为 transparent，遮罩不再叠加额外白层；其它模式保持原样。
      const fadeFill = (active && store.mode === 'fullscreen')
        ? 'transparent'
        : 'var(--dsw-specific-sidebar-fill)'
      const css = ':root{'
        + '--bgimg-blur:' + blur.toFixed(2) + 'px;'
        + '--bgimg-saturation:' + sat.toFixed(3) + ';'
        + '--bgimg-sidebar-filter:' + sideFilter + ';'
        + '--bgimg-fade-fill:' + fadeFill + ';'
        + '--bgimg-content-offset:' + offset.toFixed(0) + 'px;'
        + '--bgimg-seat-light:' + seatLight + ';'
        + '--bgimg-seat-dark:' + seatDark + ';'
        + '}'
      if (glassStyleTag === null) {
        glassStyleTag = document.createElement('style')
        glassStyleTag.dataset.plugin = 'dsh-plugin-background-image'
        glassStyleTag.dataset.pluginCss = 'dsh-plugin-background-image/glass.css'
        document.head.appendChild(glassStyleTag)
      }
      glassStyleTag.textContent = css
      // 覆写样式表按需挂载/卸载：关闭时移除全部内部类名覆写，「仅对话区域」时
      // 再移除侧栏覆写，两种情况下 DSH 原生样式均完整还原（不再用变量近似模拟）。
      overrideStyleTag = syncStyleTag(overrideStyleTag, active ? OVERRIDE_CSS : '', 'override.css')
      sidebarStyleTag = syncStyleTag(sidebarStyleTag, active && store.mode === 'fullscreen' ? SIDEBAR_CSS : '', 'sidebar.css')
    }

    function applyTheme(themeService) {
      if (themeService === null) return
      try {
        const dispose = themeService.overrideTokens('dsh-plugin-background-image', buildTokens())
        if (layerDispose !== null) layerDispose()
        layerDispose = dispose
      } catch (err) {
        console.error('background-image: 应用主题失败', err)
      }
      syncGlassVars()
      notify()
    }

    // 冲刷脏字段：入串行队列（保证写入顺序，杜绝旧值后到覆盖新值），
    // 请求体在发送前才从 store 取值，因此总是携带最新状态。
    function flushPersist() {
      if (persistDirty.size === 0) return persistQueue
      const keys = [...persistDirty]
      persistDirty.clear()
      const body = {}
      for (const key of keys) body[key] = store[key]
      persistQueue = persistQueue.then(() => fetch(CONFIG_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then((resp) => {
        if (!resp.ok) console.error('background-image: 保存配置失败 HTTP ' + resp.status)
      }).catch((err) => {
        // 写入失败时保留脏标记，待下次写入自动重试，变更不会被静默丢弃。
        for (const key of keys) persistDirty.add(key)
        console.error('background-image: 保存配置失败', err)
      }))
      return persistQueue
    }

    // 高频变更（滑杆拖动等）防抖落盘：静默期结束后只写一次。
    function schedulePersist() {
      if (persistTimer !== null) clearTimeout(persistTimer)
      persistTimer = setTimeout(() => {
        persistTimer = null
        flushPersist()
      }, PERSIST_DEBOUNCE_MS)
    }

    // 立即落盘（跳过防抖）：keys 为本次待写字段；返回的 Promise 在写入完成后 resolve。
    function persist(keys) {
      if (persistTimer !== null) { clearTimeout(persistTimer); persistTimer = null }
      if (keys) { for (const key of keys) persistDirty.add(key) }
      return flushPersist()
    }

    // 应用变更到界面（即时生效）并防抖持久化：keys 为本次修改的字段名。
    function update(themeService, keys) {
      if (keys) { for (const key of keys) persistDirty.add(key) }
      applyTheme(themeService)
      schedulePersist()
    }

    function applyStored(section) {
      if (section === null || typeof section !== 'object') return
      if (typeof section.enabled === 'boolean') store.enabled = section.enabled
      if (section.mode === 'fullscreen' || section.mode === 'conversation') store.mode = section.mode
      if (typeof section.opacity === 'number' && isFinite(section.opacity)) store.opacity = section.opacity
      if (typeof section.image === 'string') store.image = section.image
      if (typeof section.blur === 'number' && isFinite(section.blur)) store.blur = section.blur
      if (typeof section.saturation === 'number' && isFinite(section.saturation)) store.saturation = section.saturation
      if (typeof section.sidebarOpacity === 'number' && isFinite(section.sidebarOpacity)) store.sidebarOpacity = section.sidebarOpacity
      if (typeof section.composerOpacity === 'number' && isFinite(section.composerOpacity)) store.composerOpacity = section.composerOpacity
      if (typeof section.contentOffset === 'number' && isFinite(section.contentOffset)) store.contentOffset = section.contentOffset
    }

    async function loadConfig(themeService) {
      try {
        const resp = await fetch(CONFIG_URL)
        if (!resp.ok) return
        const data = await resp.json()
        applyStored(data)
        applyTheme(themeService)
        verifyLocalImage()
      } catch (err) {
        console.error('background-image: 读取配置失败', err)
      }
    }

    function preloadImage(url, timerService, ok, fail) {
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
      const themeService = props.themeService
      const timerService = props.timerService
      const s = useStore()
      const [url, setUrl] = React.useState('')
      const [pathValue, setPathValue] = React.useState('')
      const [error, setError] = React.useState('')
      const [loading, setLoading] = React.useState(false)
      const [picking, setPicking] = React.useState(false)
      const [open, setOpen] = React.useState(false)

      // 每次打开设置页时静默探测一次本地图片是否仍可读（HEAD，不传输内容）。
      React.useEffect(() => { verifyLocalImage() }, [])

      const onToggle = (e) => { store.enabled = e.target.checked; update(themeService, ['enabled']); verifyLocalImage() }
      const onMode = (id) => { store.mode = id; update(themeService, ['mode']) }
      const onOpacity = (e) => { store.opacity = Number(e.target.value) / 100; update(themeService, ['opacity']) }
      const onBlur = (e) => { store.blur = Number(e.target.value); update(themeService, ['blur']) }
      const onSaturation = (e) => { store.saturation = Number(e.target.value) / 100; update(themeService, ['saturation']) }
      const onSidebarOpacity = (e) => { store.sidebarOpacity = Number(e.target.value) / 100; update(themeService, ['sidebarOpacity']) }
      const onComposerOpacity = (e) => { store.composerOpacity = Number(e.target.value) / 100; update(themeService, ['composerOpacity']) }
      const onContentOffset = (e) => { store.contentOffset = Number(e.target.value); update(themeService, ['contentOffset']) }
      const onContentOffsetReset = () => { store.contentOffset = 0; update(themeService, ['contentOffset']) }

      const applyUrl = () => {
        const v = url.trim()
        if (v === '') { setError('请输入图片地址'); return }
        if (!/^https?:\/\//i.test(v) && !/^data:image\//i.test(v)) {
          setError('仅支持 http(s):// 图片地址或 data:image/ 数据地址')
          return
        }
        setError('')
        setLoading(true)
        preloadImage(v, timerService, () => {
          setLoading(false)
          store.image = v
          update(themeService, ['image'])
          verifyLocalImage()
        }, () => {
          setLoading(false)
          setError('图片加载失败：地址无效、被网络拦截，或格式不受浏览器支持')
        })
      }

      const applyPath = async (raw) => {
        const p = (raw === undefined ? pathValue : raw).trim()
        if (p === '') { setError('请输入图片的绝对路径'); return }
        if (!isLocalPath(p)) { setError('请输入绝对路径，例如 /Users/you/Pictures/background.png'); return }
        const ext = extOf(p)
        if (ext !== '' && IMAGE_EXTS.indexOf(ext) === -1) {
          setError('不支持的图片格式 ' + ext + '（支持 PNG/JPG/WebP/GIF/SVG/AVIF/BMP/ICO）')
          return
        }
        setError('')
        setLoading(true)
        const prev = store.image
        try {
          // 先落盘，让主机端“引用即授权”的文件路由对该路径生效，再校验可读性。
          console.log('background-image: 应用本地路径', p)
          store.image = p
          await persist(['image'])
          const check = await checkLocalImage(p)
          if (check.ok) {
            setLoading(false)
            localImageWarning = ''
            applyTheme(themeService)
          } else {
            setLoading(false)
            store.image = prev
            persist(['image'])
            localImageWarning = ''
            applyTheme(themeService)
            setError('本地图片加载失败：' + check.reason + '（路径：' + p + '）')
          }
        } catch (err) {
          setLoading(false)
          store.image = prev
          setError('保存设置失败：' + (err && err.message ? err.message : String(err)))
        }
      }

      const pickLocal = async () => {
        if (typeof fetch === 'undefined') { setError('当前环境不支持本地文件选择，请手动填写绝对路径'); return }
        setError('')
        setPicking(true)
        try {
          const resp = await fetch('/plugins/background-image/pick')
          if (!resp.ok) throw new Error('HTTP ' + resp.status)
          const data = await resp.json()
          if (data && typeof data.path === 'string' && data.path !== '') {
            setPathValue(data.path)
            await applyPath(data.path)
          } else if (data && data.error) {
            setError('打开文件选择器失败：' + data.error)
          }
        } catch (err) {
          setError('打开文件选择器失败：' + (err && err.message ? err.message : String(err)))
        } finally {
          setPicking(false)
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
      const blurPx = Math.round(Number(s.blur) || 0)
      const satPct = Math.round((isFinite(Number(s.saturation)) ? Number(s.saturation) : 1) * 100)
      const sidePct = Math.round(clamp01(s.sidebarOpacity, 0.5) * 100)
      const compPct = Math.round(clamp01(s.composerOpacity, 0.72) * 100)
      const offsetPx = Math.round(isFinite(Number(s.contentOffset)) ? Number(s.contentOffset) : 0)
      const statusText = s.enabled && s.image
        ? (localImageWarning !== ''
            ? '已启用 · 本地图片已失效，请重新选择'
            : '已启用 · ' + activeMode.label + ' · ' + Math.round(s.opacity * 100) + '%' + (blurPx > 0 ? ' · 模糊 ' + blurPx + 'px' : ''))
        : (s.image ? '已关闭' : '未选择图片')

      const details = React.createElement('div', { className: 'bgimg-details' },
        localImageWarning !== ''
          ? React.createElement('div', { className: 'bgimg-warn' },
              '本地图片已失效：' + localImageWarning + '。文件可能被移动、重命名或删除，请重新选择图片（原路径：' + s.image + '）。')
          : null,
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
          React.createElement('div', { className: 'bgimg-label' }, '毛玻璃'),
          React.createElement('div', { className: 'bgimg-slider-row' },
            React.createElement('div', { className: 'bgimg-sub' }, '背景模糊强度'),
            React.createElement('div', { className: 'bgimg-slider-value' }, blurPx + 'px')
          ),
          React.createElement('input', {
            type: 'range',
            className: 'bgimg-slider',
            min: 0,
            max: 48,
            step: 1,
            value: blurPx,
            onChange: onBlur
          }),
          React.createElement('div', { className: 'bgimg-slider-row' },
            React.createElement('div', { className: 'bgimg-sub' }, '玻璃颜色饱和度'),
            React.createElement('div', { className: 'bgimg-slider-value' }, satPct + '%')
          ),
          React.createElement('input', {
            type: 'range',
            className: 'bgimg-slider',
            min: 0,
            max: 300,
            step: 5,
            value: satPct,
            onChange: onSaturation
          }),
          React.createElement('div', { className: 'bgimg-sub' },
            '模糊与饱和度作用于输入卡片等玻璃浮层；侧边栏在「沉浸式全屏」下同样呈现毛玻璃，模糊承载在侧栏 ::before 伪元素上，不会改变 fixed 弹层的包含块。')
        ),
        React.createElement('div', { className: 'bgimg-card' },
          React.createElement('div', { className: 'bgimg-label' }, '区域不透明度'),
          React.createElement('div', { className: 'bgimg-slider-row' },
            React.createElement('div', { className: 'bgimg-sub' }, '侧边栏'),
            React.createElement('div', { className: 'bgimg-slider-value' }, sidePct + '%')
          ),
          React.createElement('input', {
            type: 'range',
            className: 'bgimg-slider',
            min: 0,
            max: 100,
            step: 1,
            value: sidePct,
            onChange: onSidebarOpacity
          }),
          React.createElement('div', { className: 'bgimg-slider-row' },
            React.createElement('div', { className: 'bgimg-sub' }, '输入区'),
            React.createElement('div', { className: 'bgimg-slider-value' }, compPct + '%')
          ),
          React.createElement('input', {
            type: 'range',
            className: 'bgimg-slider',
            min: 0,
            max: 100,
            step: 1,
            value: compPct,
            onChange: onComposerOpacity
          }),
          React.createElement('div', { className: 'bgimg-sub' },
            '数值越低越透明、越沉浸；侧边栏与输入区均支持毛玻璃，其中侧边栏仅在「沉浸式全屏」下生效，输入区两种模式均生效。')
        ),
        React.createElement('div', { className: 'bgimg-card' },
          React.createElement('div', { className: 'bgimg-slider-row' },
            React.createElement('div', { className: 'bgimg-label' }, '对话区偏移'),
            React.createElement('div', { className: 'bgimg-trailing' },
              React.createElement('span', { className: 'bgimg-slider-value' },
                (offsetPx > 0 ? '+' : '') + offsetPx + 'px'),
              React.createElement('button', {
                type: 'button',
                className: 'bgimg-btn',
                disabled: offsetPx === 0,
                onClick: onContentOffsetReset
              }, '复位')
            )
          ),
          React.createElement('input', {
            type: 'range',
            className: 'bgimg-slider',
            min: -320,
            max: 320,
            step: 1,
            value: offsetPx,
            onChange: onContentOffset
          }),
          React.createElement('div', { className: 'bgimg-sub' },
            '正值向右、负值向左平移对话主体（列宽不变），为背景图让出展示空间；仅在启用背景时生效。')
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
            React.createElement('input', {
              type: 'text',
              className: 'bgimg-input',
              placeholder: '本地绝对路径，例如 /Users/you/Pictures/background.png',
              value: pathValue,
              onChange: (e) => setPathValue(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') applyPath() }
            }),
            React.createElement('button', { type: 'button', className: 'bgimg-btn bgimg-btn-primary', onClick: pickLocal }, picking ? '选择中…' : '选择本地图片')
          ),
          s.image
            ? React.createElement('div', { className: 'bgimg-url-row' },
              React.createElement('button', { type: 'button', className: 'bgimg-btn', onClick: () => { store.image = ''; update(themeService, ['image']); verifyLocalImage() } }, '移除图片')
            )
            : null,
          error ? React.createElement('div', { className: 'bgimg-error' }, error) : null,
          React.createElement('div', { className: 'bgimg-label', style: { marginTop: 12 } }, '预设背景'),
          React.createElement('div', { className: 'bgimg-presets' },
            PRESETS.map((p) => React.createElement('button', {
              type: 'button',
              key: p.id,
              className: 'bgimg-preset' + (s.image === p.css ? ' bgimg-preset-active' : ''),
              style: { backgroundImage: p.css },
              title: p.label,
              onClick: () => { setError(''); store.image = p.css; update(themeService, ['image']); verifyLocalImage() }
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
          onClick: () => { setUrl(''); setError(''); store.enabled = false; store.mode = 'fullscreen'; store.opacity = 0.9; store.image = ''; store.blur = 0; store.saturation = 1; store.sidebarOpacity = 0.5; store.composerOpacity = 0.72; store.contentOffset = 0; update(themeService, SETTINGS_KEYS) }
        }, '恢复默认设置'),
        React.createElement('div', { className: 'bgimg-sub' },
          '提示：设置会持久化到 settings.yaml 并在刷新/重启后恢复。本地图片请点「选择本地图片」弹出系统文件框（浏览器拿不到磁盘绝对路径，由本插件经同源文件路由读取）。')
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

    // 插件自身设置面板的样式：与启停状态无关，始终注入。
    const BASE_CSS = `.bgimg-root{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;min-width:0;overflow:hidden}
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
.bgimg-input{flex:1;min-width:0;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:6px 10px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);outline:none}
.bgimg-input:focus{border-color:var(--dsw-alias-brand-primary)}
.bgimg-btn{display:inline-flex;align-items:center;gap:6px;background:var(--dsw-alias-button-elevated-fill);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:6px 12px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);cursor:pointer;flex:none}
.bgimg-btn:hover{background:var(--dsw-alias-button-floating-hover)}
.bgimg-btn-primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-foreground)}
.bgimg-btn-primary:hover{background:var(--dsw-alias-button-primary-hover)}
.bgimg-error{font-size:12px;color:var(--dsw-alias-state-error-primary);margin-top:8px}
.bgimg-warn{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px}
.bgimg-presets{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:8px}
.bgimg-preset{position:relative;height:52px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);cursor:pointer;padding:0;overflow:hidden;background-size:cover;background-position:center}
.bgimg-preset:hover{border-color:var(--dsw-alias-border-l3)}
.bgimg-preset-active{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.bgimg-preset-name{position:absolute;left:6px;bottom:5px;font-size:11px;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.5)}
.bgimg-preview{position:relative;height:130px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background-size:cover;background-position:center;overflow:hidden;margin-top:8px}
.bgimg-note{position:absolute;left:10px;bottom:8px;background:rgba(15,15,15,.55);color:#fff;border-radius:999px;padding:2px 10px;font-size:11px}`

    // 覆写 DSH 内部样式的规则（面板回填、输入卡片玻璃、对话区透明、输入座面渐变）。
    // 仅在「启用且图片有效」时挂载（见 syncGlassVars），关闭时整表移除，DSH 原生样式完整还原。
    const OVERRIDE_CSS = `.cvtE3a_card,.Nqubda_panel,.Nqubda_header,.Nqubda_row,.cvtE3a_business,.gNWCoW_inspectButton,.o3BgMG_inspectButton,.iWrAna_inspectButton,.CY-8Ka_inspectButton,.Y0dWHa_panelImage,.Y0dWHa_toolCatalogDefinition,._7yHdaG_editor,.nLMEza_objectiveInput{background:var(--dsw-alias-bg-layer-2) !important}
.cvtE3a_business select,.Nqubda_row select,.Nqubda_panel select,.cvtE3a_card select{background:var(--dsw-alias-bg-layer-2) !important}
.uV2eYG_card{-webkit-backdrop-filter:blur(var(--bgimg-blur,0px)) saturate(var(--bgimg-saturation,1));backdrop-filter:blur(var(--bgimg-blur,0px)) saturate(var(--bgimg-saturation,1))}
/* 连续性：图片只在 frame 绘制一次，对话区与详情列透明透出同一张图，消除侧栏/会话区/详情列的“多副本”断裂 */
.wSkVaW_root{background:transparent !important}
.ydkMvW_root{background:transparent !important}
/* 对话区偏移：左右 margin 对称互换（和恒为 0），在不改变主体列宽的前提下整体平移，
   为背景图让出展示空间。不用 transform：transform 会为 fixed/absolute 后代建立包含块，可能困住弹层。 */
.wSkVaW_root{margin-left:var(--bgimg-content-offset,0px) !important;margin-right:calc(0px - var(--bgimg-content-offset,0px)) !important}
.wSkVaW_composerSeat{background:linear-gradient(180deg,transparent 0px,var(--bgimg-seat-light,rgb(255,255,255)) 36px) !important}
body[data-ds-dark-theme] .wSkVaW_composerSeat{background:linear-gradient(180deg,transparent 0px,var(--bgimg-seat-dark,rgb(21,21,23)) 36px) !important}`

    // 侧栏玻璃（伪元素方案）：仅在「沉浸式全屏」下挂载；关闭或「仅对话区域」时整表移除，
    // 侧栏完全回到 DSH 原生样式。
    const SIDEBAR_CSS = `/* 毛玻璃：侧栏玻璃效果承载在 .pI_x6G_sidebarCol::before 伪元素上 —— 伪元素为 absolute 覆盖层，
   承担半透明填充（--dsw-specific-sidebar-fill）与 backdrop-filter。backdrop-filter 落在伪元素
   （无 fixed 后代）而不是侧栏祖先本身，因此设置弹层（.VOzbGW_overlay 为 position:fixed;z-index:1000，
   渲染在侧栏内）不会因为侧栏成为 fixed 后代的包含块而被锁进侧栏。
   侧栏内容（.hHd-Xa_root）仅声明 position:relative 建立定位上下文；由于 ::before 在树序中先于其后的
   兄弟内容，.hHd-Xa_root 作为树序更晚的后代会绘制在伪元素上方，无需任何 z-index。
   注意：不要给这些祖先引入非 auto 的 z-index、isolation、transform/filter/contain 等会建立
   stacking context 的属性，否则 fixed 设置弹层会被困在侧栏的 stacking context 内。 */
.pI_x6G_sidebarCol{position:relative;background:transparent !important}
.pI_x6G_sidebarCol::before{content:'';position:absolute;inset:0;pointer-events:none;background:var(--dsw-specific-sidebar-fill);-webkit-backdrop-filter:var(--bgimg-sidebar-filter,none);backdrop-filter:var(--bgimg-sidebar-filter,none)}
.hHd-Xa_root{position:relative;background:transparent !important}
/* 列表底部淡出遮罩：全屏玻璃模式下终点改为 transparent（经 --bgimg-fade-fill 控制），
   避免在玻璃 ::before 之上再叠一层半透明白，消除 .qDHVXG_list 底部的白边。 */
.qDHVXG_fade{background:linear-gradient(to bottom, transparent, var(--bgimg-fade-fill, var(--dsw-specific-sidebar-fill))) !important}`

    function insertStyle(css) {
      if (typeof document === 'undefined') return function () {}
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-plugin-background-image'
      tag.dataset.pluginCss = 'dsh-plugin-background-image/client.css'
      tag.textContent = css
      document.head.appendChild(tag)
      return function () { tag.remove() }
    }

    // 按需挂载/卸载一张插件样式表：css 为空时移除标签（原生样式还原），否则写入内容。
    function syncStyleTag(tag, css, name) {
      if (css === '') {
        if (tag !== null) tag.remove()
        return null
      }
      if (tag === null) {
        tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-plugin-background-image'
        tag.dataset.pluginCss = 'dsh-plugin-background-image/' + name
        document.head.appendChild(tag)
      }
      tag.textContent = css
      return tag
    }

    module.exports = {
      name: 'dsh-plugin-background-image',
      inject: ['theme', 'slots', 'timer'],
      apply(ctx) {
        console.log('背景图片插件（正式包）已加载')

        ctx.effect(() => () => {
          if (layerDispose !== null) { layerDispose(); layerDispose = null }
          if (glassStyleTag !== null) { glassStyleTag.remove(); glassStyleTag = null }
          if (overrideStyleTag !== null) { overrideStyleTag.remove(); overrideStyleTag = null }
          if (sidebarStyleTag !== null) { sidebarStyleTag.remove(); sidebarStyleTag = null }
          if (persistTimer !== null) { clearTimeout(persistTimer); persistTimer = null }
        })
        ctx.effect(() => insertStyle(BASE_CSS))

        // 通过本插件自己的 Host 路由读取持久化配置（不走 settingsScope，其受核心 API 白名单限制）。
        loadConfig(ctx.theme)

        ctx.slots.inject('settings.plugin.item', () => ctx.slots.register(
          { name: 'settings.plugin.item', id: 'dsh-plugin-background-image', order: 5, label: '背景图片设置' },
          () => React.createElement(SettingsPage, { themeService: ctx.theme, timerService: ctx.timer })
        ))
      }
    }

    return module.exports
  }
})
