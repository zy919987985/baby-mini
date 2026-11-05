/**
 * 微信云开发统一入口
 * ------------------------------------------------------------------
 * 一个环境只 init 一次；数据库、云存储、AI（wx.cloud.extend.AI）共用它。
 * 端上只有环境 ID，没有任何密钥；集合权限由云端安全规则控制。
 *
 * 数据结构（都是 CloudBase NoSQL 集合，已由管理端创建并配置权限）：
 *   bf_user_state  私有状态：每个 openid 一个文档（宝宝、食材标记、食谱、点赞收藏、消息）
 *                  权限 PRIVATE：仅创建者可读写
 *   bf_posts       社区帖子：全局共享，权限 CUSTOM（读 true / 写 true）
 *   bf_comments    评论：全局共享，权限 CUSTOM（读 true / 写 true）
 *   云存储桶        帖子图片：READONLY（所有用户可读，仅创建者可写）
 * ------------------------------------------------------------------
 */
const CONFIG = require('./ai-config')
const U = require('./util')

let initialized = false
let dbInstance = null

function init() {
  if (initialized) return true
  if (!CONFIG.ENV_ID) return false
  try {
    if (!wx.cloud || !wx.cloud.init) return false
    wx.cloud.init({ env: CONFIG.ENV_ID })
    initialized = true
  } catch (e) {
    console.warn('[baby-food] 云开发初始化失败：', e)
    initialized = false
  }
  return initialized
}

function isReady() {
  try {
    return initialized && typeof wx !== 'undefined' && !!wx.cloud && !!wx.cloud.database
  } catch (e) {
    return false
  }
}

function db() {
  if (!isReady()) throw new Error('云开发未就绪，请检查环境 ID 与网络')
  if (!dbInstance) dbInstance = wx.cloud.database()
  return dbInstance
}

function command() {
  const d = db()
  // 多数版本 db.command 是对象，个别封装里是工厂函数，这里都兼容
  return typeof d.command === 'function' ? d.command() : d.command
}

function isCloudFileID(v) {
  return typeof v === 'string' && v.indexOf('cloud://') === 0
}

/** 上传本地临时图片到云存储，返回可直接给 <image src> 用的 fileID */
function uploadImage(filePath) {
  if (!isReady() || !wx.cloud.uploadFile) {
    return Promise.reject(new Error('云存储未就绪，无法上传图片'))
  }
  const clean = String(filePath || '').split('?')[0]
  const ext = (clean.match(/\.[a-z0-9]+$/i) || ['.jpg'])[0].toLowerCase()
  const cloudPath = 'post-images/' + U.uid('img') + ext
  return wx.cloud.uploadFile({ cloudPath: cloudPath, filePath: filePath })
    .then(function (res) {
      if (!res || !res.fileID) throw new Error('云存储未返回 fileID')
      return res.fileID
    })
}

/** 预览图片：cloud:// 不是普通 URL，先换成临时 HTTPS 链接 */
function tempUrls(fileIDs) {
  const list = (fileIDs || []).filter(isCloudFileID)
  if (!list.length) return Promise.resolve({})
  if (!wx.cloud.getTempFileURL) return Promise.resolve({})
  return wx.cloud.getTempFileURL({ fileList: list }).then(function (res) {
    const map = {}
    ;((res && res.fileList) || []).forEach(function (f) {
      if (f && f.fileID && f.tempFileURL) map[f.fileID] = f.tempFileURL
    })
    return map
  }).catch(function () { return {} })
}

module.exports = {
  init: init,
  isReady: isReady,
  db: db,
  command: command,
  isCloudFileID: isCloudFileID,
  uploadImage: uploadImage,
  tempUrls: tempUrls
}
