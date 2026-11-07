/**
 * 生图小助手 · 云开发 AI 生图适配层
 * ------------------------------------------------------------------
 * 链路：文字描述（+画风/尺寸）
 *       → wx.cloud.extend.AI.createImageModel('hunyuan-image')
 *       → generateImage({ model: 'HY-Image-3.0-Plus-4090-Tob-v1.0', ... })
 *       → 兼容多种返回形态抽出图片 URL/base64
 *       → 页面展示 → 下载转存本地永久文件 → 保存到系统相册
 *
 * 设计要点：
 * 1. 只使用「小程序成长计划」赠送的生图额度。'hunyuan-image' 是官方定义的
 *    成长计划生图 Provider，只消耗生图资源包；不要换成 'cloudbase'（那是
 *    生文用的资源点套餐）。与 utils/ai.js 共用云开发环境，但额度池独立。
 *    不持有任何密钥，端上只有环境 ID，鉴权走小程序登录态。
 * 2. 官方返回的图片 URL 只有 24 小时有效期，且 wx.downloadFile 受
 *    「downloadFile 合法域名」限制。因此「保存」动作统一先把图片转存成
 *    小程序本地永久文件（wx.env.USER_DATA_PATH）再写入系统相册；
 *    URL 过期或域名没配好时给出可执行的提示，而不是静默失败。
 * 3. 页面只展示「本次生成结果」，不落任何本机作品记录 / 不写 storage。
 * 4. 基础库 / 模型 / 返回形态都可能变，这里做能力探测与多形态重试，
 *    模型名集中在 utils/ai-config.js 的 IMAGE.MODELS，方便模型下线时替换。
 * 5. 图片右下角的水印是平台按法规强制添加的显式 AI 标识，接口没有关闭参数，
 *    只能通过 footnote 自定义文案（≤16 字、须保留 AI 标识），见 watermarkText()。
 * ------------------------------------------------------------------
 */
const CONFIG = require('./ai-config')
const U = require('./util')

const CFG = CONFIG.IMAGE || {}
const MIN_LIB = '3.17.4'

/** 页面里的「灵感」快捷描述，围绕辅食场景，点击直接填入输入框 */
const SAMPLE_PROMPTS = [
  { label: '🍲 暖心辅食照', text: '一碗南瓜小米辅食泥，摆在浅木色餐桌上，柔和自然光，温暖治愈的美食摄影，浅色背景' },
  { label: '🧸 卡通餐盘', text: '卡通小勺子和一碗彩色蔬菜泥，可爱手绘插画，圆润造型，明快配色，浅色背景' },
  { label: '📖 食谱封面', text: '宝宝辅食食谱封面：分格餐盘里有胡萝卜泥、西兰花和米糕，俯拍构图，明亮清新，留白充足' },
  { label: '🎨 水彩小熊', text: '一只胖乎乎的小熊戴着围兜坐在餐椅上，面前摆着一小碗辅食，水彩插画风格，柔和暖色调' },
  { label: '🥕 食材平铺', text: '新鲜胡萝卜、南瓜、西兰花和米粉平铺在米白色布面上，俯拍，自然侧光，干净清新的食材摄影' }
]

/** 画风：以中文描述追加到 prompt 末尾，比让模型猜风格更稳定 */
const STYLE_OPTIONS = [
  { label: '自动', value: '' },
  { label: '温暖写实', value: '真实摄影，柔和自然光，暖色调，高清细节' },
  { label: '水彩插画', value: '清新水彩插画风格，柔和笔触，暖色调' },
  { label: '卡通手绘', value: '可爱卡通手绘风格，圆润造型，明快配色' },
  { label: '扁平插画', value: '扁平矢量插画风格，简洁构图，柔和配色' }
]

/* ---------------- 能力探测 ---------------- */

function compareVersion(a, b) {
  const left = String(a || '').split('.')
  const right = String(b || '').split('.')
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = Number(left[i]) || 0
    const y = Number(right[i]) || 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

/**
 * 生图能力是否可用。返回 { ok, hint }，hint 是可直接展示给用户的排查文案。
 * 注意：资源包 / 额度是否到账无法在端上探测，只有真正调用时才知道，
 * 因此 generate() 也会对「额度不足 / 模型未开通」类错误给出对应提示。
 */
function availability() {
  try {
    if (!CONFIG.ENV_ID) {
      return { ok: false, hint: '尚未配置云开发环境 ID，请在 utils/ai-config.js 填写 ENV_ID。' }
    }
    // 成长计划的生图额度只认 hunyuan-image；误配成 cloudbase 会改走资源点套餐
    if (CFG.PROVIDER && CFG.PROVIDER !== 'hunyuan-image') {
      return {
        ok: false,
        hint: '生图 Provider 配置错误：小程序成长计划生图额度只支持 hunyuan-image，请把 utils/ai-config.js 的 IMAGE.PROVIDER 改回该值。'
      }
    }
    if (typeof wx === 'undefined' || !wx.cloud) {
      return { ok: false, hint: '当前环境不是微信小程序，无法调用云开发生图能力。' }
    }
    let libOk = true
    let sdk = ''
    try {
      const info = wx.getSystemInfoSync ? wx.getSystemInfoSync() : null
      sdk = (info && info.SDKVersion) || ''
      if (sdk && compareVersion(sdk, MIN_LIB) < 0) libOk = false
    } catch (e) { /* 取不到版本时不误拦，交给下面的接口存在性判断 */ }
    if (!libOk) {
      return {
        ok: false,
        hint: '当前基础库 ' + sdk + ' 过低，生图需要 ' + MIN_LIB + ' 及以上。请在微信开发者工具把调试基础库调到 ' + MIN_LIB + '+，并确认 project.config.json 的 libVersion 已更新。'
      }
    }
    if (!wx.cloud.extend || !wx.cloud.extend.AI ||
        typeof wx.cloud.extend.AI.createImageModel !== 'function') {
      return {
        ok: false,
        hint: '当前基础库未提供 wx.cloud.extend.AI.createImageModel，请升级到 ' + MIN_LIB + ' 及以上后重新编译。'
      }
    }
    const app = getApp()
    if (!app || !app.globalData || !app.globalData.cloudReady) {
      return { ok: false, hint: '云开发尚未初始化成功，请检查环境 ID、网络与小程序绑定关系后重启小程序。' }
    }
    return { ok: true, hint: '' }
  } catch (e) {
    return { ok: false, hint: '生图能力探测失败：' + ((e && e.message) || '未知错误') }
  }
}

/* ---------------- 返回值解析 ---------------- */

/** 按官方文档清理 revised_prompt 里的 <think>/<recaption>/<boi> 等内联标记 */
function cleanRevisedPrompt(text) {
  if (!text) return ''
  let out = String(text).replace(/<think>[\s\S]*?<\/think>/gi, '')
  const recaption = out.match(/<recaption>([\s\S]*?)<\/recaption>/i)
  const answer = out.match(/<answer>([\s\S]*?)<\/answer>/i)
  if (recaption && recaption[1].trim()) out = recaption[1]
  else if (answer && answer[1].trim()) out = answer[1]
  return out
    .replace(/<\/?boi>/gi, '')
    .replace(/<img_size_\d+>/gi, '')
    .replace(/<img_ratio_\d+>/gi, '')
    .replace(/<\/?recaption>/gi, '')
    .replace(/<\/?answer>/gi, '')
    .trim()
}

/** 从单个对象里抽出图片地址 / base64；不是图片条目时返回 null */
function extractEntry(o) {
  if (!o || typeof o !== 'object') return null
  const asString = function (v) { return typeof v === 'string' ? v : '' }
  const url = asString(o.url) || asString(o.image_url) || asString(o.imageUrl) ||
    asString(o.tempFileURL) || asString(o.fileID)
  let b64 = asString(o.b64_json) || asString(o.b64) || asString(o.base64) || asString(o.image)
  // 去掉 dataUrl 前缀；太短的多半是占位字段而不是真正的图片数据
  b64 = b64.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '')
  if (b64.length < 128) b64 = ''
  if (!url && !b64) return null
  return {
    url: url,
    b64: b64,
    revisedPrompt: asString(o.revised_prompt) || asString(o.revisedPrompt)
  }
}

/**
 * 兼容真实存在的几种返回形态：
 * - 官方：{ data: [{ url, revised_prompt }] }
 * - SDK 包装：{ result: {...} } / { data: { data: [...] } } / { output: [...] }
 * - 部分实现直接返回 URL 字符串或 { images: [...] }
 */
function pickImage(node, depth) {
  const d = depth || 0
  if (!node || d > 4) return null
  if (typeof node === 'string') {
    return /^(https?:\/\/|cloud:\/\/|wxfile:\/\/)/.test(node) ? { url: node, b64: '', revisedPrompt: '' } : null
  }
  const direct = extractEntry(node)
  if (direct) return direct
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const found = pickImage(node[i], d + 1)
      if (found) return found
    }
    return null
  }
  const keys = ['data', 'result', 'output', 'images', 'response', 'body']
  for (let k = 0; k < keys.length; k++) {
    const child = node[keys[k]]
    if (child && child !== node) {
      const found = pickImage(child, d + 1)
      if (found) return found
    }
  }
  return null
}

/** 把模型可能返回的 base64 直接落成本地永久文件（不需要 downloadFile 域名白名单） */
function base64ToFile(b64) {
  const clean = String(b64 || '').replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '')
  if (!clean) return Promise.reject(new Error('图片数据为空'))
  const root = (typeof wx !== 'undefined' && wx.env && wx.env.USER_DATA_PATH) || ''
  if (!root || !wx.getFileSystemManager) {
    return Promise.reject(new Error('当前环境不支持写入本地图片'))
  }
  const path = root + '/ai_img_' + U.uid('b64') + '.jpg'
  return new Promise(function (resolve, reject) {
    wx.getFileSystemManager().writeFile({
      filePath: path,
      data: clean,
      encoding: 'base64',
      success: function () { resolve(path) },
      fail: function () { reject(new Error('图片数据写入本地失败')) }
    })
  })
}

/* ---------------- 生图调用 ---------------- */

function withTimeout(promise, ms) {
  return new Promise(function (resolve, reject) {
    let settled = false
    const timer = setTimeout(function () {
      if (settled) return
      settled = true
      reject(new Error('生图超时，请稍后重试或缩短描述'))
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

/**
 * 自定义水印文案（footnote）。平台按法规强制在右下角添加显式 AI 标识，
 * 接口不支持关闭，只能改文案；文案必须仍明确标注 AI 生成，否则回退平台默认水印。
 */
function watermarkText() {
  const raw = String(CFG.FOOTNOTE || '').trim()
  if (!raw) return ''
  const max = CFG.FOOTNOTE_MAX || 16
  const text = raw.length > max ? raw.slice(0, max) : raw
  if (!/AI|人工智能/i.test(text)) {
    console.warn('[baby-food] 自定义水印未标注 AI 生成，已回退平台默认水印')
    return ''
  }
  return text
}

function buildPayload(model, prompt, size) {
  const allowed = CFG.ALLOWED_SIZES || ['1024x1024', '1280x720', '720x1280', '1280x1280']
  const safeSize = allowed.indexOf(size) >= 0 ? size : (CFG.SIZE || '1024x1024')
  const payload = {
    model: model,
    prompt: prompt,
    size: safeSize,
    revise: { value: CFG.REVISE !== false },
    timeout: CFG.TIMEOUT || 120000
  }
  const footnote = watermarkText()
  if (footnote) payload.footnote = footnote
  return payload
}

/** 只取成长计划额度内的文生图模型；图生图模型需垫图，不能进入本页候选 */
function textToImageModels() {
  const list = (CFG.MODELS && CFG.MODELS.length)
    ? CFG.MODELS : ['HY-Image-3.0-Plus-4090-Tob-v1.0']
  return list.filter(function (m) { return m && !/I2I/i.test(m) })
}

/** 不同基础库暴露的调用形态不同，依次尝试直到拿到一张图片 */
function tryShapes(shapes, index, lastErr) {
  if (index >= shapes.length) {
    return Promise.reject(lastErr || new Error('生图接口调用失败'))
  }
  return Promise.resolve()
    .then(function () { return shapes[index]() })
    .then(function (res) {
      const entry = pickImage(res, 0)
      if (!entry) throw new Error('生图接口未返回图片')
      return entry
    })
    .catch(function (err) { return tryShapes(shapes, index + 1, err) })
}

function buildShapes(model, payload) {
  const shapes = []
  if (!model || typeof model !== 'object') return shapes
  if (typeof model.generateImage === 'function') {
    shapes.push(function () { return model.generateImage(payload) })
    shapes.push(function () { return model.generateImage({ data: payload }) })
  }
  if (typeof model.invoke === 'function') {
    shapes.push(function () { return model.invoke(payload) })
  }
  return shapes
}

function finalize(entry, model, size, prompt) {
  const base = {
    prompt: prompt,
    revisedPrompt: cleanRevisedPrompt(entry.revisedPrompt),
    model: model,
    size: size,
    createdAt: Date.now()
  }
  if (entry.b64) {
    return base64ToFile(entry.b64).then(function (path) {
      return Object.assign(base, { url: '', localPath: path })
    })
  }
  return Promise.resolve(Object.assign(base, { url: entry.url, localPath: '' }))
}

/**
 * 对外主入口：文字描述生成图片
 * @param {String} prompt 完整提示词（已含画风后缀），最多 500 字
 * @param {Object} opt { size }
 * @returns {Promise<{url, localPath, revisedPrompt, model, size, prompt, createdAt}>}
 */
function generate(prompt, opt) {
  const o = opt || {}
  const p = String(prompt || '').trim()
  const check = availability()
  if (!check.ok) return Promise.reject(new Error(check.hint))
  if (!p) return Promise.reject(new Error('请先描述想生成的画面'))
  if (p.length > (CFG.MAX_PROMPT || 500)) return Promise.reject(new Error('提示词最多 500 字'))

  const size = o.size || CFG.SIZE || '1024x1024'
  const models = textToImageModels()
  if (!models.length) {
    return Promise.reject(new Error('未配置成长计划文生图模型：请在 utils/ai-config.js 的 IMAGE.MODELS 填入文生图模型'))
  }

  let model
  try {
    // 固定走成长计划生图 Provider（availability() 已校验配置）
    model = wx.cloud.extend.AI.createImageModel(CFG.PROVIDER || 'hunyuan-image')
  } catch (e) {
    return Promise.reject(new Error('生图模型创建失败：' + ((e && e.message) || '请检查云开发环境')))
  }
  if (!model || typeof model !== 'object') {
    return Promise.reject(new Error('生图模型创建失败，请检查云开发环境与基础库版本'))
  }

  function tryModel(i, lastErr) {
    if (i >= models.length) {
      const raw = (lastErr && (lastErr.message || lastErr.errMsg)) || ''
      if (/额度|quota|资源包|余额|欠费|开通|not enabled|not found|AI_MODEL_NOT_FOUND/i.test(raw)) {
        return Promise.reject(new Error(
          '生图模型或额度未就绪：本功能只消耗' + (CFG.PLAN_NAME || '小程序成长计划') +
          '赠送的生图额度。请到 ' + (CFG.CREDIT_HINT || '微信公众平台 → 行业能力 → 小程序成长计划') +
          ' 确认 AI 资源包已领取、生图张数未用尽（自领取日起 6 个月有效）；成长计划生图模型无需在控制台单独开启。'
        ))
      }
      return Promise.reject(new Error(raw || '生图失败，请稍后重试'))
    }
    const payload = buildPayload(models[i], p, size)
    const shapes = buildShapes(model, payload)
    if (!shapes.length) {
      return Promise.reject(new Error('当前基础库不支持生图接口 generateImage'))
    }
    return tryShapes(shapes, 0, null)
      .then(function (entry) { return finalize(entry, models[i], size, p) })
      .catch(function (err) { return tryModel(i + 1, err) })
  }

  return withTimeout(tryModel(0, null), CFG.TOTAL_TIMEOUT || 150000)
}

/* ---------------- 下载 / 本地转存 / 相册 ---------------- */

function isLocalPath(v) {
  if (typeof v !== 'string' || !v) return false
  if (v.indexOf('wxfile://') === 0 || v.indexOf('http://tmp/') === 0 || v.indexOf('file://') === 0) return true
  try {
    const root = wx.env && wx.env.USER_DATA_PATH
    return !!(root && v.indexOf(root) === 0)
  } catch (e) { return false }
}

/** 本地永久文件（saveFile / base64 写入的结果）不需要再转存 */
function isPermanentPath(v) {
  return isLocalPath(v) && v.indexOf('tmp') < 0 && v.indexOf('temp') < 0
}

function hostOf(url) {
  const m = String(url || '').match(/^https?:\/\/([^/?#]+)/i)
  return m ? m[1] : ''
}

/** 任意来源（网络 URL / cloud:// / 本地路径）统一转成一个可操作的本地文件 */
function toLocalFile(src) {
  const s = String(src || '')
  if (!s) return Promise.reject(new Error('图片地址为空，请重新生成'))
  if (isLocalPath(s)) return Promise.resolve(s)
  if (s.indexOf('cloud://') === 0) {
    if (!wx.cloud || !wx.cloud.downloadFile) {
      return Promise.reject(new Error('云存储下载不可用'))
    }
    return wx.cloud.downloadFile({ fileID: s }).then(function (res) {
      if (!res || !res.tempFilePath) throw new Error('云存储未返回图片文件')
      return res.tempFilePath
    })
  }
  return new Promise(function (resolve, reject) {
    wx.downloadFile({
      url: s,
      success: function (res) {
        if (res.statusCode !== 200 || !res.tempFilePath) {
          return reject(new Error('图片下载失败（HTTP ' + res.statusCode + '）'))
        }
        resolve(res.tempFilePath)
      },
      fail: function (err) {
        const raw = String((err && (err.errMsg || err.message)) || '')
        if (/domain|合法域名|url not|not in the list/i.test(raw)) {
          const host = hostOf(s)
          return reject(new Error('请把 ' + (host || '生图结果域名') + ' 加入小程序后台「downloadFile 合法域名」后再保存'))
        }
        reject(new Error('图片下载失败：' + (raw || '网络异常')))
      }
    })
  })
}

/** 把临时文件转存为小程序本地永久文件，返回 savedFilePath */
function saveToLocal(src) {
  if (isPermanentPath(src)) return Promise.resolve(src)
  return toLocalFile(src).then(function (tempPath) {
    if (isPermanentPath(tempPath)) return tempPath
    if (!wx.getFileSystemManager) {
      return Promise.reject(new Error('当前环境不支持本地文件保存'))
    }
    return new Promise(function (resolve, reject) {
      wx.getFileSystemManager().saveFile({
        tempFilePath: tempPath,
        success: function (res) {
          if (!res || !res.savedFilePath) return reject(new Error('本地转存未返回文件路径'))
          resolve(res.savedFilePath)
        },
        fail: function (err) {
          reject(new Error('本地转存失败：' + String((err && (err.errMsg || err.message)) || '请重试')))
        }
      })
    })
  })
}

function ensureAlbumAuth() {
  return new Promise(function (resolve, reject) {
    if (!wx.getSetting) return reject(new Error('当前环境不支持相册授权'))
    wx.getSetting({
      success: function (res) {
        const state = res.authSetting && res.authSetting['scope.writePhotosAlbum']
        if (state === true) return resolve()
        if (state === false) {
          return wx.showModal({
            title: '需要相册权限',
            content: '保存图片到相册需要开启「添加到相册」权限，请在设置中允许后重试。',
            confirmText: '去设置',
            success: function (m) {
              if (!m.confirm) return reject(new Error('已取消保存'))
              wx.openSetting({
                success: function (s) {
                  if (s.authSetting && s.authSetting['scope.writePhotosAlbum']) resolve()
                  else reject(new Error('仍未开启相册权限'))
                },
                fail: function () { reject(new Error('打开设置失败')) }
              })
            },
            fail: function () { reject(new Error('授权提示失败')) }
          })
        }
        wx.authorize({
          scope: 'scope.writePhotosAlbum',
          success: resolve,
          fail: function () { reject(new Error('未获得相册权限，可在设置中开启后重试')) }
        })
      },
      fail: function () { reject(new Error('无法读取授权状态')) }
    })
  })
}

function writeAlbum(path) {
  return new Promise(function (resolve, reject) {
    wx.saveImageToPhotosAlbum({
      filePath: path,
      success: resolve,
      fail: function (err) {
        const raw = String((err && (err.errMsg || err.message)) || '')
        if (/auth|deny|permission|授权/i.test(raw)) {
          return reject(new Error('相册权限未开启，请在设置中允许后重试'))
        }
        reject(new Error('保存到相册失败：' + (raw || '请重试')))
      }
    })
  })
}

/**
 * 统一保存入口：先转成本地永久文件，再写入系统相册（页面只走 album: true）。
 * 页面拿到 localPath 后写回当前结果，之后即使 24 小时链接过期也能预览。
 * @param {String} src 结果里的 localPath 或 url
 * @param {Object} opts { album: Boolean }
 * @returns {Promise<{localPath: String, album: Boolean}>}
 */
function persist(src, opts) {
  const o = opts || {}
  return saveToLocal(src).then(function (localPath) {
    if (!o.album) return { localPath: localPath, album: false }
    return ensureAlbumAuth()
      .then(function () { return writeAlbum(localPath) })
      .then(function () { return { localPath: localPath, album: true } })
  })
}

/* ---------------- 当前结果的展示字段 ---------------- */

/** 给本次生成结果补上展示字段：src / saved / expired / timeText（不落 storage） */
function decorateRecord(rec) {
  const r = Object.assign({}, rec || {})
  const ttl = CFG.URL_TTL || (24 * 3600 * 1000)
  const fresh = !!r.url && (Date.now() - (Number(r.createdAt) || 0) < ttl)
  r.src = r.localPath || (fresh ? r.url : '')
  r.saved = !!r.localPath
  r.expired = !r.src
  r.timeText = U.timeAgo(r.createdAt)
  return r
}

module.exports = {
  SAMPLE_PROMPTS: SAMPLE_PROMPTS,
  STYLE_OPTIONS: STYLE_OPTIONS,
  SIZE_OPTIONS: CFG.SIZES || [],
  MAX_PROMPT: CFG.MAX_PROMPT || 500,
  PLAN_NAME: CFG.PLAN_NAME || '小程序成长计划',
  MODEL_LABEL: CFG.MODEL_LABEL || '混元生图 3.0',
  CREDIT_HINT: CFG.CREDIT_HINT || '',
  availability: availability,
  generate: generate,
  cleanRevisedPrompt: cleanRevisedPrompt,
  toLocalFile: toLocalFile,
  saveToLocal: saveToLocal,
  persist: persist,
  decorateRecord: decorateRecord
}
