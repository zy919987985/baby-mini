const store = require('../../utils/store')
const U = require('../../utils/util')
const CLOUD = require('../../utils/cloud')
const auth = require('../../utils/auth')

Page({
  data: { id: '', post: null, comments: [], draft: '', inputFocus: false },

  onLoad: function (options) {
    this.setData({ id: options.id || '' })
  },

  onShow: function () { this.refresh() },

  refresh: function () {
    const that = this
    if (!this.data.id) return Promise.resolve()
    return Promise.all([
      store.getPost(this.data.id),
      store.getComments(this.data.id)
    ]).then(function (res) {
      if (!res[0]) {
        U.toast('帖子不存在')
        return
      }
      that.setData({ post: res[0], comments: res[1] })
    }).catch(function (err) { U.showError(err, '加载失败') })
  },

  onLike: auth.guard(function () {
    const that = this
    store.toggleLike(this.data.id).then(function (liked) {
      U.toast(liked ? '已点赞' : '已取消点赞')
      that.refresh()
    }).catch(function (err) { U.showError(err) })
  }),

  onFav: auth.guard(function () {
    const that = this
    store.toggleFavorite(this.data.id).then(function (fav) {
      U.toast(fav ? '已收藏' : '已取消收藏')
      that.refresh()
    }).catch(function (err) { U.showError(err) })
  }),

  previewPostImage: function (e) {
    const ds = e.currentTarget.dataset
    const urls = ds.urls || []
    CLOUD.tempUrls(urls).then(function (map) {
      wx.previewImage({
        urls: urls.map(function (u) { return map[u] || u }),
        current: map[ds.current] || ds.current
      })
    })
  },

  focusInput: function () { this.setData({ inputFocus: true }) },
  onDraft: function (e) { this.setData({ draft: e.detail.value }) },

  sendComment: auth.guard(function () {
    const text = (this.data.draft || '').trim()
    if (!text) return U.toast('请输入评论内容')
    const that = this
    store.addComment(this.data.id, text).then(function () {
      that.setData({ draft: '', inputFocus: false })
      U.toast('评论已发布')
      that.refresh()
    }).catch(function (err) { U.showError(err, '评论失败') })
  }),
})
