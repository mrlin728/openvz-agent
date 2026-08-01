import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'openvz-scene-acui-'))
process.env.OPENVZ_USER_DIR = temp
process.env.OPENVZ_RESOURCES_DIR = path.resolve('.')

const { sceneStore } = await import('./scene/scene-store.js')
const { execLegacyUIShow, execLegacyUIUpdate, execLegacyUIPatch, execLegacyUIHide } = await import('./capabilities/tools/acui-compat.js')

sceneStore.clear()
const shown = JSON.parse(execLegacyUIShow({ component: 'WeatherCard', props: { city: '上海', temperature: 28 } }))
assert.equal(shown.adapter, 'scene')
assert.equal(sceneStore.get(shown.id).kind, 'weather')
assert.equal(sceneStore.get(shown.id).data.city, '上海')

assert.equal(JSON.parse(execLegacyUIUpdate({ id: shown.id, props: { temperature: 29 } })).ok, true)
assert.equal(sceneStore.get(shown.id).data.temperature, 29)

assert.equal(JSON.parse(execLegacyUIPatch({ id: shown.id, op: 'setState', data: { status: 'fresh' } })).ok, true)
assert.equal(sceneStore.get(shown.id).data.status, 'fresh')

assert.equal(JSON.parse(execLegacyUIHide({ id: shown.id })).changed, true)
assert.equal(sceneStore.get(shown.id), null)
assert.ok(sceneStore.rev >= 4)

fs.rmSync(temp, { recursive: true, force: true })
console.log('Legacy ACUI calls project into canonical SceneStore: OK')
