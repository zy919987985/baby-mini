const store = require('../../utils/store')
const U = require('../../utils/util')
const R = require('../../utils/recipes')
const CLOUD = require('../../utils/cloud')
const auth = require('../../utils/auth')

Page({
  data: {
    greeting: '早上好',
    babyName: '宝宝',
    babyAvatar: '👶',
    ageText: '6个月',
    stageName: '吞咽期',
    todayTip: '',
    unread: 0,
    filter: '推荐',
    posts: [],
    cloudOffline: false
  },

  onLoad: function () {
    const h = new Date().getHours()
    this.setData({
      greeting: h < 11 ? '早上好' : (h < 14 ? '中午好' : (h < 18 ? '下午好' : '晚上好'))
    })
  },

  onShow: function () {
    this.refresh()
  },

  onPullDownRefresh: function () {
    const that = this
    this.refresh().then(function () { wx.stopPullDownRefresh() })
  },

  refresh: function () {
    const that = this
    return Promise.all([
      store.getBabies(),
      store.getPosts(),
      store.getSummary()
    ]).then(function (res) {
      const babies = res[0]
      let posts = res[1]
      const summary = res[2]
      const baby = babies[0] || {}
      const months = U.monthAge(baby.birthday)
      const stage = R.stageFor(months)

      if (that.data.filter === '收藏') {
        posts = posts.filter(function (p) { return p.favorited })
      } else if (that.data.filter === '推荐') {
        posts = posts.slice().sort(function (a, b) {
          return (b.likeCount + b.favCount * 2) - (a.likeCount + a.favCount * 2)
        })
      } else {
        posts = posts.slice().sort(function (a, b) { return b.createdAt - a.createdAt })
      }

      posts = posts.map(function (p) {
        return Object.assign({}, p, { ageTag: (p.tags && p.tags[0]) || '辅食记录' })
      })

      // 阶段提示：<6 月龄先别加辅食；满 3 岁可逐步过渡到成人饮食
      let todayTip
      if (months < 6) {
        todayTip = '宝宝还不到 6 个月，建议纯母乳 / 配方奶喂养，满 6 个月后逐步添加辅食。'
      } else if (months >= 36) {
        todayTip = '宝宝已经' + U.ageText(months) + '啦，可以逐步吃成人的食物了：清淡少盐、均衡多样，避免整粒坚果与果冻。'
      } else {
        todayTip = stage.name + '：建议做成' + stage.texture + '，' + stage.feeding + '。新食材记得连续观察 3 天。'
      }

      that.setData({
        babyName: baby.name || '宝宝',
        babyAvatar: baby.avatar || '👶',
        ageText: U.ageText(months),
        stageName: stage.name,
        todayTip: todayTip,
        unread: summary.unread,
        posts: posts,
        cloudOffline: !store.isCloudMode() || store.hasPendingChanges()
      })
    }).catch(function (err) {
      U.showError(err, '内容加载失败')
    })
  },

  onFilter: function (e) {
    const f = e.currentTarget.dataset.f
    // 「我的收藏」属于个人数据，未登录时先要求登录
    if (f === '收藏') {
      const that = this
      auth.requireLogin().then(function () {
        that.setData({ filter: f }, that.refresh)
      }).catch(function () { /* 用户取消登录 */ })
      return
    }
    this.setData({ filter: f }, this.refresh)
  },

  onLike: auth.guard(function (e) {
    const id = e.currentTarget.dataset.id
    const that = this
    store.toggleLike(id).then(function (liked) {
      U.toast(liked ? '已点赞' : '已取消点赞')
      that.refresh()
    }).catch(function (err) { U.showError(err) })
  }),

  onFav: auth.guard(function (e) {
    const id = e.currentTarget.dataset.id
    const that = this
    store.toggleFavorite(id).then(function (fav) {
      U.toast(fav ? '已收藏' : '已取消收藏')
      that.refresh()
    }).catch(function (err) { U.showError(err) })
  }),

  openPost: function (e) {
    wx.navigateTo({ url: '/pages/post-detail/post-detail?id=' + e.currentTarget.dataset.id })
  },

  previewPostImage: function (e) {
    const ds = e.currentTarget.dataset
    const urls = ds.urls || []
    // cloud:// fileID 不能直接给 previewImage，先换临时 HTTPS 链接
    CLOUD.tempUrls(urls).then(function (map) {
      wx.previewImage({
        urls: urls.map(function (u) { return map[u] || u }),
        current: map[ds.current] || ds.current
      })
    })
  },

  goPublish: function () {
    auth.requireLogin().then(function () {
      wx.navigateTo({ url: '/pages/publish/publish' })
    }).catch(function () { /* 用户取消登录 */ })
  },
  goCook: function () { wx.switchTab({ url: '/pages/cook/cook' }) },
  goIngredients: function () { wx.switchTab({ url: '/pages/ingredients/ingredients' }) },
  goMessages: function () { wx.switchTab({ url: '/pages/messages/messages' }) },
  goProfile: function () { wx.switchTab({ url: '/pages/profile/profile' }) }
})
