const store = require('./utils/store')
const CLOUD = require('./utils/cloud')
const auth = require('./utils/auth')

App({
  globalData: {
    brand: '#FF7A59',
    version: '2.0.0',
    storageMode: 'cloud',
    cloudReady: false,
    offline: false
  },

  onLaunch() {
    // 云开发必须先 init，之后 wx.cloud.database() / uploadFile() / extend.AI 才可用。
    // 一个环境只初始化一次，统一放在 utils/cloud.js。
    const CONFIG = require('./utils/ai-config')
    const ok = CLOUD.init()
    this.globalData.cloudReady = ok && CLOUD.isReady()

    // 启动诊断：排查 -502001 时把这几项一起贴给开发者即可定位大半问题
    console.info('[baby-food] 启动诊断', {
      envId: CONFIG.ENV_ID,
      cloudReady: this.globalData.cloudReady,
      hasWxCloud: !!(typeof wx !== 'undefined' && wx.cloud),
      hasDatabase: !!(typeof wx !== 'undefined' && wx.cloud && wx.cloud.database),
      hasImageModel: !!(typeof wx !== 'undefined' && wx.cloud && wx.cloud.extend &&
        wx.cloud.extend.AI && wx.cloud.extend.AI.createImageModel),
      SDKVersion: (typeof wx !== 'undefined' && wx.getSystemInfoSync)
        ? wx.getSystemInfoSync().SDKVersion : 'unknown'
    })

    // 数据仓库首次启动时建/读云端私有文档、播种社区内容、迁移旧本地数据。
    // 页面所有 store 方法都会 await 这个 init，不必担心竞态。
    store.init().then(() => {
      this.globalData.offline = !store.isCloudMode()
      if (this.globalData.offline) {
        console.warn('[baby-food] 云端不可用，当前展示本地缓存（可继续操作，恢复后自动补传）')
      }
      // 登录态缓存与云数据初始化同步完成，页面级「登录后查看」遮罩才能正确判断
      return auth.init()
    }).catch((err) => {
      this.globalData.offline = true
      console.warn('[baby-food] 云数据初始化失败：',
        err && (err.errCode || err.code || ''), err && (err.errMsg || err.message || ''), err)
    })
  }
})
