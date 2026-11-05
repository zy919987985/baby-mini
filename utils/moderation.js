/**
 * 发帖内容安全审核（文字 + 图片）
 * ------------------------------------------------------------------
 * 三层拦截，任何一层不通过都不允许发布：
 * 1. 本地硬性规则：广告导流、赌博诈骗、色情低俗、暴恐违禁、虚假医疗、
 *    辱骂攻击等关键词，以及图片格式/大小/数量校验。同步执行，无网也能拦。
 * 2. AI 文字审核：把标题/正文/关联食谱/标签交给云开发托管大模型，
 *    只要求返回 JSON 判定结果，不改写用户内容。
 * 3. AI 图片审核：本地图片读成 base64 dataUrl，交给支持图片输入的
 *    视觉模型逐张审核（图片里的文字、二维码、水印也能一起看）。
 *
 * 失败策略：
 * - 未配置云开发环境（ENV_ID 为空）→ 只跑第 1 层，返回 mode='local'，
 *   功能可用但会在页面上明确标注「本地规则校验」，不冒充 AI 审核。
 * - 已启用 AI 但接口超时/报错/返回无法解析 → 默认拦截发布（失败关闭），
 *   由 MODERATION.BLOCK_ON_ERROR 控制，避免未经审核的内容被放行。
 *
 * 与 utils/ai.js 一样，本模块不持有任何 API Key，密钥由云开发平台托管。
 * ------------------------------------------------------------------
 */
const CONFIG = require('./ai-config')

const CFG = CONFIG.MODERATION || {}

const TEXT_SYSTEM_PROMPT = [
  '你是中文母婴社区的内容安全审核员，请依据中国法律法规与平台社区规范审核用户待发布的帖子。',
  '',
  '必须判定为不通过（pass=false）的情形：',
  '1. 违法违规、政治敏感、危害国家安全与公共秩序的内容；',
  '2. 色情低俗、暴力血腥、恐怖、赌博、毒品、诈骗；',
  '3. 广告营销与站外引流：微信号、手机号、二维码、外链、代购、招商、刷单返利；',
  '4. 泄露他人隐私：身份证号、住址、联系方式、可识别的儿童隐私信息；',
  '5. 虚假医疗或危险喂养建议：宣称包治/根治、替代就医、推荐处方药、给 1 岁内宝宝加盐加糖加蜂蜜、整颗易噎食物；',
  '6. 辱骂、人身攻击、歧视、引战；',
  '7. 与婴幼儿辅食、育儿完全无关的灌水内容。',
  '',
  '家长正常分享辅食做法、喂养记录、排敏经验与个人感受应判定为通过，不要过度拦截。',
  '只输出一个 JSON 对象，不要 Markdown 代码块，不要任何解释文字：',
  '{"pass":true或false,"category":"不通过时填分类（广告导流/色情低俗/虚假医疗/违法违规/辱骂攻击/无关内容等），通过时留空","reason":"不通过时用一句话说明具体问题并给出修改建议，30 字以内；通过时留空"}'
].join('\n')

const IMAGE_SYSTEM_PROMPT = [
  '你是中文母婴社区的图片内容安全审核员，请审核用户待发布的图片，并检查图片中出现的文字、水印、二维码。',
  '',
  '必须判定为不通过（pass=false）的情形：',
  '1. 违法违规、政治敏感、色情低俗、暴力血腥、恐怖、赌博、毒品、诈骗相关画面；',
  '2. 二维码、微信号、手机号、外链、广告水印、商品促销等导流信息；',
  '3. 泄露他人隐私（证件、票据、清晰可识别的他人住址或儿童隐私信息）；',
  '4. 明显危险喂养画面，或与婴幼儿辅食、育儿完全无关的内容。',
  '',
  '正常的辅食成品照、食材照、制作过程照应判定为通过，不要过度拦截。',
  '只输出一个 JSON 对象，不要 Markdown 代码块，不要任何解释文字：',
  '{"pass":true或false,"category":"不通过时填分类，通过时留空","reason":"不通过时用一句话说明具体问题并给出修改建议，30 字以内；通过时留空"}'
].join('\n')

/**
 * 本地规则只拦截「一眼就该拦」的硬违规，语义判断交给 AI，
 * 避免把「辅食不能替代母乳」「不能给整颗葡萄」这类正确科普误杀。
 */
const LOCAL_TEXT_RULES = [
  {
    category: '广告导流',
    re: /(微信号|微信[:：]|weixin|vx[:：]?\s*[a-z0-9_-]{5,}|加我(微信|好友|私聊)?|私聊我|扫码|二维码|加群|进群|代购|微店|淘宝|拼多多|招代理|招商加盟|刷单|返利|兼职日结|(^|[^\d])1[3-9]\d{9}([^\d]|$)|QQ群|公众号下单)/i,
    reason: '含站外联系方式、二维码或广告引流信息，请删除后再发布'
  },
  {
    category: '赌博诈骗',
    re: /(赌博|博彩|私彩|彩票预测|资金盘|炒币|虚拟币|开户送彩金|刷单返现|诈骗|中奖通知)/,
    reason: '含赌博、诈骗或资金盘相关内容'
  },
  {
    category: '色情低俗',
    re: /(色情|淫秽|裸照|裸体|成人影片|成人内容|约炮|性暗示|黄色网站)/,
    reason: '含色情低俗内容'
  },
  {
    category: '暴恐违禁',
    re: /(暴恐|恐怖袭击|枪支|弹药|管制刀具|毒品|吸毒|爆炸物|自残教程|自杀方法)/,
    reason: '含暴力、恐怖或违禁品信息'
  },
  {
    category: '虚假医疗',
    re: /(包治|根治|药到病除|祖传秘方|特效药|保证治愈|治愈率|不用就医|自行停药|停用处方药)/,
    reason: '含虚假医疗或误导性诊疗断言'
  },
  {
    category: '辱骂攻击',
    re: /(傻逼|傻b|去死|死全家|滚蛋|脑残|废物东西)/i,
    reason: '含辱骂或人身攻击内容'
  }
]

function verdict(pass, category, reason) {
  return { pass: !!pass, category: category || '', reason: reason || '' }
}

/** 配置层面是否具备 AI 审核条件（不代表模型真的已开通） */
function isAIAvailable() {
  try {
    const app = getApp()
    return !!(
      CFG.ENABLED !== false &&
      CONFIG.ENV_ID &&
      typeof wx !== 'undefined' &&
      wx.cloud && wx.cloud.extend && wx.cloud.extend.AI &&
      typeof wx.cloud.extend.AI.createModel === 'function' &&
      app && app.globalData && app.globalData.cloudReady
    )
  } catch (e) {
    return false
  }
}

/**
 * 真实能力探测：云环境 ID 填了 ≠ 生文模型已开通。
 * 发一次极短的文本请求确认模型可用，结果在本会话内缓存。
 * 探测失败时审核走本地规则并在页面明确标注，避免「模型没开通就永远发不出帖子」。
 */
let probePromise = null
let probeResult = false

function probeAI() {
  if (probePromise) return probePromise
  if (!isAIAvailable()) {
    probeResult = false
    probePromise = Promise.resolve(false)
    return probePromise
  }
  probePromise = callModel(CFG.TEXT_MODEL || CONFIG.MODEL, [
    { role: 'system', content: '只回复 ok，不要输出其它内容' },
    { role: 'user', content: 'ok' }
  ], 6000).then(function () {
    probeResult = true
    return true
  }).catch(function (err) {
    console.warn('[baby-food] AI 审核模型未就绪，改用本地规则：', err && err.message)
    probeResult = false
    return false
  })
  return probePromise
}

function isAIProbed() { return probeResult }

/* ---------------- 第一层：本地硬性规则 ---------------- */

function checkTextLocally(fields) {
  const f = fields || {}
  const parts = [f.title, f.content, f.recipeTitle]
  ;(f.tags || []).forEach(function (t) { parts.push(t) })
  const text = parts.filter(Boolean).join('\n')
  for (let i = 0; i < LOCAL_TEXT_RULES.length; i++) {
    const rule = LOCAL_TEXT_RULES[i]
    if (rule.re.test(text)) return verdict(false, rule.category, rule.reason)
  }
  return verdict(true, '', '')
}

function extOf(path) {
  const clean = String(path || '').split('?')[0]
  const m = clean.match(/\.([a-z0-9]+)$/i)
  return m ? m[1].toLowerCase() : ''
}

function mimeOf(path) {
  const ext = extOf(path)
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  return 'image/jpeg'
}

function checkImageLocally(file) {
  const path = String((file && file.path) || '')
  const size = Number((file && file.size) || 0)
  if (!path) return verdict(false, '图片异常', '图片文件不存在，请重新选择')
  // 部分机型 chooseMedia 返回的临时路径不带后缀，此时按 jpeg 处理，不误拦
  const ext = extOf(path)
  if (ext && ['jpg', 'jpeg', 'png', 'webp'].indexOf(ext) < 0) {
    return verdict(false, '图片格式', '仅支持 jpg / png / webp 格式的图片')
  }
  if (size > CFG.MAX_IMAGE_BYTES) {
    return verdict(false, '图片过大', '单张图片超过 4 MB，请选择压缩后的图片')
  }
  return verdict(true, '', '')
}

/* ---------------- 第二、三层：云开发 AI ---------------- */

/** 兼容不同基础库/文档的两种返回形态：{text} 与 {choices:[{message}]} */
function pickText(res, depth) {
  if (!res || (depth || 0) > 3) return ''
  if (typeof res === 'string') return res
  if (typeof res.text === 'string' && res.text) return res.text
  if (res.choices && res.choices[0] && res.choices[0].message) {
    return String(res.choices[0].message.content || '')
  }
  if (res.data && res.data !== res) return pickText(res.data, (depth || 0) + 1)
  if (res.result && res.result !== res) return pickText(res.result, (depth || 0) + 1)
  return ''
}

/**
 * 官方多模态文档里，小程序端 generateText 有「直接传参」和
 * 「包一层 data」两种写法。这里依次尝试，取第一个能拿到文本的形态，
 * 避免用户升级基础库或换 provider 后审核整体失效。
 */
function generate(model, payload) {
  const shapes = [
    function () { return model.generateText(payload) },
    function () { return model.generateText({ data: payload }) }
  ]
  function attempt(i) {
    if (i >= shapes.length) return Promise.reject(new Error('AI 审核接口调用失败'))
    return Promise.resolve().then(shapes[i]).then(function (res) {
      const text = pickText(res, 0)
      if (text) return text
      return attempt(i + 1)
    }).catch(function () {
      return attempt(i + 1)
    })
  }
  return attempt(0)
}

function withTimeout(promise, ms) {
  return new Promise(function (resolve, reject) {
    let settled = false
    const timer = setTimeout(function () {
      if (settled) return
      settled = true
      reject(new Error('AI 审核超时'))
    }, ms || 30000)
    promise.then(function (v) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(v)
    }, function (e) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(e)
    })
  })
}

function callModel(modelName, messages, ms) {
  const model = wx.cloud.extend.AI.createModel(CFG.PROVIDER || 'cloudbase')
  return withTimeout(generate(model, { model: modelName, messages: messages }), ms || CFG.TIMEOUT)
    .then(function (text) {
      if (!text) throw new Error('AI 未返回审核结果')
      return text
    })
}

/** 模型偶尔会裹 ```json 围栏，只截取最外层 JSON 对象 */
function parseVerdict(text) {
  let s = String(text || '').trim()
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('AI 审核结果格式异常')
  const raw = JSON.parse(s.slice(start, end + 1))
  const positive = raw.pass === true || raw.result === 'pass' || raw.label === 'pass' || raw.allow === true
  const negative = raw.pass === false || raw.result === 'reject' || raw.result === 'block' || raw.label === 'reject' || raw.allow === false
  if (!positive && !negative) throw new Error('AI 审核结果缺少判定字段')
  return verdict(
    positive && !negative,
    String(raw.category || (positive ? '' : '不适宜内容')),
    String(raw.reason || (positive ? '' : '内容未通过审核，请修改后重试'))
  )
}

function readDataUrl(path) {
  return new Promise(function (resolve, reject) {
    if (typeof wx === 'undefined' || !wx.getFileSystemManager) {
      return reject(new Error('当前环境不支持读取本地图片'))
    }
    wx.getFileSystemManager().readFile({
      filePath: path,
      encoding: 'base64',
      success: function (res) {
        const b64 = String((res && res.data) || '')
        if (!b64) return reject(new Error('图片内容为空'))
        // 官方文档建议 Base64 单张不超过 5 MB，超了直接拦，别发大请求
        if (b64.length > 5 * 1024 * 1024) return reject(new Error('图片过大，无法完成审核'))
        resolve('data:' + mimeOf(path) + ';base64,' + b64)
      },
      fail: function () { reject(new Error('图片读取失败')) }
    })
  })
}

function buildTextMessages(fields) {
  const body = [
    '标题：' + (fields.title || ''),
    '正文：' + (fields.content || ''),
    '关联食谱：' + (fields.recipeTitle || ''),
    '标签：' + (fields.tags || []).join('、')
  ].join('\n')
  return [
    { role: 'system', content: TEXT_SYSTEM_PROMPT },
    { role: 'user', content: '请审核以下待发布内容，只输出 JSON：\n' + body }
  ]
}

function reviewText(fields, ai) {
  const useAI = ai === undefined ? isAIAvailable() : ai
  const local = checkTextLocally(fields)
  if (!local.pass) return Promise.resolve(Object.assign({ mode: 'local' }, local))
  if (!useAI) return Promise.resolve({ pass: true, category: '', reason: '', mode: 'local' })
  return callModel(CFG.TEXT_MODEL || CONFIG.MODEL, buildTextMessages(fields))
    .then(parseVerdict)
    .then(function (v) { return Object.assign({ mode: 'ai' }, v) })
}

function reviewImage(file, index, ai) {
  const useAI = ai === undefined ? isAIAvailable() : ai
  const local = checkImageLocally(file)
  if (!local.pass) return Promise.resolve(Object.assign({ mode: 'local', index: index }, local))
  if (!useAI) return Promise.resolve({ pass: true, category: '', reason: '', mode: 'local', index: index })
  return readDataUrl(file.path).then(function (dataUrl) {
    return callModel(CFG.VISION_MODEL, [
      { role: 'system', content: IMAGE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: '请审核这张待发布的图片，只输出 JSON 结果。' },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ])
  }).then(parseVerdict).then(function (v) {
    return Object.assign({ mode: 'ai', index: index }, v)
  })
}

function reviewImages(list, index, out, notify, ai) {
  if (index >= list.length) return Promise.resolve(out)
  notify(ai
    ? '正在 AI 审核第 ' + (index + 1) + '/' + list.length + ' 张图片…'
    : '正在校验第 ' + (index + 1) + '/' + list.length + ' 张图片…')
  return reviewImage(list[index], index, ai).then(function (r) {
    out.push(r)
    if (!r.pass) return out
    return reviewImages(list, index + 1, out, notify, ai)
  })
}

/**
 * 对外主入口：发布前统一审核，返回是否放行及拦截原因。
 * 先探测生文模型是否真的可用；模型未开通时走本地规则并在页面标注，
 * 模型可用但本次调用失败时按 BLOCK_ON_ERROR 失败关闭。
 * @param {Object} input { title, content, recipeTitle, tags, images: [{path, size}] }
 * @param {Function} onProgress 阶段文案回调，用于页面 loading
 * @returns {Promise<{pass, stage, imageIndex, mode, category, reason, images}>}
 */
function reviewPost(input, onProgress) {
  const o = input || {}
  const notify = typeof onProgress === 'function' ? onProgress : function () {}
  const fields = {
    title: o.title || '',
    content: o.content || '',
    recipeTitle: o.recipeTitle || '',
    tags: o.tags || []
  }
  const images = Array.isArray(o.images) ? o.images : []

  notify('正在准备内容审核…')
  return probeAI().then(function (ai) {
    function onError(err) {
      // AI 从未探测成功 = 环境/模型未开通，降级本地规则，不把发帖功能锁死
      if (!ai) {
        return {
          pass: true, stage: 'degraded', imageIndex: -1, mode: 'local',
          category: '', reason: 'AI 审核未就绪，已按本地规则校验', images: []
        }
      }
      if (CFG.BLOCK_ON_ERROR !== false) {
        return {
          pass: false, stage: 'error', imageIndex: -1,
          mode: 'ai', category: '审核未完成',
          reason: 'AI 审核服务暂不可用，为避免不合规内容发布，请稍后重试',
          images: [], error: (err && err.message) || 'AI_ERROR'
        }
      }
      return {
        pass: true, stage: 'degraded', imageIndex: -1,
        mode: 'local', category: '', reason: '审核服务异常，已按本地规则放行', images: []
      }
    }

    notify(ai ? '正在 AI 审核文字内容…' : '正在校验文字内容…')
    return reviewText(fields, ai).then(function (t) {
      if (!t.pass) {
        return {
          pass: false, stage: 'text', imageIndex: -1, mode: t.mode,
          category: t.category, reason: t.reason, images: []
        }
      }
      return reviewImages(images, 0, [], notify, ai).then(function (list) {
        const bad = list.filter(function (r) { return !r.pass })[0]
        return {
          pass: !bad,
          stage: bad ? 'image' : '',
          imageIndex: bad ? bad.index : -1,
          mode: ai ? 'ai' : 'local',
          category: bad ? bad.category : '',
          reason: bad ? bad.reason : '',
          images: list
        }
      })
    }).catch(onError)
  })
}

module.exports = {
  config: CFG,
  isAIAvailable: isAIAvailable,
  probeAI: probeAI,
  isAIProbed: isAIProbed,
  checkTextLocally: checkTextLocally,
  checkImageLocally: checkImageLocally,
  parseVerdict: parseVerdict,
  reviewText: reviewText,
  reviewImage: reviewImage,
  reviewPost: reviewPost
}
