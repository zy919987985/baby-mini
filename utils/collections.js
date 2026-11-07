/**
 * 云开发集合名（唯一来源）
 * ------------------------------------------------------------------
 * 权限由云端安全规则控制，端上不持有任何密钥：
 *   bf_user_state  PRIVATE：仅创建者可读写（宝宝、食材、点赞收藏、消息）
 *   bf_posts       CUSTOM ：读 true / 写 true（全端共享的社区帖子）
 *   bf_comments    CUSTOM ：读 true / 写 true（评论）
 *
 * 小程序端 store.js 从这里取名字，避免各处硬编码。
 */
module.exports = {
  STATE: 'bf_user_state',
  POSTS: 'bf_posts',
  COMMENTS: 'bf_comments'
}
