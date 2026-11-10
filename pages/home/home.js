const store = require('../../utils/store')
const U = require('../../utils/util')
const R = require('../../utils/recipes')
const CLOUD = require('../../utils/cloud')
const auth = require('../../utils/auth')
const VL = require('../../utils/virtual-list')
const SYS = require('../../utils/system-info')

const PAGE_SIZE = VL.PAGE_SIZE   // 云端每页条数，utils/virtual-list.js 单一来源

/** 取窗口尺寸；新基础库走 getWindowInfo，旧基础库回退，取不到用 375x667 */
function windowMetrics() {
  const info = SYS.windowInfo()
  return {
    width: Number(info.windowWidth) || 375,
    height: Number(info.windowHeight) || 667
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
    unread: 0,
    filter: '最新',
    cloudOffline: false,

    // 虚拟列表：只把可视窗口内的数据交给 WXML
    visiblePosts: [],
    padTop: 0,              // px，上方空白占位
    padBottom: 0,           // px，下方空白占位
    slotRpx: VL.ITEM_RPX,   // 单条高度（rpx），与 utils/virtual-list.js 同源

    // 底部只提示「加载中 / 已加载」，不展示任何具体条数。
    // loadedCount 仅用于判断是否为空列表，不会渲染成数字。
    loadedCount: 0,
    hasMore: false
  },

  onLoad: function () {
    const m = windowMetrics()
    this._itemH = VL.rpxToPx(VL.ITEM_RPX, m.width) // 单条高度 px（含间距）
    this._viewportH = m.height
    this._scrollTop = 0
    this._listTop = 0          // 列表容器顶部在文档中的坐标 px
    this._loaded = []          // 已加载的帖子（累计），全部来自云端游标分页
    this._cursor = null        // 传给 store.getPostPage 的下一页游标
    this._hasMore = true
    this._loading = false      // 请求中，防止滚动高频触发重复请求
    this._failedAt = 0         // 上次请求失败时间，避免滚动时无限重试
    this._generation = 0       // 请求代次：reset 之后丢弃旧请求的结果
    this._range = null
    this._measured = false

    const h = new Date().getHours()
    this.setData({
      greeting: h < 11 ? '早上好' : (h < 14 ? '中午好' : (h < 18 ? '下午好' : '晚上好'))
    })
  },

  onShow: function () {
    // 从详情页 / 发布页返回时保持滚动位置，并串行重拉已加载的页
    this.refresh()
  },

  onPullDownRefresh: function () {
    this.refresh({ reset: true }).then(function () { wx.stopPullDownRefresh() })
  },

  /** 头部信息来自私有状态文档，不需要碰帖子集合 */
  _headPatch: function (babies, summary) {
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
      todayTip: todayTip,
      unread: (summary && summary.unread) || 0,
      cloudOffline: !store.isCloudMode() || store.hasPendingChanges()
    }
  },

  /**
   * reset=true：清空游标回到第 1 页并滚到顶部（切换筛选 / 下拉刷新）。
   * 默认（onShow）：按当前已加载页数串行重拉，既能带回新发布的帖子，
   * 又能保持页码与滚动位置；软刷新不会把用户甩回顶部。
   */
  refresh: function (options) {
    const that = this
    const reset = !!(options && options.reset)
    // getHomeSummary 只读私有状态里的未读数，不碰 bf_posts；
    // 列表数据全部来自 getPostPage 的云端游标分页。
    return Promise.all([
      store.getBabies(),
      store.getHomeSummary()
    ]).then(function (res) {
      const head = that._headPatch(res[0], res[1])

      if (reset) {
        that._generation += 1
        that._loaded = []
        that._cursor = null
        that._hasMore = true
        that._loading = false
        that._scrollTop = 0
        that._range = null
        that.setData(head)
        if (typeof wx !== 'undefined' && wx.pageScrollTo) {
          wx.pageScrollTo({ scrollTop: 0, duration: 0 })
        }
        return that._fetchPage(true).then(function () {
          that._measureListTop()
        })
      }

      const pages = Math.max(1, Math.ceil(that._loaded.length / PAGE_SIZE))
      return that._reloadPages(pages).then(function () {
        that._updateWindow(true, head)
        that._measureListTop()
      })
    }).catch(function (err) {
      U.showError(err, '内容加载失败')
    })
  },

  /**
   * 串行重拉前 n 页：每一页用上一页返回的游标，整体完成后一次性 setData，
   * 避免逐页刷新导致列表跳动。期间 _loading=true 挡住滚动预加载。
   */
  _reloadPages: function (n) {
    const that = this
    const gen = this._generation
    const filter = this.data.filter
    let acc = []
    let cursor = null
    let hasMore = false

    if (this._loading) return Promise.resolve()
    this._loading = true

    const finish = function () {
      if (gen !== that._generation) return
      that._loaded = acc
      that._cursor = cursor
      that._hasMore = hasMore
      that._loading = false
      console.info('[baby-food] 首页软刷新累计 ' + acc.length + ' 条，hasMore=' + hasMore)
      that._updateWindow(true, {
        loadedCount: acc.length,
        hasMore: hasMore
      })
    }

    return store.getFavoriteIds().then(function (ids) {
      const favoriteIds = filter === '收藏' ? ids : []
      function step(i) {
        if (i >= n || gen !== that._generation) return Promise.resolve()
        return store.getPostPage({
          filter: filter,
          favoriteIds: favoriteIds,
          cursor: cursor,
          limit: PAGE_SIZE
        }).then(function (res) {
          if (gen !== that._generation) return
          acc = acc.concat(res.list)
          cursor = res.cursor
          hasMore = res.hasMore
          if (!res.hasMore) return
          return step(i + 1)
        })
      }
      return step(0)
    }).then(finish, function (err) {
      if (gen !== that._generation) return
      that._loading = false
      console.warn('[baby-food] 列表软刷新失败', err)
      U.toast('刷新失败，下拉重试')
    })
  },

  /** 拉取一页；first=true 表示清空后的第 1 页 */
  _fetchPage: function (first) {
    const that = this
    if (this._loading) return Promise.resolve(false)
    if (!first && !this._hasMore) return Promise.resolve(false)
    const gen = this._generation
    const filter = this.data.filter
    this._loading = true

    return store.getFavoriteIds().then(function (ids) {
      return store.getPostPage({
        filter: filter,
        favoriteIds: filter === '收藏' ? ids : [],
        cursor: first ? null : that._cursor,
        limit: PAGE_SIZE
      })
    }).then(function (res) {
      // 切换筛选 / 下拉刷新后，旧请求的结果一律丢弃
      if (gen !== that._generation) return false
      that._loaded = first ? res.list : that._loaded.concat(res.list)
      that._cursor = res.cursor
      that._hasMore = res.hasMore
      that._loading = false
      console.info('[baby-food] 首页累计 ' + that._loaded.length + ' 条，hasMore=' + res.hasMore)
      that._updateWindow(true, {
        loadedCount: that._loaded.length,
        hasMore: res.hasMore
      })
      return true
    }, function (err) {
      if (gen !== that._generation) return false
      that._loading = false
      that._failedAt = Date.now()
      console.warn('[baby-food] 加载下一页失败', err)
      U.toast('加载失败，下拉刷新重试')
      return false
    })
  },

  /**
   * 计算可视区间：只有区间变化时才 setData，
   * 让 onPageScroll 的高频回调不产生大量数据传输。
   */
  _updateWindow: function (force, extra, cb) {
    const range = VL.computeRange({
      scrollTop: this._scrollTop,
      listTop: this._listTop,
      viewportHeight: this._viewportH,
      itemHeight: this._itemH,
      total: this._loaded.length,
      overscan: VL.OVERSCAN
    })
    if (!force && !extra && !cb && VL.sameRange(this._range, range)) return
    this._range = range
    const patch = {
      visiblePosts: this._loaded.slice(range.start, range.end),
      padTop: range.padTop,
      padBottom: range.padBottom
    }
    if (extra) Object.assign(patch, extra)
    this.setData(patch, cb)
  },

  /**
   * 列表容器顶部在「文档」中的坐标 = 视口内 top + 当前滚动距离。
   * 同时取 selectViewport().scrollOffset()，避免测量瞬间滚动位置不同步。
   */
  _measureListTop: function () {
    const that = this
    if (typeof wx === 'undefined' || !wx.createSelectorQuery) return
    const q = wx.createSelectorQuery()
    q.select('#post-list').boundingClientRect()
    q.selectViewport().scrollOffset()
    q.exec(function (res) {
      const rect = res && res[0]
      const view = res && res[1]
      // 测量失败（节点未渲染等）也必须放行预加载：否则 _measured 永远为 false，
      // _maybeLoadMore 一直早退，滚动翻页就只剩 onReachBottom 兜底。
      if (rect && typeof rect.top === 'number') {
        that._listTop = rect.top + ((view && Number(view.scrollTop)) || that._scrollTop || 0)
      } else {
        console.warn('[baby-food] 列表位置测量失败，用估算位置触发预加载')
      }
      that._measured = true
      that._updateWindow(true)
      that._maybeLoadMore()
    })
  },

  onPageScroll: function (e) {
    this._scrollTop = Math.max(0, Number(e.scrollTop) || 0)
    this._updateWindow()
    this._maybeLoadMore()
  },

  /** 距已加载内容底部不足 1.2 屏时提前向云端要下一页，onReachBottom 只作兜底 */
  _maybeLoadMore: function () {
    if (!this._measured) return
    if (!this._hasMore || this._loading) return
    // 请求失败后冷却 3 秒，避免 onPageScroll 每帧触发重试风暴；
    // onReachBottom 不受此限制，用户滑到底仍可立即手动重试。
    if (Date.now() - this._failedAt < 3000) return
    if (VL.shouldLoadMore({
      scrollTop: this._scrollTop,
      listTop: this._listTop,
      viewportHeight: this._viewportH,
      itemHeight: this._itemH,
      loaded: this._loaded.length
    })) this._fetchPage(false)
  },

  onReachBottom: function () {
    this._fetchPage(false)
  },

  onFilter: function (e) {
    const f = e.currentTarget.dataset.f
    const that = this
    const apply = function () {
      that.setData({ filter: f }, function () { that.refresh({ reset: true }) })
    }
    // 「我的收藏」属于个人数据，未登录时先要求登录
    if (f === '收藏') {
      auth.requireLogin().then(apply).catch(function () { /* 用户取消登录 */ })
      return
    }
    apply()
  },

  /**
   * 点赞 / 收藏是本地状态 + 云端原子计数，不重新拉列表：
   * 云端游标是排序快照，重拉反而会让用户丢失当前滚动位置。
   */
  _patchInteraction: function (id, countField, delta) {
    this._loaded = store.decoratePosts(this._loaded).map(function (p) {
      if (p.id !== id) return p
      const n = Object.assign({}, p)
      n[countField] = Math.max(0, (Number(n[countField]) || 0) + delta)
      return n
    })
    this._updateWindow(true)
  },

  onLike: auth.guard(function (e) {
    const id = e.currentTarget.dataset.id
    const that = this
    store.toggleLike(id).then(function (liked) {
      U.toast(liked ? '已点赞' : '已取消点赞')
      that._patchInteraction(id, 'likeCount', liked ? 1 : -1)
    }).catch(function (err) { U.showError(err) })
  }),

  onFav: auth.guard(function (e) {
    const id = e.currentTarget.dataset.id
    const that = this
    store.toggleFavorite(id).then(function (fav) {
      U.toast(fav ? '已收藏' : '已取消收藏')
      // 收藏筛选下取消收藏，这条应立即从列表消失
      if (that.data.filter === '收藏' && !fav) {
        that._loaded = that._loaded.filter(function (p) { return p.id !== id })
        that._updateWindow(true, { loadedCount: that._loaded.length })
        return
      }
      that._patchInteraction(id, 'favCount', fav ? 1 : -1)
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
