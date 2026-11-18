/**
 * 本地辅食搭配引擎（非 AI / 无深度合成）
 * ------------------------------------------------------------------
 * 用途：个人主体小程序暂不开放「深度合成」服务类目，端上不再调用任何
 *       大模型 / 文本生成 / 图片生成能力。本模块只做确定性规则匹配：
 *         读取用户已标记的食材状态（月龄 / 过敏）
 *         → 从 utils/recipes.js 的内置模板库按条件挑选一份
 *         → 过敏词二次校验，命中则逐句剔除
 *      全程在本机完成，不构造提示词、不调用 wx.cloud.extend.AI、不上传
 *      用于内容生成的数据。结果仍是「草稿」，保存动作由页面负责。
 *
 * 接口刻意与旧的 utils/ai.js 保持一致：
 *   generateRecipe(opt) → Promise<{ recipe, source: 'local', reason: '' }>
 *   isAvailable()       → false（表示当前没有云端生成能力）
 * 所以 pages/cook/cook.js 只换一行 require 就能工作；将来若主体变更、
 * 已补齐「深度合成」类目及算法备案，把那行 require 换回 './ai' 即可恢复，
 * 同时恢复 cook.wxml 里两处来源文案。原始文件见
 * .workbuddy/backup/ai-disabled-20261110/。
 * ------------------------------------------------------------------
 */
const R = require('./recipes')
const U = require('./util')
const store = require('./store')

/**
 * 常见过敏原的关联词。内置模板里个别步骤/小贴士会顺带提到别的食材，
 * 即使主料安全也可能撞上宝宝的过敏清单，这里按关键字做一次扩展。
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

/** 0 是合法月龄，不能用 Number(v) || 6 兜底，否则会给新生儿放出超龄食材 */
function normalizeMonths(v) {
  const n = Number(v)
  if (v === 0) return 0
  if (v === undefined || v === null || v === '' || !isFinite(n)) return 6
  return Math.max(0, Math.min(72, Math.floor(n)))
}

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

function findViolation(recipe, terms) {
  const parts = []
  function add(v) { if (typeof v === 'string') parts.push(v) }
  add(recipe.title)
  add(recipe.nutrition)
  add(recipe.serving)
  ;(recipe.tags || []).forEach(add)
  ;(recipe.ingredients || []).forEach(function (i) { add(i && i.name); add(i && i.amount) })
  ;(recipe.steps || []).forEach(function (s) { add(s && s.t); add(s && s.d) })
  ;(recipe.tips || []).forEach(add)
  return containsAny(parts.join('\n'), terms) ? '命中过敏词' : ''
}

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

/**
 * 对外主入口（只返回草稿，不写入本地食谱库）
 * @param {Object} opt { ageMonths, ageText, babyName, mealType, texture, allergyNames, round, excludeTitle }
 * @returns {Promise<{recipe: Object, source: 'local', reason: string}>}
 */
function generateRecipe(opt) {
  const o = opt || {}
  // 只读取用户已标记的食材状态，用于月龄 / 过敏过滤；不发起任何内容生成请求
  return store.getAllIngredients().then(function (all) {
    const list = all || []
    const months = normalizeMonths(o.ageMonths)
    const stage = R.stageFor(months)

    const states = {}
    list.forEach(function (i) { states[i.id] = i.status })

    const storeAllergy = list.filter(function (i) { return i.status === 'allergy' })
      .map(function (i) { return i.name })
    // 页面显式传入优先；未传时回退到已保存的标记
    const allergyNames = Array.isArray(o.allergyNames)
      ? o.allergyNames.slice()
      : storeAllergy
    const bannedTerms = bannedTermsOf(allergyNames)

    // 按 round 轮换主料，连点「换一个」不会总出同一道
    const safeIds = R.safeIngredientIds(months, states, false)
    const round = Number(o.round) || 0
    const pick = safeIds.length ? [safeIds[round % safeIds.length]] : []

    return R.generateRecipe({
      ageMonths: months,
      mealType: o.mealType || '午餐',
      texture: o.texture || stage.texture,
      states: states,
      selectedIds: pick,
      bannedTerms: bannedTerms,
      babyName: o.babyName,
      round: round
    }).then(function (recipe) {
      // 双保险：模板筛选之后再全文校验一次，漏网的句子直接剔除
      if (findViolation(recipe, bannedTerms)) {
        recipe = sanitizeLocalRecipe(recipe, bannedTerms)
      }
      recipe.source = 'local'
      recipe.condition = {
        ageMonths: months,
        ageText: o.ageText || U.ageText(months),
        babyName: o.babyName || '宝宝',
        mealType: o.mealType || '午餐',
        texture: o.texture || stage.texture,
        allergyNames: allergyNames.slice()
      }
      return { recipe: recipe, source: 'local', reason: '' }
    })
  })
}

/** 当前版本不提供云端生成能力，固定返回 false */
function isAvailable() { return false }

module.exports = {
  isAvailable: isAvailable,
  generateRecipe: generateRecipe
}
