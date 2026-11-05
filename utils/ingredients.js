/**
 * 市面常见宝宝辅食食材库
 * status: 由用户在「食材清单」中标记 —— normal 正常 / allergy 过敏 / untried 未食用
 * minMonth: 建议引入月龄；allergen: 是否为高致敏食材；icon: 列表图标
 */

const CATEGORIES = [
  { id: 'grain', name: '谷物薯类', icon: '🌾', color: '#FFF3DC' },
  { id: 'veg', name: '蔬菜菌菇', icon: '🥦', color: '#E6F7F0' },
  { id: 'fruit', name: '水果', icon: '🍎', color: '#FFEDE6' },
  { id: 'meat', name: '肉禽蛋类', icon: '🥚', color: '#FFF0E3' },
  { id: 'sea', name: '水产', icon: '🐟', color: '#E8F2FF' },
  { id: 'bean', name: '豆奶坚果', icon: '🫘', color: '#F3EEFF' },
  { id: 'other', name: '油脂调味', icon: '🫒', color: '#F4F0ED' }
]

const RAW = [
  // 谷物薯类
  ['rice_cereal', '强化铁米粉', '🍚', 'grain', 6, false, '补铁首选，第一口辅食'],
  ['rice', '大米', '🌾', 'grain', 6, false, '煮烂成粥或米糊'],
  ['millet', '小米', '🌾', 'grain', 6, false, '养胃，需充分煮软'],
  ['oat', '燕麦', '🥣', 'grain', 8, false, '含麸质，少量尝试'],
  ['corn', '玉米', '🌽', 'grain', 8, false, '建议打泥去渣'],
  ['potato', '土豆', '🥔', 'grain', 6, false, '蒸熟压泥'],
  ['sweet_potato', '红薯', '🍠', 'grain', 6, false, '膳食纤维丰富'],
  ['yam', '山药', '🍠', 'grain', 7, false, '处理时戴手套防手痒'],
  ['noodle', '婴儿面条', '🍜', 'grain', 8, false, '选无盐配方'],
  ['bread', '全麦面包', '🍞', 'grain', 10, false, '含麸质，注意配料表'],
  ['quinoa', '藜麦', '🌾', 'grain', 10, false, '需反复淘洗'],
  ['taro', '芋头', '🍠', 'grain', 8, false, '蒸透压泥'],
  ['purple_potato', '紫薯', '🍠', 'grain', 8, false, '花青素丰富'],
  ['lotus_root', '莲藕', '🪷', 'grain', 10, false, '煮熟打泥'],

  // 蔬菜菌菇
  ['pumpkin', '南瓜', '🎃', 'veg', 6, false, '天然甜味，宝宝接受度高'],
  ['carrot', '胡萝卜', '🥕', 'veg', 6, false, '富含 β-胡萝卜素'],
  ['broccoli', '西兰花', '🥦', 'veg', 7, false, '焯水后打泥'],
  ['spinach', '菠菜', '🥬', 'veg', 8, false, '焯水去草酸'],
  ['bokchoy', '小白菜', '🥬', 'veg', 7, false, '取嫩叶部分'],
  ['cabbage', '大白菜', '🥬', 'veg', 7, false, '煮软切碎'],
  ['pea', '豌豆', '🫛', 'veg', 8, false, '去皮防噎'],
  ['tomato', '番茄', '🍅', 'veg', 8, false, '去皮去籽'],
  ['winter_melon', '冬瓜', '🥒', 'veg', 7, false, '水分多，易消化'],
  ['cucumber', '黄瓜', '🥒', 'veg', 8, false, '初期建议蒸熟'],
  ['eggplant', '茄子', '🍆', 'veg', 8, false, '蒸熟去皮下'],
  ['mushroom', '香菇', '🍄', 'veg', 10, false, '切碎煮透'],
  ['asparagus', '芦笋', '🥬', 'veg', 10, false, '取嫩尖'],
  ['pepper', '甜椒', '🫑', 'veg', 10, false, '去皮蒸软'],
  ['zucchini', '西葫芦', '🥒', 'veg', 7, false, '去皮去瓤'],
  ['lettuce', '生菜', '🥬', 'veg', 8, false, '焯水切碎'],

  // 水果
  ['apple', '苹果', '🍎', 'fruit', 6, false, '蒸熟刮泥更温和'],
  ['banana', '香蕉', '🍌', 'fruit', 6, false, '压泥即食'],
  ['pear', '梨', '🍐', 'fruit', 6, false, '蒸梨泥润燥'],
  ['avocado', '牛油果', '🥑', 'fruit', 6, false, '优质脂肪'],
  ['blueberry', '蓝莓', '🫐', 'fruit', 8, false, '对半切开防噎'],
  ['strawberry', '草莓', '🍓', 'fruit', 10, true, '常见致敏，少量试'],
  ['orange', '橙子', '🍊', 'fruit', 10, false, '去膜去籽'],
  ['kiwi', '猕猴桃', '🥝', 'fruit', 10, true, '酸性较强，注意观察'],
  ['peach', '桃子', '🍑', 'fruit', 8, false, '去皮打泥'],
  ['watermelon', '西瓜', '🍉', 'fruit', 8, false, '去籽，少量'],
  ['grape', '葡萄', '🍇', 'fruit', 12, false, '必须切四分防噎'],
  ['mango', '芒果', '🥭', 'fruit', 10, true, '常见致敏，少量试'],

  // 肉禽蛋类
  ['egg_yolk', '鸡蛋黄', '🥚', 'meat', 7, true, '从 1/4 个开始'],
  ['whole_egg', '全蛋', '🍳', 'meat', 12, true, '确认蛋清不过敏再吃'],
  ['chicken', '鸡胸肉', '🍗', 'meat', 8, false, '打泥更嫩'],
  ['pork', '猪里脊', '🥩', 'meat', 8, false, '补铁补锌'],
  ['beef', '牛肉', '🥩', 'meat', 8, false, '高铁食材'],
  ['pork_liver', '猪肝', '🥩', 'meat', 8, false, '补铁，每周 1-2 次'],
  ['chicken_liver', '鸡肝', '🥩', 'meat', 8, false, '浸泡去血水'],
  ['lamb', '羊肉', '🥩', 'meat', 10, false, '去筋膜打泥'],
  ['duck', '鸭肉', '🍗', 'meat', 10, false, '少量尝试'],
  ['pork_floss', '无盐肉松', '🥩', 'meat', 12, false, '选无添加配方'],

  // 水产
  ['cod', '鳕鱼', '🐟', 'sea', 8, true, '刺少，注意鱼类过敏'],
  ['salmon', '三文鱼', '🐟', 'sea', 8, true, '富含 DHA'],
  ['shrimp', '虾', '🦐', 'sea', 10, true, '高致敏，1 岁后再试更稳妥'],
  ['seabass', '鲈鱼', '🐟', 'sea', 8, false, '清蒸去刺'],
  ['hairtail', '带鱼', '🐟', 'sea', 10, false, '仔细去刺'],
  ['oyster', '牡蛎', '🦪', 'sea', 12, true, '高致敏，务必煮熟'],

  // 豆奶坚果
  ['tofu', '嫩豆腐', '🧈', 'bean', 8, false, '植物蛋白，压碎即食'],
  ['soymilk', '无糖豆浆', '🥛', 'bean', 12, false, '需煮沸，1 岁后'],
  ['yogurt', '原味酸奶', '🥛', 'bean', 12, true, '牛奶蛋白致敏，选无糖'],
  ['cheese', '低钠奶酪', '🧀', 'bean', 12, true, '牛奶蛋白致敏'],
  ['peanut', '花生', '🥜', 'bean', 12, true, '高致敏，必须打酱'],
  ['sesame', '黑芝麻', '🌰', 'bean', 10, true, '磨成粉，整粒防噎'],
  ['walnut', '核桃', '🌰', 'bean', 12, true, '磨粉，整粒防噎'],
  ['black_bean', '黑豆', '🫘', 'bean', 10, false, '煮烂去皮'],

  // 油脂调味
  ['olive_oil', '橄榄油', '🫒', 'other', 8, false, '每餐 2-3 滴'],
  ['flaxseed_oil', '亚麻籽油', '🫒', 'other', 8, false, '凉拌，不高温'],
  ['nori', '无盐海苔', '🍙', 'other', 12, false, '剪碎，防粘喉'],
  ['lemon', '柠檬', '🍋', 'other', 12, false, '仅用于去腥'],
  ['mushroom_powder', '香菇粉', '🧂', 'other', 12, false, '替代盐提鲜']
]

const INGREDIENTS = RAW.map(function (r) {
  return {
    id: r[0], name: r[1], icon: r[2], category: r[3],
    minMonth: r[4], allergen: r[5], note: r[6], status: 'untried'
  }
})

const STATUS_META = {
  untried: { label: '未食用', color: '#A9A099', bg: '#F4F0ED' },
  normal: { label: '正常', color: '#3CA884', bg: '#E6F7F0' },
  allergy: { label: '过敏', color: '#E0526E', bg: '#FFE9ED' }
}

function categoryOf(id) {
  return CATEGORIES.filter(function (c) { return c.id === id })[0] || CATEGORIES[0]
}

function findById(id) {
  return INGREDIENTS.filter(function (i) { return i.id === id })[0] || null
}

module.exports = {
  CATEGORIES: CATEGORIES,
  INGREDIENTS: INGREDIENTS,
  STATUS_META: STATUS_META,
  categoryOf: categoryOf,
  findById: findById
}
