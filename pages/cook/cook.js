const store = require('../../utils/store')
const R = require('../../utils/recipes')
const U = require('../../utils/util')
const AI = require('../../utils/ai')
const auth = require('../../utils/auth')

// loading 阶段文案：每 4 秒推进一档，仅作体验提示，不代表真实进度
const LOADING_STEPS = [
  '正在带入餐次、质地与过敏清单…',
  '正在排除过敏食材及其制品…',
  'AI 正在搭配全新食谱…',
  '正在校验食材与步骤安全性…',
  '正在整理用量与制作步骤…'
]

const SAVE_DEFAULT = '＋ 添加到我的食谱'

Page({
  data: {
    babies: [],
    babyIndex: 0,
    babyName: '宝宝',
    babyAvatar: '👶',
    ageText: '6个月',
    ageMonths: 6,
    stageName: '吞咽期',
    stageTexture: '细腻泥糊',
    meals: R.MEALS,
    mealType: '午餐',
    textures: ['细腻泥糊', '带小颗粒的稠泥', '碎末 / 软小块', '软烂小丁', '家常软食'],
    texture: '细腻泥糊',
    allergyNames: [],
    aiReady: false,

    // 本次生成条件的快照：生成请求与结果展示用的是同一份，改条件不会影响已出的结果
    // 四项条件全部快照，含「当前选择的宝宝月龄」，避免请求用的年龄和展示的年龄不一致
    condBabyName: '',
    condAgeMonths: 0,
    condAgeText: '',
    condMeal: '午餐',
    condTexture: '细腻泥糊',
    condAllergyText: '无',
    condAllergyCount: 0,

    // 年龄边界提示：与首页「今日辅食建议」口径一致
    ageNotice: '',

    recipe: null,          // 仅是当前草稿，未写入本地食谱库
    saved: false,
    saving: false,
    saveBtnText: SAVE_DEFAULT,
    generating: false,
    waitSeconds: 0,
    loadingText: LOADING_STEPS[0],
    round: 0
  },

  onShow: function () {
    // 未登录不展示制作辅食（含宝宝信息），只显示「登录后查看」
    if (auth.syncLock(this)) {
      const that = this
      auth.refresh().then(function () {
        if (auth.isLoggedIn()) { that.setData({ __locked: false }); that.refresh() }
        else that.setData({ __locked: true })
      })
      return
    }
    this.refresh()
    // 从其它 tab 切回来时恢复计时（生成请求仍在后台进行）
    if (this.data.generating && !this._ticker) this._startTicker()
  },

  onRequireLogin: function () {
    const that = this
    auth.requireLogin().then(function () {
      that.setData({ __locked: false })
      that.refresh()
      if (that.data.generating && !that._ticker) that._startTicker()
    }).catch(function () { /* 用户取消登录 */ })
  },

  onHide: function () { this._stopTicker() },
  onUnload: function () { this._stopTicker() },

  refresh: function () {
    const that = this
    return Promise.all([
      store.getBabies(),
      store.getAllIngredients()
    ]).then(function (res) {
      const babies = res[0].map(function (b) {
        return Object.assign({}, b, { ageText: U.ageText(U.monthAge(b.birthday)) })
      })
      const baby = babies[that.data.babyIndex] || babies[0] || {}
      const months = U.monthAge(baby.birthday)
      const stage = R.stageFor(months)
      const chosen = that.data.texture
      // 与首页口径一致：不满 6 个月先别加辅食；满 3 岁可逐步过渡到成人饮食
      const ageNotice = months < 6
        ? '🍼 宝宝还不到 6 个月，建议纯母乳 / 配方奶喂养，满 6 个月后逐步添加辅食'
        : (months >= 36
          ? '🍽️ 宝宝已满 3 岁，可以逐步吃成人的食物了，注意清淡少盐、均衡多样'
          : '')

      that.setData({
        babies: babies,
        babyIndex: Math.min(that.data.babyIndex, Math.max(0, babies.length - 1)),
        babyName: baby.name || '宝宝',
        babyAvatar: baby.avatar || '👶',
        ageText: U.ageText(months),
        ageMonths: months,
        stageName: stage.name,
        stageTexture: stage.texture,
        ageNotice: ageNotice,
        texture: chosen && that.data.textures.indexOf(chosen) >= 0 && !that._textureTouched ? stage.texture : chosen,
        // 过敏清单只读展示，来源与「食材清单」页完全同一份数据
        allergyNames: res[1].filter(function (i) { return i.status === 'allergy' })
          .map(function (i) { return i.name }),
        aiReady: AI.isAvailable()
      })
    }).catch(function (err) { U.showError(err, '加载失败') })
  },

  _startTicker: function () {
    const that = this
    this._stopTicker()
    this._ticker = setInterval(function () {
      const sec = that.data.waitSeconds + 1
      const idx = Math.min(LOADING_STEPS.length - 1, Math.floor(sec / 4))
      that.setData({ waitSeconds: sec, loadingText: LOADING_STEPS[idx] })
    }, 1000)
  },

  _stopTicker: function () {
    if (this._ticker) {
      clearInterval(this._ticker)
      this._ticker = null
    }
  },

  onBaby: function (e) {
    if (this.data.generating) return
    this._textureTouched = false
    this.setData({ babyIndex: Number(e.currentTarget.dataset.i) }, this.refresh)
  },

  onMeal: function (e) {
    if (this.data.generating) return
    this.setData({ mealType: e.currentTarget.dataset.v })
  },

  onTexture: function (e) {
    if (this.data.generating) return
    this._textureTouched = true
    this.setData({ texture: e.currentTarget.dataset.v })
  },

  goIngredients: function () { wx.switchTab({ url: '/pages/ingredients/ingredients' }) },
  goProfile: function () { wx.switchTab({ url: '/pages/profile/profile' }) },

  onGenerate: auth.guard(function () {
    const that = this
    if (this.data.generating) return

    const round = this.data.round
    const prev = this.data.recipe
    // 生成失败时把旧草稿还回去，避免误丢用户还没保存的结果
    this._draftBackup = prev ? { recipe: prev, saved: this.data.saved } : null

    // 四项条件在这里一次性快照（含当前选择的宝宝月龄），
    // 之后无论用户怎么改表单、怎么切换宝宝，都不影响本次请求与结果展示
    const cond = {
      babyName: this.data.babyName,
      ageMonths: this.data.ageMonths,
      ageText: this.data.ageText,
      mealType: this.data.mealType,
      texture: this.data.texture,
      allergyNames: this.data.allergyNames.slice()
    }

    // 安全边界：不满 6 个月不生成辅食食谱，与首页「满 6 个月后逐步添加辅食」一致
    if (cond.ageMonths < 6) {
      U.toast('宝宝还不满 6 个月，建议满 6 个月后逐步添加辅食')
      return
    }

    this.setData({
      generating: true,
      recipe: null,
      saved: false,
      saving: false,
      saveBtnText: SAVE_DEFAULT,
      waitSeconds: 0,
      loadingText: LOADING_STEPS[0],
      condBabyName: cond.babyName,
      condAgeMonths: cond.ageMonths,
      condAgeText: cond.ageText,
      condMeal: cond.mealType,
      condTexture: cond.texture,
      condAllergyText: cond.allergyNames.length ? cond.allergyNames.join('、') : '无',
      condAllergyCount: cond.allergyNames.length
    })
    this._startTicker()

    const opt = {
      ageMonths: cond.ageMonths,
      ageText: cond.ageText,
      mealType: cond.mealType,
      texture: cond.texture,
      allergyNames: cond.allergyNames,
      babyName: cond.babyName,
      round: round,
      excludeTitle: prev ? prev.title : ''
    }

    // 只生成草稿，不调用 store.saveRecipe
    return AI.generateRecipe(opt).then(function (res) {
      that._stopTicker()
      that._draftBackup = null
      that.setData({
        recipe: res.recipe,
        generating: false,
        saved: false,
        saveBtnText: SAVE_DEFAULT,
        round: round + 1
      }, function () {
        // 「换一个」按钮在长卡片底部，生成期间结果卡片被移除、页面高度变化，
        // 完成后滚回结果区顶部，避免停留在旧位置看不到新食谱。
        setTimeout(function () { that._scrollToRecipe() }, 80)
      })
      U.toast('生成完成，满意后再添加到我的食谱')
    }).catch(function (err) {
      that._stopTicker()
      const backup = that._draftBackup
      that.setData({
        generating: false,
        recipe: backup ? backup.recipe : null,
        saved: backup ? backup.saved : false,
        saveBtnText: backup && backup.saved ? '✓ 已添加到我的食谱' : SAVE_DEFAULT
      })
      U.showError(err, '生成失败，请重试')
    })
  }),

  /** 用户手动确认后才写入本地食谱库 */
  onSaveRecipe: auth.guard(function () {
    const that = this
    const r = this.data.recipe
    if (!r || this.data.saved || this.data.saving || this.data.generating) return
    this.setData({ saving: true, saveBtnText: '添加中…' })
    return store.saveRecipe(r).then(function () {
      that.setData({ saved: true, saving: false, saveBtnText: '✓ 已添加到我的食谱' })
      U.toast('已添加到我的食谱')
    }).catch(function (err) {
      that.setData({ saving: false, saveBtnText: SAVE_DEFAULT })
      U.showError(err, '添加失败，请重试')
    })
  }),

  /**
   * 结果渲染完成后滚到「生成的辅食」区。
   * 优先用 selector（基础库 2.7.3+）；老版本或选择器失效时退回手动算 scrollTop。
   */
  _scrollToRecipe: function () {
    const that = this
    if (!wx.pageScrollTo) return
    wx.pageScrollTo({
      selector: '#recipe-anchor',
      duration: 300,
      fail: function () {
        try {
          const q = wx.createSelectorQuery().in(that)
          q.select('#recipe-anchor').boundingClientRect()
          q.selectViewport().scrollOffset()
          q.exec(function (res) {
            const rect = res && res[0]
            const view = res && res[1]
            if (rect && view) {
              wx.pageScrollTo({ scrollTop: Math.max(0, view.scrollTop + rect.top - 12), duration: 300 })
            }
          })
        } catch (e) { /* 页面已销毁等场景，忽略 */ }
      }
    })
  },

  onAnother: function () { return this.onGenerate() },

  onPost: auth.guard(function () {
    const r = this.data.recipe
    if (!r || this.data.generating) return
    wx.navigateTo({
      url: '/pages/publish/publish?recipe=' + encodeURIComponent(r.title) + '&emoji=' + encodeURIComponent(r.emoji)
    })
  }),
})
