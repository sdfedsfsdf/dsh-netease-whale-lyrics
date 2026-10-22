// Minimal opt-in bridge inside whale's existing closure. No behavior changes without a client registration.
export const bridge = `
// BEGIN DSH NETEASE LYRICS BRIDGE v2
var lyricBridgeOwner = null
var lyricBridgeClick = null
function lyricBridgeBlocked() {
  return !bubbleOn || !!costBubbleActive || !!whaleSysItem ||
    !!(bubbleScene && /^(cost|alert|wait)$/.test(bubbleScene.kind))
}
function lyricBridgeIntercept() {
  if (!lyricBridgeOwner || !lyricBridgeClick || lyricBridgeBlocked()) return false
  try { return lyricBridgeClick() === true } catch (err) { return false }
}
window.__dshWhaleLyricsBridge = {
  version: 2,
  settingsHost: menuRootView,
  register: function (owner, onClick) {
    if (lyricBridgeOwner && lyricBridgeOwner !== owner) return false
    lyricBridgeOwner = owner; lyricBridgeClick = onClick; return true
  },
  show: function (owner, text, ttl, detail) {
    if (owner !== lyricBridgeOwner || lyricBridgeBlocked()) return false
    if (detail && detail.updateOnly && !(bubbleScene && bubbleScene.kind === 'lyrics' && bubbleShown)) return false
    text = String(text || '').replace(/[\\r\\n]+/g, ' ').trim().slice(0, 500)
    if (!text) return false
    var paint = function () {
      // Only replace our own two inner text spans when the sentence changes.
      var translation = detail && detail.translation || ''
      var signature = text + '\\n' + translation
      if (amountEl.__lyricSignature !== signature || !amountEl.firstChild || amountEl.firstChild.nodeType !== 1) {
        applyBubbleLines([null, { t: text, s: 'A', w: false }, translation ? { t: translation, s: 'C', w: false } : null])
        amountEl.__lyricSignature = signature
      }
      var move = function (el, value, progress) {
        if (!value) return
        var span = el.firstChild
        if (!span || span.nodeType !== 1 || span.className !== 'dshwv-lyric-run' || span.textContent !== value) {
          el.textContent = ''
          span = document.createElement('span'); span.className = 'dshwv-lyric-run'
          span.textContent = value; el.appendChild(span)
        }
        el.title = value
        var distance = Math.max(0, span.scrollWidth - el.clientWidth)
        span.style.transform = 'translateX(' + (-distance * Math.max(0, Math.min(1, progress || 0))) + 'px)'
      }
      move(amountEl, text, detail && detail.progress)
      move(hintEl, translation, detail && detail.progress)
    }
    root.classList.add('dshwv-lyric-mode')
    if (bubbleScene && bubbleScene.kind === 'lyrics' && bubbleShown) {
      paint()
      bubbleScene.ttlMs = ttl || 0
      bubbleResetTtl()
    } else {
      applyDefaultFrame()
      bubbleRoundOn = false
      sceneOpen('lyrics', paint, ttl || 0)
    }
    return true
  },
  hide: function (owner) {
    if (owner !== lyricBridgeOwner) return
    root.classList.remove('dshwv-lyric-mode')
    if (bubbleScene && bubbleScene.kind === 'lyrics') hideBubble()
  },
  unregister: function (owner) {
    if (owner !== lyricBridgeOwner) return
    this.hide(owner); lyricBridgeOwner = null; lyricBridgeClick = null
  }
}
// END DSH NETEASE LYRICS BRIDGE v2
`
export const replacements = [
  ['function sceneOpen(kind, renderFn, ttlMs) {', "function sceneOpen(kind, renderFn, ttlMs) {\n  root.classList.toggle('dshwv-lyric-mode', kind === 'lyrics') // DSH-LYRICS-HOOK"],
  ['function hideBubble() {', "function hideBubble() {\n  root.classList.remove('dshwv-lyric-mode') // DSH-LYRICS-HOOK"],
  ['function whaleClick() {', 'function whaleClick() {\n  if (lyricBridgeIntercept()) return // DSH-LYRICS-HOOK'],
  ['function bubbleNext() {', "function bubbleNext() {\n  if (bubbleScene && bubbleScene.kind === 'lyrics') { hideBubble(); return } // DSH-LYRICS-HOOK"],
  ['function render() {', "function render() {\n  if (bubbleScene && bubbleScene.kind === 'lyrics') return // DSH-LYRICS-HOOK"],
  ['function showBubble() {', "function showBubble() {\n  if (bubbleScene && bubbleScene.kind === 'lyrics') return // DSH-LYRICS-HOOK"],
]
export function patch(source) {
  if (source.includes('// BEGIN DSH NETEASE LYRICS BRIDGE v2')) return source
  source = unpatch(source)
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) throw new Error('鲸鱼版本不兼容：' + before)
    source = source.replace(before, after)
  }
  const anchor = 'setInterval(function () { pollLastTurn(); pollWaitState() }, 1000)'
  if (source.split(anchor).length !== 2) throw new Error('鲸鱼初始化锚点不匹配，未修改文件')
  return source.replace(anchor, bridge + '\n' + anchor)
}
export function unpatch(source) {
  const found = /\/\/ BEGIN DSH NETEASE LYRICS BRIDGE v([12])/.exec(source)
  const start = found ? found.index : -1
  const endMark = '// END DSH NETEASE LYRICS BRIDGE v' + (found ? found[1] : '2')
  if (start >= 0) {
    const end = source.indexOf(endMark, start)
    if (end < 0) throw new Error('兼容桥标记不完整，拒绝移除')
    source = source.slice(0, start - 1) + source.slice(end + endMark.length + 2)
  }
  for (const [before, after] of replacements) source = source.replace(after, before)
  return source
}
