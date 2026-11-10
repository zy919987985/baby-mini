/**
 * 首页（个人小程序合规版）
 * ------------------------------------------------------------------
 * 个人小程序暂未开放社交类目，社区帖子 / 点赞 / 收藏 / 评论 / 发布 / 消息
 * 相关能力全部停用。首页改为「官方号每日推荐辅食」：
 *   - 数据源 utils/daily-recommend.js，随包发布，本地 02:00 换一批 6 条；
 *   - 只读资讯，无 UGC、无云端帖子集合读写、无登录门禁；
 *   - 头部宝宝信息仍来自 utils/store.js（与社交无关，保留）。
 *
 * 【恢复社交版的方法】
 *   1) 原始 home.js / home.wxml / home.wxss / home.json 完整备份在
 *      .workbuddy/backup/social-disabled-20261110/home/；
 *      home.wxml 末尾也用注释保留了原帖子的完整 WXML。
 *   2) app.json 重新注册 pages/messages、pages/post-detail、pages/publish
 *      与「消息」tabBar，并从 project.config.json 的 packOptions.ignore 移除。
 *   3) 恢复 cook / recipe-detail 的「发帖子」入口与 profile 的三项统计。
 *   4) utils/store.js 的帖子 / 评论 / 消息接口一行未改，可直接复用。
 * ------------------------------------------------------------------
 */
const store = require('../../utils/store')
const U = require('../../utils/util')
const R = require('../../utils/recipes')
const DAILY = require('../../utils/daily-recommend')

function greetingOf(d) {
  const h = d.getHours()
  return h < 11 ? '早上好' : (h < 14 ? '中午好' : (h < 18 ? '下午好' : '晚上好'))
}

/** 头部信息只依赖宝宝档案，不碰任何社区集合 */
function headPatch(babies) {
  const baby = (babies || [])[0] || {}
  const months = U.monthAge(baby.birthday)
  const stage = R.stageFor(months)

  let todayTip
  if (months < 6) {
    todayTip = '宝宝还不到 6 个月，建议纯母乳 / 配方奶喂养，满 6 个月后逐步添加辅食。'
  } else if (months >= 36) {
    todayTip = '宝宝已经' + U.ageText(months) + '啦，可以逐步吃成人的食物了：清淡少盐、均衡多样，避免整粒坚果与果冻。'
  } else {
    todayTip = stage.name + '：建议做成' + stage.texture + '，' + stage.feeding + '。新食材记得连续观察 3 天。'
  }

  return {
    babyName: baby.name || '宝宝',
    babyAvatar: baby.avatar || '👶',
    ageText: U.ageText(months),
    stageName: stage.name,
    todayTip: todayTip
  }
}

Page({
  data: {
    greeting: '早上好',
    babyName: '宝宝',
    babyAvatar: '👶',
    ageText: '6个月',
    stageName: '吞咽期',
    todayTip: '',

    // 官方号每日推荐
    account: DAILY.account,
    dailyDateText: '',
    nextDateText: '',
    updateText: '每日 02:00 更新',
    dailyItems: []
  },

  onLoad: function () {
    this._day = 0
    this._timer = null
    this.setData({ greeting: greetingOf(new Date()) })
    this._applyDaily()
  },

  onShow: function () {
    // 跨过 02:00 后从后台回来，立即换成本期批次
    this._applyDaily()
    this._scheduleNext()
    this._loadHead()
  },

  onHide: function () { this._clearTimer() },
  onUnload: function () { this._clearTimer() },

  onPullDownRefresh: function () {
    const that = this
    this._applyDaily()
    this._scheduleNext()
    this._loadHead().then(function () {
      if (typeof wx !== 'undefined' && wx.stopPullDownRefresh) wx.stopPullDownRefresh()
    })
  },

  _loadHead: function () {
    const that = this
    return store.getBabies().then(function (babies) {
      that.setData(headPatch(babies))
    }).catch(function (err) { U.showError(err, '资料加载失败') })
  },

  /** 同一发布日不重复 setData，避免收起用户已展开的做法 */
  _applyDaily: function () {
    const d = DAILY.getDaily()
    if (d.day === this._day && this.data.dailyItems.length) return
    this._day = d.day
    this.setData({
      dailyDateText: d.dateText,
      nextDateText: d.nextDateText,
      updateText: d.updateText,
      dailyItems: d.items
    })
  },

  /** 在下一个本地 02:00 自动换批，页面在前台时无需重启小程序 */
  _scheduleNext: function () {
    const that = this
    this._clearTimer()
    const wait = Math.min(DAILY.msUntilNextPublish() + 1000, 86460000)
    this._timer = setTimeout(function () {
      that._applyDaily()
      that._scheduleNext()
    }, wait)
  },

  _clearTimer: function () {
    if (this._timer) { clearTimeout(this._timer); this._timer = null }
  },

  toggleDaily: function (e) {
    const i = Number(e.currentTarget.dataset.index)
    const item = this.data.dailyItems[i]
    if (!item) return
    const patch = {}
    patch['dailyItems[' + i + '].open'] = !item.open
    this.setData(patch)
  },

  goCook: function () { wx.switchTab({ url: '/pages/cook/cook' }) },
  goIngredients: function () { wx.switchTab({ url: '/pages/ingredients/ingredients' }) },
  goProfile: function () { wx.switchTab({ url: '/pages/profile/profile' }) }
})
