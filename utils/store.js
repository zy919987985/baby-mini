/**
 * 数据仓库（云开发版）
 * ------------------------------------------------------------------
 * 所有数据落在微信云开发，不再依赖 wx.setStorageSync 作为主存储：
 *   bf_user_state  —— 私有状态，每个 openid 一个文档（权限 PRIVATE）
 *   bf_posts       —— 社区帖子，全局共享（权限 CUSTOM: read/write true）
 *   bf_comments    —— 评论，全局共享（权限 CUSTOM: read/write true）
 *   云存储桶        —— 帖子图片，存 cloud:// fileID（权限 READONLY）
 *
 * 对外暴露的仍然是原来那套「全部返回 Promise」的接口，页面代码零改动。
 * 本地 Storage 只做两件事：
 *   1) 离线只读快照（cloud 挂了还能看内容，页面会明确提示离线）
 *   2) 首次上云时把旧版 baby_food_state_v1 的数据迁移到云端（只迁一次）
 * ------------------------------------------------------------------
 */
const U = require('./util')
const ING = require('./ingredients')
const CLOUD = require('./cloud')

const COL = {
  STATE: 'bf_user_state',
  POSTS: 'bf_posts',
  COMMENTS: 'bf_comments'
}
const CACHE_KEY = 'baby_food_cloud_cache_v2'
const COMMUNITY_KEY = 'baby_food_cloud_community_v2'
const LEGACY_KEY = 'baby_food_state_v1'
const MIGRATED_KEY = 'baby_food_migrated_v2'
// 记住「属于当前 openid 的私有文档 _id」，避免换账号后误绑到别人的文档
const STATE_DOC_KEY = 'baby_food_state_doc_v2'

function now() { return Date.now() }
function H(n) { return n * 3600000 }
function D(n) { return n * 86400000 }

let initPromise = null
let stateDocId = null
let offline = false
let cache = null                                  // 私有状态快照
let community = { posts: [], comments: [] }       // 社区内容快照
let pendingChanges = false                        // 离线期间的改动未同步

/* ---------------- 种子数据 ---------------- */

function seedPrivate() {
  return {
    version: 2,
    user: null,
    // 默认不预填宝宝档案：首次进入展示空状态，引导用户自行添加
    babies: [],
    // 默认所有食材均为「未食用」，过敏/正常由用户实测后自行标记
    ingredientStates: {},
    customIngredients: [],
    recipes: [],
    likes: {},
    favorites: {},
    messages: [
      { id: 'm_4', type: 'system', from: '辅食小助手', avatar: '🍼', title: '欢迎来到宝宝辅食', desc: '先去「我的」完善宝宝信息，食谱会更贴合月龄哦', postId: '', createdAt: now() - D(2), read: true }
    ]
  }
}

function seedCommunity() {
  const t = now()
  const posts = [
    {
      id: 'post_seed_1', authorId: 'u_xiaoman', authorName: '小满妈妈', authorAvatar: '👩', isMine: false,
      title: '8月龄｜第一次吃蛋黄就光盘啦',
      content: '按 1/4 个蛋黄起步，用温水调稀后拌进南瓜泥，没有加任何调味料。连着观察了三天，没有起疹子，今天加到半个啦～分享给同样在排敏期的姐妹。',
      coverEmoji: '🥚', coverSeed: 'egg-yolk', recipeTitle: '蛋黄南瓜糊', tags: ['8个月', '补铁', '排敏'],
      images: [], likeCount: 128, commentCount: 2, favCount: 46, createdAt: t - H(3)
    },
    {
      id: 'post_seed_2', authorId: 'u_doudou', authorName: '豆豆的辅食日记', authorAvatar: '🧑', isMine: false,
      title: '一周不重样的手指食物，娃自己抓着吃',
      content: '10 个月开始练自主进食。蒸软的南瓜条、西兰花小树、三文鱼小饼都很好抓。关键是全程大人在旁边看着，圆形食物一定切开，别偷懒。',
      coverEmoji: '🥦', coverSeed: 'finger-food', recipeTitle: '三文鱼时蔬小饼', tags: ['10个月', '手指食物', '自主进食'],
      images: [], likeCount: 96, commentCount: 0, favCount: 73, createdAt: t - H(11)
    },
    {
      id: 'post_seed_3', authorId: 'u_anran', authorName: '安然', authorAvatar: '👩‍🦰', isMine: false,
      title: '过敏宝宝也能吃的补铁粥（附避雷清单）',
      content: '我家娃对蛋清和虾都过敏，食材清单里标成红色之后，生成食谱会自动避开，这点太省心了。今天这锅番茄牛肉小米粥，连汤都喝光。',
      coverEmoji: '🥩', coverSeed: 'beef-porridge', recipeTitle: '番茄牛肉小米粥', tags: ['过敏友好', '补铁'],
      images: [], likeCount: 212, commentCount: 1, favCount: 105, createdAt: t - D(1) - H(2)
    },
    {
      id: 'post_seed_4', authorId: 'u_mine', authorName: '我', authorAvatar: '🍼', isMine: true,
      title: '今天第一次做南瓜米糊，记录一下',
      content: '跟着详细步骤一步步来，蒸 15 分钟、过筛、冲米粉，居然一次成功。宝宝吃了小半碗，明天继续。',
      coverEmoji: '🎃', coverSeed: 'pumpkin', recipeTitle: '南瓜铁米粉糊', tags: ['6个月', '第一口辅食'],
      images: [], likeCount: 18, commentCount: 2, favCount: 5, createdAt: t - D(2)
    }
  ]
  const comments = [
    { id: 'c_1', postId: 'post_seed_1', authorName: '团子妈', avatar: '👩', content: '请问蛋黄是煮全熟吗？我家还没敢试', createdAt: t - H(2) },
    { id: 'c_2', postId: 'post_seed_1', authorName: '小满妈妈', avatar: '👩', content: '是的，冷水下锅煮 10 分钟，取蛋黄压散加温水～', createdAt: t - H(1) },
    { id: 'c_3', postId: 'post_seed_3', authorName: '果果', avatar: '🧑', content: '避雷清单太需要了，收藏！', createdAt: t - D(1) },
    { id: 'c_4', postId: 'post_seed_4', authorName: '小满妈妈', avatar: '👩', content: '好棒！记得连续观察三天哦', createdAt: t - D(1) },
    { id: 'c_5', postId: 'post_seed_4', authorName: '我', avatar: '🍼', content: '谢谢，明天试试加一点胡萝卜', createdAt: t - D(1) + H(1) }
  ]
  return { posts: posts, comments: comments }
}

/* ---------------- 本地快照 / 旧数据迁移 ---------------- */

function readLocal(key) {
  try { return wx.getStorageSync(key) || null } catch (e) { return null }
}
function writeLocal(key, value) {
  try { wx.setStorageSync(key, value) } catch (e) { console.warn('[baby-food] 本地快照写入失败') }
}
function saveCache() { writeLocal(CACHE_KEY, cache) }
function saveCommunity() { writeLocal(COMMUNITY_KEY, community) }

function stripMeta(doc) {
  const d = Object.assign({}, doc)
  delete d._id
  delete d._openid
  return d
}

/** 旧版本地数据 → 云数据（只在新用户首次上云时执行一次） */
function legacyPrivate(s) {
  const seed = seedPrivate()
  return {
    version: 2,
    user: s.user || null,
    babies: Array.isArray(s.babies) && s.babies.length ? s.babies : seed.babies,
    ingredientStates: s.ingredientStates || seed.ingredientStates,
    customIngredients: s.customIngredients || [],
    recipes: s.recipes || [],
    likes: s.likes || {},
    favorites: s.favorites || {},
    messages: s.messages || seed.messages
  }
}
function legacyCommunity(s) {
  const posts = (s.posts || []).map(function (p) {
    return Object.assign({}, p, {
      images: p.images || [],
      commentCount: p.commentCount || 0,
      createdAt: p.createdAt || now()
    })
  })
  return { posts: posts, comments: s.comments || [] }
}

function mergePrivate(doc) {
  const seed = seedPrivate()
  const out = Object.assign({}, seed, stripMeta(doc))
  // 补齐后续版本新增字段，避免旧文档缺字段导致白屏
  Object.keys(seed).forEach(function (k) {
    if (out[k] === undefined || out[k] === null) out[k] = seed[k]
  })
  return out
}

/* ---------------- 云端读写原语 ---------------- */

function isCloudMode() { return !offline && CLOUD.isReady() }
function ready() { return init() }

function assertWrite(res, kind) {
  if (!res) return res
  if (res.code || res.message) throw new Error(res.message || '云端写入被拒绝')
  const n = res.stats ? res.stats[kind] : res[kind]
  if (typeof n === 'number' && n === 0) {
    throw new Error('云端写入未生效，请检查集合权限')
  }
  return res
}

/** 小程序端单次 get 最多 20 条，这里分页拉全 */
function fetchAll(query, max) {
  const size = 20
  const limit = max || 100
  const out = []
  function page(n) {
    return query.skip(n * size).limit(size).get().then(function (res) {
      const rows = (res && res.data) || []
      rows.forEach(function (r) { out.push(stripMeta(r)) })
      if (rows.length === size && out.length < limit) return page(n + 1)
      return out
    })
  }
  return page(0)
}

function findPostDoc(id) {
  return CLOUD.db().collection(COL.POSTS).where({ id: id }).limit(1).get()
    .then(function (res) { return (res.data || [])[0] || null })
}

function bumpPost(id, field, delta) {
  if (!isCloudMode()) return Promise.resolve()
  return findPostDoc(id).then(function (doc) {
    if (!doc) return null
    const patch = {}
    patch[field] = CLOUD.command().inc(delta)
    return CLOUD.db().collection(COL.POSTS).doc(doc._id).update({ data: patch })
      .then(function (res) { return assertWrite(res, 'updated') })
  }).catch(function (err) {
    // 集合为 PRIVATE 时改不了别人的帖子计数：点赞状态仍存私有文档，不阻断交互
    console.warn('[baby-food] 帖子计数同步失败（本地状态已保留）：',
      err && (err.errCode || err.code || ''), err && (err.errMsg || err.message || ''))
    return null
  })
}

/** 是否属于「文档不属于当前用户 / 集合权限 / 集合不存在」这类可自愈的写入失败 */
function isRecoverableWriteError(err) {
  const code = Number(err && (err.errCode !== undefined ? err.errCode : err.code))
  if ([ -502001, -502003, -502005, -501009 ].indexOf(code) >= 0) return true
  return /权限|未生效|集合不存在|permission|denied|not exist|not found/i.test(
    String((err && (err.message || err.errMsg)) || '')
  )
}

/** 当前绑定的私有文档写不进去时，重新建一份属于当前 openid 的文档 */
function recreateStateDoc() {
  stateDocId = null
  writeLocal(STATE_DOC_KEY, '')
  return CLOUD.db().collection(COL.STATE).add({ data: Object.assign({}, cache) })
    .then(function (added) {
      stateDocId = added._id
      writeLocal(STATE_DOC_KEY, stateDocId)
      saveCache()
      pendingChanges = false
      return cache
    })
}

/** 云端写入最终失败：数据已在本地快照，标为待同步，不再把 UI 操作判为失败 */
function settleWriteFailure(err, bestEffort) {
  pendingChanges = true
  console.warn('[baby-food] 云端私有状态同步失败（本地快照已保留，下次启动自动补传）：',
    err && (err.errCode || err.code || ''), err && (err.errMsg || err.message || ''))
  if (!bestEffort) console.warn('[baby-food] 该操作按本地优先放行，云端稍后同步')
  return cache
}

/**
 * 提交私有状态变更：本地快照立即落地，云端尽力同步。
 * 云端故障（含 -502001）不再阻断登录、宝宝档案、食谱等本地操作。
 */
function commit(patch, bestEffort) {
  Object.assign(cache, patch)
  saveCache()
  if (!isCloudMode()) {
    pendingChanges = true
    return Promise.resolve(cache)
  }
  if (!stateDocId) {
    return recreateStateDoc().catch(function (err) { return settleWriteFailure(err, bestEffort) })
  }
  return CLOUD.db().collection(COL.STATE).doc(stateDocId).update({ data: patch })
    .then(function (res) { assertWrite(res, 'updated'); return cache })
    .catch(function (err) {
      // 读到他人文档 / 权限被拒时，换一份自己的文档重试一次（自愈串号与 -502001）
      if (isRecoverableWriteError(err)) {
        console.warn('[baby-food] 私有状态写入被拒，正在重建属于自己的文档：',
          err && (err.errCode || err.code || ''), err && (err.errMsg || err.message || ''))
        return recreateStateDoc().catch(function (e2) { return settleWriteFailure(e2, bestEffort) })
      }
      return settleWriteFailure(err, bestEffort)
    })
}

/** 启动后把离线期间的改动补传云端 */
function syncPending() {
  if (!pendingChanges || !isCloudMode() || !stateDocId) return Promise.resolve(false)
  return CLOUD.db().collection(COL.STATE).doc(stateDocId).update({ data: Object.assign({}, cache) })
    .then(function (res) { assertWrite(res, 'updated'); pendingChanges = false; return true })
    .catch(function (err) {
      console.warn('[baby-food] 离线改动补传失败，保留待同步标记：', err)
      return false
    })
}

function addMessage(msg) {
  const item = Object.assign({ id: U.uid('msg'), createdAt: now(), read: false, postId: '' }, msg)
  const messages = [item].concat(cache.messages || [])
  return commit({ messages: messages }, true)
}

/* ---------------- 启动：建文档 / 播种 / 迁移 ---------------- */

/**
 * 读取私有状态文档。
 * 优先用本地记住的 _id 精确取；取不到（换账号 / 文档被删 / 权限拒绝）就新建一份，
 * 避免误绑到别人的文档后每次写入都报 -502001。
 */
function loadOrCreateState(db, legacy) {
  const rememberedId = readLocal(STATE_DOC_KEY)

  function bind(doc) {
    stateDocId = doc._id
    writeLocal(STATE_DOC_KEY, stateDocId)
    cache = mergePrivate(doc)
    saveCache()
    return false
  }
  function create() {
    cache = legacy ? legacyPrivate(legacy) : seedPrivate()
    return db.collection(COL.STATE).add({ data: Object.assign({}, cache) })
      .then(function (added) {
        stateDocId = added._id
        writeLocal(STATE_DOC_KEY, stateDocId)
        writeLocal(MIGRATED_KEY, true)
        saveCache()
        return true
      })
  }
  function pickData(res) {
    const d = res && res.data
    return Array.isArray(d) ? d[0] : d
  }

  if (rememberedId) {
    return db.collection(COL.STATE).doc(rememberedId).get()
      .then(function (res) {
        const doc = pickData(res)
        return doc && doc._id ? bind(doc) : create()
      })
      .catch(function (err) {
        console.warn('[baby-food] 已绑定的私有文档不可读，改绑新文档：',
          err && (err.errCode || err.code || ''), err && (err.errMsg || err.message || ''))
        writeLocal(STATE_DOC_KEY, '')
        return create()
      })
  }
  return db.collection(COL.STATE).limit(1).get().then(function (res) {
    const docs = (res && res.data) || []
    const doc = Array.isArray(docs) ? docs[0] : docs
    return doc && doc._id ? bind(doc) : create()
  })
}

function bootstrap() {
  if (!CLOUD.isReady()) throw new Error('云开发未就绪')
  const db = CLOUD.db()
  const legacy = readLocal(MIGRATED_KEY) ? null : readLocal(LEGACY_KEY)

  return loadOrCreateState(db, legacy).then(function (fresh) {
    return db.collection(COL.POSTS).limit(1).get().then(function (res) {
      if ((res.data || []).length) return null
      const seed = (legacy && fresh) ? legacyCommunity(legacy) : seedCommunity()
      let chain = Promise.resolve()
      seed.posts.forEach(function (p) {
        chain = chain.then(function () { return db.collection(COL.POSTS).add({ data: p }) })
      })
      seed.comments.forEach(function (c) {
        chain = chain.then(function () { return db.collection(COL.COMMENTS).add({ data: c }) })
      })
      return chain.then(function () { return seed })
    })
  }).then(function (seed) {
    if (seed) {
      community = seed
      saveCommunity()
    }
    offline = false
    return cache
  })
}

function init() {
  if (initPromise) return initPromise
  // 包一层 Promise.resolve，确保 wx.cloud.database() 同步抛错时也能走离线兜底
  initPromise = Promise.resolve().then(bootstrap).catch(function (err) {
    console.warn('[baby-food] 云数据初始化失败，转入离线只读快照：',
      err && (err.errCode || err.code || ''), err && (err.errMsg || err.message || ''), err)
    offline = true
    cache = mergePrivate(readLocal(CACHE_KEY) || seedPrivate())
    const c = readLocal(COMMUNITY_KEY)
    community = c && c.posts ? c : seedCommunity()
    return cache
  }).then(function (c) {
    return syncPending().then(function () { return c })
  })
  return initPromise
}

/* ---------------- 用户与宝宝 ---------------- */

function getUser() { return ready().then(function () { return cache.user }) }

function saveUser(user) {
  // 登录只是记录展示用的昵称/头像，云端同步失败不应让用户登不进去
  return ready().then(function () {
    return commit({ user: Object.assign({}, user, { loginAt: now() }) }, true)
  }).then(function () { return cache.user })
}

function signOutUser() {
  return ready().then(function () { return commit({ user: null }, true) })
}

function getBabies() { return ready().then(function () { return (cache.babies || []).slice() }) }

function saveBaby(baby) {
  return ready().then(function () {
    const babies = (cache.babies || []).slice()
    if (baby.id) {
      const idx = babies.findIndex(function (b) { return b.id === baby.id })
      if (idx >= 0) babies[idx] = Object.assign({}, babies[idx], baby)
      else babies.push(baby)
    } else {
      babies.push(Object.assign({ id: U.uid('baby') }, baby))
    }
    return commit({ babies: babies })
  }).then(function () { return (cache.babies || []).slice() })
}

function removeBaby(id) {
  return ready().then(function () {
    const babies = cache.babies || []
    if (babies.length <= 1) return Promise.reject(new Error('至少保留一个宝宝档案'))
    return commit({ babies: babies.filter(function (b) { return b.id !== id }) })
  })
}

/* ---------------- 食材清单 ---------------- */

function getAllIngredients() {
  return ready().then(function () {
    return ING.INGREDIENTS.concat(cache.customIngredients || []).map(function (i) {
      return Object.assign({}, i, { status: (cache.ingredientStates || {})[i.id] || 'untried' })
    })
  })
}

function getIngredientStates() {
  return ready().then(function () { return Object.assign({}, cache.ingredientStates || {}) })
}

function setIngredientState(id, status) {
  return ready().then(function () {
    const states = Object.assign({}, cache.ingredientStates || {})
    states[id] = status
    return commit({ ingredientStates: states })
  }).then(function () { return Object.assign({}, cache.ingredientStates) })
}

/** 把所有食材状态清空为「未食用」（只动 ingredientStates，不影响宝宝/食谱/帖子） */
function clearIngredientStates() {
  return ready().then(function () {
    return commit({ ingredientStates: {} }, true)
  }).then(getAllIngredients)
}

function addCustomIngredient(item) {
  return ready().then(function () {
    const id = U.uid('custom')
    const list = (cache.customIngredients || []).slice()
    list.push({
      id: id, name: item.name, icon: item.icon || '🥣', category: 'other',
      minMonth: Number(item.minMonth) || 6, allergen: false,
      note: item.note || '自定义食材', status: 'untried'
    })
    const states = Object.assign({}, cache.ingredientStates || {})
    states[id] = 'untried'
    return commit({ customIngredients: list, ingredientStates: states })
  }).then(getAllIngredients)
}

/* ---------------- 帖子与互动 ---------------- */

function decoratePost(p) {
  const c = cache || seedPrivate()
  return Object.assign({}, p, {
    liked: !!(c.likes || {})[p.id],
    favorited: !!(c.favorites || {})[p.id],
    timeText: U.timeAgo(p.createdAt),
    coverStyle: U.gradientOf(p.coverSeed || p.id)
  })
}

/** 同一 id 只保留一条：不同 openid 各自播种时可能产生重复种子帖 */
function dedupePosts(list) {
  const seen = {}
  return (list || []).filter(function (p) {
    if (!p || !p.id || seen[p.id]) return false
    seen[p.id] = true
    return true
  })
}

function loadPosts() {
  if (!isCloudMode()) return Promise.resolve(dedupePosts(community.posts))
  return fetchAll(CLOUD.db().collection(COL.POSTS).orderBy('createdAt', 'desc'))
    .then(function (list) {
      community.posts = dedupePosts(list)
      saveCommunity()
      return community.posts.slice()
    })
    .catch(function (err) {
      // 云端读失败（权限 / 集合 / 网络）时退回缓存，页面照常渲染
      console.warn('[baby-food] 云端帖子读取失败，展示本地缓存：',
        err && (err.errCode || err.code || ''), err && (err.errMsg || err.message || ''))
      return dedupePosts(community.posts)
    })
}

function getPosts() {
  return ready().then(loadPosts).then(function (list) {
    return list.slice()
      .sort(function (a, b) { return b.createdAt - a.createdAt })
      .map(decoratePost)
  })
}

function getPost(id) {
  return getPosts().then(function (list) {
    return list.filter(function (x) { return x.id === id })[0] || null
  })
}

function addPost(input) {
  return ready().then(function () {
    if (!isCloudMode()) return Promise.reject(new Error('云端不可用，暂无法发布帖子'))
    const u = cache.user
    const post = {
      id: U.uid('post'),
      authorId: u ? u.nickName : 'cloud_user',
      authorName: u ? u.nickName : '我',
      authorAvatar: (u && u.avatarUrl && !u.isImageAvatar) ? u.avatarUrl : '🍼',
      isMine: true,
      title: input.title,
      content: input.content,
      coverEmoji: input.coverEmoji || '🍲',
      coverSeed: U.uid('cover'),
      recipeTitle: input.recipeTitle || '',
      tags: input.tags || [],
      images: input.images || [],
      audit: input.audit || null,
      likeCount: 0, commentCount: 0, favCount: 0,
      createdAt: now()
    }
    return CLOUD.db().collection(COL.POSTS).add({ data: post }).then(function () {
      community.posts = [post].concat(community.posts || [])
      saveCommunity()
      return addMessage({
        type: 'system', from: '辅食小助手', avatar: '✅',
        title: '帖子发布成功', desc: post.title, postId: post.id
      }).then(function () { return decoratePost(post) })
    })
  })
}

function toggleLike(id) {
  return ready().then(function () {
    const next = !(cache.likes || {})[id]
    const likes = Object.assign({}, cache.likes || {})
    likes[id] = next
    return Promise.all([
      commit({ likes: likes }, true),
      bumpPost(id, 'likeCount', next ? 1 : -1)
    ]).then(function () {
      if (next) {
        return addMessage({
          type: 'like', from: '我', avatar: '❤️',
          title: '你赞了一篇帖子', desc: '', postId: id
        }).then(function () { return next })
      }
      return next
    })
  })
}

function toggleFavorite(id) {
  return ready().then(function () {
    const next = !(cache.favorites || {})[id]
    const favorites = Object.assign({}, cache.favorites || {})
    favorites[id] = next
    return Promise.all([
      commit({ favorites: favorites }, true),
      bumpPost(id, 'favCount', next ? 1 : -1)
    ]).then(function () {
      if (next) {
        return addMessage({
          type: 'favorite', from: '我', avatar: '⭐',
          title: '你收藏了一篇帖子', desc: '', postId: id
        }).then(function () { return next })
      }
      return next
    })
  })
}

function loadComments() {
  if (!isCloudMode()) return Promise.resolve((community.comments || []).slice())
  return fetchAll(CLOUD.db().collection(COL.COMMENTS)).then(function (list) {
    community.comments = list
    saveCommunity()
    return list.slice()
  }).catch(function (err) {
    console.warn('[baby-food] 云端评论读取失败，展示本地缓存：',
      err && (err.errCode || err.code || ''), err && (err.errMsg || err.message || ''))
    return (community.comments || []).slice()
  })
}

function getComments(postId) {
  return ready().then(loadComments).then(function (list) {
    return list.filter(function (c) { return c.postId === postId })
      .sort(function (a, b) { return a.createdAt - b.createdAt })
      .map(function (c) { return Object.assign({}, c, { timeText: U.timeAgo(c.createdAt) }) })
  })
}

function addComment(postId, text) {
  return ready().then(function () {
    if (!isCloudMode()) return Promise.reject(new Error('云端不可用，暂无法发表评论'))
    const u = cache.user
    const c = {
      id: U.uid('comment'), postId: postId,
      authorName: u ? u.nickName : '我',
      avatar: (u && u.avatarUrl && !u.isImageAvatar) ? u.avatarUrl : '🍼',
      content: text, createdAt: now(), isMine: true
    }
    return CLOUD.db().collection(COL.COMMENTS).add({ data: c })
      .then(function () {
        community.comments = (community.comments || []).concat([c])
        saveCommunity()
        return bumpPost(postId, 'commentCount', 1)
      })
      .then(function () {
        return addMessage({
          type: 'comment', from: '我', avatar: '💬',
          title: '你评论了一篇帖子', desc: text, postId: postId
        })
      })
      .then(function () { return Object.assign({}, c, { timeText: '刚刚' }) })
  })
}

/* ---------------- 消息 ---------------- */

function getMessages() {
  return ready().then(function () {
    return (cache.messages || []).slice()
      .sort(function (a, b) { return b.createdAt - a.createdAt })
      .map(function (m) { return Object.assign({}, m, { timeText: U.timeAgo(m.createdAt) }) })
  })
}

function unreadCount() {
  return (cache && cache.messages ? cache.messages : []).filter(function (m) { return !m.read }).length
}

function markMessageRead(id) {
  return ready().then(function () {
    const messages = (cache.messages || []).map(function (m) {
      return m.id === id ? Object.assign({}, m, { read: true }) : m
    })
    return commit({ messages: messages }, true)
  })
}

function markAllRead() {
  return ready().then(function () {
    const messages = (cache.messages || []).map(function (m) {
      return Object.assign({}, m, { read: true })
    })
    return commit({ messages: messages }, true)
  })
}

/* ---------------- 食谱 ---------------- */

function getRecipes() { return ready().then(function () { return (cache.recipes || []).slice() }) }

function getRecipe(id) {
  return ready().then(function () {
    return (cache.recipes || []).filter(function (r) { return r.id === id })[0] || null
  })
}

function saveRecipe(recipe) {
  return ready().then(function () {
    const list = (cache.recipes || []).slice()
    const idx = list.findIndex(function (r) { return r.id === recipe.id })
    if (idx >= 0) list[idx] = recipe
    else list.unshift(recipe)
    return commit({ recipes: list })
  }).then(function () { return recipe })
}

function deleteRecipe(id) {
  return ready().then(function () {
    return commit({ recipes: (cache.recipes || []).filter(function (r) { return r.id !== id }) })
  })
}

/* ---------------- 汇总 / 重置 ---------------- */

function getSummary() {
  return ready().then(loadPosts).then(function (posts) {
    const fav = Object.keys(cache.favorites || {}).filter(function (k) { return cache.favorites[k] }).length
    const normal = Object.keys(cache.ingredientStates || {}).filter(function (k) { return cache.ingredientStates[k] === 'normal' }).length
    const allergy = Object.keys(cache.ingredientStates || {}).filter(function (k) { return cache.ingredientStates[k] === 'allergy' }).length
    return {
      postCount: posts.filter(function (p) { return p.isMine }).length,
      favCount: fav,
      recipeCount: (cache.recipes || []).length,
      normalCount: normal,
      allergyCount: allergy,
      unread: unreadCount(),
      totalIngredients: ING.INGREDIENTS.length + (cache.customIngredients || []).length
    }
  })
}

/** 只重置「我」的私有状态，社区帖子是共享数据，不动别人的内容 */
function resetAll() {
  return ready().then(function () {
    return commit(Object.assign({}, seedPrivate()), true)
  }).then(function () { return cache })
}

module.exports = {
  init: init,
  isCloudMode: isCloudMode,
  hasPendingChanges: function () { return pendingChanges },
  getUser: getUser, saveUser: saveUser, signOutUser: signOutUser,
  getBabies: getBabies, saveBaby: saveBaby, removeBaby: removeBaby,
  getAllIngredients: getAllIngredients, getIngredientStates: getIngredientStates,
  setIngredientState: setIngredientState, clearIngredientStates: clearIngredientStates,
  addCustomIngredient: addCustomIngredient,
  getPosts: getPosts, getPost: getPost, addPost: addPost,
  toggleLike: toggleLike, toggleFavorite: toggleFavorite,
  getComments: getComments, addComment: addComment,
  getMessages: getMessages, unreadCount: unreadCount,
  markMessageRead: markMessageRead, markAllRead: markAllRead,
  getRecipes: getRecipes, getRecipe: getRecipe, saveRecipe: saveRecipe, deleteRecipe: deleteRecipe,
  getSummary: getSummary, resetAll: resetAll,
  _seedState: function () {
    const c = seedCommunity()
    return Object.assign({}, seedPrivate(), { posts: c.posts, comments: c.comments })
  }
}
