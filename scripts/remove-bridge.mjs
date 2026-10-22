import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { Script } from 'node:vm'
import { unpatch } from './bridge.mjs'
const profile = process.argv[2] || process.env.DSH_PROFILE_DIR || process.cwd()
const pkg = createRequire(path.join(profile, 'package.json')).resolve('dsh-whale-widget/package.json')
const file = path.join(path.dirname(pkg), 'assets', 'whale-widget.js')
const original = fs.readFileSync(file, 'utf8')
const clean = unpatch(original)
new Script(clean)
fs.writeFileSync(file, clean, 'utf8')
console.log('已移除歌词兼容桥；请先停用扩展，否则下次启动会重新安装兼容桥。')
