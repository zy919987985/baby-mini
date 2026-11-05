const store = require('../../utils/store')
const ING = require('../../utils/ingredients')
const U = require('../../utils/util')
const auth = require('../../utils/auth')

const FILTERS = ['全部', '正常', '过敏', '未食用', '高致敏']
const FILTER_STATUS = { '正常': 'normal', '过敏': 'allergy', '未食用': 'untried' }

Page({
  data: {
    keyword: '',
    filters: FILTERS,
    filter: '全部',
    groups: [],
    stats: { normal: 0, allergy: 0, untried: 0, total: 0 },
    showAdd: false,
    newName: '',
    newMonth: '6'
  },

  onShow: function () {
    // 食材标记是个人喂养记录，未登录只显示「登录后查看」
    if (auth.syncLock(this)) {
      const that = this
      auth.refresh().then(function () {
        if (auth.isLoggedIn()) { that.setData({ __locked: false }); that.refresh() }
        else that.setData({ __locked: true })
      })
      return
    }
    this.refresh()
  },

  onRequireLogin: function () {
    const that = this
    auth.requireLogin().then(function () {
      that.setData({ __locked: false })
      that.refresh()
    }).catch(function () { /* 用户取消登录 */ })
  },

  refresh: function () {
    const that = this
    return store.getAllIngredients().then(function (list) {
      const meta = ING.STATUS_META
      const f = that.data.filter
      const kw = that.data.keyword.trim().toLowerCase()

      const stats = { normal: 0, allergy: 0, untried: 0, total: list.length }
      list.forEach(function (i) { stats[i.status] = (stats[i.status] || 0) + 1 })

      const visible = list.filter(function (i) {
        if (FILTER_STATUS[f] && i.status !== FILTER_STATUS[f]) return false
        if (f === '高致敏' && !i.allergen) return false
        if (kw && i.name.toLowerCase().indexOf(kw) < 0) return false
        return true
      })

      const groups = ING.CATEGORIES.map(function (c) {
        return {
          id: c.id, name: c.name, icon: c.icon, color: c.color,
          items: visible.filter(function (i) { return i.category === c.id }).map(function (i) {
            const m = meta[i.status] || meta.untried
            return Object.assign({}, i, {
              statusLabel: m.label, statusColor: m.color, statusBg: m.bg
            })
          })
        }
      }).filter(function (g) { return g.items.length > 0 })

      that.setData({ groups: groups, stats: stats })
    }).catch(function (err) { U.showError(err, '食材加载失败') })
  },

  onSearch: function (e) {
    this.setData({ keyword: e.detail.value }, this.refresh)
  },

  clearSearch: function () {
    this.setData({ keyword: '' }, this.refresh)
  },

  onFilter: function (e) {
    this.setData({ filter: e.currentTarget.dataset.f }, this.refresh)
  },

  onStatus: auth.guard(function (e) {
    const id = e.currentTarget.dataset.id
    const that = this
    wx.showActionSheet({
      itemList: ['✅ 标记为正常（已排敏）', '⚠️ 标记为过敏（避开）', '⭕ 标记为未食用'],
      success: function (res) {
        const status = ['normal', 'allergy', 'untried'][res.tapIndex]
        store.setIngredientState(id, status).then(function () {
          U.toast(status === 'normal' ? '已标记为正常' : (status === 'allergy' ? '已标记为过敏，生成食谱将自动避开' : '已标记为未食用'))
          that.refresh()
        }).catch(function (err) { U.showError(err) })
      },
      fail: function () {}
    })
  }),

  // 一键把所有食材还原为「未食用」（默认状态）。只清食材标记，不影响宝宝/食谱。
  onResetStatus: auth.guard(function () {
    const that = this
    wx.showModal({
      title: '重置食材状态',
      content: '将把所有食材标记为「未食用」（不影响宝宝档案与食谱），确定吗？',
      success: function (res) {
        if (!res.confirm) return
        store.clearIngredientStates().then(function () {
          U.toast('已重置为未食用')
          that.refresh()
        }).catch(function (err) { U.showError(err, '重置失败') })
      }
    })
  }),

  openAdd: function () { this.setData({ showAdd: true }) },
  closeAdd: function () { this.setData({ showAdd: false }) },
  noop: function () {},
  onNewName: function (e) { this.setData({ newName: e.detail.value }) },
  onNewMonth: function (e) { this.setData({ newMonth: e.detail.value }) },

  submitAdd: auth.guard(function () {
    const name = this.data.newName.trim()
    const month = Number(this.data.newMonth)
    if (!name) return U.toast('请输入食材名称')
    if (!month || month < 4 || month > 36) return U.toast('月龄请填 4-36')
    const that = this
    store.addCustomIngredient({ name: name, minMonth: month }).then(function () {
      that.setData({ showAdd: false, newName: '', newMonth: '6' })
      U.toast('已添加')
      that.refresh()
    }).catch(function (err) { U.showError(err) })
  }),
})
