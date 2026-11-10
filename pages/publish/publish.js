/**
 * 【社交类目暂缓】本页已从 app.json 的 pages 移除、并从上传包中排除，
 * 代码完整保留但不可达、不参与编译。恢复方式见 pages/home/home.js 顶部说明。
 */
const store = require('../../utils/store')
const U = require('../../utils/util')
const MOD = require('../../utils/moderation')
const CLOUD = require('../../utils/cloud')
const auth = require('../../utils/auth')

const EMOJIS = ['🎃', '🥕', '🥦', '🍚', '🥚', '🐟', '🍎', '🥑', '🍠', '🥩', '🫐', '🍲']

function decode(v) {
  if (!v) return ''
  try { return decodeURIComponent(v) } catch (e) { return v }
}

Page({
  data: {
    title: '',
    content: '',
    recipeTitle: '',
    tagText: '',
    coverEmoji: '🍲',
    coverStyle: U.gradientOf('publish'),
    emojis: EMOJIS,

    images: [],                 // { path, size, status: pending|pass|reject, reason }
    maxImages: MOD.config.MAX_IMAGES || 3,
    aiReady: false,

    auditBusy: false,
    auditText: '',
    auditError: '',
    auditPassed: false
  },

  onLoad: function (options) {
    const q = options || {}
    const recipe = decode(q.recipe)
    const emoji = decode(q.emoji)
    const patch = { aiReady: MOD.isAIAvailable() }
    if (recipe) {
      patch.recipeTitle = recipe
      patch.title = '今天做了 ' + recipe + '，记录一下'
    }
    if (emoji && EMOJIS.indexOf(emoji) >= 0) patch.coverEmoji = emoji
    this.setData(patch)
  },

  onShow: function () {
    // 环境 ID 存在不等于模型已开通，探测后展示真实的审核模式
    const that = this
    MOD.probeAI().then(function (r) { that.setData({ aiReady: r }) })
  },

  /** 任何内容改动都会让上一次审核结论失效，重新提交时再跑一遍 */
  _resetAudit: function () {
    const images = this.data.images.map(function (f) {
      return Object.assign({}, f, { status: 'pending', reason: '' })
    })
    this.setData({ auditError: '', auditPassed: false, images: images })
  },

  onTitle: function (e) { this.setData({ title: e.detail.value }); this._resetAudit() },
  onContent: function (e) { this.setData({ content: e.detail.value }); this._resetAudit() },
  onRecipe: function (e) { this.setData({ recipeTitle: e.detail.value }); this._resetAudit() },
  onTags: function (e) { this.setData({ tagText: e.detail.value }); this._resetAudit() },

  onEmoji: function (e) {
    const v = e.currentTarget.dataset.v
    this.setData({ coverEmoji: v, coverStyle: U.gradientOf(v + Date.now()) })
    this._resetAudit()
  },

  onChooseImage: function () {
    const that = this
    if (this.data.auditBusy) return
    const remain = this.data.maxImages - this.data.images.length
    if (remain <= 0) return U.toast('最多上传 ' + this.data.maxImages + ' 张图片')

    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: function (res) {
        const files = (res.tempFiles || []).map(function (f) {
          return { path: f.tempFilePath, size: Number(f.size) || 0, status: 'pending', reason: '' }
        })
        const accepted = []
        let rejected = ''
        files.forEach(function (f) {
          const v = MOD.checkImageLocally(f)
          if (v.pass) accepted.push(f)
          else if (!rejected) rejected = v.reason
        })
        if (accepted.length) {
          that.setData({ images: that.data.images.concat(accepted) }, function () { that._resetAudit() })
        }
        if (rejected) U.toast(rejected)
      },
      fail: function (err) {
        // 用户主动取消选择不提示
        if (err && err.errMsg && err.errMsg.indexOf('cancel') >= 0) return
        U.showError(err, '选择图片失败')
      }
    })
  },

  onRemoveImage: function (e) {
    if (this.data.auditBusy) return
    const i = Number(e.currentTarget.dataset.i)
    const images = this.data.images.filter(function (_, idx) { return idx !== i })
    this.setData({ images: images }, this._resetAudit.bind(this))
  },

  onPreviewImage: function (e) {
    const i = Number(e.currentTarget.dataset.i)
    const urls = this.data.images.map(function (f) { return f.path })
    wx.previewImage({ urls: urls, current: urls[i] })
  },

  onSubmit: function () {
    const that = this
    if (this.data.auditBusy) return

    const title = (this.data.title || '').trim()
    const content = (this.data.content || '').trim()
    if (title.length < 2) return U.toast('标题至少 2 个字')
    if (content.length < 5) return U.toast('正文至少 5 个字')

    // 发布属于写操作，未登录先要求授权
    return auth.requireLogin().then(function () {
      return that._doPublish(title, content)
    }).catch(function () { /* 用户取消登录，静默放弃 */ })
  },

  /** 经登录校验后的真实发布流程 */
  _doPublish: function (title, content) {
    const that = this

    const tags = (this.data.tagText || '').split(/[,，、\s]+/)
      .map(function (s) { return s.trim() })
      .filter(function (s) { return !!s })
      .slice(0, 3)

    // 一次性快照：审核用的内容和最终发布的内容必须是同一份
    const payload = {
      title: title,
      content: content,
      recipeTitle: (this.data.recipeTitle || '').trim(),
      tags: tags.length ? tags : ['辅食记录'],
      coverEmoji: this.data.coverEmoji,
      images: this.data.images.map(function (f) { return { path: f.path, size: f.size } })
    }

    this.setData({
      auditBusy: true,
      auditText: '正在准备审核…',
      auditError: '',
      auditPassed: false
    })

    return MOD.reviewPost(payload, function (text) {
      that.setData({ auditText: text })
    }).then(function (result) {
      if (!result.pass) {
        that._applyReject(result)
        wx.showModal({
          title: '内容未通过审核',
          content: that.data.auditError,
          showCancel: false,
          confirmText: '去修改'
        })
        return null
      }
      that._applyPass()
      return that._publish(payload, result)
    }).catch(function (err) {
      // reviewPost 内部已做失败关闭，这里兜住页面自身的异常
      that.setData({ auditError: '审核流程异常：' + ((err && err.message) || '请稍后重试') })
      U.showError(err, '审核未完成，发布已拦截')
      return null
    }).then(function () {
      that.setData({ auditBusy: false })
    })
  },

  /** 拦截：保留草稿，标出是哪一段/哪张图不合规 */
  _applyReject: function (result) {
    let msg = ''
    if (result.stage === 'text') {
      msg = '【文字 · ' + (result.category || '不合规') + '】' + result.reason
    } else if (result.stage === 'image') {
      msg = '【第 ' + (result.imageIndex + 1) + ' 张图片 · ' + (result.category || '不合规') + '】' + result.reason
      const idx = result.imageIndex
      const images = this.data.images.map(function (f, i) {
        if (i === idx) return Object.assign({}, f, { status: 'reject', reason: result.reason })
        if (i < idx) return Object.assign({}, f, { status: 'pass' })
        return f
      })
      this.setData({ images: images })
    } else {
      msg = '【' + (result.category || '审核未完成') + '】' + result.reason
    }
    this.setData({ auditError: msg, auditPassed: false, auditText: '' })
  },

  _applyPass: function () {
    const images = this.data.images.map(function (f) {
      return Object.assign({}, f, { status: 'pass', reason: '' })
    })
    this.setData({ images: images, auditPassed: true, auditText: '审核通过，正在发布…' })
  },

  /**
   * 审核通过后才落库。图片走云存储 wx.cloud.uploadFile，
   * 帖子里只存 cloud:// fileID（<image> 可直接渲染，跨设备可见）。
   * 任一图片上传失败就整单回滚提示，不发布「缺图」的帖子。
   */
  _publish: function (payload, result) {
    const paths = payload.images.map(function (f) { return f.path })
    return Promise.all(paths.map(function (p) { return CLOUD.uploadImage(p) }))
      .then(function (fileIDs) {
        return store.addPost({
          title: payload.title,
          content: payload.content,
          recipeTitle: payload.recipeTitle,
          tags: payload.tags,
          coverEmoji: payload.coverEmoji,
          images: fileIDs,
          audit: { mode: result.mode, passed: true, at: Date.now() }
        })
      })
      .then(function () {
        wx.showToast({ title: '审核通过，发布成功', icon: 'success' })
        setTimeout(function () { wx.switchTab({ url: '/pages/home/home' }) }, 900)
      })
      .catch(function (err) {
        console.warn('[baby-food] 发布失败：', err)
        U.showError(err, '图片上传或发布失败，请重试')
      })
  }
})
