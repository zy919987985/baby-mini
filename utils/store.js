/**
 * 数据仓库（云开发版）
 * ------------------------------------------------------------------
 * 所有数据落在微信云开发，不再依赖 wx.setStorageSync 作为主存储：
 *   bf_user_state  —— 私有状态，每个 openid 一个文档（权限 PRIVATE）
 *   bf_posts       —— 社区帖子，全局共享（权限 CUSTOM: read/write true）
 *   bf_comments    —— 评论，全局共享（权限 CUSTOM: read/write true）
 *   云存储桶        —— 帖子图片，存 cloud:// fileID（权限 READONLY）
 *
 * 社区数据（帖子 / 评论）全部由云端维护：新增、修改、删除都在云开发控制台
 * 或后台完成，小程序端不内置任何演示数据、也不会自动往云端灌数据。
 * 对外暴露的仍然是原来那套「全部返回 Promise」的接口，页面代码零改动。
 * 帖子列表有两条读取路径：
 *   getPosts()      全量（≤100 条），保留给需要整表的地方；
 *   getPostPage()   云端 keyset 游标分页，一页 10 条，首页专用，无 skip 深分页。
 * 本地 Storage 只做两件事：
 *   1) 离线只读快照（缓存云端已加载的内容，不产生新数据）
 *   2) 首次上云时把旧版 baby_food_state_v1 的数据迁移到云端（只迁一次）
 * ------------------------------------------------------------------
 */
const U = require('./util')
const ING = require('./ingredients')
const CLOUD = require('./cloud')
const COL = require('./collections')

// 首页云端游标分页的每页条数，与 utils/virtual-list.js 的 PAGE_SIZE 保持一致
const POST_PAGE_SIZE = 10
const CACHE_KEY = 'baby_food_cloud_cache_v2'
// v2 快照里存过客户端内置的演示帖 / 演示评论，换 key 让它自然失效；
// v3 只缓存云端真实读取到的内容。
const COMMUNITY_KEY = 'baby_food_cloud_community_v3'
const LEGACY_KEY = 'baby_food_state_v1'
const MIGRATED_KEY = 'baby_food_migrated_v2'
// 记住「属于当前 openid 的私有文档 _id」，避免换账号后误绑到别人的文档
const STATE_DOC_KEY = 'baby_food_state_doc_v2'

function now() { return Date.now() }
function D(n) { return n * 86400000 }

let initPromise = null
let stateDocId = null
let myOpenid = null                               // 当前账号的 openid（从私有状态文档读取）
let offline = false
let cache = null                                  // 私有状态快照
let community = { posts: [], comments: [] }       // 社区内容快照
let pendingChanges = false                        // 离线期间的改动未同步

/* ---------------- 默认私有状态 ---------------- */

function seedPrivate() {
  return {
    version: 2,
    user: null,
    // 稳定的账号标识：登录时生成一次，退出登录不清空，用于判定「帖子是不是我发的」。
    // 不能放在 user 里，否则 logout 后重新登录会换 uid，历史帖子就认不回来了。
    accountUid: '',
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

/**
 * 社区内容没有本地初始数据源，全部来自云端 bf_posts / bf_comments。
 * community 只在云端读取成功后写入离线只读快照；云端首次就不可用时它是空列表，
 * 首页会显示空状态，不会凭空造出演示数据。
 */

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

/**
 * 共享集合（帖子 / 评论）额外保留归属 openid，仅用于「是不是我的」判定。
 * 改名为 _owner，避免下划线系统字段被误写回云端。
 */
function withOwner(doc) {
  const d = stripMeta(doc)
  if (doc && doc._openid) d._owner = doc._openid
  return d
}

/** 云端若残留历史演示内容，也不属于任何真实账号，永远不算「我的」 */
function isSeedContent(item) {
  if (!item) return true
  if (item.isSeed === true) return true
  const id = String(item.id || '')
  return id.indexOf('post_seed_') === 0 || /^c_\d+$/.test(id)
}

function currentUid() { return (cache && cache.accountUid) || '' }

/**
 * 帖子 / 评论是否属于当前账号。
 * 绝不能信任文档里写死的 isMine：那是发布瞬间的静态标记，而社区集合是全端共享的，
 * 别的账号读到同样会被当成自己的（新账号因此在「我的帖子」里看到别人的 3 条帖子）。
 * 判定优先级：稳定账号 uid → 云端文档归属 openid；两者都拿不到就不算。
 */
function isMineContent(item) {
  if (!item || isSeedContent(item)) return false
  const uid = currentUid()
  if (uid && item.authorUid) return item.authorUid === uid
  if (myOpenid && item._owner) return item._owner === myOpenid
  return false
}

/** 旧版本地数据 → 云数据（只在新用户首次上云时执行一次） */
function legacyPrivate(s) {
  const seed = seedPrivate()
  return {
    version: 2,
    user: s.user || null,
    accountUid: '',
    babies: Array.isArray(s.babies) && s.babies.length ? s.babies : seed.babies,
    ingredientStates: s.ingredientStates || seed.ingredientStates,
    customIngredients: s.customIngredients || [],
    recipes: s.recipes || [],
    likes: s.likes || {},
    favorites: s.favorites || {},
    messages: s.messages || seed.messages
  }
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
      rows.forEach(function (r) { out.push(withOwner(r)) })
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
    const _ = CLOUD.command()
    const patch = {}
    patch[field] = _.inc(delta)
    // 历史兼容字段 hotScore 仍随互动原子累加（首页已改为按时间排序，不再读它）。
    // 用 inc 原子更新，避免多人同时点赞时读-改-写丢更新。
    patch.hotScore = _.inc(field === 'favCount' ? delta * 2 : delta)
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

/* ---------------- 启动：建文档 / 迁移 ---------------- */

/**
 * 读取私有状态文档。
 * 优先用本地记住的 _id 精确取；取不到（换账号 / 文档被删 / 权限拒绝）就新建一份，
 * 避免误绑到别人的文档后每次写入都报 -502001。
 */
function loadOrCreateState(db, legacy) {
  const rememberedId = readLocal(STATE_DOC_KEY)

  function bind(doc) {
    stateDocId = doc._id
    // 私有文档的系统 _openid 即当前账号身份，用于判定共享帖子的归属
    myOpenid = doc._openid || null
    writeLocal(STATE_DOC_KEY, stateDocId)
    cache = mergePrivate(doc)
    saveCache()
    return false
  }
  function create() {
    cache = legacy ? legacyPrivate(legacy) : seedPrivate()
    myOpenid = null
    return db.collection(COL.STATE).add({ data: Object.assign({}, cache) })
      .then(function (added) {
        stateDocId = added._id
        writeLocal(STATE_DOC_KEY, stateDocId)
        writeLocal(MIGRATED_KEY, true)
        saveCache()
        // 新建文档的系统 _openid 只写在云端，读回一次（失败不阻断启动）
        return db.collection(COL.STATE).doc(added._id).get()
          .then(function (res) {
            const d = pickData(res)
            myOpenid = (d && d._openid) || null
          })
          .catch(function () { myOpenid = null })
      })
      .then(function () { return true })
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

/**
 * 启动只负责私有状态文档（建/读 + 旧版本地数据迁移）。
 * 社区内容完全由云端提供，这里不写入、不补齐任何帖子或评论。
 * 云端不可用时 init() 的 catch 转入离线只读快照模式。
 */
function bootstrap() {
  if (!CLOUD.isReady()) throw new Error('云开发未就绪')
  const db = CLOUD.db()
  const legacy = readLocal(MIGRATED_KEY) ? null : readLocal(LEGACY_KEY)

  return loadOrCreateState(db, legacy).then(function () {
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
    // 没有云端数据时只能用「曾经真实加载过」的快照；没有就保持空列表，
    // 绝不再用内置演示内容填充。
    const c = readLocal(COMMUNITY_KEY)
    community = c ? {
      posts: Array.isArray(c.posts) ? c.posts : [],
      comments: Array.isArray(c.comments) ? c.comments : []
    } : { posts: [], comments: [] }
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
    const patch = { user: Object.assign({}, user, { loginAt: now() }) }
    // 账号 uid 只生成一次，退出登录后重新登录仍认得回自己发过的帖子
    if (!cache.accountUid) patch.accountUid = U.uid('acct')
    return commit(patch, true)
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
  const d = Object.assign({}, p, {
    liked: !!(c.likes || {})[p.id],
    favorited: !!(c.favorites || {})[p.id],
    timeText: U.timeAgo(p.createdAt),
    coverStyle: U.gradientOf(p.coverSeed || p.id),
    // 首页「我的」标签按当前账号动态计算，不读文档里写死的 isMine
    isMine: isMineContent(p)
  })
  delete d._owner
  return d
}

/** 同一 id 只保留一条：云端历史数据或多份快照合并时可能出现重复文档 */
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

/* ---------------- 云端游标分页（首页专用） ---------------- */

/**
 * 首页只剩「最新 / 我的收藏」两个筛选，两者都按发布时间倒序。
 * 保留这个函数让 buildPageWhere / localPostPage / getPostPage 共用同一排序列来源；
 * hotScore 仍会写入云端作为历史兼容字段，但不再参与任何排序。
 */
function sortFieldOf() {
  return 'createdAt'
}

function postSortId(p) {
  return String((p && (p.sortId || p.id)) || '')
}

function postScore(p) {
  return (Number(p && p.likeCount) || 0) + (Number(p && p.favCount) || 0) * 2
}

/**
 * keyset 游标条件：严格排在「上一页最后一条」之后。
 *   (排序值 < last.value) OR (排序值 == last.value AND sortId < last.sortId)
 * sortId 是业务 id 的副本（唯一且稳定），既避开系统 _id 依赖，也让离线兜底
 * 与云端用同一套游标；收藏筛选把 id: _.in(ids) 复制进每个分支，
 * 从而避开同一字段上 in / lt 两个命令冲突。
 * 不用 skip：深分页不会越翻越慢，也不会因插入新帖而错位。
 */
function buildPageWhere(_, filter, favoriteIds, cursor) {
  const field = sortFieldOf()
  const base = {}
  if (filter === '收藏') base.id = _.in(favoriteIds || [])
  if (!cursor) return Object.keys(base).length ? base : null

  const a = Object.assign({}, base)
  a[field] = _.lt(cursor.value)
  const b = Object.assign({}, base)
  b[field] = cursor.value
  b.sortId = _.lt(cursor.sortId)
  return _.or([a, b])
}

function cursorOf(row, field) {
  return { value: row[field], sortId: postSortId(row) }
}

function decorateRows(rows) {
  return (rows || []).map(function (r) { return decoratePost(withOwner(r)) })
}

/** 离线兜底：本地快照补齐派生字段后，按与云端完全相同的规则排序 + 游标切片 */
function localPostPage(filter, favoriteIds, cursor, limit) {
  const field = sortFieldOf()
  const ids = {}
  ;(favoriteIds || []).forEach(function (id) { ids[id] = true })

  let list = dedupePosts(community.posts).map(function (p) {
    return Object.assign({}, p, {
      hotScore: typeof p.hotScore === 'number' ? p.hotScore : postScore(p),
      sortId: postSortId(p)
    })
  })
  if (filter === '收藏') list = list.filter(function (p) { return ids[p.id] })
  list.sort(function (x, y) {
    if (y[field] !== x[field]) return y[field] - x[field]
    return y.sortId < x.sortId ? -1 : (y.sortId > x.sortId ? 1 : 0)
  })

  // 列表是降序：跳过所有「排在游标之前或与游标相同」的条目，
  // 第一个严格排在游标之后的条目就是下一页起点（与云端 _.lt 同义）。
  // 首页（cursor 为空）从第 0 条开始。
  let start = 0
  if (cursor) {
    start = list.length
    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      const beforeOrAt = p[field] > cursor.value ||
        (p[field] === cursor.value && p.sortId >= cursor.sortId)
      if (!beforeOrAt) { start = i; break }
    }
  }

  const window = list.slice(start, start + limit + 1)
  const hasMore = window.length > limit
  const page = window.slice(0, limit)
  const next = hasMore && page.length
    ? { value: page[page.length - 1][field], sortId: page[page.length - 1].sortId }
    : null
  return { list: decorateRows(page), cursor: next, hasMore: hasMore }
}

/**
 * 首页列表数据源：云端游标分页，一页 10 条。
 * 返回 { list, cursor, hasMore }；把 cursor 原样传给下一次调用即可翻页。
 * 云端不可用（离线 / 权限 / 集合或索引缺失）时自动降级为同规则的本地快照分页。
 *
 * 注意：游标是排序快照，按 createdAt 取页。会话期间有新帖发布会让排序轻微变化，
 * 下拉刷新重置游标即可拿到最新顺序（互动计数不再影响排序）。
 */
function getPostPage(options) {
  const o = options || {}
  const filter = o.filter || '最新'
  const limit = Math.max(1, Number(o.limit) || POST_PAGE_SIZE)
  const cursor = o.cursor || null
  const favoriteIds = o.favoriteIds || []
  const field = sortFieldOf()

  return ready().then(function () {
    if (filter === '收藏' && !favoriteIds.length) {
      return { list: [], cursor: null, hasMore: false }
    }
    if (!isCloudMode()) {
      console.info('[baby-food] 离线模式，首页分页使用本地快照（' +
        dedupePosts(community.posts).length + ' 条）')
      return localPostPage(filter, favoriteIds, cursor, limit)
    }

    let q
    try {
      const _ = CLOUD.command()
      const col = CLOUD.db().collection(COL.POSTS)
      const where = buildPageWhere(_, filter, favoriteIds, cursor)
      q = (where ? col.where(where) : col)
        .orderBy(field, 'desc').orderBy('sortId', 'desc').limit(limit + 1)
    } catch (e) {
      return localPostPage(filter, favoriteIds, cursor, limit)
    }

    return q.get().then(function (res) {
      const rows = (res && res.data) || []
      const hasMore = rows.length > limit
      const page = rows.slice(0, limit)
      const next = hasMore && page.length ? cursorOf(page[page.length - 1], field) : null
      // 第一页写一份离线快照，云端挂了还能看到已加载过的内容。
      // 直接替换而非 concat，避免把任何历史演示数据混进快照。
      if (page.length && !cursor) {
        community.posts = dedupePosts(page.map(withOwner))
        saveCommunity()
      }
      // 诊断：只有 10 条却显示「已全部加载」时，一眼看出云端实际返回多少
      console.info('[baby-food] 分页 ' + filter + (cursor ? '（续页）' : '（首屏）') +
        '：云端返回 ' + rows.length + ' 条，取 ' + page.length + ' 条，hasMore=' + hasMore)
      return { list: decorateRows(page), cursor: next, hasMore: hasMore }
    }).catch(function (err) {
      console.warn('[baby-food] 云端分页读取失败，改用本地快照（' +
        dedupePosts(community.posts).length + ' 条）：',
        err && (err.errCode || err.code || ''), err && (err.errMsg || err.message || ''))
      return localPostPage(filter, favoriteIds, cursor, limit)
    })
  })
}

/** 当前账号收藏的帖子 id（私有状态文档，供「收藏」筛选下推到云端） */
function getFavoriteIds() {
  return ready().then(function () {
    const fav = (cache && cache.favorites) || {}
    return Object.keys(fav).filter(function (k) { return !!fav[k] })
  })
}

/** 用当前私有状态重装饰已有列表：软刷新零网络请求、保持滚动位置 */
function decoratePosts(list) {
  return (list || []).map(decoratePost)
}

/** 详情页按 id 直查单条，不再为了找一条帖子把整个集合拉回来 */
function getPost(id) {
  return ready().then(function () {
    const local = function () {
      const hit = dedupePosts(community.posts).filter(function (p) { return p.id === id })[0]
      return hit ? decoratePost(hit) : null
    }
    if (!isCloudMode()) return local()
    return findPostDoc(id).then(function (doc) {
      return doc ? decoratePost(withOwner(doc)) : local()
    }).catch(function (err) {
      console.warn('[baby-food] 帖子详情读取失败，改用本地快照：',
        err && (err.errMsg || err.message || ''))
      return local()
    })
  })
}

function addPost(input) {
  return ready().then(function () {
    if (!isCloudMode()) return Promise.reject(new Error('云端不可用，暂无法发布帖子'))
    const u = cache.user
    const postId = U.uid('post')
    const post = {
      id: postId,
      authorId: u ? u.nickName : 'cloud_user',
      authorName: u ? u.nickName : '我',
      authorAvatar: (u && u.avatarUrl && !u.isImageAvatar) ? u.avatarUrl : '🍼',
      authorUid: currentUid(),
      title: input.title,
      content: input.content,
      coverEmoji: input.coverEmoji || '🍲',
      coverSeed: U.uid('cover'),
      recipeTitle: input.recipeTitle || '',
      tags: input.tags || [],
      images: input.images || [],
      audit: input.audit || null,
      likeCount: 0, commentCount: 0, favCount: 0,
      createdAt: now(),
      // 云端游标分页的排序列 + tiebreaker，缺了新帖会永远排在列表末尾
      hotScore: 0,
      sortId: postId
    }
    return CLOUD.db().collection(COL.POSTS).add({ data: post }).then(function () {
      // 云端文档由平台补 _openid；本地快照同步补一份归属，离线时也能判定
      const local = Object.assign({}, post, myOpenid ? { _owner: myOpenid } : {})
      community.posts = [local].concat(community.posts || [])
      saveCommunity()
      return addMessage({
        type: 'system', from: '辅食小助手', avatar: '✅',
        title: '帖子发布成功', desc: post.title, postId: post.id
      }).then(function () { return decoratePost(local) })
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
      .map(function (c) {
        const d = Object.assign({}, c, {
          timeText: U.timeAgo(c.createdAt),
          isMine: isMineContent(c)
        })
        delete d._owner
        return d
      })
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
      authorUid: currentUid(),
      content: text, createdAt: now()
    }
    return CLOUD.db().collection(COL.COMMENTS).add({ data: c })
      .then(function () {
        const local = Object.assign({}, c, myOpenid ? { _owner: myOpenid } : {})
        community.comments = (community.comments || []).concat([local])
        saveCommunity()
        return bumpPost(postId, 'commentCount', 1)
      })
      .then(function () {
        return addMessage({
          type: 'comment', from: '我', avatar: '💬',
          title: '你评论了一篇帖子', desc: text, postId: postId
        })
      })
      .then(function () {
        return Object.assign({}, c, { timeText: '刚刚', isMine: isMineContent(c) })
      })
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

/**
 * 「我的帖子」数量：改用云端 count()，不再把整个集合拉回来数。
 * 只按稳定账号 uid 统计，不带 authorUid 的历史内容天然不会被误算成我的。
 * 没有 uid 时返回 0，而不是退回去按 _openid 猜（那样会把不属于当前
 * 账号的内容一并统计进去）。
 */
function myPostCount() {
  const uid = currentUid()
  return ready().then(function () {
    if (!isCloudMode()) return dedupePosts(community.posts).filter(isMineContent).length
    if (!uid) return 0
    return CLOUD.db().collection(COL.POSTS).where({ authorUid: uid }).count()
      .then(function (res) { return (res && res.total) || 0 })
      .catch(function () { return 0 })
  })
}

function getSummary() {
  return myPostCount().then(function (postCount) {
    const fav = Object.keys(cache.favorites || {}).filter(function (k) { return cache.favorites[k] }).length
    const normal = Object.keys(cache.ingredientStates || {}).filter(function (k) { return cache.ingredientStates[k] === 'normal' }).length
    const allergy = Object.keys(cache.ingredientStates || {}).filter(function (k) { return cache.ingredientStates[k] === 'allergy' }).length
    return {
      postCount: postCount,
      favCount: fav,
      recipeCount: (cache.recipes || []).length,
      normalCount: normal,
      allergyCount: allergy,
      unread: unreadCount(),
      totalIngredients: ING.INGREDIENTS.length + (cache.customIngredients || []).length
    }
  })
}

/**
 * 首页头部只需要未读数。单独给一个不碰帖子集合的入口，
 * 避免首页每次刷新都经 getSummary() 触发一次全表读取，
 * 把云端游标分页的意义抵消掉。
 */
function getHomeSummary() {
  return ready().then(function () {
    return { unread: unreadCount() }
  })
}

/** 只重置「我」的私有状态，社区帖子是共享数据，不动别人的内容 */
function resetAll() {
  return ready().then(function () {
    const fresh = Object.assign({}, seedPrivate())
    // 重置的是个人记录，账号身份要保留，否则已发布的帖子会认不回来
    fresh.accountUid = (cache && cache.accountUid) || ''
    return commit(fresh, true)
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
  getPostPage: getPostPage, getFavoriteIds: getFavoriteIds, decoratePosts: decoratePosts,
  toggleLike: toggleLike, toggleFavorite: toggleFavorite,
  getComments: getComments, addComment: addComment,
  getMessages: getMessages, unreadCount: unreadCount,
  markMessageRead: markMessageRead, markAllRead: markAllRead,
  getRecipes: getRecipes, getRecipe: getRecipe, saveRecipe: saveRecipe, deleteRecipe: deleteRecipe,
  getSummary: getSummary, getHomeSummary: getHomeSummary, resetAll: resetAll
}
