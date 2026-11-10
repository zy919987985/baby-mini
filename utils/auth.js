/**
 * 授权登录封装：统一管理登录态，以及「需要登录才能继续」的拦截。
 *
 * 设计目标：
 *  - 未登录的用户只能浏览帖子（首页信息流），其余任何写操作 / 个人页都需要先登录。
 *  - 页面只需在 wxml 末尾放一个 <auth-modal /> 组件，登录弹层即自动可用。
 *
 * 常用 API：
 *  - auth.isLoggedIn()            同步判断是否已登录（用于页面级「登录后查看」遮罩）
 *  - auth.requireLogin()          返回 Promise：已登录直接 resolve(user)，否则弹出登录框，
 *                                 登录成功后 resolve(user)。多个并发调用复用同一弹层。
 *  - auth.guard(fn)               把任意操作包成「先登录再执行」；用户取消登录时静默放弃。
 *  - auth.login(user) / logout()  写入 / 清除登录态并放行 / 驳回等待中的操作。
 *  - auth.getCloudAccount()       当前 WorkBuddy 云服务真实会话（未同步时为 null）。
 *
 * 云端身份是渐进增强：登录成功后异步建立真实会话，不阻塞登录弹层关闭；
 * 云端失败只记录日志，本地昵称登录照常可用，但绝不伪造会话。
 */
const store = require('./store')
const account = require('./workbuddy-account')

// undefined: 初始化中；null: 未登录；object: 已登录（user 对象）
let currentUser = undefined
// 当前存活的 auth-modal 实例栈，最后一个为当前页面（支持页面跳转嵌套）
const modals = []
// 等待登录完成的 Promise resolve 列表（requireLogin 的 pending）
let resolvers = []

/* ---------------- 登录态读取 ---------------- */

function init() {
  return store.getUser().then(function (u) {
    currentUser = u || null
    // 冷启动恢复云端真实会话；失败不阻断启动，也不影响本地登录态
    account.restore().catch(function (err) {
      console.warn('[baby-food] 云端账号会话恢复失败（不影响本地登录）：',
        err && err.message)
    })
    return currentUser
  }).catch(function () {
    currentUser = null
    return null
  })
}

// 重新从 store 读取（登录 / 退出后修正内存缓存）
function refresh() {
  return store.getUser().then(function (u) {
    currentUser = u || null
    return currentUser
  }).catch(function () { return currentUser })
}

function isLoggedIn() { return !!currentUser }
function getUser() { return currentUser || null }

/* ---------------- 组件注册（由 auth-modal 调用） ---------------- */

function registerModal(m) {
  const i = modals.indexOf(m)
  if (i < 0) modals.push(m)
}
function unregisterModal(m) {
  const i = modals.indexOf(m)
  if (i >= 0) modals.splice(i, 1)
}
function openModal() {
  const m = modals[modals.length - 1]
  if (m && typeof m.open === 'function') m.open()
}

function resolveAll(user) {
  const list = resolvers
  resolvers = []
  list.forEach(function (r) { r.resolve(user) })
}
function rejectAll(err) {
  const list = resolvers
  resolvers = []
  list.forEach(function (r) { r.reject(err) })
}

/* ---------------- 对外拦截 API ---------------- */

/**
 * 确保已登录。返回 Promise：
 *  - 已登录：resolve(user)
 *  - 未登录：弹出登录框，登录成功后 resolve(user)
 *  - 用户取消：reject(Error('已取消登录'))
 */
function requireLogin() {
  return Promise.resolve().then(function () {
    if (currentUser === undefined) return refresh()
  }).then(function () {
    if (isLoggedIn()) return currentUser
    return new Promise(function (resolve, reject) {
      resolvers.push({ resolve: resolve, reject: reject })
      openModal()
    })
  })
}

/**
 * 登录成功：写库并放行所有等待中的操作。
 * 随后异步建立 WorkBuddy 云服务真实会话（不 await，避免网络慢时登录弹层关不掉）。
 */
function login(user) {
  return store.saveUser(user).then(function (saved) {
    currentUser = saved
    resolveAll(saved)
    account.signIn().catch(function (err) {
      console.warn('[baby-food] 云端账号建立失败（不影响本地登录）：',
        err && err.message)
    })
    return saved
  })
}

/** 取消登录：驳回所有等待中的操作 */
function cancelLogin() {
  rejectAll(new Error('已取消登录'))
}

function logout() {
  return store.signOutUser().then(function () {
    currentUser = null
    account.signOut().catch(function (err) {
      console.warn('[baby-food] 云端账号退出失败：', err && err.message)
    })
    return null
  })
}

/**
 * 页面级拦截助手：根据登录态设置 page.data.__locked，返回是否锁定。
 * 建议放在 onShow 开头：未登录时页面只渲染「登录后查看」遮罩。
 */
function syncLock(page) {
  const locked = !isLoggedIn()
  if (page && typeof page.setData === 'function') page.setData({ __locked: locked })
  return locked
}

/**
 * 把函数包成「先登录再执行」。用于任何写操作：
 *   onLike: auth.guard(function (e) { ... }),
 * 用户取消登录时静默放弃（不抛错、不打 toast）；其余异常由原函数自身 catch 处理。
 */
function guard(fn) {
  return function () {
    const self = this
    const args = arguments
    return requireLogin().then(function () {
      return fn.apply(self, args)
    }).catch(function (err) {
      if (err && err.message === '已取消登录') return
      throw err
    })
  }
}

module.exports = {
  init: init,
  refresh: refresh,
  isLoggedIn: isLoggedIn,
  getUser: getUser,
  requireLogin: requireLogin,
  login: login,
  logout: logout,
  cancelLogin: cancelLogin,
  registerModal: registerModal,
  unregisterModal: unregisterModal,
  syncLock: syncLock,
  guard: guard,
  getCloudAccount: function () { return account.currentSession() }
}
