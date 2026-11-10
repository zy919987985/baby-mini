const store = require('../../utils/store')
const U = require('../../utils/util')
const auth = require('../../utils/auth')

Page({
  data: { id: '', recipe: null },

  onLoad: function (options) { this.setData({ id: options.id || '' }) },

  onShow: function () {
    const that = this
    if (!this.data.id) return
    store.getRecipe(this.data.id).then(function (r) {
      that.setData({ recipe: r })
    }).catch(function (err) { U.showError(err, '食谱加载失败') })
  },

  /* 社交类目暂缓：跳转到发帖页的入口停用（recipe-detail.wxml 对应按钮已注释）。
  onPost: auth.guard(function () {
    const r = this.data.recipe
    if (!r) return
    wx.navigateTo({
      url: '/pages/publish/publish?recipe=' + encodeURIComponent(r.title) + '&emoji=' + encodeURIComponent(r.emoji)
    })
  }),
  */

  onDelete: auth.guard(function () {
    const that = this
    wx.showModal({
      title: '删除食谱',
      content: '删除后这份食谱的步骤记录将无法恢复，确定继续吗？',
      confirmColor: '#E0526E',
      success: function (res) {
        if (!res.confirm) return
        store.deleteRecipe(that.data.id).then(function () {
          U.toast('已删除')
          setTimeout(function () { wx.navigateBack() }, 700)
        }).catch(function (err) { U.showError(err) })
      }
    })
  }),
})
