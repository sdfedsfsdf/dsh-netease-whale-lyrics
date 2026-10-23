(function () {
  window.__ModuleLoader__.load({
    id: 'dsh-netease-whale-lyrics',
    factory: function () {
      function activeLine(lines, seconds) {
        var result = null
        for (var i = 0; i < lines.length; i++) {
          if (lines[i].time > seconds * 1000) break
          result = lines[i]
        }
        if (!result) return ''
        var text = String(result.text || '').replace(/[\r\n]+/g, ' ').trim()
        return /^(暂无歌词|纯音乐|纯音乐，请欣赏|无歌词)$/i.test(text) ? '' : text
      }
      function lineDetail(lines, seconds, duration) {
        var index = -1
        for (var i = 0; i < lines.length; i++) { if (lines[i].time > seconds * 1000) break; index = i }
        var text = activeLine(lines, seconds)
        if (index < 0 || !text) return null
        var line = lines[index], end = Number(duration) * 1000
        for (var j = index + 1; j < lines.length; j++) {
          if (lines[j].time > line.time) { end = lines[j].time; break }
        }
        if (!(end > line.time)) end = line.time + 6000
        // Kana/Hangul/Latin/Cyrillic etc identify non-Chinese content; Han-only lines remain Chinese.
        var foreign = /\p{L}/u.test(text.replace(/\p{Script=Han}/gu, '')) || Boolean(line.tr && String(line.tr).trim() !== text)
        var translation = foreign ? String(line.tr || '').trim() || '暂无中文翻译' : ''
        var progress = Math.max(0, Math.min(1, (seconds * 1000 - line.time) / (end - line.time)))
        // Hold both edges briefly to make the beginning and ending readable.
        return { text: text, translation: translation, progress: Math.max(0, Math.min(1, (progress - .1) / .8)) }
      }
      function mount(env) {
        var win = env || window, doc = win.document
        var owner = {}, bridge = null, row = null, alive = true, token = '', pending = false
        var epoch = 0, sample = null, lines = [], song = '', lyricSong = '', retryAt = 0
        var nextPoll = 0, expires = 0, requestId = 0, controllers = new Set(), single = null
        var mode = 'off', hint = null, select = null, lastError = ''
        var key = 'dsh-netease-whale-lyrics-mode-v1'
        try { mode = win.localStorage.getItem(key) || 'off' } catch (_) {}
        if (!/^(off|continuous|click)$/.test(mode)) mode = 'off'
        var fontKey = 'dsh-netease-whale-lyrics-font-percent-v1', fontPercent = 100
        try { var savedFont = Number(win.localStorage.getItem(fontKey)); if (savedFont >= 70 && savedFont <= 160) fontPercent = Math.round(savedFont) } catch (_) {}
        var fontStyle = doc.createElement('style')
        function applyFont(value) {
          var number = Number(value)
          fontPercent = Number.isFinite(number) ? Math.max(70, Math.min(160, Math.round(number))) : 100
          var factor = fontPercent / 100
          fontStyle.textContent = '.dshwv-lyric-mode .dshwv-text>.dshwv-label{font-size:clamp(' + (9 * factor) + 'px,calc(var(--dshw-u, .244px) * ' + (58 * factor) + '),' + (34 * factor) + 'px)!important}'
            + '.dshwv-lyric-mode .dshwv-text>.dshwv-hint{font-size:clamp(' + (8 * factor) + 'px,calc(var(--dshw-u, .244px) * ' + (44 * factor) + '),' + (26 * factor) + 'px)!important}'
          try { win.localStorage.setItem(fontKey, String(fontPercent)) } catch (_) {}
        }
        // 设置以主机端为准：DSH 换端口后 localStorage 会清空，靠它把模式/字号找回来。
        var settingsToken = '', fontValueEl = null, fontSliderEl = null, saveTimer = 0
        function persist() {
          try { win.localStorage.setItem(key, mode); win.localStorage.setItem(fontKey, String(fontPercent)) } catch (_) {}
          if (!settingsToken) return
          try {
            win.fetch('/api/netease-whale-lyrics/settings', {
              method: 'POST', credentials: 'same-origin', cache: 'no-store',
              headers: { 'content-type': 'application/json', 'x-whale-lyrics-csrf': settingsToken },
              body: JSON.stringify({ mode: mode, fontPercent: fontPercent }),
            }).catch(function () {})
          } catch (_) {}
        }
        async function loadSettings() {
          try {
            var res = await win.fetch('/api/netease-whale-lyrics/settings', { credentials: 'same-origin', cache: 'no-store' })
            if (!res.ok) return
            var out = await res.json()
            settingsToken = String((out && out.csrfToken) || '')
            var s = (out && out.settings) || {}
            if (!s.saved) { persist(); return } // 首次运行：把浏览器里的设置迁到主机端
            var changed = false
            if (/^(off|continuous|click)$/.test(s.mode) && s.mode !== mode) { mode = s.mode; changed = true }
            var f = Number(s.fontPercent)
            if (f >= 70 && f <= 160 && Math.round(f) !== fontPercent) { fontPercent = Math.round(f); applyFont(fontPercent); changed = true }
            if (!alive || !changed) return
            if (select) select.value = mode
            if (fontSliderEl) fontSliderEl.value = String(fontPercent)
            if (fontValueEl) fontValueEl.textContent = fontPercent + '%'
            clear(); nextPoll = 0
            if (mode !== 'off') poll(true)
            else if (bridge) bridge.hide(owner)
            if (hint) status(mode === 'off' ? '已关闭 · 原有气泡行为不变' : '正在连接网易云…')
          } catch (_) { /* 主机端路由不可用时退回浏览器存储 */ }
        }
        function status(text) { if (hint) hint.textContent = text }
        function clear() {
          sample = null; lines = []; song = ''; lyricSong = ''; expires = 0; retryAt = 0; single = null
          if (bridge) bridge.hide(owner)
        }
        async function json(url, init) {
          var c = new win.AbortController(); controllers.add(c)
          var timeout = win.setTimeout(function () { c.abort() }, 6500)
          try {
            var res = await win.fetch(url, Object.assign({ credentials: 'same-origin', cache: 'no-store', signal: c.signal }, init))
            var out = await res.json()
            if (!res.ok || out.ok === false) {
              if (res.status === 403) token = ''
              throw new Error(out.error || ('HTTP ' + res.status))
            }
            return out
          } finally { win.clearTimeout(timeout); controllers.delete(c) }
        }
        async function call(tool, args) {
          if (!token) {
            var boot = await json('/api/netease-music/bootstrap')
            token = boot.csrfToken
            if (!token) throw new Error('网易云插件未就绪')
          }
          return json('/api/netease-music/action', {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-netease-csrf': token },
            body: JSON.stringify({ tool: tool, args: args || {} }),
          })
        }
        function current() {
          if (!sample || !lyricSong || lyricSong !== song || Date.now() - sample.at > 4500) return ''
          var elapsed = sample.playing ? Math.min(3, Math.max(0, (Date.now() - sample.at) / 1000)) + 0.35 : 0
          return lineDetail(lines, sample.position + elapsed, sample.duration)
        }
        function paint() {
          if (!alive || !bridge || mode === 'off') return
          var detail = current()
          if (mode === 'continuous') {
            if (!sample || !sample.playing || !detail) { bridge.hide(owner); return }
            bridge.show(owner, detail.text, 0, detail)
          } else if (single && expires > Date.now()) {
            var progress = Math.max(0, Math.min(1, (Date.now() - single.at - 400) / 4000))
            bridge.show(owner, single.detail.text, expires - Date.now(), Object.assign({}, single.detail, { progress: progress, updateOnly: true }))
          }
        }
        var flight = null
        function poll(force) {
          if (flight) return flight
          flight = pollWork(force).finally(function () { flight = null })
          return flight
        }
        async function pollWork(force) {
          if (!alive || mode === 'off' || pending || !bridge) return
          if (!force && Date.now() < nextPoll) return
          pending = true
          var generation = epoch
          try {
            var pos = await call('netease_position')
            if (!alive || generation !== epoch) return
            if (!pos.songId || !Number.isFinite(pos.position)) { clear(); status('没有可读取的播放进度'); return }
            var id = String(pos.songId)
            if (song !== id) { clear(); song = id }
            sample = pos; lastError = ''
            if (lyricSong !== id && Date.now() >= retryAt) {
              var result = await call('netease_lyric', { songId: id })
              if (!alive || generation !== epoch || song !== id) return
              lines = Array.isArray(result.lines) ? result.lines.slice().sort(function (a, b) { return a.time - b.time }) : []
              lyricSong = id
            }
            status(!lines.length ? '这首歌暂无歌词' : (mode === 'continuous' ? (pos.playing ? '正在跟随当前歌词' : '已暂停，继续播放后恢复') : '点击鲸鱼，显示一次当前歌词'))
            paint()
          } catch (err) {
            if (!alive || generation !== epoch) return
            lastError = String(err.message || err)
            clear(); retryAt = Date.now() + 5000
            status('暂不可用：' + lastError)
          } finally {
            pending = false
            nextPoll = Date.now() + (lastError ? 5000 : 850)
          }
        }
        function onClick() {
          if (mode === 'off') return false
          var generation = epoch, seq = ++requestId
          // A click forces a new position read; it never starts a repeating output loop in click mode.
          Promise.resolve(poll(true)).then(function () {
            if (!alive || epoch !== generation || seq !== requestId || !bridge) return
            var detail = current() || { text: lastError ? '暂时无法读取歌词' : '当前暂无歌词', translation: '', progress: 0 }
            expires = Date.now() + 5000
            if (mode === 'click') single = { detail: detail, at: Date.now() }
            bridge.show(owner, detail.text, mode === 'click' ? 5000 : 0, Object.assign({}, detail, mode === 'click' ? { progress: 0 } : {}))
          })
          return true
        }
        function setMode(value) {
          epoch++; requestId++; mode = /^(off|continuous|click)$/.test(value) ? value : 'off'
          for (var c of controllers) c.abort()
          clear(); nextPoll = 0
          try { win.localStorage.setItem(key, mode) } catch (_) {}
          persist()
          if (select) select.value = mode
          status(mode === 'off' ? '已关闭 · 原有气泡行为不变' : '正在连接网易云…')
          if (mode !== 'off') poll(true)
        }
        function attach() {
          var found = win.__dshWhaleLyricsBridge
          if (!found || found.version !== 2 || !found.settingsHost || !found.settingsHost.isConnected) return
          if (found === bridge && row && row.isConnected) return
          if (bridge) bridge.unregister(owner)
          if (row) row.remove()
          bridge = found
          if (!bridge.register(owner, onClick)) { bridge = null; return }
          row = doc.createElement('div'); row.className = 'dshwv-lyrics-settings'
          var label = doc.createElement('label'); label.textContent = '歌词模式'
          select = doc.createElement('select'); select.setAttribute('aria-label', '歌词模式')
          ;[['off', '关闭'], ['continuous', '持续输出'], ['click', '点击后单次输出']].forEach(function (pair) {
            var opt = doc.createElement('option'); opt.value = pair[0]; opt.textContent = pair[1]; select.appendChild(opt)
          })
          select.value = mode; select.addEventListener('change', function () { setMode(select.value) })
          label.appendChild(select); row.appendChild(label)
          hint = doc.createElement('small'); row.appendChild(hint)
          var fontLabel = doc.createElement('label'); fontLabel.style.marginTop = '10px'
          var fontTitle = doc.createElement('span'); fontTitle.textContent = '歌词字号'
          var fontValue = doc.createElement('output'); fontValue.textContent = fontPercent + '%'
          fontLabel.appendChild(fontTitle); fontLabel.appendChild(fontValue)
          var fontSlider = doc.createElement('input')
          fontSlider.type = 'range'; fontSlider.min = '70'; fontSlider.max = '160'; fontSlider.step = '5'
          fontSlider.value = String(fontPercent); fontSlider.setAttribute('aria-label', '歌词字号')
          fontSlider.style.cssText = 'width:100%;height:24px;margin-top:4px;accent-color:#536ba9;cursor:pointer'
          fontSliderEl = fontSlider; fontValueEl = fontValue
          fontSlider.addEventListener('input', function () {
            applyFont(fontSlider.value); fontValue.textContent = fontPercent + '%'; paint()
            win.clearTimeout(saveTimer); saveTimer = win.setTimeout(persist, 300)
          })
          row.appendChild(fontLabel); row.appendChild(fontSlider)
          row.addEventListener('pointerdown', function (e) { e.stopPropagation() })
          bridge.settingsHost.appendChild(row)
          status(mode === 'off' ? '已关闭 · 原有气泡行为不变' : '正在连接网易云…')
          if (mode !== 'off') poll(true)
        }
        var style = doc.createElement('style')
        style.textContent = '.dshwv-lyrics-settings{padding:10px 0;margin-top:8px;border-top:1px solid #8098b733;color:#203170;font:12px system-ui}.dshwv-lyrics-settings label{display:flex;align-items:center;justify-content:space-between;gap:12px}.dshwv-lyrics-settings select{background:#fff;color:#203170;border:1px solid #b8c9df;border-radius:7px;padding:5px;max-width:180px}.dshwv-lyrics-settings small{display:block;margin-top:7px;opacity:.75;line-height:1.5}.dshwv-lyric-mode .dshwv-text>.dshwv-label,.dshwv-lyric-mode .dshwv-text>.dshwv-hint{white-space:nowrap!important;overflow:hidden!important;text-overflow:clip!important;width:100%;max-width:100%}.dshwv-lyric-mode .dshwv-text>.dshwv-label{font-size:clamp(9px,calc(var(--dshw-u, .244px) * 58),34px)!important;line-height:1.3!important;letter-spacing:.025em}.dshwv-lyric-mode .dshwv-text>.dshwv-hint{font-size:clamp(8px,calc(var(--dshw-u, .244px) * 44),26px)!important;line-height:1.3!important;min-height:0!important;margin-top:clamp(2px,calc(var(--dshw-u, .244px) * 20),10px)}.dshwv-lyric-run{display:block;width:max-content;min-width:100%;will-change:transform;transition:transform .24s linear}'
        doc.head.appendChild(style)
        applyFont(fontPercent); doc.head.appendChild(fontStyle)
        var timer = win.setInterval(function () {
          attach(); poll(false); paint()
          if (mode === 'click' && expires && Date.now() > expires) { if (bridge) bridge.hide(owner); expires = 0 }
        }, 250)
        attach()
        loadSettings()
        return function () {
          alive = false; epoch++; win.clearInterval(timer); win.clearTimeout(saveTimer)
          for (var c of controllers) c.abort()
          if (bridge) bridge.unregister(owner)
          if (row) row.remove()
          style.remove(); fontStyle.remove()
        }
      }
      return { apply: function (ctx) { ctx.effect(function () { return mount() }, '网易云鲸鱼歌词联动') }, _test: { activeLine: activeLine, lineDetail: lineDetail, mount: mount } }
    },
  })
})()
