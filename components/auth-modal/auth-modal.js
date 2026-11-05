const auth = require('../../utils/auth')
const U = require('../../utils/util')

Component({
  data: {
    show: false,
    tempAvatar: '',
    tempNick: ''
  },

  lifetimes: {
    attached: function () { auth.registerModal(this) },
    detached: function () { auth.unregisterModal(this) }
  },

  methods: {
    // 由 auth.requireLogin() 调用，弹出登录框并清空表单
    open: function () {
      this.setData({ show: true, tempAvatar: '', tempNick: '' })
    },

    close: function () {
      this.setData({ show: false })
      auth.cancelLogin()
    },

    noop: function () {},

    onChooseAvatar: function (e) {
      const url = e.detail.avatarUrl
      if (!url) return
      const that = this
      try {
        const fs = wx.getFileSystemManager()
        const dest = wx.env.USER_DATA_PATH + '/avatar_' + Date.now() + '.png'
        fs.saveFile({
          tempFilePath: url,
          filePath: dest,
          success: function (res) { that.setData({ tempAvatar: res.savedFilePath }) },
          fail: function () { that.setData({ tempAvatar: url }) }
        })
      } catch (err) {
        that.setData({ tempAvatar: url })
      }
    },

    onNick: function (e) { this.setData({ tempNick: e.detail.value }) },

    confirm: function () {
      const that = this
      const nick = (this.data.tempNick || '').trim() || '辅食家长'
      const avatar = this.data.tempAvatar
      auth.login({
        nickName: nick,
        avatarUrl: avatar || '🍼',
        isImageAvatar: !!avatar
      }).then(function () {
        that.setData({ show: false })
      }).catch(function (err) {
        U.showError(err, '登录失败，请重试')
      })
    }
  }
})
