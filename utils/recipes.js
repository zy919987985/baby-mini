/**
 * 辅食生成引擎（本地规则版 · 降级兜底）
 * 依据宝宝月龄、餐次、质地、可用食材、过敏标记生成带详细制作过程的食谱。
 * 主链路已改为 utils/ai.js 调用云端大模型；本文件在 AI 未配置/超时/结果不合格时兜底，
 * 保证「生成专属辅食」在任何情况下都能出结果。
 */
const ING = require('./ingredients')
const U = require('./util')

const STAGES = [
  { min: 0, max: 7, name: '吞咽期', texture: '细腻泥糊', feeding: '每天 1-2 次，每次 1-2 勺起步', desc: '单一食材、稀滑无颗粒，不加盐糖油' },
  { min: 8, max: 9, name: '蠕嚼期', texture: '带小颗粒的稠泥', feeding: '每天 2 次，可开始手指食物', desc: '可混合 2-3 种食材，用舌头能压碎的软颗粒' },
  { min: 10, max: 11, name: '细嚼期', texture: '碎末 / 软小块', feeding: '每天 2-3 次，逐步跟餐', desc: '切成 0.5cm 小丁，练习咀嚼' },
  { min: 12, max: 17, name: '咀嚼期', texture: '软烂小丁 / 小饼', feeding: '每天 3 次正餐 + 1-2 次加餐', desc: '清淡少盐，可吃软烂的家庭餐' },
  { min: 18, max: 72, name: '成人过渡期', texture: '家常软食', feeding: '三餐两点，规律作息', desc: '注意均衡多样，避免整粒坚果与果冻' }
]

/**
 * 月龄归一：0 是合法值（新生儿），不能用 `Number(v) || 6` 把 0 兜底成 6 个月，
 * 否则降级引擎会给不满 6 个月的宝宝放出 6 月龄食材。
 */
function normalizeMonths(v) {
  const n = Number(v)
  if (v === 0) return 0
  if (v === undefined || v === null || v === '' || !isFinite(n)) return 6
  return Math.max(0, Math.min(72, Math.floor(n)))
}

function stageFor(months) {
  const m = normalizeMonths(months)
  return STAGES.filter(function (s) { return m >= s.min && m <= s.max })[0] || STAGES[0]
}

const MEALS = ['早餐', '午餐', '晚餐', '加餐']

const TEMPLATES = [
  {
    id: 'pumpkin_rice', mainId: 'pumpkin', title: '南瓜铁米粉糊', emoji: '🎃', minMonth: 6,
    meals: ['早餐', '加餐'], tags: ['补铁', '好消化', '第一口辅食'],
    ingredients: [{ name: '南瓜', amount: '40g' }, { name: '强化铁米粉', amount: '15g' }, { name: '温水 / 母乳', amount: '60ml' }],
    nutrition: '碳水化合物 + 铁 + β-胡萝卜素',
    steps: [
      { t: '选瓜与处理', d: '挑表皮橙黄、手感沉的贝贝南瓜，去皮去瓤，切成 2cm 小块，约 40g。' },
      { t: '清洗浸泡', d: '南瓜块用流动清水冲洗，浸泡 5 分钟后沥干，去除表面杂质。' },
      { t: '上锅蒸熟', d: '水开后上蒸锅，中火蒸 12-15 分钟，筷子能轻松插入即可。' },
      { t: '压泥过筛', d: '用勺背压成泥，再用细筛网过一遍，确保没有纤维和硬块。' },
      { t: '冲调米粉', d: '米粉倒入碗中，分 2-3 次加入 60ml 约 70℃ 温水，同方向搅匀至顺滑。' },
      { t: '混合调稠', d: '把南瓜泥拌入米糊，调整到勺子倾斜时能缓慢流下的稠度。' },
      { t: '试温喂食', d: '滴一滴在手腕内侧确认不烫，用小软勺从嘴角送入，观察吞咽。' }
    ],
    tips: ['第一次只喂 1-2 勺，连续观察 3 天有无皮疹、呕吐或腹泻。', '剩余的南瓜泥可分装冷冻，24 小时内吃完。']
  },
  {
    id: 'carrot_potato', mainId: 'carrot', title: '胡萝卜土豆双色泥', emoji: '🥕', minMonth: 6,
    meals: ['午餐', '晚餐'], tags: ['护眼', '膳食纤维'],
    ingredients: [{ name: '胡萝卜', amount: '30g' }, { name: '土豆', amount: '40g' }, { name: '温水', amount: '适量' }],
    nutrition: 'β-胡萝卜素 + 钾 + 淀粉',
    steps: [
      { t: '备料', d: '胡萝卜、土豆分别去皮，切成 1.5cm 薄片，缩短蒸制时间。' },
      { t: '去涩', d: '胡萝卜片用清水泡 5 分钟；土豆片泡水去多余淀粉，避免发黏。' },
      { t: '分格蒸制', d: '蒸锅上汽后放入，中火蒸 15 分钟至两种食材都完全软烂。' },
      { t: '分别打泥', d: '胡萝卜加少量温水打成细泥；土豆用勺背压泥，不要料理机久打以免发黏。' },
      { t: '调味（不加盐）', d: '两泥混合，滴入 2-3 滴橄榄油帮助脂溶性维生素吸收，不加任何调味料。' },
      { t: '过筛与造型', d: '过筛一次后装碗，可用勺背压出双色漩涡，提升宝宝兴趣。' },
      { t: '喂食要点', d: '温度降到 40℃ 以下再喂，一次不超过半碗。' }
    ],
    tips: ['胡萝卜连续大量食用可能让皮肤发黄，停几天即可恢复。', '土豆发芽发绿的部分务必整块丢弃。']
  },
  {
    id: 'broccoli_rice', mainId: 'broccoli', title: '西兰花小米粥', emoji: '🥦', minMonth: 7,
    meals: ['午餐', '晚餐'], tags: ['维生素C', '补铁搭档'],
    ingredients: [{ name: '西兰花', amount: '30g' }, { name: '小米', amount: '25g' }, { name: '清水', amount: '300ml' }],
    nutrition: '维生素 C + 膳食纤维 + B 族维生素',
    steps: [
      { t: '浸泡西兰花', d: '掰成小朵，用淡盐水浸泡 10 分钟，流水冲净缝隙里的杂质。' },
      { t: '焯水', d: '水开后下锅焯 2 分钟，捞出过凉水，保持翠绿并去除涩味。' },
      { t: '切碎', d: '只取花冠部分，切成细末；粗茎留作大人食用。' },
      { t: '熬小米粥', d: '小米淘洗后加 300ml 水，大火煮开转小火熬 25 分钟，中途搅动防糊底。' },
      { t: '合并再煮', d: '加入西兰花末再煮 5 分钟，让味道融合。' },
      { t: '调质地', d: '按月龄决定保留颗粒还是用勺背压成稠糊。' },
      { t: '装碗', d: '晾至温热，滴 2 滴亚麻籽油拌匀即可。' }
    ],
    tips: ['西兰花易产气，初次少量尝试。', '搭配富含铁的肉泥一起吃，维 C 能促进铁吸收。']
  },
  {
    id: 'egg_yolk', mainId: 'egg_yolk', title: '蛋黄南瓜糊', emoji: '🥚', minMonth: 7,
    meals: ['早餐', '午餐'], tags: ['补铁', '高蛋白', '需排敏'],
    ingredients: [{ name: '鸡蛋', amount: '1 个' }, { name: '南瓜泥', amount: '30g' }, { name: '温水', amount: '适量' }],
    nutrition: '铁 + 卵磷脂 + 优质蛋白',
    steps: [
      { t: '洗蛋', d: '鸡蛋外壳用清水洗净，避免敲开时蛋壳污染蛋液。' },
      { t: '冷水下锅', d: '鸡蛋冷水入锅，水开后煮 10 分钟，捞出立刻放冷水降温。' },
      { t: '取蛋黄', d: '剥壳对半切开，取出完整蛋黄，去掉表面灰绿色薄膜。' },
      { t: '按比例取用', d: '第一次只用 1/4 个蛋黄，无异常后逐步加到 1/2 个、1 个。' },
      { t: '研泥调稀', d: '用勺背把蛋黄压散，分次加温水调成能流动的糊状，避免干噎。' },
      { t: '与南瓜泥混合', d: '拌入蒸好的南瓜泥，口感更顺滑、也更容易被接受。' },
      { t: '观察', d: '喂食后 2 小时内留意口周红疹、呕吐、便血等过敏信号。' }
    ],
    tips: ['蛋黄属于高致敏食材，务必单独连续试 3 天。', '1 岁前不吃蛋清；确认不过敏后再尝试全蛋。']
  },
  {
    id: 'apple_pear', mainId: 'apple', title: '苹果雪梨蒸泥', emoji: '🍎', minMonth: 6,
    meals: ['加餐'], tags: ['润燥', '天然甜味'],
    ingredients: [{ name: '苹果', amount: '半个' }, { name: '雪梨', amount: '1/4 个' }, { name: '清水', amount: '少量' }],
    nutrition: '果胶 + 水分 + 钾',
    steps: [
      { t: '清洗去皮', d: '苹果、梨用流水搓洗干净，去皮去核，切成薄片。' },
      { t: '隔水蒸', d: '放入小碗，加 1 勺清水，水开后蒸 8-10 分钟至半透明。' },
      { t: '保留汤汁', d: '蒸出的果水不要倒掉，一起打泥可保留水溶性维生素。' },
      { t: '刮泥 / 打泥', d: '6-7 月龄用勺子刮成果泥；8 月龄以上可留极细颗粒。' },
      { t: '控量', d: '初次 1-2 小勺即可，水果不替代正餐奶量。' },
      { t: '现做现吃', d: '果泥易氧化变色，做好后 20 分钟内吃完。' }
    ],
    tips: ['蒸熟的水果比生食更温和，适合刚加辅食的宝宝。', '不建议额外加糖或蜂蜜（1 岁前禁蜂蜜）。']
  },
  {
    id: 'avocado_banana', mainId: 'avocado', title: '牛油果香蕉泥', emoji: '🥑', minMonth: 6,
    meals: ['加餐', '早餐'], tags: ['优质脂肪', '免开火'],
    ingredients: [{ name: '牛油果', amount: '1/4 个' }, { name: '香蕉', amount: '半根' }],
    nutrition: '不饱和脂肪酸 + 钾 + 膳食纤维',
    steps: [
      { t: '判断成熟度', d: '牛油果轻按微陷、果皮深褐为佳；香蕉选带少量斑点的熟香蕉。' },
      { t: '取果肉', d: '牛油果对半切开挖核，用勺子挖出 1/4 个果肉。' },
      { t: '压泥', d: '两种果肉放碗中，用叉子反复压到完全顺滑无纤维。' },
      { t: '调整稠度', d: '太稠可加 1-2 勺母乳或配方奶调稀。' },
      { t: '立即食用', d: '牛油果和香蕉都易氧化，建议 10 分钟内吃完。' },
      { t: '观察便便', d: '脂肪含量较高，首次少量，观察有无腹泻。' }
    ],
    tips: ['可抹在蒸软的面包条上，作为 9 月龄以上的手指食物。', '开封后的牛油果可挤柠檬汁防氧化，但宝宝餐建议现切现吃。']
  },
  {
    id: 'cod_pumpkin', mainId: 'cod', title: '鳕鱼南瓜浓汤', emoji: '🐟', minMonth: 8,
    meals: ['午餐', '晚餐'], tags: ['DHA', '高蛋白', '需排敏'],
    ingredients: [{ name: '鳕鱼', amount: '30g' }, { name: '南瓜', amount: '50g' }, { name: '柠檬', amount: '1 片' }, { name: '清水', amount: '150ml' }],
    nutrition: '优质蛋白 + DHA + 胡萝卜素',
    steps: [
      { t: '解冻与检查', d: '鳕鱼提前冷藏解冻，用手指仔细摸一遍确认没有细刺。' },
      { t: '去腥', d: '放 1 片柠檬腌 10 分钟，冲洗后擦干。' },
      { t: '蒸鱼', d: '水开后蒸 8 分钟，取出用叉子压散成鱼蓉。' },
      { t: '蒸南瓜', d: '南瓜去皮切块，蒸 12 分钟至软烂后压泥。' },
      { t: '煮浓汤', d: '南瓜泥加 150ml 清水小火煮开，倒入鱼蓉搅匀再煮 3 分钟。' },
      { t: '调质地', d: '8 月龄过筛成浓汤；10 月龄以上保留鱼蓉颗粒。' },
      { t: '试温', d: '晾到 40℃ 左右，先喂一小勺观察反应。' }
    ],
    tips: ['鱼类属于高致敏食材，首次安排在上午，方便白天观察。', '不要选腌制或重盐的「银鳕鱼」制品。']
  },
  {
    id: 'beef_tomato', mainId: 'beef', title: '番茄牛肉小米粥', emoji: '🥩', minMonth: 8,
    meals: ['午餐', '晚餐'], tags: ['补铁', '高蛋白'],
    ingredients: [{ name: '牛里脊', amount: '30g' }, { name: '番茄', amount: '半个' }, { name: '小米', amount: '25g' }],
    nutrition: '血红素铁 + 维 C 促吸收 + 锌',
    steps: [
      { t: '处理牛肉', d: '牛里脊去筋膜，切小块，冷水浸泡 20 分钟去血水。' },
      { t: '焯水打泥', d: '冷水下锅煮开撇沫，捞出后加少量温水打成细肉泥。' },
      { t: '番茄去皮', d: '番茄顶部划十字，开水烫 30 秒去皮，去籽后切碎。' },
      { t: '熬粥底', d: '小米加 10 倍水，小火熬 25 分钟成软烂粥底。' },
      { t: '合煮', d: '先放番茄碎煮 5 分钟出味，再放牛肉泥搅散煮 5 分钟。' },
      { t: '防结块', d: '肉泥下锅时边倒边搅，避免成团影响口感。' },
      { t: '收尾', d: '滴 2 滴橄榄油，晾温后食用。' }
    ],
    tips: ['牛肉纤维粗，务必要打细；8 月龄建议过筛。', '番茄偏酸，若口周发红可减量或延后引入。']
  },
  {
    id: 'sweet_potato', mainId: 'sweet_potato', title: '红薯燕麦软粥', emoji: '🍠', minMonth: 8,
    meals: ['早餐', '加餐'], tags: ['通便', '饱腹'],
    ingredients: [{ name: '红薯', amount: '50g' }, { name: '即食燕麦', amount: '15g' }, { name: '清水', amount: '200ml' }],
    nutrition: '膳食纤维 + 复合碳水',
    steps: [
      { t: '蒸红薯', d: '红薯去皮切块，蒸 15 分钟至筷子轻松穿透。' },
      { t: '压泥', d: '趁热压成细泥，挑出粗纤维。' },
      { t: '煮燕麦', d: '燕麦加 200ml 水小火煮 8 分钟，煮到完全糊化。' },
      { t: '混合', d: '倒入红薯泥搅匀，再煮 2 分钟。' },
      { t: '调稠度', d: '按宝宝吞咽能力加水或延长收煮时间。' },
      { t: '食用', d: '温热食用，可搭配已排敏的高铁食材，营养更均衡。' }
    ],
    tips: ['燕麦含麸质，首次少量尝试并观察 3 天。', '红薯易胀气，不要连续多餐大量吃。']
  },
  {
    id: 'tofu_veg', mainId: 'tofu', title: '豆腐青菜碎碎羹', emoji: '🧈', minMonth: 8,
    meals: ['午餐', '晚餐'], tags: ['植物蛋白', '补钙'],
    ingredients: [{ name: '嫩豆腐', amount: '50g' }, { name: '小白菜嫩叶', amount: '20g' }, { name: '清水', amount: '120ml' }],
    nutrition: '植物蛋白 + 钙 + 叶酸',
    steps: [
      { t: '豆腐焯水', d: '嫩豆腐切小块，沸水焯 1 分钟去豆腥，捞出沥干。' },
      { t: '青菜处理', d: '只取嫩叶，沸水焯 1 分钟后过凉，切成极细的碎末。' },
      { t: '煮羹', d: '小锅加 120ml 清水煮开，放入豆腐块小火煮 5 分钟。' },
      { t: '压碎', d: '用勺背把豆腐压成小碎块，方便宝宝抿碎。' },
      { t: '下青菜', d: '加入青菜末再煮 2 分钟，关火。' },
      { t: '勾薄芡（可选）', d: '10 月龄以上可加少量水淀粉让汤汁挂勺，不易洒。' },
      { t: '晾温', d: '盛出晾至温热，配软饭一起吃。' }
    ],
    tips: ['豆腐属豆制品，首次单独尝试确认无腹胀、皮疹。', '1 岁前不放盐、酱油等调味。']
  },
  {
    id: 'chicken_corn', mainId: 'chicken', title: '鸡肉玉米浓汤', emoji: '🍗', minMonth: 9,
    meals: ['午餐', '晚餐'], tags: ['高蛋白', '清甜'],
    ingredients: [{ name: '鸡胸肉', amount: '30g' }, { name: '甜玉米粒', amount: '30g' }, { name: '清水', amount: '180ml' }],
    nutrition: '优质蛋白 + 叶黄素 + 碳水',
    steps: [
      { t: '鸡肉去筋', d: '鸡胸肉去掉筋膜，切小块，用姜片水泡 10 分钟去腥。' },
      { t: '煮熟打泥', d: '冷水下锅煮 12 分钟，捞出加少量汤打成细肉泥。' },
      { t: '玉米处理', d: '玉米粒蒸 10 分钟后去皮，打成玉米泥并过筛去渣。' },
      { t: '合煮', d: '两种泥加 180ml 清水小火煮开，持续搅拌 5 分钟。' },
      { t: '调质地', d: '9 月龄保留细颗粒，8 月龄请过筛后食用。' },
      { t: '食用', d: '温热时食用，可拌入软饭或面条。' }
    ],
    tips: ['玉米外皮不易消化，务必过筛。', '鸡肉偏干，打泥时加汤而不是加水，口感更顺滑。']
  },
  {
    id: 'pork_liver', mainId: 'pork_liver', title: '猪肝菠菜补铁粥', emoji: '🥬', minMonth: 8,
    meals: ['午餐'], tags: ['高效补铁', '每周1-2次'],
    ingredients: [{ name: '猪肝', amount: '20g' }, { name: '菠菜嫩叶', amount: '15g' }, { name: '大米', amount: '25g' }],
    nutrition: '血红素铁 + 维 A + 叶酸',
    steps: [
      { t: '浸泡去血水', d: '猪肝切薄片，用清水反复浸泡换水 30 分钟。' },
      { t: '焯煮', d: '冷水下锅加姜片煮 8 分钟，撇净浮沫后捞出。' },
      { t: '打泥过筛', d: '猪肝加少量温水打成泥，过筛去掉筋膜颗粒。' },
      { t: '菠菜焯水', d: '菠菜沸水焯 1 分钟去草酸，切极细末。' },
      { t: '熬粥', d: '大米加 10 倍水熬 30 分钟至开花软烂。' },
      { t: '合并', d: '放猪肝泥与菠菜末，再煮 5 分钟搅匀。' },
      { t: '控频率', d: '每次约 20g，每周 1-2 次即可，不天天吃。' }
    ],
    tips: ['猪肝维 A 含量高，过量可能蓄积，务必控制频次。', '选颜色鲜红、有弹性、无异味的新鲜猪肝。']
  },
  {
    id: 'salmon_veg', mainId: 'salmon', title: '三文鱼时蔬小饼', emoji: '🍣', minMonth: 10,
    meals: ['午餐', '加餐'], tags: ['DHA', '手指食物'],
    ingredients: [{ name: '三文鱼', amount: '40g' }, { name: '胡萝卜', amount: '20g' }, { name: '土豆', amount: '50g' }],
    nutrition: 'DHA + 优质蛋白 + 复合碳水',
    steps: [
      { t: '鱼肉处理', d: '三文鱼仔细检查细刺，切小块后用柠檬片腌 10 分钟。' },
      { t: '蒸熟压散', d: '上锅蒸 8 分钟，取出用叉子压成鱼蓉。' },
      { t: '备蔬菜', d: '土豆蒸熟压泥，胡萝卜擦成细末后蒸 8 分钟。' },
      { t: '拌馅', d: '三种材料混合拌匀，不加盐，靠土豆的黏性成团。' },
      { t: '整形', d: '手心沾水，取一小团压成直径 4cm、厚 1cm 的小饼。' },
      { t: '煎 / 烤', d: '不粘锅刷薄油小火两面各煎 2 分钟，或烤箱 180℃ 烤 12 分钟。' },
      { t: '切成条', d: '晾温后切成宝宝能握住的长条，鼓励自主进食。' }
    ],
    tips: ['鱼类高致敏，首次单独试吃确认不过敏后再做混合食谱。', '手指食物全程需大人在旁看护，避免噎食。']
  },
  {
    id: 'millet_yam', mainId: 'yam', title: '山药小米养胃粥', emoji: '🍠', minMonth: 7,
    meals: ['早餐', '晚餐'], tags: ['温和', '好消化'],
    ingredients: [{ name: '铁棍山药', amount: '40g' }, { name: '小米', amount: '25g' }, { name: '清水', amount: '300ml' }],
    nutrition: '淀粉酶 + 黏蛋白 + B 族维生素',
    steps: [
      { t: '防手痒', d: '山药戴手套去皮，切段后立刻泡入清水防氧化。' },
      { t: '蒸软', d: '上锅蒸 15 分钟至能用勺子轻松压碎。' },
      { t: '压泥', d: '趁热压成细泥，过筛更细腻。' },
      { t: '熬粥', d: '小米淘洗后加 300ml 水，小火熬 25 分钟。' },
      { t: '合并', d: '加入山药泥搅匀，再煮 5 分钟至顺滑。' },
      { t: '食用', d: '温热食用，适合胃口不佳或转奶期。' }
    ],
    tips: ['山药黏液可能刺激皮肤，处理时务必戴手套。', '便秘期宝宝可减量，山药偏收涩。']
  },
  {
    id: 'blueberry_yogurt', mainId: 'blueberry', title: '蓝莓酸奶谷物杯', emoji: '🫐', minMonth: 12,
    meals: ['加餐'], tags: ['益生菌', '手指食物'],
    ingredients: [{ name: '蓝莓', amount: '30g' }, { name: '无糖原味酸奶', amount: '80g' }, { name: '即食燕麦', amount: '10g' }],
    nutrition: '花青素 + 益生菌 + 钙',
    steps: [
      { t: '清洗蓝莓', d: '蓝莓用淡盐水泡 5 分钟，流水冲净后沥干。' },
      { t: '切分防噎', d: '每颗蓝莓纵向切成 4 份，整粒有噎食风险。' },
      { t: '选酸奶', d: '配料表只有生牛乳与发酵菌，无糖无代糖，1 岁以上再引入。' },
      { t: '组装', d: '杯底铺酸奶，撒燕麦，放蓝莓碎，重复一层。' },
      { t: '静置', d: '放 3 分钟让燕麦吸软，口感更好。' },
      { t: '食用', d: '用短柄勺引导宝宝自己舀，锻炼手眼协调。' }
    ],
    tips: ['乳制品属高致敏，确认不过敏后再吃。', '葡萄、蓝莓、小番茄等圆形食物必须切分后给。']
  }
]

function findTemplate(id) {
  return TEMPLATES.filter(function (t) { return t.id === id })[0] || null
}

/**
 * 模板正文是否出现过敏禁用词。
 * 只看主料不够：有些模板会在步骤或小贴士里顺带提到别的食材
 * （例如「搭配蛋黄更均衡」），对蛋黄过敏的宝宝同样不能用。
 */
function templateHasBanned(tpl, terms) {
  if (!terms || !terms.length) return false
  const parts = [tpl.title]
  ;(tpl.ingredients || []).forEach(function (i) { parts.push(i.name) })
  ;(tpl.steps || []).forEach(function (s) { parts.push(s.t); parts.push(s.d) })
  ;(tpl.tips || []).forEach(function (t) { parts.push(t) })
  parts.push(tpl.nutrition)
  const text = parts.join('|')
  for (let i = 0; i < terms.length; i++) {
    if (text.indexOf(terms[i]) >= 0) return true
  }
  return false
}

function scaleAmount(amount, factor) {
  const m = String(amount).match(/^(\d+(?:\.\d+)?)(g|ml)$/)
  if (!m) return amount
  const n = Math.round(Number(m[1]) * factor)
  return n + m[2]
}

/** 依据月龄给出建议可用的食材 id 列表 */
function safeIngredientIds(ageMonths, states, onlyTried) {
  const m = normalizeMonths(ageMonths)
  const st = states || {}
  const list = ING.INGREDIENTS.filter(function (item) {
    if (item.minMonth > m) return false
    if (st[item.id] === 'allergy') return false
    if (onlyTried && st[item.id] !== 'normal') return false
    return true
  })
  list.sort(function (a, b) {
    const sa = st[a.id] === 'normal' ? 0 : 1
    const sb = st[b.id] === 'normal' ? 0 : 1
    return sa - sb || a.minMonth - b.minMonth
  })
  return list.map(function (i) { return i.id })
}

/**
 * 生成食谱
 * @param {Object} opt { ageMonths, mealType, texture, selectedIds, states, babyName, round, bannedTerms }
 * @returns {Promise<Object>} 食谱对象
 */
function generateRecipe(opt) {
  const o = opt || {}
  const bannedTerms = o.bannedTerms || []
  const months = normalizeMonths(o.ageMonths)
  const stage = stageFor(months)
  const states = o.states || {}
  const safe = safeIngredientIds(months, states, false)
  const selected = (o.selectedIds && o.selectedIds.length)
    ? o.selectedIds.filter(function (id) { return safe.indexOf(id) >= 0 })
    : safe

  // 只从「正文完全不含过敏禁用词」的模板里挑，避免轮换到蛋黄/鱼虾类模板
  const pool = TEMPLATES.filter(function (t) {
    return months >= t.minMonth &&
      selected.indexOf(t.mainId) >= 0 &&
      !templateHasBanned(t, bannedTerms)
  })
  const usable = pool.length ? pool : TEMPLATES.filter(function (t) {
    return months >= t.minMonth && !templateHasBanned(t, bannedTerms)
  })

  const round = Number(o.round) || 0
  let tpl = usable[round % usable.length]
  if (!tpl) tpl = TEMPLATES[0]

  // 主料若在用户选择中，替换为最靠前的自定义组合（通用模板）
  let recipe = cloneTemplate(tpl)
  const custom = selected.filter(function (id) {
    return !TEMPLATES.some(function (t) { return t.mainId === id })
  })
  if (custom.length && (!selected.length || selected[0] === custom[0])) {
    const item = ING.findById(custom[0])
    if (item) recipe = genericTemplate(item, stage)
  }

  const factor = months < 9 ? 1 : (months < 12 ? 1.4 : 1.8)
  const ingredients = recipe.ingredients.map(function (i) {
    return { name: i.name, amount: scaleAmount(i.amount, factor) }
  })

  const steps = recipe.steps.map(function (s, idx) {
    return { no: idx + 1, t: s.t, d: s.d }
  })
  steps.push({
    no: steps.length + 1,
    t: '质地调整 · ' + stage.texture,
    d: '宝宝目前 ' + U.ageText(months) + '（' + stage.name + '），请把成品处理成「' + stage.texture + '」：' + stage.desc + '。'
  })
  steps.push({
    no: steps.length + 1,
    t: '排敏与保存',
    d: '新食材请单独连续观察 3 天；当餐未吃完的份请丢弃，不要二次加热。做好的生胚可分装冷冻，48 小时内吃完。'
  })

  const allergyNames = ING.INGREDIENTS.filter(function (i) {
    return states[i.id] === 'allergy'
  }).map(function (i) { return i.name })

  const tips = recipe.tips.slice()
  tips.push('本餐次建议：' + stage.feeding + '。1 岁前不额外加盐、糖、蜂蜜。')
  if (allergyNames.length) {
    // 不在结果里复述过敏食材名称：页面已有独立的过敏清单展示，
    // 也便于 AI 结果与本地结果共用同一套过敏词校验。
    tips.push('已按宝宝过敏标记自动筛选食材，购买加工品时请再核对配料表。')
  }

  return Promise.resolve({
    id: U.uid('recipe'),
    title: recipe.title,
    emoji: recipe.emoji,
    templateId: recipe.id,
    babyName: o.babyName || '宝宝',
    ageMonths: months,
    ageText: U.ageText(months),
    stage: stage.name,
    mealType: o.mealType || '午餐',
    texture: o.texture || stage.texture,
    tags: recipe.tags,
    nutrition: recipe.nutrition,
    serving: months < 9 ? '约 1 小碗（60-80g）' : (months < 12 ? '约 1 碗（100-130g）' : '约 1 碗（150-180g）'),
    minutes: 25 + steps.length * 2,
    ingredients: ingredients,
    steps: steps,
    tips: tips,
    safeCount: safe.length,
    createdAt: Date.now()
  })
}

function cloneTemplate(t) {
  return {
    id: t.id, title: t.title, emoji: t.emoji, tags: t.tags.slice(),
    nutrition: t.nutrition,
    ingredients: t.ingredients.map(function (i) { return { name: i.name, amount: i.amount } }),
    steps: t.steps.map(function (s) { return { t: s.t, d: s.d } }),
    tips: t.tips.slice()
  }
}

function genericTemplate(item, stage) {
  return {
    id: 'generic_' + item.id,
    title: item.name + '软泥',
    emoji: item.icon,
    tags: ['单一食材', '排敏期适用'],
    nutrition: '以 ' + item.name + ' 为主的单一食材辅食',
    ingredients: [{ name: item.name, amount: '50g' }, { name: '温水 / 母乳', amount: '适量' }],
    steps: [
      { t: '挑选与清洗', d: '选择新鲜、无破损的' + item.name + '，流水充分冲洗，去皮去核去不可食部分。' },
      { t: '切小块', d: '切成 1-2cm 均匀小块，保证受热均匀、缩短加热时间。' },
      { t: '充分加热', d: '蒸或煮 12-18 分钟至完全软烂，筷子能轻松穿透，不加任何调味料。' },
      { t: '打成细泥', d: '加少量温开水或母乳，用辅食机打成顺滑细泥，再过筛一次去粗纤维。' },
      { t: '调整稠度', d: '调到勺子倾斜时缓慢滑落的程度，太稠易干呕、太稀易呛。' },
      { t: '试温与观察', d: '手腕内侧试温，先喂 1 小勺，连续观察 3 天有无过敏反应。' }
    ],
    tips: [item.note, '单一食材试吃通过后再与其他已排敏食材搭配。']
  }
}

module.exports = {
  STAGES: STAGES,
  MEALS: MEALS,
  TEMPLATES: TEMPLATES,
  stageFor: stageFor,
  safeIngredientIds: safeIngredientIds,
  findTemplate: findTemplate,
  generateRecipe: generateRecipe
}
