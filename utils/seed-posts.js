/**
 * 社区演示内容 · 统一数据源
 * ------------------------------------------------------------------
 * 云端 bf_posts / bf_comments 与本地离线兜底共用这一份数据，
 * 避免云端清空后小程序启动又播回旧的 4 条演示帖。
 *
 * 归属约定（重要）：所有演示内容
 *   - isSeed: true / isMine: false
 *   - 不写 authorUid、不写 _openid、不写 _owner
 * 因此 isMineContent() 对任何账号都返回 false，
 * 「我的帖子」永远不会把这 33 条算进任何一个用户。
 *
 * 纯 ES5、无 wx / Node 依赖，小程序端与本地脚本都可直接 require。
 */

var AUTHORS = [
  { id: 'seed_u_01', name: '小满妈妈', avatar: '👩' },
  { id: 'seed_u_02', name: '豆豆的辅食日记', avatar: '🧑' },
  { id: 'seed_u_03', name: '安然', avatar: '👩‍🦰' },
  { id: 'seed_u_04', name: '南瓜妈妈', avatar: '🍼' },
  { id: 'seed_u_05', name: '团子妈', avatar: '👩' },
  { id: 'seed_u_06', name: '米粒妈妈', avatar: '👩‍🦱' },
  { id: 'seed_u_07', name: '果果爸', avatar: '🧔' },
  { id: 'seed_u_08', name: '小柚子', avatar: '🍊' },
  { id: 'seed_u_09', name: '汤圆麻麻', avatar: '🧕' },
  { id: 'seed_u_10', name: '一一爸爸', avatar: '👨' }
]

// 33 条演示帖：标题 / 正文 / 封面 / 关联食谱 / 标签
var TOPICS = [
  {
    title: '6月龄｜第一口米粉，稀到能挂住勺背就行',
    content: '别一上来就冲成糊，第一周用 70℃ 左右温水调成能缓缓流下的稀糊，一小勺试三天。我家娃第一天只吃了两口，第四天主动张嘴了，真的别急。',
    emoji: '🥣', slug: 'first-rice', recipe: '强化铁米粉稀糊', tags: ['6个月', '第一口辅食', '排敏']
  },
  {
    title: '蛋黄排敏第 1 天：1/4 个起步就够了',
    content: '全熟蛋黄压散，温水调稀拌进米粉，不加盐不加糖。连续观察三天有没有疹子、呕吐、腹泻，没问题再加到 1/2 个。蛋清留到 8 月龄以后再说。',
    emoji: '🥚', slug: 'egg-yolk-first', recipe: '蛋黄米粉糊', tags: ['8个月', '排敏', '补铁']
  },
  {
    title: '南瓜泥蒸多久不结块？我试了 4 次',
    content: '切 1cm 薄片上锅蒸 12 分钟，关火焖 2 分钟，压泥时加两勺温水再过一遍筛，口感完全不一样。之前蒸 20 分钟反而发干发苦。附一张今天的成品图。',
    emoji: '🎃', slug: 'pumpkin-steam', recipe: '细滑南瓜泥', tags: ['6个月', '第一口辅食', '备餐']
  },
  {
    title: '周日两小时备一周的辅食泥，冷冻格别塞太满',
    content: '南瓜、胡萝卜、西兰花、土豆分格冷冻，每格约 30g，三天内吃完。标签写日期和食材，别凭记忆猜，我踩过一次放了两周的坑。',
    emoji: '🧊', slug: 'freezer-prep', recipe: '', tags: ['备餐', '冷冻分装', '效率']
  },
  {
    title: '加辅食后便秘，西梅泥真管用但别贪多',
    content: '6 月龄以上可以试 1 小勺西梅泥，配温水，第二天就顺畅了。连着吃三天没改善就先停，问问医生，别自己加量。',
    emoji: '🍑', slug: 'prune-puree', recipe: '西梅苹果泥', tags: ['便秘', '6个月', '记录']
  },
  {
    title: '牛肉泥怎么打不柴？加一勺土豆泥',
    content: '里脊去筋膜焯水后蒸 20 分钟，打泥时分次加温水和一点土豆泥，细腻很多。单打牛肉真的像木屑，娃直接扭头不看我。',
    emoji: '🥩', slug: 'beef-puree', recipe: '牛肉土豆泥', tags: ['8个月', '补铁', '质地']
  },
  {
    title: '第一次吃三文鱼，观察了整整三天',
    content: '蒸熟压碎挑净刺，只给一小勺，混在常吃的米糊里。第 1、2 天都没事，第三天下午嘴角有点红，先停两周再试。排敏真的急不得。',
    emoji: '🐟', slug: 'salmon-first', recipe: '三文鱼米糊', tags: ['排敏', '8个月', '记录']
  },
  {
    title: '西兰花当手指食物，蒸到能用手指捏碎',
    content: '切成小树形状，蒸 8 分钟，软到一捏就碎但还能拿起来。第一次给娃抓了半小时，掉了 20 次，地上铺张垫子省心很多。',
    emoji: '🥦', slug: 'broccoli-finger', recipe: '西兰花小树', tags: ['10个月', '手指食物', '自主进食']
  },
  {
    title: '娃突然拒绝勺子，换成自己抓反而吃更多',
    content: '9 月龄那阵一看见勺子就扭头，改蒸软的南瓜条让他自己抓，一顿吃了小半碗。全程大人在旁边看着，别离开，圆形食物一定切开。',
    emoji: '✋', slug: 'self-feeding', recipe: '', tags: ['9个月', '自主进食', '拒食']
  },
  {
    title: '过敏宝宝避雷清单，我贴在冰箱上了',
    content: '蛋清、虾、芒果、花生目前全避。在食材清单里把这些标成「过敏」，生成食谱会自动绕开，比每次自己盯着配料表省心太多。',
    emoji: '🚫', slug: 'allergy-list', recipe: '', tags: ['过敏友好', '排敏', '食材清单']
  },
  {
    title: '米粉别用开水冲，营养和口感都毁了',
    content: '水温太高米粉会结块，还容易破坏添加的维生素。我用的是恒温壶 70℃，先水后粉、静置 30 秒再搅，基本没疙瘩。',
    emoji: '🌡️', slug: 'rice-water-temp', recipe: '强化铁米粉稀糊', tags: ['6个月', '冲调', '第一口辅食']
  },
  {
    title: '一周辅食表贴在餐椅后面，照着买菜就行',
    content: '周一南瓜、周二西兰花、周三牛肉、周四鳕鱼、周五红薯……新食材只安排在上午，方便观察反应。周末统一补货，工作日不手忙脚乱。',
    emoji: '🗓️', slug: 'weekly-plan', recipe: '', tags: ['备餐', '一周计划', '效率']
  },
  {
    title: '带娃出门吃饭，保温杯＋辅食剪够用了',
    content: '家里先装好温热的软饭和菜泥，出门两小时内吃完，回程不再复用。外面餐厅的汤和酱料一律不碰，一岁前不加盐这条要守住。',
    emoji: '👜', slug: 'eating-out', recipe: '', tags: ['外出', '备餐', '一岁前无盐']
  },
  {
    title: '9 月龄开始给手指食物，从条状开始',
    content: '别切小丁，先给能握住、露出一点点长度的条状，娃更好抓。葡萄、小番茄这类圆形食物一定纵向切四瓣，这步千万别省。',
    emoji: '🥕', slug: 'finger-shape', recipe: '蒸软胡萝卜条', tags: ['9个月', '手指食物', '安全']
  },
  {
    title: '番茄去皮别烫半天，划十字 30 秒够了',
    content: '顶部划十字，沸水里放 30 秒捞出来，皮一撕就掉。去籽再蒸，酸味淡很多，娃第一次吃没皱眉，拌小米粥很香。',
    emoji: '🍅', slug: 'tomato-peel', recipe: '番茄牛肉小米粥', tags: ['8个月', '补铁', '小技巧']
  },
  {
    title: '猪肝粉一周两次够不够？说说我的做法',
    content: '猪肝反复泡水去腥，煮熟烘干打粉，每次一小勺拌粥。补铁确实好，但别天天给，一周 1–2 次搭配红肉泥和强化铁米粉就够。',
    emoji: '🍲', slug: 'liver-powder', recipe: '猪肝粉小米粥', tags: ['补铁', '8个月', '质地']
  },
  {
    title: '不爱喝水的娃，换个吸管杯突然就会了',
    content: '6 月龄后辅食变稠，每次吃完给两口温水。鸭嘴杯他一直咬着玩，换成带重力球的吸管杯当天就喝了 40ml，工具真的看缘分。',
    emoji: '🥤', slug: 'straw-cup', recipe: '', tags: ['喝水', '6个月', '工具']
  },
  {
    title: '10 月龄三文鱼时蔬小饼，一次做 12 个',
    content: '三文鱼泥＋土豆泥＋焯碎西兰花，少量米粉调和，平底锅不加油小火两面煎。冷冻起来早上复热两分钟，救急神器，成品图放上来了。',
    emoji: '🍥', slug: 'salmon-patty', recipe: '三文鱼时蔬小饼', tags: ['10个月', '手指食物', '备餐']
  },
  {
    title: '断夜奶和加辅食别撞在同一周',
    content: '两件事一起上，娃白天吃得少、夜里又哭，全家崩溃。我们先把上午辅食稳住两周，再慢慢减夜奶，顺利很多。',
    emoji: '🌙', slug: 'night-weaning', recipe: '', tags: ['作息', '6个月', '经验']
  },
  {
    title: '削山药手痒到怀疑人生，一副手套解决',
    content: '山药黏液沾皮肤真的痒，戴一次性手套削皮、切段直接上锅蒸。蒸熟压泥带一点颗粒感，10 月龄娃挺买账。',
    emoji: '🍠', slug: 'yam-gloves', recipe: '山药小米泥', tags: ['10个月', '小技巧', '质地']
  },
  {
    title: '高铁米粉 vs 自制米糊，我最后两个都留着',
    content: '6 月龄第一口用强化铁米粉，图的是铁；7 月龄后偶尔换自熬米糊配菜泥，换换口感。自制的别当唯一铁来源，这点问过儿保。',
    emoji: '🍚', slug: 'iron-rice', recipe: '', tags: ['补铁', '6个月', '第一口辅食']
  },
  {
    title: '娃把碗掀了三次，我改成先不收走',
    content: '以前一掀就收，结果下一顿更抗拒。现在平静擦一下，隔十分钟再递一小勺，反而能吃几口。餐椅从第一口就坐，规矩比追着喂有用。',
    emoji: '🪑', slug: 'chair-rule', recipe: '', tags: ['就餐习惯', '拒食', '经验']
  },
  {
    title: '11 月龄从软烂粥过渡到软饭，别一步到位',
    content: '先按 3:1 的粥里掺一点点软饭，一周后加到 1:1，让娃慢慢练咀嚼。直接换干饭那次呛了两回，吓得我退回去重来。',
    emoji: '🍛', slug: 'soft-rice', recipe: '三色软饭', tags: ['11个月', '咀嚼', '质地']
  },
  {
    title: '一岁前不加盐不加糖，跟家里老人同步一次',
    content: '不是「少放一点」，是完全不放。把这条打印贴在厨房，比每次口头解释省事。南瓜、番茄本身就有味道，娃根本不缺。',
    emoji: '🧂', slug: 'no-salt', recipe: '', tags: ['一岁前无盐', '习惯', '家庭共识']
  },
  {
    title: '牛油果香蕉泥，五分钟搞定的下午加餐',
    content: '半个牛油果＋半根熟香蕉压泥，不加水不加糖，绵密又顶饿。牛油果容易氧化，现做现吃，别放冰箱等晚上。',
    emoji: '🥑', slug: 'avocado-banana', recipe: '牛油果香蕉泥', tags: ['8个月', '加餐', '5分钟']
  },
  {
    title: '鳕鱼蒸蛋（蛋清确认排敏之后才敢做）',
    content: '鳕鱼去刺压碎，蛋液加 1.5 倍温水过筛，盖保鲜膜小火蒸 10 分钟。嫩到娃自己用勺子挖，一次吃了小半碗。',
    emoji: '🍳', slug: 'cod-egg', recipe: '鳕鱼蒸蛋', tags: ['10个月', '排敏', '补蛋白']
  },
  {
    title: '把过敏食材标红之后，生成食谱真的会避开',
    content: '在食材清单里把虾和蛋清标成「过敏」，点生成专属辅食，给的方子一次都没出现这两样。餐次、质地、宝宝月龄也都能选，省了我很多脑细胞。配图是今天的成品。',
    emoji: '🤖', slug: 'ai-recipe', recipe: '', tags: ['过敏友好', 'AI食谱', '工具']
  },
  {
    title: '胡萝卜不用过油，蒸软压泥一样好',
    content: '总听说胡萝卜素要油才吸收，其实同一顿里有别的一点脂肪就够了。蒸 10 分钟压泥，娃接受度比炒过的高，也不油腻。',
    emoji: '🥕', slug: 'carrot-steam', recipe: '胡萝卜土豆泥', tags: ['7个月', '小技巧', '质地']
  },
  {
    title: '第一次吃虾：1/8 只起步，特意安排在上午',
    content: '蒸熟剁成极细的泥，混在已吃过的米糊里，只给一小勺。安排在上午方便白天观察，连着三天没反应才敢慢慢加量。',
    emoji: '🦐', slug: 'shrimp-first', recipe: '', tags: ['排敏', '记录', '10个月']
  },
  {
    title: '辅食后大便变稀或变干，先回看这三件事',
    content: '新食材是不是一次加了两样、纤维是不是突然变多、水是不是没跟上。大多数情况停新食材两天就恢复，持续异常还是去看医生。',
    emoji: '📋', slug: 'poop-check', recipe: '', tags: ['记录', '6个月', '经验']
  },
  {
    title: '餐椅要从第一口辅食就开始坐',
    content: '一开始家里人说抱着喂方便，坚持了两周就成习惯了。现在一坐上餐椅就知道要吃饭，不追不哄，一顿 20 分钟结束。',
    emoji: '🪑', slug: 'high-chair', recipe: '', tags: ['就餐习惯', '6个月', '经验']
  },
  {
    title: '换季食欲差，别硬喂也别换着花样哄',
    content: '这两天娃每顿只吃几口，我把新食材全停了，只给吃惯的南瓜小米粥，两天后自己回来了。生长曲线正常就别太焦虑。',
    emoji: '🍂', slug: 'appetite', recipe: '', tags: ['拒食', '换季', '经验']
  },
  {
    title: '12 月龄，终于能跟我们同桌吃饭了',
    content: '把大人的菜在放调料前先盛出一小份，切碎、不放盐，软饭配着吃。娃看我们吃自己也吃得香，这顿饭的意义比营养大。',
    emoji: '🍽️', slug: 'family-table', recipe: '家常软饭配时蔬', tags: ['12个月', '家庭餐', '咀嚼']
  }
]

// 云存储里唯一一张历史成品图，给 3 条帖子做单图展示（其余用渐变封面）
var POST_IMAGE = 'cloud://b1-2-d8gwni96j764b4f40.6231-b1-2-d8gwni96j764b4f40-1525365538/post-images/img_mw320ec6_jsjj.png'
var IMAGE_INDEXES = [2, 17, 26]

var COMMENT_INDEXES = [1, 4, 7, 10, 15, 21, 24, 30]
var COMMENT_TEXTS = [
  '请问是冷水下锅还是水开后下锅呀？',
  '我家也是这个月龄，明天照着试一次～',
  '排敏真的要连着观察三天，别偷懒',
  '收藏了，周末备餐安排上',
  '这个分装盒求个同款，不是广告哈',
  '把过敏食材标红之后生成食谱会自动避开，太省心',
  '第一次做就成功，感谢写得这么细！',
  '西梅泥别一次给太多，我们踩过坑',
  '蒸 12 分钟刚好，我上次蒸久了有点发苦',
  '同款餐椅，从第一口就坐真的省事',
  '一岁前不加盐这点，家里老人也要同步一下',
  '娃把碗掀了先别急着收，过十分钟再试',
  '牛油果现做现吃这点太对了，氧化后颜色吓人',
  '同款冻格，标签一定写日期，血的教训',
  '圆形食物切四瓣这条希望所有人都看到',
  '同桌吃饭之后娃胃口明显好了，深有同感'
]

var SPAN = 3 * 86400000

/** 固定种子的伪随机：保证云端导入与本地兜底生成出完全相同的数据 */
function rand(seed) {
  var s = seed >>> 0
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/**
 * 生成 33 条帖子。时间均匀铺在「baseTs 往前 3 天」到「15 分钟前」之间，
 * 带 ±10 分钟抖动，最新一条也不会是未来时间。
 */
function buildPosts(baseTs) {
  var t = Number(baseTs) || Date.now()
  var r = rand(20261107)
  var start = t - SPAN + 20 * 60000
  var end = t - 15 * 60000
  return TOPICS.map(function (item, i) {
    var jitter = Math.round((r() - 0.5) * 20 * 60000)
    var author = AUTHORS[(i * 7 + 3) % AUTHORS.length]
    return {
      id: 'post_seed_' + (101 + i),
      authorId: author.id,
      authorName: author.name,
      authorAvatar: author.avatar,
      isMine: false,
      isSeed: true,
      title: item.title,
      content: item.content,
      coverEmoji: item.emoji,
      coverSeed: 'seed-' + item.slug,
      recipeTitle: item.recipe || '',
      tags: item.tags.slice(),
      images: IMAGE_INDEXES.indexOf(i) >= 0 ? [POST_IMAGE] : [],
      likeCount: 12 + Math.floor(r() * 240),
      favCount: 2 + Math.floor(r() * 90),
      commentCount: 0,
      createdAt: Math.round(start + (end - start) * i / (TOPICS.length - 1)) + jitter
    }
  })
}

/**
 * 生成配套评论并回填帖子的 commentCount。
 * 评论同样 isSeed:true，不带任何归属字段，不会显示成「我的评论」。
 */
function buildComments(baseTs, posts) {
  var t = Number(baseTs) || Date.now()
  var r = rand(81107)
  var list = []
  COMMENT_INDEXES.forEach(function (pi, gi) {
    var post = posts[pi]
    if (!post) return
    for (var k = 0; k < 2; k++) {
      var ci = gi * 2 + k
      var author = AUTHORS[(ci * 3 + 1) % AUTHORS.length]
      post.commentCount += 1
      list.push({
        id: 'c_' + (101 + ci),
        postId: post.id,
        authorName: author.name,
        avatar: author.avatar,
        content: COMMENT_TEXTS[ci],
        isSeed: true,
        createdAt: Math.min(t - 60000, post.createdAt + (k + 1) * 3600000 + Math.floor(r() * 600000))
      })
    }
  })
  return list
}

module.exports = {
  AUTHORS: AUTHORS,
  TOPICS: TOPICS,
  SPAN: SPAN,
  buildPosts: buildPosts,
  buildComments: buildComments
}
