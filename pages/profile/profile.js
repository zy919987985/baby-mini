const store = require('../../utils/store')
const U = require('../../utils/util')
const auth = require('../../utils/auth')

const GENDERS = ['女宝', '男宝']

Page({
  data: {
    user: null,
    babies: [],
    summary: {},
    today: U.formatDate(new Date()),
    genders: GENDERS,
    genderIndex: 0,
    showLogin: false,
    tempAvatar: '',
    tempNick: '',
    showBaby: false,
    babyForm: {},
    showRecipes: false,
    recipes: [],
    showAbout: false
  },

  onShow: function () {
    // 个人中心属于隐私内容，未登录只显示「登录后查看」
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

  // 占位：弹层内部点击不冒泡到遮罩（catchtap 需要存在的方法，否则微信会报警告）
  noop: function () {},

  refresh: function () {
    const that = this
    return Promise.all([
      store.getUser(), store.getBabies(), store.getSummary()
    ]).then(function (res) {
      const babies = res[1].map(function (b) {
        return Object.assign({}, b, { ageText: U.ageText(U.monthAge(b.birthday)) })
      })
      that.setData({ user: res[0], babies: babies, summary: res[2] })
    }).catch(function (err) { U.showError(err, '资料加载失败') })
  },

  onLogout: function () {
    const that = this
    wx.showModal({
      title: '退出登录', content: '宝宝档案与记录会保留，退出后仅清除登录信息。',
      success: function (res) {
        if (!res.confirm) return
        auth.logout().then(function () {
          that.refresh()
          that.setData({ __locked: true })
          U.toast('已退出')
        }).catch(function (err) { U.showError(err) })
      }
    })
  },

  /* ---------------- 宝宝档案 ---------------- */

  openNewBaby: function () {
    this.setData({
      showBaby: true, genderIndex: 0,
      babyForm: {
        name: '', gender: '女宝', birthday: U.formatDate(new Date(Date.now() - 180 * 86400000)),
        height: '', weight: '', avatar: '👶', note: ''
      }
    })
  },

  openBaby: function (e) {
    const id = e.currentTarget.dataset.id
    const b = this.data.babies.filter(function (x) { return x.id === id })[0]
    if (!b) return
    this.setData({
      showBaby: true,
      genderIndex: Math.max(0, GENDERS.indexOf(b.gender)),
      babyForm: Object.assign({}, b)
    })
  },

  closeBaby: function () { this.setData({ showBaby: false }) },

  onForm: function (e) {
    const k = e.currentTarget.dataset.k
    const patch = {}
    patch['babyForm.' + k] = e.detail.value
    this.setData(patch)
  },

  onGender: function (e) {
    const i = Number(e.detail.value)
    this.setData({ genderIndex: i, 'babyForm.gender': GENDERS[i] })
  },

  onBirthday: function (e) { this.setData({ 'babyForm.birthday': e.detail.value }) },

  saveBaby: function () {
    const f = this.data.babyForm
    if (!f.name || !f.name.trim()) return U.toast('请填写宝宝小名')
    const that = this
    store.saveBaby({
      id: f.id, name: f.name.trim(), gender: f.gender, birthday: f.birthday,
      height: f.height, weight: f.weight, avatar: f.avatar || '👶', note: f.note
    }).then(function () {
      that.setData({ showBaby: false })
      U.toast('已保存')
      that.refresh()
    }).catch(function (err) { U.showError(err) })
  },

  deleteBaby: function () {
    const id = this.data.babyForm.id
    const that = this
    wx.showModal({
      title: '删除档案', content: '删除后该宝宝的信息将无法恢复，确定继续吗？',
      success: function (res) {
        if (!res.confirm) return
        store.removeBaby(id).then(function () {
          that.setData({ showBaby: false })
          that.refresh()
        }).catch(function (err) { U.showError(err) })
      }
    })
  },

  /* ---------------- 我的食谱 / 说明 / 重置 ---------------- */

  openRecipes: function () {
    const that = this
    store.getRecipes().then(function (list) {
      that.setData({ recipes: list, showRecipes: true })
    }).catch(function (err) { U.showError(err) })
  },

  closeRecipes: function () { this.setData({ showRecipes: false }) },

  openRecipe: function (e) {
    const id = e.currentTarget.dataset.id
    this.setData({ showRecipes: false })
    wx.navigateTo({ url: '/pages/recipe-detail/recipe-detail?id=' + id })
  },

  openAbout: function () { this.setData({ showAbout: true }) },
  closeAbout: function () { this.setData({ showAbout: false }) },

  goIngredients: function () { wx.switchTab({ url: '/pages/ingredients/ingredients' }) },

  onReset: function () {
    const that = this
    wx.showModal({
      title: '重置演示数据',
      content: '会清空你的食谱、食材标记、点赞收藏与消息，恢复到初始状态；社区帖子为共享内容不会删除。此操作不可撤销。',
      confirmColor: '#E0526E',
      success: function (res) {
        if (!res.confirm) return
        store.resetAll().then(function () { that.refresh(); U.toast('已重置') })
          .catch(function (err) { U.showError(err) })
      }
    })
  }
})
