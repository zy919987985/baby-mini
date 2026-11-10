/**
 * 【社交类目暂缓】「消息」tab 已从 app.json 的 pages / tabBar 移除，
 * 并从上传包中排除；代码完整保留但不可达、不参与编译。
 * 恢复方式见 pages/home/home.js 顶部说明。
 */
const store = require('../../utils/store')
const U = require('../../utils/util')
const auth = require('../../utils/auth')

const BG = {
  like: '#FFE9ED', comment: '#E9F1FF', favorite: '#FFF3DC',
  system: '#E6F7F0'
}
const TYPE_NAME = { like: '点赞', comment: '评论', favorite: '收藏' }

Page({
  data: {
    filter: '全部',
    unread: 0,
    messages: []
  },

  onShow: function () {
    // 互动消息属于个人隐私，未登录只显示「登录后查看」
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

  onPullDownRefresh: function () {
    this.refresh().then(function () { wx.stopPullDownRefresh() })
  },

  refresh: function () {
    const that = this
    return store.getMessages().then(function (all) {
      const f = that.data.filter
      let list = all
      if (f === '未读') list = list.filter(function (m) { return !m.read })
      else if (TYPE_NAME[f]) list = list.filter(function (m) { return m.type === f })

      list = list.map(function (m) {
        return Object.assign({}, m, { bgColor: BG[m.type] || '#F4F0ED' })
      })
      that.setData({
        messages: list,
        unread: all.filter(function (m) { return !m.read }).length
      })
    }).catch(function (err) { U.showError(err, '消息加载失败') })
  },

  onFilter: function (e) {
    this.setData({ filter: e.currentTarget.dataset.f }, this.refresh)
  },

  onReadAll: auth.guard(function () {
    const that = this
    store.markAllRead().then(function () {
      U.toast('已全部标为已读')
      that.refresh()
    }).catch(function (err) { U.showError(err) })
  }),

  onOpen: auth.guard(function (e) {
    const id = e.currentTarget.dataset.id
    const postId = e.currentTarget.dataset.post
    const that = this
    store.markMessageRead(id).then(function () {
      that.refresh()
      if (postId) wx.navigateTo({ url: '/pages/post-detail/post-detail?id=' + postId })
    }).catch(function (err) { U.showError(err) })
  }),
})
