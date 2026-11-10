/**
 * 官方号「每日推荐辅食」
 * ------------------------------------------------------------------
 * 个人小程序暂未开放社交类目：首页不再展示用户帖子，改为官方号发布的
 * 只读资讯内容。设计要点：
 *   1) 内容池来自 utils/recipes.js 的官方食谱模板，随包发布，不依赖云端、
 *      不需要登录，也不产生任何 UGC（无发布 / 点赞 / 评论 / 收藏）。
 *   2) 以本地时间 02:00 为「发布日」分界：00:00~01:59 仍展示前一日批次，
 *      到 02:00 自动切换成新一批 6 条，对应「每日凌晨 2 点发布 6 条」。
 *   3) 轮换用「日期做种子的确定性洗牌」，同一天所有用户看到同一批 6 条，
 *      当天不重复，不需要服务端，离线也能展示。
 *   4) 以后若改成真正的云端定时发布，只需把页面数据源从 getDaily() 换成
 *      读取 bf_posts 里 authorUid='official' 的当日文档，页面结构不用改。
 *
 * 本文件是纯函数模块：不引用 wx，可在 Node 下直接单测。
 * ------------------------------------------------------------------
 */
var R = require('./recipes')

var ACCOUNT = { name: '宝宝辅食官方', avatar: '🍼', badge: '官方' }
var DAILY_COUNT = 6
var PUBLISH_HOUR = 2
var DAY_MS = 86400000

/** 官方编辑文案：与 utils/recipes.js 的 TEMPLATES 一一对应 */
var EDITORIAL = {
  pumpkin_rice: '第一口辅食可以从强化铁米粉开始。南瓜蒸透后过筛拌进米糊，稀滑好吞咽，顺带补上 6 月龄后容易缺的铁。',
  carrot_potato: '两种根茎菜分开蒸、分别压泥，颜色和口感都更清楚。滴两滴植物油帮助胡萝卜素吸收，1 岁前不加盐糖。',
  broccoli_rice: '西兰花只取花冠焯水切末，拌进熬开花的小米粥。搭配富含铁的肉泥一起吃，维生素 C 能促进铁吸收。',
  egg_yolk: '蛋黄属于高致敏食材，从 1/4 个起步、温水调稀后单独连续观察 3 天。1 岁前不吃蛋清。',
  apple_pear: '水果蒸软再刮泥，比生食更温和。蒸出的果水一起打泥能留住水溶性维生素，现做现吃、不加糖不加蜂蜜。',
  avocado_banana: '免开火的加餐：熟牛油果配带斑点的香蕉，用叉子压到完全顺滑。优质脂肪含量高，首次少量并观察便便。',
  cod_pumpkin: '鳕鱼柠檬去腥蒸熟压蓉，与南瓜泥煮成浓汤。鱼类高致敏，首次安排在上午，方便白天观察反应。',
  beef_tomato: '牛里脊去筋膜打细泥，番茄去皮去籽提味补维 C，血红素铁更好吸收。8 月龄建议过筛后食用。',
  sweet_potato: '红薯压泥加煮到糊化的燕麦，膳食纤维足、饱腹感好。红薯易胀气，不要连续多餐大量吃。',
  tofu_veg: '嫩豆腐焯水去豆腥，青菜只取嫩叶切极细末，煮成好舀的碎碎羹。植物蛋白与钙兼顾，1 岁前不放盐酱油。',
  chicken_corn: '鸡胸肉打泥加过筛的玉米泥同煮，自带清甜。玉米外皮不易消化，务必过筛；打泥时加汤不加水更顺滑。',
  pork_liver: '猪肝反复浸泡去血水、打泥过筛，配菠菜末熬进粥里，补铁效率高。每次约 20g、每周 1-2 次即可。',
  salmon_veg: '三文鱼、土豆、胡萝卜拌匀压成小饼，煎或烤后切成宝宝能握住的长条。手指食物需全程大人在旁看护。',
  millet_yam: '铁棍山药蒸软压泥，与熬开花的小米粥同煮，温和好消化，适合胃口不佳或转奶期。处理山药记得戴手套。',
  blueberry_yogurt: '1 岁以上再引入乳制品：无糖酸奶铺底、撒燕麦、放切四瓣的蓝莓。圆形食物必须切分，避免噎食。'
}

/** 把食谱模板整理成首页卡片数据 */
function pool() {
  return R.TEMPLATES.map(function (t, i) {
    var e = EDITORIAL[t.id] || {}
    var fallback = (t.ingredients || []).map(function (x) { return x.name }).join('、') +
      '，' + (t.nutrition || '') + '。按月龄调整质地，1 岁前不额外加盐、糖、蜂蜜。'
    return {
      _i: i,
      templateId: t.id,
      minMonth: t.minMonth,
      title: t.title,
      emoji: t.emoji,
      desc: e.desc || fallback,
      ageTag: t.minMonth + ' 月龄+',
      meal: (t.meals && t.meals[0]) || '辅食',
      tags: (t.tags || []).slice(0, 3),
      nutrition: t.nutrition,
      ingredients: (t.ingredients || []).map(function (x) {
        return { name: x.name, amount: x.amount }
      }),
      steps: (t.steps || []).map(function (s, n) {
        return { no: n + 1, t: s.t, d: s.d }
      }),
      tips: (t.tips || []).slice()
    }
  })
}

/** 02:00 前的凌晨算作前一个发布日 */
function dayStart(now) {
  var d = new Date(now)
  var t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
  if (d.getHours() < PUBLISH_HOUR) t.setDate(t.getDate() - 1)
  return t
}

/** 用 UTC 天序号做种子，避免时区/夏令时在同一天内产生两个值 */
function dayNumber(now) {
  var t = dayStart(now)
  return Math.floor(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) / DAY_MS)
}

function dateTextOf(day) {
  var d = new Date(day * DAY_MS)
  return (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日'
}

/** 下一个本地 02:00（严格晚于 now） */
function nextBoundary(now) {
  var d = new Date(now)
  var t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), PUBLISH_HOUR, 0, 0, 0)
  if (t.getTime() <= d.getTime()) t.setDate(t.getDate() + 1)
  return t.getTime()
}

function msUntilNextPublish(now) {
  var t = now === undefined ? Date.now() : Number(now)
  return Math.max(1000, nextBoundary(t) - t)
}

/** 32 位乘法（老基础库没有 Math.imul 时的等价实现） */
function imul(a, b) {
  if (Math.imul) return Math.imul(a, b)
  var ah = (a >>> 16) & 0xffff
  var al = a & 0xffff
  return ((ah * b << 16) + al * b) | 0
}

/**
 * 雪崩混合：连续日期只差 1，若直接拿去当 LCG 种子，相邻两天的第一批
 * 随机值几乎一样，会出现「连着好几天重复同样几条」。先打散再播种。
 */
function mix32(x) {
  var h = (x ^ 0x9E3779B9) >>> 0
  h = imul(h ^ (h >>> 16), 0x85EBCA6B) >>> 0
  h = imul(h ^ (h >>> 13), 0xC2B2AE35) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

/** 线性同余伪随机：确定、不依赖 Math.random，同一天结果恒定 */
function rng(seed) {
  var s = mix32(seed)
  return function () {
    s = (imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function pick(day) {
  var list = pool()
  var rand = rng(day)
  for (var i = list.length - 1; i > 0; i--) {
    var j = Math.floor(rand() * (i + 1))
    var tmp = list[i]
    list[i] = list[j]
    list[j] = tmp
  }
  var chosen = list.slice(0, Math.min(DAILY_COUNT, list.length))
  // 按月龄从低到高排，读起来像一份由浅入深的当日菜单
  chosen.sort(function (a, b) { return a.minMonth - b.minMonth || a._i - b._i })
  return chosen
}

function decorate(item, day, index) {
  return Object.assign({}, item, {
    id: 'official_' + day + '_' + item.templateId,
    authorName: ACCOUNT.name,
    authorAvatar: ACCOUNT.avatar,
    badge: ACCOUNT.badge,
    timeText: dateTextOf(day) + ' 02:00 发布',
    no: index + 1,
    open: false
  })
}

/**
 * 取当前发布日的 6 条官方推荐。
 * @param {number|Date} now 便于测试注入时间；不传用 Date.now()
 */
function getDaily(now) {
  var t = now === undefined ? Date.now() : now
  var day = dayNumber(t)
  return {
    day: day,
    dateText: dateTextOf(day),
    nextDateText: dateTextOf(day + 1),
    updateText: '每日 02:00 更新',
    account: ACCOUNT,
    count: DAILY_COUNT,
    items: pick(day).map(function (it, i) { return decorate(it, day, i) })
  }
}

module.exports = {
  account: ACCOUNT,
  DAILY_COUNT: DAILY_COUNT,
  PUBLISH_HOUR: PUBLISH_HOUR,
  pool: pool,
  dayNumber: dayNumber,
  dateTextOf: dateTextOf,
  nextBoundary: nextBoundary,
  msUntilNextPublish: msUntilNextPublish,
  getDaily: getDaily
}
