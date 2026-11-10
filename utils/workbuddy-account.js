/**
 * WorkBuddy 云服务 · 真实账号身份
 * ------------------------------------------------------------------
 * 用 wx.login 的 code 换取云服务会话，为「宝宝辅食」提供可跨设备识别的真实身份。
 * 渐进增强：本地昵称登录（utils/auth.js）仍是主流程，云端失败只记录、不阻断登录；
 * 但绝不伪造 session —— 任何失败都把 session 置空并给出明确原因。
 * 端上不保存 code / token / openid 作为身份凭据，会话由 SDK 管理。
 * ------------------------------------------------------------------
 */
const { getCloud } = require('./workbuddy-cloud')

let session = null

function auth() { return getCloud().auth }

function msgOf(err, fallback) {
  return (err && err.message) || fallback
}

/** 把平台/网络错误翻译成用户能看懂的一句话，不吞掉原始原因 */
function normalize(err) {
  const msg = msgOf(err, '云服务暂时不可用，请稍后重试')
  if (/合法域名|url not in domain|domain list/i.test(msg)) {
    return new Error('云服务网关未加入小程序 request 合法域名，请在小程序后台配置后重试')
  }
  if (/network|request:fail|timeout|超时|SDK 未就绪/i.test(msg)) {
    return new Error('云端账号暂不可用（' + msg + '），本地功能不受影响')
  }
  return new Error(msg)
}

function loginCode() {
  return new Promise(function (resolve, reject) {
    if (typeof wx === 'undefined' || typeof wx.login !== 'function') {
      reject(new Error('当前环境不支持微信登录'))
      return
    }
    try {
      wx.login({
        success: function (res) {
          if (!res || !res.code) { reject(new Error('微信登录未返回 code')); return }
          resolve(res.code)
        },
        fail: function (err) {
          reject(new Error((err && err.errMsg) || '微信登录失败，请重试'))
        }
      })
    } catch (e) {
      reject(new Error(msgOf(e, '微信登录失败，请重试')))
    }
  })
}

/** 当前运行时的真实 AppID（试用版与正式版不同），不能写死、不能用 wbapp_ 代替 */
function runtimeAppid() {
  try {
    const info = wx.getAccountInfoSync()
    return (info && info.miniProgram && info.miniProgram.appId) || ''
  } catch (e) {
    return ''
  }
}

/** 冷启动恢复已有会话；没有会话是正常的未登录状态，不算失败 */
function restore() {
  return Promise.resolve().then(function () {
    return auth().getSession()
  }).then(function (r) {
    if (r && r.error) throw new Error(r.error.message || '会话恢复失败')
    session = (r && r.data) || null
    return session
  }).catch(function (err) {
    session = null
    throw normalize(err)
  })
}

/** 建立真实会话。必须在用户主动登录动作后调用，不在 onShow 自动发起 */
function signIn() {
  return loginCode().then(function (code) {
    return auth().signInWithWechat(code, runtimeAppid())
  }).then(function (r) {
    if (r && r.error) throw new Error(r.error.message || '云端账号登录失败')
    session = (r && r.data) || null
    if (!session) throw new Error('云端账号未返回有效会话')
    return session
  }).catch(function (err) {
    session = null
    throw normalize(err)
  })
}

function signOut() {
  session = null
  return Promise.resolve().then(function () {
    return auth().signOut()
  }).catch(function (err) {
    throw normalize(err)
  })
}

function currentSession() { return session }

module.exports = {
  restore: restore,
  signIn: signIn,
  signOut: signOut,
  currentSession: currentSession
}
