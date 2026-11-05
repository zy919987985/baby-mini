function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36)
}

function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

function formatDate(d) {
  const date = d instanceof Date ? d : new Date(d)
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

function timeAgo(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
  if (diff < 7 * 86400000) return Math.floor(diff / 86400000) + '天前'
  return formatDate(ts)
}

/** 依据生日计算月龄 */
function monthAge(birthday) {
  if (!birthday) return 6
  const b = new Date(birthday.replace(/-/g, '/'))
  if (isNaN(b.getTime())) return 6
  const now = new Date()
  let m = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth())
  if (now.getDate() < b.getDate()) m -= 1
  return Math.max(0, Math.min(72, m))
}

function ageText(months) {
  const m = Number(months) || 0
  if (m < 12) return m + '个月'
  const y = Math.floor(m / 12)
  const rest = m % 12
  return y + '岁' + (rest ? rest + '个月' : '')
}

const GRADIENTS = [
  'linear-gradient(135deg,#FFD9C0,#FFAA8A)',
  'linear-gradient(135deg,#FFE9A8,#FFC46B)',
  'linear-gradient(135deg,#C9EEDC,#7FD1AC)',
  'linear-gradient(135deg,#D9E4FF,#A9BCF5)',
  'linear-gradient(135deg,#FFD6DF,#FBA7BC)',
  'linear-gradient(135deg,#E7DCFF,#BFA9F2)',
  'linear-gradient(135deg,#D6F0F4,#8FD3DE)'
]

function gradientOf(seed) {
  const s = String(seed || '')
  let n = 0
  for (let i = 0; i < s.length; i++) n += s.charCodeAt(i)
  return GRADIENTS[n % GRADIENTS.length]
}

function toast(title, icon) {
  wx.showToast({ title: title, icon: icon || 'none', duration: 1800 })
}

/** 云开发常见错误码 → 中文解释，避免用户只看到一串负数 */
const CLOUD_ERRORS = {
  '-502001': '云数据库请求失败：请检查集合权限与云开发环境',
  '-502002': '云数据库指令不合法',
  '-502003': '无权限操作云数据库：集合权限不足',
  '-502005': '云数据库集合不存在',
  '-501001': '云端服务异常，请稍后重试',
  '-501005': '云开发环境信息异常，请确认环境 ID 与小程序绑定',
  '-501009': '操作的云端资源不存在',
  '-503001': '云存储请求失败',
  '-503002': '无权限访问云文件',
  '-401001': '云开发未登录或鉴权失败'
}

/** 把任意异常整理成可展示的文案 + 可排查的结构化信息 */
function describeError(err, fallback) {
  const code = err && (err.errCode !== undefined ? err.errCode : err.code)
  const raw = (err && (err.errMsg || err.message)) || ''
  const key = String(code)
  let msg = CLOUD_ERRORS[key] || ''
  if (!msg) msg = raw && raw !== String(code) ? raw : (fallback || '操作失败，请稍后重试')
  return { code: code, raw: raw, message: msg }
}

/** 统一错误提示：网络 / 未登录 / 权限 / 存储异常都有明确反馈 */
function showError(err, fallback) {
  const info = describeError(err, fallback)
  // 完整错误留在控制台，方便把 errCode + errMsg 一次贴给开发者排查
  console.warn('[baby-food] 操作失败', {
    errCode: info.code, errMsg: info.raw, fallback: fallback || '', error: err
  })
  const text = '[' + info.code + '] ' + info.message
  wx.showToast({
    title: text.length > 22 ? text.slice(0, 22) : text,
    icon: 'none', duration: 2600
  })
  return info
}

module.exports = {
  uid: uid,
  pad: pad,
  formatDate: formatDate,
  timeAgo: timeAgo,
  monthAge: monthAge,
  ageText: ageText,
  gradientOf: gradientOf,
  toast: toast,
  showError: showError,
  describeError: describeError,
  CLOUD_ERRORS: CLOUD_ERRORS,
  GRADIENTS: GRADIENTS
}
