/**
 * AI 辅食生成 · 集中配置
 * ------------------------------------------------------------------
 * 只需要改这一个文件，就能把「本地规则引擎」切换成「云端大模型」。
 *
 * 当前状态（2026-11-06）：已接入「小程序成长计划」赠送的 Token 额度，
 * 走 wx.cloud.extend.AI.createModel('cloudbase') 统一模型组 + deepseek-v4.1-flash。
 * 成长计划免费额度覆盖 5 个模型：hy4 / hy4-preview / hy3 /
 * deepseek-v4.1-flash / deepseek-v4.1-flash-1017。
 * cloudbase 组无需在控制台逐个开启模型，免费额度用尽后自动切套餐资源点；
 * 旧的 hunyuan-v3 组只支持 hy3 且即将废弃，不要再使用。
 *
 * 环境要求：微信基础库 ≥ 3.15.1（project.config.json 已设置）。
 * 模型调用形态由 utils/ai.js 自动适配：优先成长计划的 invoke()，
 * 基础库较旧时回退 generateText()，两者都失败才降级本地规则引擎。
 * 发帖审核仍走 moderation.js 的 generateText() 链路。
 *
 * ⚠️ 不要把任何 API Key / AppSecret 写进小程序前端代码。
 *    本方案走 wx.cloud.extend.AI，密钥由云开发平台保管，端上只有环境 ID。
 * ------------------------------------------------------------------
 */
module.exports = {
  // 云开发环境 ID（已通过 CloudBase 连接核对：个人版 / ap-shanghai / 绑定 wx214cdea17324bdf8）
  // 留空 = 未接入，辅食生成降级本地引擎、审核降级本地规则、数据层离线只读缓存
  ENV_ID: 'b1-2-d8gwni96j764b4f40',

  // 模型组：成长计划推荐的 'cloudbase'（支持全部模型、免开启、额度用尽自动切套餐）
  // 旧组 'hunyuan-v3' 仅支持 hy3 且即将废弃，勿用
  MODEL_GROUP: 'cloudbase',

  // 模型名：小程序成长计划免费额度覆盖的模型之一
  // 可选：'hy4' / 'hy4-preview' / 'hy3' / 'deepseek-v4.1-flash' / 'deepseek-v4.1-flash-1017'
  MODEL: 'deepseek-v4.1-flash',

  // 单次生成超时（毫秒）。非流式大模型首字较慢，页面已有等待秒数与 loading，
  // 放宽到 40s 避免频繁误降级；超时仍会自动切到本地引擎。
  TIMEOUT: 40000,

  // 结果被检测出含过敏食材时，自动重试的次数
  MAX_RETRY: 1,

  // 传给模型的「最近生成过、请避开」的食谱标题数量
  HISTORY_LIMIT: 4,

  /* ---------------- 发帖内容审核（pages/publish） ---------------- */

  MODERATION: {
    // 是否启用 AI 审核。关闭后只跑本地规则（线上不建议关闭）
    ENABLED: true,

    // 文字审核模型：显式指定，避免辅食生成换模型时把已跑通的审核链路一起改动。
    // 留空则复用上面的 MODEL。两者都是 cloudbase 组内的纯文本模型，可按需互换。
    TEXT_MODEL: 'hy4-preview',

    // 图片审核必须是「支持图片输入」的视觉模型，且需在控制台开启。
    // 官方多模态文档列出的可选模型：hunyuan-t1-vision-20250916 /
    // hy-vision-2.0-instruct / glm-5.3-flash 等，以控制台实际可用为准。
    VISION_MODEL: 'hunyuan-t1-vision-20250916',

    // createModel 的 provider，与辅食生成保持一致
    PROVIDER: 'cloudbase',

    // 单次审核超时（毫秒）。图片审核比纯文字慢，单独放宽
    TIMEOUT: 30000,

    // 最多可上传图片张数、单张原始大小上限（字节）
    MAX_IMAGES: 3,
    MAX_IMAGE_BYTES: 4 * 1024 * 1024,

    // AI 已启用但审核服务异常 / 返回无法解析时，是否拦截发布。
    // 合规场景必须 true：审核没跑完就不放行。
    BLOCK_ON_ERROR: true
  }
}
