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
 * 环境要求：微信基础库 ≥ 3.17.4（project.config.json 已设置）。
 * 生文 / 审核 3.15.1 即可；生图（IMAGE）必须 3.17.4+ 才有 createImageModel。
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
  },

  /* ---------------- 生图小助手（pages/image-gen） ---------------- */

  /**
   * 生图小助手只使用「小程序成长计划」赠送的生图额度，不走资源点套餐。
   *
   * 官方口径（2026-11-07 核对 docs.cloudbase.net/ai/ai-inspire-plan-guide）：
   * - createImageModel('hunyuan-image')：hunyuan-image 就是「小程序成长计划生图
   *   Provider」，仅消耗成长计划赠送的生图资源包。生文用的 MODEL_GROUP:'cloudbase'
   *   走 Token 资源包 / 资源点套餐，与生图额度是两个独立池子，勿把两者混用。
   * - 成长计划二期（2026-07-01 ~ 2026-12-31）AI 资源包：10 亿 Token + 10 万张生图，
   *   自领取日起 6 个月有效，仅限微信小程序与云开发服务端使用。
   * - 成长计划当前可用的生图模型：
   *     文生图 HY-Image-3.0-Plus-4090-Tob-v1.0（本页使用，消费生图额度）
   *     图生图 HY-Image-v3.0-I2I-ToB-v1.0.1（需垫图 image_urls / images，本页未启用）
   *   一期的 hunyuan-image / hunyuan-image-v3.0-v1.0.4 已于 2026-07-15 下线，勿填回。
   *
   * 前置条件（缺一不可，页面会做能力探测并给出提示）：
   * 1. 微信基础库 >= 3.17.4（project.config.json 的 libVersion 已调整）；
   * 2. 云开发环境已 init 成功（app.js 里 CLOUD.init）；
   * 3. 微信公众平台「行业能力 → 小程序成长计划」已领取 AI 资源包且生图额度未用尽。
   *
   * ⚠️ 模型下线：上述两个 3.0 模型于 2026-12-01 0 点下线，接替模型
   *   hy-image-v3.5-preview 预计 2026-11 月中旬提供，调用方式与 3.0 不同（改造点待
   *   官方通知），但适用范围仍是「小程序成长计划赠送的生图额度」。届时只需改
   *   MODELS，并按官方新文档调整 utils/image-gen.js 的 buildPayload /
   *   createImageModel 调用形态；页面层不用改。
   */
  IMAGE: {
    // 成长计划生图 Provider，固定值。改成 'cloudbase' 会改走资源点套餐，不要改。
    PROVIDER: 'hunyuan-image',

    // 成长计划信息：页面说明与错误排查文案共用
    PLAN_NAME: '小程序成长计划',
    MODEL_LABEL: '混元生图 3.0',
    CREDIT_HINT: '微信公众平台 → 行业能力 → 小程序成长计划 → 查看用量',

    // 按顺序尝试的候选模型，必须都是成长计划额度内的「文生图」模型。
    // 图生图模型 HY-Image-v3.0-I2I-ToB-v1.0.1 需要垫图，不能作为重试候选。
    MODELS: ['HY-Image-3.0-Plus-4090-Tob-v1.0'],

    // 官方支持的尺寸（小程序端文档列出 4 种）；非法值会回退到 SIZE
    SIZE: '1024x1024',
    ALLOWED_SIZES: ['1024x1024', '1280x720', '720x1280', '1280x1280'],
    SIZES: [
      { label: '方形 1:1', value: '1024x1024' },
      { label: '横版 16:9', value: '1280x720' },
      { label: '竖版 9:16', value: '720x1280' }
    ],

    // 是否让模型自动润色提示词（返回 revised_prompt）
    REVISE: true,

    // 自定义水印文案（官方 footnote 参数）：最长 16 字符，服务端在图片右下角同步添加。
    // 平台按法规强制添加「显式 + 隐式」两套 AI 标识，接口没有关闭水印的参数，
    // 这里只能改文案，且必须明确含 AI / 人工智能等生成含义。留空 = 平台默认水印。
    // 不要传空白、纯装饰文字，也不要裁剪/擦除图片来规避标识（属于隐匿 AI 标识）。
    FOOTNOTE: 'AI 生成 · 辅食灵感',
    FOOTNOTE_MAX: 16,

    // prompt 上限（官方限制 500 字）、单次请求超时、外层总超时
    MAX_PROMPT: 500,
    TIMEOUT: 120000,
    TOTAL_TIMEOUT: 150000,

    // 生成结果 URL 只有 24 小时有效，过期后页面显示「链接已失效」；
    // 「保存到相册」会先把图片转存成小程序本地永久文件，不受 24 小时限制。
    URL_TTL: 24 * 3600 * 1000
  }
}
