/**
 * WorkBuddy 云服务 · 端上公开配置
 * ------------------------------------------------------------------
 * 由 workbuddy_cloud_service(action=activate) 返回的 publicConfig 原样落盘。
 * 只含端上可用的公开值，不含任何长期密钥：环境 ID 与 Provider 密钥留在服务端。
 * endpoint 是固定网关，禁止手改 / 拼接 / 从 location 推导；换环境需重新激活并覆盖本文件。
 * ------------------------------------------------------------------
 */
module.exports = {
  endpoint: 'https://mp-api.app.workbuddy.host',
  publishableKey: 'wbpk_iWmUA7cs9YWI37Q26eZYwZ_be4ond9AdIcbKc250vzqEcLT7TvrNTvt',
  workBuddyOAuthClientId: 'cb_jq6QyEPkOkJXPcpz0JxS_wbapp_iWmUA7cs9YWI37Q26eZYwZ'
}
