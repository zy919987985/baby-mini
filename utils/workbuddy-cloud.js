/**
 * WorkBuddy 云服务 · 小程序端唯一客户端
 * ------------------------------------------------------------------
 * 与 utils/cloud.js（微信原生云开发 wx.cloud）是两套独立后端，互不替换：
 *   utils/cloud.js   社区帖子 / 评论 / 私有状态 / 生图（小程序成长计划）
 *   本文件            真实账号会话（Auth），后续可复用 database / storage / llm
 * 全应用只初始化一次，所有模块共用同一个 client 实例。
 * 小程序没有 location.origin，endpoint 必须显式传入，不能依赖同源回退。
 * ------------------------------------------------------------------
 */
const CFG = require('./workbuddy-cloud-config')
const { createDiagnosticWx } = require('./workbuddy-cloud-diagnostics')

let client = null

function loadFactory() {
  let mod
  try {
    mod = require('@tencent-ai/workbuddy-cloud-sdk/miniprogram')
  } catch (e) {
    throw new Error('云服务 SDK 未就绪：请在微信开发者工具执行「构建 npm」后重新编译')
  }
  if (!mod || typeof mod.createMiniProgramWorkBuddyCloud !== 'function') {
    throw new Error('云服务 SDK 版本不支持小程序入口，请更新 @tencent-ai/workbuddy-cloud-sdk')
  }
  return mod.createMiniProgramWorkBuddyCloud
}

function getCloud() {
  if (client) return client
  if (typeof wx === 'undefined' || typeof wx.request !== 'function') {
    throw new Error('云服务需要在微信小程序运行时中初始化')
  }
  const factory = loadFactory()
  client = factory({
    endpoint: CFG.endpoint,
    publishableKey: CFG.publishableKey,
    workBuddyOAuthClientId: CFG.workBuddyOAuthClientId,
    wx: createDiagnosticWx(wx)
  })
  return client
}

module.exports = { getCloud: getCloud }
