/**
 * 系统信息读取兼容层
 * ------------------------------------------------------------------
 * wx.getSystemInfoSync 已废弃（基础库 2.20.1 起拆成 5 个新 API），
 * 每次调用都会在开发者工具打印弃用告警。本项目只用到两类信息：
 *
 *   SDKVersion             → wx.getAppBaseInfo()
 *   windowWidth / Height   → wx.getWindowInfo()
 *
 * 另外三个 getDeviceInfo / getSystemSetting / getAppAuthorizeSetting
 * 当前没有用到，不引入，避免无谓的权限与兼容面。
 *
 * 兼容策略：新基础库走新 API；只有新 API 不存在（基础库 < 2.20.1，
 * 这类旧库本身也不会打印弃用告警）才回退 wx.getSystemInfoSync。
 * 任何异常都返回空对象，绝不阻断启动、页面渲染或能力探测。
 * ------------------------------------------------------------------
 */

function wxEnv() {
  return (typeof wx !== 'undefined' && wx) ? wx : null
}

/** 应用基础信息，主要取 SDKVersion。取不到返回 {} */
function appBaseInfo() {
  const w = wxEnv()
  if (!w) return {}
  try {
    if (typeof w.getAppBaseInfo === 'function') return w.getAppBaseInfo() || {}
    if (typeof w.getSystemInfoSync === 'function') return w.getSystemInfoSync() || {}
  } catch (e) {
    // 个别宿主 / 模拟器会抛错，交给调用方使用默认值
  }
  return {}
}

/** 窗口信息，取 windowWidth / windowHeight。取不到返回 {} */
function windowInfo() {
  const w = wxEnv()
  if (!w) return {}
  try {
    if (typeof w.getWindowInfo === 'function') return w.getWindowInfo() || {}
    if (typeof w.getSystemInfoSync === 'function') return w.getSystemInfoSync() || {}
  } catch (e) {
    // 同上
  }
  return {}
}

/** 基础库版本号；取不到返回空串，调用方会跳过版本判断而不是误拦 */
function sdkVersion() {
  return String(appBaseInfo().SDKVersion || '')
}

module.exports = {
  appBaseInfo: appBaseInfo,
  windowInfo: windowInfo,
  sdkVersion: sdkVersion
}
