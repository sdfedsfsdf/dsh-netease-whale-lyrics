import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { patch, unpatch, bridge } from './scripts/bridge.mjs'
const whalePath = process.argv[2]
if (whalePath) {
  const original = fs.readFileSync(whalePath, 'utf8')
  const patched = patch(original)
  new vm.Script(patched)
  assert.equal(patch(patched), patched)
  assert.equal(unpatch(patched).trim(), unpatch(original).trim())
}
function element(width = 100) {
  return { clientWidth: width, firstChild: null, style: {}, appendChild(x) { this.firstChild = x }, textContent: '' }
}
const classes = new Set()
let text = '', closed = 0
const b = {
  window: {}, menuRootView: {}, bubbleOn: true, costBubbleActive: false, whaleSysItem: null,
  bubbleScene: null, bubbleShown: false, bubbleRoundOn: false,
  root: { classList: { add(x) { classes.add(x) }, remove(x) { classes.delete(x) } } }, amountEl: element(), hintEl: element(), document: { createElement() { return { nodeType: 1, className: '', textContent: '', scrollWidth: 300, style: {} } } },
  applyBubbleLines(x) { text = x[1].t }, singleCenter(s, t) { return t }, applyDefaultFrame() {}, bubbleResetTtl() {},
  sceneOpen(kind, fn) { b.bubbleScene = { kind }; b.bubbleShown = true; fn() },
  hideBubble() { b.bubbleScene = null; b.bubbleShown = false; closed++ },
}
vm.runInNewContext(bridge, b)
const api = b.window.__dshWhaleLyricsBridge, owner = {}
assert.equal(api.register(owner, () => true), true)
assert.equal(api.show(owner, '第一行\n歌词', 0), true); assert.equal(text, '第一行 歌词')
api.show(owner, 'Long lyric', 0, { translation: '很长的翻译', progress: .5 })
assert.equal(b.amountEl.firstChild.style.transform, 'translateX(-100px)')
assert.equal(b.hintEl.firstChild.style.transform, 'translateX(-100px)')
b.amountEl.clientWidth = 400
api.show(owner, 'Long lyric', 0, { translation: '很长的翻译', progress: 1 })
assert.equal(b.amountEl.firstChild.style.transform, 'translateX(0px)', '短句不滚动')
assert.equal(vm.runInNewContext('lyricBridgeIntercept()', b), true)
b.bubbleScene = { kind: 'wait' }
assert.equal(api.show(owner, '不应覆盖'), false)
assert.equal(vm.runInNewContext('lyricBridgeIntercept()', b), false)
api.unregister(owner); assert.equal(closed, 0, '不能关闭系统提示')
b.bubbleScene = null; api.register(owner, () => true); api.show(owner, '歌词', 0); api.unregister(owner)
assert.equal(closed, 1); assert.equal(classes.size, 0)

let bundle
vm.runInNewContext(fs.readFileSync(new URL('./client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load(x) { bundle = x } } } })
const client = bundle.factory()
const { activeLine, lineDetail, mount } = client._test
const bilingual = [{ time: 0, text: 'Hello world', tr: '你好，世界' }, { time: 10000, text: '下一句' }]
assert.equal(lineDetail(bilingual, 5, 20).translation, '你好，世界')
assert.equal(lineDetail(bilingual, 5, 20).progress, .5)
assert.equal(lineDetail(bilingual, 0, 20).progress, 0)
assert.equal(lineDetail(bilingual, 9.9, 20).progress, 1)
assert.equal(lineDetail(bilingual, 12, 20).translation, '')
assert.equal(lineDetail([{ time: 0, text: 'こんにちは世界' }], 2, 10).translation, '暂无中文翻译')
assert.equal(activeLine([{ time: 1000, text: 'A' }, { time: 2000, text: 'B' }], .5), '')
assert.equal(activeLine([{ time: 1000, text: 'A' }, { time: 2000, text: 'B' }], 2), 'B')
assert.equal(activeLine([{ time: 0, text: '暂无歌词' }], 1), '')
class El {
  constructor() { this.children = []; this.isConnected = true; this.handlers = {}; this.style = {}; this.attrs = {} }
  appendChild(x) { this.children.push(x); return x }
  setAttribute(k, v) { this.attrs[k] = v }
  addEventListener(k, f) { this.handlers[k] = f }
  remove() { this.isConnected = false }
}
const head = new El(), host = new El(), shown = []
let click, interval, mode = 'off', requests = 0, position = 1, playing = true
const saved = new Map()
let settingsStore = { saved: false }
const posts = []
const env = {
  document: { head, createElement() { return new El() } },
  localStorage: { getItem(k) { return k.includes('font-percent') ? saved.get(k) : mode }, setItem(k, v) { if (k.includes('font-percent')) saved.set(k,v); else mode = v } },
  AbortController, setTimeout, clearTimeout, setInterval(fn) { interval = fn; return 1 }, clearInterval() {},
  __dshWhaleLyricsBridge: { version: 2, settingsHost: host, register(o, f) { click = f; return true }, show(o, t, ttl, detail) { shown.push({ t, ttl, detail }); return true }, hide() {}, unregister() { click = null } },
  async fetch(url, init) {
    if (String(url).includes('/api/netease-whale-lyrics/settings')) {
      if (init && init.method === 'POST') {
        const body = JSON.parse(init.body)
        assert.equal(init.headers['x-whale-lyrics-csrf'], 'st', '设置写入必须带主机端令牌')
        posts.push(body)
        settingsStore = Object.assign({ saved: true }, settingsStore, body)
        return { ok: true, json: async () => ({ ok: true, settings: settingsStore }) }
      }
      return { ok: true, json: async () => ({ ok: true, csrfToken: 'st', settings: settingsStore }) }
    }
    const tool = init.body && JSON.parse(init.body).tool
    requests++
    const data = url.endsWith('bootstrap') ? { ok: true, csrfToken: 'test' }
      : tool === 'netease_position' ? { ok: true, songId: '1', position, playing, at: Date.now() }
      : { ok: true, lines: [{ time: 0, text: '第一句' }, { time: 2000, text: '第二句' }] }
    return { ok: true, json: async () => data }
  },
}
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve() }
const dispose = mount(env)
await flush()
assert.equal(posts.length, 1, '主机端没有设置时，应把浏览器里的设置迁移过去')
assert.deepEqual(posts[0], { mode: 'off', fontPercent: 100 })
const musicRequests = () => requests
assert.equal(host.children.length, 1)
const slider = host.children[0].children.find(x => x.attrs['aria-label'] === '歌词字号')
assert.equal(slider.value, '100')
slider.value = '150'; slider.handlers.input()
assert.ok(head.children[1].textContent.includes('* 87)'))
assert.equal(saved.get('dsh-netease-whale-lyrics-font-percent-v1'),'150')
slider.value = '999'; slider.handlers.input()
assert.equal(saved.get('dsh-netease-whale-lyrics-font-percent-v1'),'160')
interval(); await flush(); assert.equal(requests, 0, '关闭时不查询网易云')
const select = host.children[0].children[0].children[0]
select.value = 'click'; select.handlers.change(); await flush()
assert.equal(shown.length, 0, '点击模式不能自动冒泡')
assert.equal(click(), true); await flush()
assert.equal(shown.at(-1).t, '第一句'); assert.equal(shown.at(-1).ttl, 5000)
position = 3; interval(); await flush()
assert.equal(shown.at(-1).t, '第一句', '点击显示内容保持冻结')
assert.equal(shown.at(-1).detail.updateOnly, true, '动画更新不可重新打开已关闭的单次气泡')
select.value = 'continuous'; select.handlers.change(); await flush(); interval(); await flush()
assert.equal(shown.at(-1).t, '第二句'); assert.equal(shown.at(-1).ttl, 0)
select.value = 'off'; select.handlers.change(); await flush()
const count = shown.length; interval(); await flush(); assert.equal(shown.length, count)
dispose(); assert.equal(click, null); assert.equal(head.children[0].isConnected, false)

// 换端口/重启后：localStorage 是空的，但主机端还记得「持续输出 + 120%」
settingsStore = { saved: true, mode: 'continuous', fontPercent: 120 }
posts.length = 0
mode = 'off'; saved.clear(); shown.length = 0; requests = 0
const dispose2 = mount(env)
await flush()
assert.equal(posts.length, 0, '主机端已有设置时不该反过来覆盖它')
assert.equal(shown.length > 0, true, '恢复模式后应立即开始推送歌词')
const row2 = host.children.at(-1)
const select2 = row2.children[0].children[0]
assert.equal(select2.value, 'continuous', '菜单里的模式要跟着主机端恢复')
assert.equal(saved.get('dsh-netease-whale-lyrics-font-percent-v1'), '120', '字号也应从主机端恢复')
dispose2()
console.log('PASS: 桥补丁可逆/幂等、系统提示优先、单行时间匹配、关闭不轮询、点击冻结、持续跟随、设置跨端口持久化、清理恢复')
