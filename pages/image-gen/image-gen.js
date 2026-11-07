const IMG = require('../../utils/image-gen')
const U = require('../../utils/util')

// loading 阶段文案：每 6 秒推进一档，仅作等待提示，不代表真实进度
const LOADING_STEPS = [
  '正在整理你的画面描述…',
  '正在连接云开发生图模型…',
  'AI 正在构思构图与配色…',
  '正在绘制细节，通常需要 10-40 秒…',
  '快好了，正在生成最终图片…'
]

Page({
  data: {
    prompt: '',
    promptLength: 0,
    samples: IMG.SAMPLE_PROMPTS,
    styles: IMG.STYLE_OPTIONS,
    styleIndex: 0,
    sizes: IMG.SIZE_OPTIONS,
    sizeIndex: 0,
    maxPrompt: IMG.MAX_PROMPT,
    planName: IMG.PLAN_NAME,
    engineLabel: IMG.MODEL_LABEL,
    creditHint: IMG.CREDIT_HINT,

    available: false,
    availabilityHint: '',

    generating: false,
    saving: false,
    waitSeconds: 0,
    loadingText: LOADING_STEPS[0],

    result: null
  },

  onLoad: function () {
    this._syncAvailability()
  },

  onShow: function () {
    this._syncAvailability()
    // 从其它页面切回来时恢复计时（生图请求仍在后台进行）
    if (this.data.generating && !this._ticker) this._startTicker()
  },

  onHide: function () { this._stopTicker() },
  onUnload: function () { this._stopTicker() },

  _syncAvailability: function () {
    const a = IMG.availability()
    if (a.ok !== this.data.available || a.hint !== this.data.availabilityHint) {
      this.setData({ available: a.ok, availabilityHint: a.hint })
    }
  },

  _startTicker: function () {
    this._stopTicker()
    const that = this
    this._ticker = setInterval(function () {
      const s = that.data.waitSeconds + 1
      const idx = Math.min(LOADING_STEPS.length - 1, Math.floor(s / 6))
      that.setData({ waitSeconds: s, loadingText: LOADING_STEPS[idx] })
    }, 1000)
  },

  _stopTicker: function () {
    if (this._ticker) clearInterval(this._ticker)
    this._ticker = null
  },

  /* ---------------- 输入与选项 ---------------- */

  onPrompt: function (e) {
    const v = e.detail.value || ''
    this.setData({ prompt: v, promptLength: v.length })
  },

  onClearPrompt: function () {
    this.setData({ prompt: '', promptLength: 0 })
  },

  onSample: function (e) {
    const item = this.data.samples[Number(e.currentTarget.dataset.i)]
    if (!item) return
    this.setData({ prompt: item.text, promptLength: item.text.length })
  },

  onStyle: function (e) {
    this.setData({ styleIndex: Number(e.currentTarget.dataset.i) })
  },

  onSize: function (e) {
    this.setData({ sizeIndex: Number(e.currentTarget.dataset.i) })
  },

  /** 用户描述 + 画风后缀，作为真正发给模型的完整提示词 */
  _buildPrompt: function () {
    const text = String(this.data.prompt || '').trim()
    if (!text) return ''
    const style = (this.data.styles[this.data.styleIndex] || {}).value || ''
    return style ? text + '，' + style : text
  },

  /* ---------------- 生成 ---------------- */

  onGenerate: function () {
    const check = IMG.availability()
    if (!check.ok) {
      wx.showModal({
        title: '生图能力未就绪', content: check.hint,
        showCancel: false, confirmText: '我知道了'
      })
      return
    }
    const full = this._buildPrompt()
    if (!full) return U.toast('请先描述想生成的画面')
    if (full.length > IMG.MAX_PROMPT) return U.toast('描述加画风超过 500 字，请精简一下')
    if (this.data.generating || this.data.saving) return

    const size = (this.data.sizes[this.data.sizeIndex] || {}).value || '1024x1024'
    this.setData({
      generating: true, waitSeconds: 0,
      loadingText: LOADING_STEPS[0], result: null
    })
    this._startTicker()

    const that = this
    IMG.generate(full, { size: size }).then(function (r) {
      const rec = {
        prompt: full,
        revisedPrompt: r.revisedPrompt || '',
        url: r.url || '',
        localPath: r.localPath || '',
        createdAt: r.createdAt,
        model: r.model,
        size: r.size
      }
      that.setData({ result: IMG.decorateRecord(rec) })
      U.toast('生成完成')
    }, function (err) {
      console.warn('[baby-food] 生图失败', err)
      wx.showModal({
        title: '生成失败',
        content: (err && err.message) || '生成失败，请稍后重试',
        showCancel: false, confirmText: '我知道了'
      })
    }).then(function () {
      that._stopTicker()
      that.setData({ generating: false })
    })
  },


  /* ---------------- 预览与保存 ---------------- */

  onPreviewResult: function () {
    const r = this.data.result
    if (!r || !r.src) return U.toast('图片链接已失效，请重新生成')
    wx.previewImage({ urls: [r.src], current: r.src })
  },

  /**
   * 保存到相册（页面唯一的保存动作）：先把图片下载并转存成本机永久文件，
   * 不再依赖 24 小时有效的链接，再写入系统相册；保存后把本地路径写回当前结果。
   */
  onSaveAlbum: function () {
    const rec = this.data.result
    if (!rec) return
    if (this.data.saving) return
    if (!rec.src) return U.toast('图片链接已失效，请重新生成')
    this.setData({ saving: true })
    const that = this
    return IMG.persist(rec.localPath || rec.url, { album: true }).then(function (res) {
      const next = Object.assign({}, rec, { localPath: res.localPath })
      that.setData({ result: IMG.decorateRecord(next), saving: false })
      U.toast('已保存到相册')
    }, function (err) {
      that.setData({ saving: false })
      console.warn('[baby-food] 保存生图失败', err)
      wx.showModal({
        title: '保存失败',
        content: (err && err.message) || '请重试',
        showCancel: false, confirmText: '我知道了'
      })
    })
  }
})
