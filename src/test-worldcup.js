// 世界杯模块纯算法测试：直播吧 HTML 解析 + 小组积分榜计算。
// fixture 抓取于 2026-06-11 直播吧首页（含世界杯/NBA/电竞等混合条目，测过滤）。
//
// Run: node src/test-worldcup.js

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parseWorldcupMatches, computeStandings, parseWorldcupNews } from './worldcup.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let failed = 0
function assert(cond, label) {
  if (!cond) {
    console.error(`FAIL: ${label}`)
    failed++
    process.exitCode = 1
  } else {
    console.log(`PASS: ${label}`)
  }
}

const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'zhibo8-home-sample.html'), 'utf-8')

// fixture 抓取当天（开幕日，所有场次未开赛）的视角时间
const FIXTURE_NOW = new Date(2026, 5, 11, 20, 0).getTime()

// ====== 1) 解析与过滤 ======
{
  const matches = parseWorldcupMatches(html, FIXTURE_NOW)
  assert(matches.length === 4, `1) fixture 解析出 4 场世界杯（实际 ${matches.length}）`)
  assert(matches.every(m => m.matchId && m.home && m.away && m.time), '1) 每场都有 matchId/双方/时间')
  assert(matches.every(m => !/男篮|电竞/.test(m.league)), '1) 过滤掉男篮世界杯/电竞条目')

  const opener = matches[0]
  assert(opener.home === '墨西哥' && opener.away === '南非', `1) 揭幕战 墨西哥 vs 南非（实际 ${opener.home} vs ${opener.away}）`)
  assert(opener.time === '2026-06-12 03:00', `1) 揭幕战时间 2026-06-12 03:00（实际 ${opener.time}）`)
  assert(opener.stage.group === 'A' && opener.stage.round === 1, `1) 揭幕战 A组第1轮（实际 ${JSON.stringify(opener.stage)}）`)
  assert(opener.status === 'scheduled' && opener.score === null, '1) 未开赛：status=scheduled，score=null')
  assert(opener.homeLogo.includes('duoduocdn'), '1) 解析出队徽地址')
  assert(opener.detailUrl.includes('zhibo8.com/zhibo/zuqiu'), `1) 详情页链接（实际 ${opener.detailUrl}）`)
}

// ====== 2) 状态判定：进行中 / 已结束 ======
{
  // 视角拨到揭幕战开球后 30 分钟：无比分也应判 live
  const during = parseWorldcupMatches(html, new Date(2026, 5, 12, 3, 30).getTime())
  assert(during[0].status === 'live', `2) 开球后30分钟 → live（实际 ${during[0].status}）`)

  // 带比分的条目（拼一个赛后形态的 li，模拟 NBA 式 _score 结构）
  const finishedLi = `<ul><li label="世界杯,墨西哥,足球,南非,世界杯小组赛A组第1轮" id="saishi1867414" data-time="2026-06-12 03:00" data-rightishome="0" data-type="football"><time>03:00</time><b><span class="_league">世界杯小组赛A组第1轮</span><span class="_teams"> 墨西哥 <img src="https://duihui.duoduocdn.com/zuqiu/zq_moxige_313403.png"/><span class="_score"><span class="c-s">2 - 1</span></span><img src="https://duihui.duoduocdn.com/zuqiu/zq_nanfei_851083.png"/> 南非</span></b><a href="/zhibo/zuqiu/2026/match1867414v.htm" target="_blank">咪咕 CCTV5</a></li></ul>`
  const after = parseWorldcupMatches(finishedLi, new Date(2026, 5, 12, 8, 0).getTime())
  assert(after.length === 1 && after[0].score?.home === 2 && after[0].score?.away === 1, `2) 赛后比分 2-1（实际 ${JSON.stringify(after[0]?.score)}）`)
  assert(after[0].status === 'finished', `2) 开球5小时后有比分 → finished（实际 ${after[0].status}）`)

  // NBA 式"大比分1-2"不能被误读成足球比分
  const seriesLi = `<li label="世界杯,甲,足球,乙,世界杯小组赛B组第1轮" id="saishi9" data-time="2026-06-12 03:00" data-type="football"><b><span class="_league">世界杯小组赛B组第1轮</span><span class="_teams"> 甲 <img src="a.png"/><span class="_score"><span class="c-s"> - </span><span class="s-m-l">大比分1-2</span></span><img src="b.png"/> 乙</span></b></li>`
  const series = parseWorldcupMatches(seriesLi, FIXTURE_NOW)
  assert(series.length === 1 && series[0].score === null, `2) "大比分1-2"不被误读为比分（实际 ${JSON.stringify(series[0]?.score)}）`)
}

// ====== 3) 小组积分榜 ======
{
  const make = (id, group, home, away, hs, as) => ({
    matchId: id,
    stage: { group, round: 1, knockout: null },
    home, away,
    homeLogo: '', awayLogo: '',
    score: { home: hs, away: as },
    status: 'finished',
    startMs: FIXTURE_NOW,
  })
  const standings = computeStandings([
    make('1', 'A', '墨西哥', '南非', 2, 0),
    make('2', 'A', '韩国', '捷克', 1, 1),
    make('3', 'A', '墨西哥', '韩国', 0, 3),
    make('4', 'B', '加拿大', '波黑', 1, 0),
    { ...make('5', 'B', '甲', '乙', 9, 9), status: 'live' },        // 进行中不计入
    { ...make('6', null, '丙', '丁', 1, 0), stage: { group: null } }, // 淘汰赛不计入
  ])

  assert(Object.keys(standings).join(',') === 'A,B', `3) 只有 A、B 两组（实际 ${Object.keys(standings).join(',')}）`)
  const groupA = standings.A
  assert(groupA[0].team === '韩国' && groupA[0].pts === 4, `3) A组第一 韩国 4分（实际 ${groupA[0]?.team} ${groupA[0]?.pts}分）`)
  assert(groupA[1].team === '墨西哥' && groupA[1].pts === 3, `3) A组第二 墨西哥 3分 — 同分时净胜球优先（实际 ${groupA[1]?.team} ${groupA[1]?.pts}分 gd=${groupA[1]?.gd}）`)
  assert(groupA[1].gd === -1 && groupA[2].team === '捷克', `3) 墨西哥净胜球-1 高于捷克的平局1分`)
  assert(standings.B.length === 2 && standings.B[0].team === '加拿大', '3) B组只计入已结束场次')
}

// ====== 4) 空输入与改版容错 ======
{
  assert(parseWorldcupMatches('').length === 0, '4) 空 HTML → 空数组不抛错')
  assert(parseWorldcupMatches('<html><body>改版了</body></html>').length === 0, '4) 无条目页面 → 空数组')
  const noTeams = `<li label="足球,世界杯" id="saishi7" data-time="2026-06-12 03:00" data-type="football"><b><span class="_league">世界杯</span><span class="_teams"><img src="x.png"></span></b></li>`
  assert(parseWorldcupMatches(noTeams).length === 0, '4) 无队名条目（如赛事合集）被跳过')

  // 开幕式条目带 data-type=football 和两个"队名"形态，曾被误解析成比赛（2026-06-11 真实数据）
  const ceremony = `<li label="足球,世界杯" id="saishi2059824" data-time="2026-06-12 01:30" data-type="football"><b><span class="_league">2026美加墨世界杯开幕式</span><span class="_teams"> 美加墨世界杯 <img src="a.png"/><span> - </span><img src="b.png"/> 开幕式</span></b></li>`
  assert(parseWorldcupMatches(ceremony).length === 0, '4) 开幕式等非比赛节目条目被排除')
}

// ====== 5) 新闻解析 ======
{
  const newsHtml = `
    <a href="/6a2a0cd07d0c1native.htm" class="list-item" target="_blank">世界杯开幕式看点：美加墨三国各办一场！夏奇拉明日空降墨西哥</a>
    <a href="//news.zhibo8.com/zuqiu/abc.htm" target="_blank">泪目！C罗：美加墨世界杯将是我最后一届，可能两年后退役</a>
    <a href="/other.htm">和足球无关的新闻标题不该被收录哦</a>
    <a href="/lanqiu.htm">男篮世界杯预选赛中国队大胜</a>
    <a href="/6a2a0cd07d0c1native.htm">世界杯开幕式看点：美加墨三国各办一场！夏奇拉明日空降墨西哥</a>`
  const news = parseWorldcupNews(newsHtml)
  assert(news.length === 2, `5) 收录 2 条世界杯新闻（实际 ${news.length}：过滤无关/男篮/重复）`)
  assert(news[0].url === 'https://www.zhibo8.cc/6a2a0cd07d0c1native.htm', `5) 相对链接补全域名（实际 ${news[0]?.url}）`)
  assert(news[1].url.startsWith('https://news.zhibo8.com'), `5) 协议相对链接补 https（实际 ${news[1]?.url}）`)
  assert(parseWorldcupNews('').length === 0, '5) 空输入不抛错')
}

console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
