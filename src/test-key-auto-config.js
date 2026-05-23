// Key auto-config should not bind a fresh key to stale provider words from chat history.
//
// Run: node src/test-key-auto-config.js

import { detectAllKeyInfos } from './key-auto-config.js'

let failed = 0

function assert(cond, label) {
  if (!cond) {
    console.error(`FAIL: ${label}`)
    failed += 1
    process.exitCode = 1
  } else {
    console.log(`PASS: ${label}`)
  }
}

function hasAliyunAsr(infos) {
  return infos.some(info => info.service === 'asr' && info.provider === 'aliyun')
}

{
  const infos = detectAllKeyInfos('sk-1234567890abcdefghijklmnopqrstuvwxyz')
  assert(!hasAliyunAsr(infos), 'plain sk-* key is not treated as Aliyun ASR')
}

{
  const infos = detectAllKeyInfos('刚才说的是阿里云语音，但这个是 DeepSeek key：sk-1234567890abcdefghijklmnopqrstuvwxyz')
  assert(!hasAliyunAsr(infos), 'DeepSeek-labeled sk-* key is not treated as Aliyun ASR')
}

{
  const infos = detectAllKeyInfos('配置阿里云百炼语音识别 sk-1234567890abcdefghijklmnopqrstuvwxyz')
  assert(hasAliyunAsr(infos), 'explicit same-message Aliyun ASR key is still detected')
}

if (failed > 0) process.exit(1)
