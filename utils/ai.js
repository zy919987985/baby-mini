/**
 * AI 辅食生成适配层
 * ------------------------------------------------------------------
 * 链路：汇总本次条件（餐次 / 质地 / 过敏食材）→ 构造提示词 → 云开发大模型
 *       → 解析 JSON → 过敏词硬校验（命中自动重试）→ 结果规范化
 *       → 返回「草稿」，由用户手动确认后才写入我的食谱
 *       → 任一环节失败，自动降级到本地规则引擎 utils/recipes.js
 *
 * 两条安全边界（这是本文件存在的意义）：
 * 1. 不持有任何密钥。走 wx.cloud.extend.AI（云开发托管模型），
 *    端上只有环境 ID，API Key 由云开发平台保管。
 * 2. 过敏约束不能只靠模型「自觉遵守」。模型输出必须再过一遍文本校验，
 *    命中禁用词就重试，仍不通过则降级 —— 降级引擎本身已排除过敏食材。
 *
 * 本模块不写 store，生成结果不落库；保存动作由页面 onSaveRecipe 负责。
 * ------------------------------------------------------------------
 */
const CONFIG = require('./ai-config')
const R = require('./recipes')
const U = require('./util')
const store = require('./store')

const SYSTEM_PROMPT = [
  '你是婴幼儿辅食营养师助手，请依据用户条件生成一份可直接照做的宝宝辅食食谱。',
  '',
  '【最高优先级 · 安全规则】',
  '1. 用户每次都会给出「餐次、质地、过敏禁用食材」三项条件，必须同时满足，不得忽略任何一项；食谱类型、份量、切配方式、成品形态都要与餐次和质地一致。',
  '2. 「过敏禁用食材」列表中的任何食材、别名、含该食材的制品（油、酱、粉、汤底、调味料、加工品）一律不得出现在成品食材、标题、标签、步骤、小贴士、营养说明中。',
  '3. 不要在输出的任何文字里复述或列出禁用食材的名称。',
  '4. 不使用超过宝宝月龄建议引入的食材；1 岁前不加盐、糖、蜂蜜；不写医疗诊断、治疗或药效断言。',
  '5. 圆形易噎食物（葡萄、蓝莓、坚果等）必须写明切分处理。',
  '',
  '【输出格式】只输出一个 JSON 对象，不要 Markdown 代码块，不要任何解释文字：',
  '{"title":"食谱名","emoji":"一个食物 emoji","tags":["标签"],"minutes":25,"serving":"约 1 小碗","nutrition":"营养重点",',
  '"ingredients":[{"name":"食材名","amount":"用量"}],"steps":[{"t":"步骤标题","d":"详细做法"}],"tips":["小贴士"]}',
  '',
  '【内容要求】ingredients 3-6 种；steps 5-8 步，每步 d 不少于 25 字，写清克数、时间、火候和质地处理；tips 2-3 条，含排敏与安全提示。'
].join('\n')

/**
 * 常见过敏原的「马甲」：模型常换个说法把禁用食材写回来，
 * 例如鸡蛋黄过敏却写成「蛋羹」、虾过敏写成「虾皮提鲜」。
 * 这里按过敏食材名的关键字做一次关联扩展，用于结果二次校验。
 */
const ALLERGEN_GROUPS = [
  { keys: ['蛋'], terms: ['蛋黄', '鸡蛋', '全蛋', '蛋清', '蛋液', '蛋羹', '蛋挞', '蛋糕', '鹌鹑蛋'] },
  { keys: ['虾'], terms: ['虾仁', '虾皮', '虾米', '虾粉', '虾'] },
  { keys: ['蟹'], terms: ['蟹肉', '蟹黄', '蟹'] },
  { keys: ['花生'], terms: ['花生酱', '花生油', '花生碎', '花生'] },
  { keys: ['奶', '乳', '酸奶', '奶酪'], terms: ['牛奶', '酸奶', '奶酪', '奶油', '乳清', '奶制品', '炼乳'] },
  { keys: ['坚果', '核桃', '腰果', '杏仁'], terms: ['核桃', '腰果', '杏仁', '坚果碎', '坚果酱'] },
  { keys: ['芝麻'], terms: ['芝麻酱', '芝麻油', '芝麻'] },
  { keys: ['大豆', '黄豆', '豆腐'], terms: ['黄豆', '豆浆', '豆腐', '豆干', '腐竹', '酱油'] },
  { keys: ['小麦', '麸质'], terms: ['面粉', '面条', '馒头', '面包', '麸质', '小麦'] },
  { keys: ['鱼'], terms: ['鱼肉', '鱼泥', '鱼汤', '鱼露', '鱼'] }
]

function bannedTermsOf(names) {
  const terms = []
  function push(t) { if (t && terms.indexOf(t) < 0) terms.push(t) }
  ;(names || []).forEach(function (name) {
    push(name)
    ALLERGEN_GROUPS.forEach(function (g) {
      let hit = false
      g.keys.forEach(function (k) { if (name.indexOf(k) >= 0) hit = true })
      if (hit) g.terms.forEach(push)
    })
  })
  return terms
}

/** 云开发 AI 能力是否可用：环境 ID 已配置 + 基础库支持 + 已 init 成功 */
function isAvailable() {
  try {
    const app = getApp()
    return !!(
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
 * 汇总本次生成的全部条件。
 * 餐次 / 质地 / 过敏食材由页面显式传入（快照），保证「生成时用的」与
 * 「结果里显示的」是同一份；store 只用来补 states、适龄食材和历史标题。
 */
function buildContext(opt) {
  return Promise.all([
    store.getAllIngredients(),
    store.getRecipes()
  ]).then(function (res) {
    const all = res[0] || []
    const months = Number(opt.ageMonths) || 6
    const stage = R.stageFor(months)

    const states = {}
    all.forEach(function (i) { states[i.id] = i.status })

    const storeAllergy = all.filter(function (i) { return i.status === 'allergy' })
      .map(function (i) { return i.name })
    // 页面显式传入优先；未传时回退到本地存储，保证任何调用方都带得上过敏清单
    const allergyNames = Array.isArray(opt.allergyNames)
      ? opt.allergyNames.slice()
      : storeAllergy

    const safeNames = all.filter(function (i) {
      return i.status !== 'allergy' &&
        allergyNames.indexOf(i.name) < 0 &&
        (Number(i.minMonth) || 6) <= months
    }).map(function (i) { return i.name })

    // 降级时按 round 轮换主料，避免每次兜底都出同一道「强化铁米粉软泥」
    const safeIds = R.safeIngredientIds(months, states, false)

    const historyTitles = (res[1] || []).slice(0, CONFIG.HISTORY_LIMIT)
      .map(function (r) { return r.title })
    // 上一份「未保存的草稿」也要避开，否则连点「换一个」容易出同一道菜
    if (opt.excludeTitle && historyTitles.indexOf(opt.excludeTitle) < 0) {
      historyTitles.unshift(opt.excludeTitle)
    }

    return {
      ageMonths: months,
      stage: stage,
      mealType: opt.mealType || '午餐',
      texture: opt.texture || stage.texture,
      allergyNames: allergyNames,
      bannedTerms: bannedTermsOf(allergyNames),
      round: Number(opt.round) || 0,
      states: states,
      safeNames: safeNames,
      safeIds: safeIds,
      historyTitles: historyTitles
    }
  })
}

function buildUserPrompt(ctx, attempt) {
  const lines = []
  lines.push('【本次生成条件 · 三项必须同时满足】')
  lines.push('1）餐次：' + ctx.mealType + '。食谱类型、份量与喂食安排都要符合这一餐次。')
  lines.push('2）质地：' + ctx.texture + '。切配、研磨、过筛、成型与最后一步的质地复核都要按此执行，并在步骤里写明。')
  lines.push('3）过敏禁用食材：' + (ctx.allergyNames.length ? ctx.allergyNames.join('、') : '无') +
    '。成品食材、调味料、步骤与任何文字中均不得出现这些食材及其制品。')
  lines.push('')
  lines.push('宝宝月龄：' + U.ageText(ctx.ageMonths) + '（' + ctx.stage.name + '，' + ctx.stage.desc + '）')
  lines.push('【适龄可用食材参考】：' + ctx.safeNames.slice(0, 60).join('、'))
  if (ctx.historyTitles.length) {
    lines.push('【请避开最近生成过的食谱】：' + ctx.historyTitles.join('、'))
  }
  lines.push('请生成一份全新搭配，主料组合与上述标题都不同。这是第 ' + (ctx.round + 1) + ' 次生成。')
  lines.push('输出前逐项自检：餐次是否符合？质地是否落实？是否完全不含过敏禁用食材及其别名？')
  if (attempt > 0) {
    lines.push('上一次输出被检测出含禁用食材，本次请更换全部主料，逐项自检后再输出 JSON。')
  }
  return lines.join('\n')
}

/** 调用云开发托管大模型（非流式）。模型名以云开发控制台已开启的为准 */
function callModel(ctx, attempt) {
  const model = wx.cloud.extend.AI.createModel('cloudbase')
  return model.generateText({
    model: CONFIG.MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(ctx, attempt) }
    ]
  }).then(function (res) {
    const choices = res && res.choices
    const text = choices && choices[0] && choices[0].message && choices[0].message.content
    if (!text) throw new Error('AI 未返回内容')
    return text
  })
}

/** 给模型调用加超时，避免网络慢时页面一直转圈（不会取消底层请求，仅提前降级） */
function withTimeout(promise, ms) {
  return new Promise(function (resolve, reject) {
    let settled = false
    const timer = setTimeout(function () {
      if (settled) return
      settled = true
      reject(new Error('AI 生成超时'))
    }, ms)
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

/** 模型偶尔会裹 ```json 围栏或加前后缀，这里只截取最外层 JSON 对象 */
function extractJson(text) {
  let s = String(text || '').trim()
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('AI 返回格式异常')
  return JSON.parse(s.slice(start, end + 1))
}

/**
 * 过敏硬校验：扫描模型原始结果的所有文本字段。
 * 注意这里查的是「模型输出」，不是提示词，所以提示词里列禁用名不会误判。
 */
function findViolation(raw, terms) {
  const parts = []
  function add(v) { if (typeof v === 'string') parts.push(v) }
  add(raw.title)
  add(raw.nutrition)
  add(raw.serving)
  ;(raw.tags || []).forEach(add)
  ;(raw.ingredients || []).forEach(function (i) { add(i && i.name); add(i && i.amount) })
  ;(raw.steps || []).forEach(function (s) { add(s && s.t); add(s && s.d) })
  ;(raw.tips || []).forEach(add)
  const text = parts.join('\n')
  for (let i = 0; i < terms.length; i++) {
    if (text.indexOf(terms[i]) >= 0) return terms[i]
  }
  return ''
}

/** 降级结果用：单段文本是否命中任一禁用词 */
function containsAny(text, terms) {
  if (typeof text !== 'string') return false
  for (let i = 0; i < terms.length; i++) {
    if (text.indexOf(terms[i]) >= 0) return true
  }
  return false
}

/** 逐句剔除含禁用词的句子，其余内容保留 */
function stripBannedSentences(text, terms) {
  if (typeof text !== 'string' || !text) return ''
  const chunks = String(text).split(/([。；！？])/)
  const kept = []
  for (let i = 0; i < chunks.length; i += 2) {
    const sentence = (chunks[i] || '') + (chunks[i + 1] || '')
    if (!sentence.trim()) continue
    if (!containsAny(sentence, terms)) kept.push(sentence)
  }
  return kept.join('')
}

/**
 * 本地模板库里个别步骤/小贴士会顺带提到别的食材，即使主料安全也可能撞上
 * 宝宝的过敏清单。降级结果再做一次文本清理，保证「成品里看不到过敏食材」。
 */
function sanitizeLocalRecipe(recipe, terms) {
  recipe.title = stripBannedSentences(recipe.title, terms) || '适龄辅食'
  recipe.nutrition = stripBannedSentences(recipe.nutrition, terms) || '按月龄均衡搭配'
  recipe.serving = stripBannedSentences(recipe.serving, terms) || '约 1 小碗'
  recipe.tags = (recipe.tags || []).filter(function (t) { return !containsAny(t, terms) })
  recipe.ingredients = (recipe.ingredients || []).filter(function (i) {
    return !containsAny(i.name, terms) && !containsAny(i.amount, terms)
  })
  if (!recipe.ingredients.length) recipe.ingredients = [{ name: '温水', amount: '适量' }]
  recipe.steps = (recipe.steps || []).map(function (s, idx) {
    return {
      no: idx + 1,
      t: stripBannedSentences(s.t, terms) || ('步骤 ' + (idx + 1)),
      d: stripBannedSentences(s.d, terms) || '按宝宝当前月龄与质地要求处理食材后喂食。'
    }
  })
  recipe.tips = (recipe.tips || []).map(function (t) {
    return stripBannedSentences(t, terms)
  }).filter(Boolean)
  if (!recipe.tips.length) recipe.tips = ['喂养前请核对食材与宝宝过敏史。']
  return recipe
}

/** 把模型结果补齐成项目现有食谱结构，保证详情页/发帖子都能直接复用 */
function normalizeRecipe(raw, ctx, opt) {
  const months = ctx.ageMonths
  const stage = ctx.stage

  const ingredients = (Array.isArray(raw.ingredients) ? raw.ingredients : [])
    .filter(function (i) { return i && i.name })
    .slice(0, 8)
    .map(function (i) {
      return { name: String(i.name), amount: String(i.amount || '适量') }
    })

  const steps = (Array.isArray(raw.steps) ? raw.steps : [])
    .filter(function (s) { return s && (s.t || s.d) })
    .slice(0, 10)
    .map(function (s, idx) {
      return {
        no: idx + 1,
        t: String(s.t || ('步骤 ' + (idx + 1))),
        d: String(s.d || '')
      }
    })

  if (!ingredients.length || !steps.length) throw new Error('AI 返回内容不完整')

  // 追加一步「按本次条件复核」，让餐次与质地在结果里也看得见。
  // 此步在过敏校验之后追加，且不写具体过敏名，不会被误判。
  steps.push({
    no: steps.length + 1,
    t: '按本次条件复核',
    d: '本餐为「' + ctx.mealType + '」，成品需处理成「' + ctx.texture + '」后再喂食；' +
      (ctx.allergyNames.length
        ? '同时确认全部食材与调味料均不含宝宝过敏成分。'
        : '同时确认食材均适合当前月龄。')
  })

  const tags = (Array.isArray(raw.tags) ? raw.tags : [])
    .filter(function (t) { return typeof t === 'string' && t })
    .slice(0, 4)
    .map(String)

  const tips = (Array.isArray(raw.tips) ? raw.tips : [])
    .filter(function (t) { return typeof t === 'string' && t })
    .slice(0, 4)
    .map(String)
  // 免责提示里不写具体过敏名，避免被下一轮校验误判
  tips.push('本食谱由 AI 生成，仅供参考；喂养前请家长逐项核对食材与宝宝过敏史，新食材单独连续观察 3 天。')

  return {
    id: U.uid('recipe'),
    title: String(raw.title || '专属辅食'),
    emoji: String(raw.emoji || '🍲'),
    babyName: opt.babyName || '宝宝',
    ageMonths: months,
    ageText: U.ageText(months),
    stage: stage.name,
    mealType: ctx.mealType,
    texture: ctx.texture,
    condition: {
      mealType: ctx.mealType,
      texture: ctx.texture,
      allergyNames: ctx.allergyNames.slice()
    },
    tags: tags.length ? tags : ['AI 生成', '适龄搭配'],
    nutrition: String(raw.nutrition || '均衡搭配'),
    serving: String(raw.serving || (months < 9 ? '约 1 小碗（60-80g）' : '约 1 碗（120-150g）')),
    minutes: Number(raw.minutes) > 0 ? Number(raw.minutes) : 25,
    ingredients: ingredients,
    steps: steps,
    tips: tips,
    source: 'ai',
    aiModel: CONFIG.MODEL,
    createdAt: Date.now()
  }
}

/** 生成 + 过敏重试。抛错时由外层统一降级 */
function attemptAI(ctx, opt, attempt) {
  return withTimeout(callModel(ctx, attempt), CONFIG.TIMEOUT)
    .then(extractJson)
    .then(function (raw) {
      const hit = findViolation(raw, ctx.bannedTerms)
      if (hit) {
        if (attempt < CONFIG.MAX_RETRY) return attemptAI(ctx, opt, attempt + 1)
        throw new Error('AI 结果含禁用食材')
      }
      return normalizeRecipe(raw, ctx, opt)
    })
}

/**
 * 对外主入口（只返回草稿，不写入本地食谱库）
 * @param {Object} opt { ageMonths, mealType, texture, allergyNames, babyName, round, excludeTitle }
 * @returns {Promise<{recipe: Object, source: 'ai'|'local', reason: string}>}
 */
function generateRecipe(opt) {
  const o = opt || {}
  let context = null

  return buildContext(o).then(function (ctx) {
    context = ctx
    if (!isAvailable()) {
      return { recipe: null, reason: 'NO_CLOUD' }
    }
    return attemptAI(ctx, o, 0).then(function (recipe) {
      return { recipe: recipe, reason: '' }
    }).catch(function (err) {
      console.warn('[baby-food] AI 生成失败，降级本地引擎：', err && err.message)
      return { recipe: null, reason: (err && err.message) || 'AI_ERROR' }
    })
  }).then(function (result) {
    if (result.recipe) {
      return { recipe: result.recipe, source: 'ai', reason: result.reason }
    }
    // 降级：本地规则引擎本身已按 states 排除过敏与超月龄食材，
    // 且 mealType / texture 都由本次条件快照传入。
    const safeIds = context.safeIds || []
    const round = context.round
    const pick = safeIds.length ? [safeIds[round % safeIds.length]] : []
    return R.generateRecipe({
      ageMonths: context.ageMonths,
      mealType: context.mealType,
      texture: context.texture,
      states: context.states,
      selectedIds: pick,
      // 让本地模板也在「正文含过敏词」层面被过滤，不只是过滤主料
      bannedTerms: context.bannedTerms,
      babyName: o.babyName,
      round: round
    }).then(function (recipe) {
      // 双保险：模板筛选之后再全文校验一次，漏网的句子直接剔除
      if (findViolation(recipe, context.bannedTerms)) {
        recipe = sanitizeLocalRecipe(recipe, context.bannedTerms)
      }
      recipe.source = 'local'
      recipe.condition = {
        mealType: context.mealType,
        texture: context.texture,
        allergyNames: context.allergyNames.slice()
      }
      return { recipe: recipe, source: 'local', reason: result.reason }
    })
  })
}

module.exports = {
  isAvailable: isAvailable,
  generateRecipe: generateRecipe
}
