/**
 * 定高虚拟列表 · 纯计算模块
 * ------------------------------------------------------------------
 * 小程序没有 DOM，长列表要「只渲染看得见的几条」只能靠：
 *   视口滚动位置 → 反推条目索引区间 → 上下用空白 view 撑起总高度。
 * 这里只做数学，不碰 wx / setData，因此可以直接在 Node 里跑单测。
 *
 * 使用前提：每个条目高度必须完全一致（含条目间距）。首页的
 * .v-slot 高度由 ITEM_RPX 注入、卡片内部分区固定高度，见 home.wxss。
 * 若调整了卡片高度，只改 ITEM_RPX 一处即可，WXML 会同步渲染。
 *
 * 纯 ES5，无第三方依赖。
 */

/**
 * 单个条目的高度（rpx），包含卡片本体 + 底部 26rpx 间距。
 * 必须与 home.wxss 中 .v-slot 的布局一致：
 *   .v-slot 722rpx 卡片 + 26rpx padding-bottom = 748rpx
 */
var ITEM_RPX = 748

/** 每页加载条数 */
var PAGE_SIZE = 10

/** 视口上下各多渲染几条，快速滚动时不至于白屏 */
var OVERSCAN = 2

/** rpx → px：750rpx 恒等于屏幕宽度 */
function rpxToPx(rpx, windowWidth) {
  return rpx * ((Number(windowWidth) || 375) / 750)
}

function clamp(n, min, max) {
  if (n < min) return min
  if (n > max) return max
  return n
}

/**
 * 计算当前应该渲染的条目区间与上下占位高度。
 *
 * @param {Object} o
 *   scrollTop      {number} 页面滚动距离（px）
 *   listTop        {number} 列表容器顶部在「整个文档」中的坐标（px）
 *   viewportHeight {number} 视口高度（px）
 *   itemHeight     {number} 单条高度（px，含间距）
 *   total          {number} 已加载的条目总数
 *   overscan       {number} 上下预渲染条数，默认 2
 * @returns {{start:number, end:number, padTop:number, padBottom:number, totalHeight:number}}
 *   start/end 为半开区间 [start, end)；padTop / padBottom 单位 px。
 */
function computeRange(o) {
  var opt = o || {}
  var itemHeight = Math.max(1, Number(opt.itemHeight) || 0)
  var total = Math.max(0, Math.floor(Number(opt.total) || 0))
  var viewportHeight = Math.max(0, Number(opt.viewportHeight) || 0)
  var overscan = opt.overscan === undefined
    ? OVERSCAN : Math.max(0, Math.floor(Number(opt.overscan) || 0))

  // 列表容器顶部在文档中的位置；下拉刷新时 scrollTop 可能为负，统一截到 0
  var offset = clamp(
    (Number(opt.scrollTop) || 0) - (Number(opt.listTop) || 0),
    0,
    total * itemHeight
  )

  var start = Math.floor(offset / itemHeight) - overscan
  var end = Math.ceil((offset + viewportHeight) / itemHeight) + overscan
  start = clamp(start, 0, total)
  end = clamp(end, start, total)

  return {
    start: start,
    end: end,
    padTop: start * itemHeight,
    padBottom: (total - end) * itemHeight,
    totalHeight: total * itemHeight
  }
}

/** 区间是否发生变化，用来避免每帧都 setData */
function sameRange(a, b) {
  return !!a && !!b && a.start === b.start && a.end === b.end &&
    a.padTop === b.padTop && a.padBottom === b.padBottom
}

/** 取第 page 页（从 1 开始）为止的已加载数据 */
function pageSlice(list, page, pageSize) {
  var all = list || []
  var size = Math.max(1, Number(pageSize) || PAGE_SIZE)
  var count = Math.min(all.length, Math.max(0, Math.floor(Number(page) || 0)) * size)
  return all.slice(0, count)
}

function hasMore(list, page, pageSize) {
  var size = Math.max(1, Number(pageSize) || PAGE_SIZE)
  return (list || []).length > Math.floor(Number(page) || 0) * size
}

/**
 * 是否该提前加载下一页：距「已加载内容底部」不足 thresholdScreens 屏时触发。
 * 提前加载比等 onReachBottom 到硬底部更顺滑，onReachBottom 仅作兜底。
 */
function shouldLoadMore(o) {
  var opt = o || {}
  var itemHeight = Math.max(1, Number(opt.itemHeight) || 0)
  var loaded = Math.max(0, Math.floor(Number(opt.loaded) || 0))
  var viewportHeight = Math.max(0, Number(opt.viewportHeight) || 0)
  var screens = opt.thresholdScreens === undefined ? 1.2 : Number(opt.thresholdScreens)
  var listBottom = (Number(opt.listTop) || 0) + loaded * itemHeight
  var trigger = listBottom - viewportHeight * screens
  return ((Number(opt.scrollTop) || 0) + viewportHeight) >= trigger
}

module.exports = {
  ITEM_RPX: ITEM_RPX,
  PAGE_SIZE: PAGE_SIZE,
  OVERSCAN: OVERSCAN,
  rpxToPx: rpxToPx,
  computeRange: computeRange,
  sameRange: sameRange,
  pageSlice: pageSlice,
  hasMore: hasMore,
  shouldLoadMore: shouldLoadMore
}
