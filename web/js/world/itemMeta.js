// 可踩物件的元数据（纯数据）：显示名、对应 ASMR 声音、互动方式、特效等。
// react 互动类型：
//   squish 软软陷下去   bounce 弹起来    crunch 踩碎（过一会儿复原）  pop 踩破（过一会儿重生）
//   splash 溅水        chime 发出乐音   crinkle 揉搓              fizz 噼里啪啦
//   sticky 黏黏拉丝     slide 冰面滑行   multipop 连续踩爆（气泡膜）
// love: 糯糯有多喜欢它（越喜欢越可能多踩几下，ASMR 里"重复触发"是很受欢迎的）

export const ITEM_META = {
  // 糖果森林
  marshmallow: { label: '软绵绵棉花糖', sound: 'marshmallow', react: 'squish', h: 0.22, sink: 0.1, fx: { preset: 'fluff', colors: ['#ffffff', '#ffe0ee'] }, love: 0.5 },
  jelly: { label: 'Q弹果冻', sound: 'jelly', react: 'bounce', h: 0.3, fx: { preset: 'sparkles', colors: ['#ff8fc2', '#ffd1e8'] }, love: 0.7 },
  candy_wrapper: { label: '沙沙糖纸', sound: 'candy_wrapper', react: 'crinkle', h: 0.03, fx: { preset: 'sparkles', colors: ['#fff6a8', '#a8f0ff', '#ffc2e8'] }, love: 0.5 },
  chocolate: { label: '咔嚓巧克力', sound: 'chocolate', react: 'crunch', h: 0.08, fx: { preset: 'crumbs', colors: ['#7a4524', '#5c321a', '#9a5a32'] }, respawn: 8, love: 0.3 },
  popping_candy: { label: '噼啪跳跳糖', sound: 'popping_candy', react: 'fizz', h: 0.05, fx: { preset: 'sparkles', colors: ['#ff6fa3', '#7fd6ff', '#ffe066'] }, love: 0.5 },
  gummy: { label: '小熊软糖', sound: 'gummy', react: 'squish', h: 0.18, sink: 0.06, fx: { preset: 'hearts', colors: ['#ff8fb3'] }, love: 0.4 },
  cotton_candy: { label: '蓬松棉花糖', sound: 'cotton_candy', react: 'squish', h: 0.2, sink: 0.14, fx: { preset: 'fluff', colors: ['#ffc2e0', '#c9e8ff'] }, love: 0.4 },
  // 海底
  bubble: { label: '啵啵泡泡', sound: 'bubble_pop', react: 'pop', h: 0.3, fx: { preset: 'bubbles', colors: ['#ffffff', '#d9f7ff'] }, respawn: 6, love: 0.6 },
  seashell: { label: '咔哒贝壳', sound: 'seashell', react: 'crunch', h: 0.08, fx: { preset: 'sparkles', colors: ['#ffe3ef', '#ffffff'] }, respawn: 0.01, love: 0.4 },
  pearl: { label: '叮咚珍珠', sound: 'pearl', react: 'chime', h: 0.1, fx: { preset: 'sparkles', colors: ['#ffffff', '#ffe9f8'] }, love: 0.5 },
  seaweed: { label: '摇摇海草', sound: 'seaweed', react: 'squish', h: 0.04, sink: 0.04, fx: { preset: 'bubbles', colors: ['#ffffff'] }, love: 0.3 },
  starfish: { label: '软软海星', sound: 'starfish', react: 'squish', h: 0.06, sink: 0.03, fx: { preset: 'bubbles', colors: ['#ffffff'] }, love: 0.4 },
  jellyfish: { label: '弹弹水母', sound: 'jellyfish', react: 'bounce', h: 0.28, fx: { preset: 'bubbles', colors: ['#ffd1f5', '#ffffff'] }, love: 0.7 },
  tide_pool: { label: '小水潭', sound: 'sea_splash', react: 'splash', h: 0.0, fx: { preset: 'water', colors: ['#bfefff', '#ffffff'] }, love: 0.4 },
  // 雪国
  snow_pile: { label: '咯吱雪堆', sound: 'snow_pile', react: 'crunch', h: 0.12, fx: { preset: 'snow', colors: ['#ffffff'] }, respawn: 7, love: 0.6 },
  ice_sheet: { label: '滑溜溜冰面', sound: 'ice_slide', react: 'slide', h: 0.02, fx: { preset: 'sparkles', colors: ['#dff4ff', '#ffffff'] }, love: 0.3 },
  icicle: { label: '冰棱风铃', sound: 'icicle', react: 'chime', h: 0.05, note: true, fx: { preset: 'sparkles', colors: ['#cfeeff', '#ffffff'] }, love: 0.5 },
  snowball: { label: '圆滚滚雪球', sound: 'snowman', react: 'crunch', h: 0.2, fx: { preset: 'snow', colors: ['#ffffff'] }, respawn: 8, love: 0.4 },
  frost_flower: { label: '冰晶花', sound: 'frost_flower', react: 'chime', h: 0.05, fx: { preset: 'sparkles', colors: ['#bfe8ff', '#ffffff'] }, love: 0.4 },
  ice_crack: { label: '薄冰', sound: 'ice_crack', react: 'crunch', h: 0.02, fx: { preset: 'sparkles', colors: ['#dff4ff'] }, respawn: 6, love: 0.5 },
  // 森林
  mushroom: { label: '啵嘤蘑菇', sound: 'mushroom', react: 'bounce', h: 0.32, fx: { preset: 'spores', colors: ['#fff3b0', '#ffffff'] }, love: 0.7 },
  leaf_pile: { label: '沙沙落叶', sound: 'leaf_pile', react: 'crunch', h: 0.08, fx: { preset: 'leaves', colors: ['#f2a03d', '#e2703a', '#f6c445', '#c9d65a'] }, respawn: 6, love: 0.6 },
  twig: { label: '咔嚓小树枝', sound: 'twig', react: 'crunch', h: 0.04, fx: { preset: 'crumbs', colors: ['#8a5a36', '#a87148'] }, respawn: 8, love: 0.3 },
  puddle: { label: '啪嗒水洼', sound: 'puddle', react: 'splash', h: 0.0, fx: { preset: 'water', colors: ['#bfe8ff', '#ffffff'] }, love: 0.5 },
  acorn: { label: '小橡果', sound: 'acorn', react: 'crunch', h: 0.08, fx: { preset: 'sparkles', colors: ['#fff3b0'] }, respawn: 0.01, love: 0.3 },
  log: { label: '咚咚木桩', sound: 'log', react: 'squish', h: 0.24, sink: 0.0, fx: { preset: 'crumbs', colors: ['#c99a6a'] }, love: 0.4 },
  lily_pad: { label: '荷叶', sound: 'lily_pad', react: 'splash', h: 0.02, fx: { preset: 'water', colors: ['#d8f5ff'] }, love: 0.4 },
  flower_bell: { label: '风铃花', sound: 'flower_bell', react: 'chime', h: 0.04, note: true, fx: { preset: 'notes', colors: ['#ff9ec4', '#ffd166'] }, love: 0.4 },
  // 烘焙屋
  macaron: { label: '酥脆马卡龙', sound: 'macaron', react: 'crunch', h: 0.16, fx: { preset: 'crumbs', colors: ['#ffb3d1', '#ffe8f1'] }, respawn: 7, love: 0.6 },
  biscuit: { label: '咔嚓饼干', sound: 'biscuit', react: 'crunch', h: 0.06, fx: { preset: 'crumbs', colors: ['#e0a560', '#c98a45', '#f2c27c'] }, respawn: 7, love: 0.6 },
  cream_puff: { label: '奶油泡芙', sound: 'cream_puff', react: 'squish', h: 0.2, sink: 0.08, fx: { preset: 'fluff', colors: ['#ffffff', '#fff3d6'] }, love: 0.5 },
  pudding: { label: '晃晃布丁', sound: 'pudding', react: 'bounce', h: 0.28, fx: { preset: 'sparkles', colors: ['#ffe28a', '#ffffff'] }, love: 0.6 },
  sugar_cube: { label: '方糖', sound: 'sugar_cube', react: 'crunch', h: 0.14, fx: { preset: 'crumbs', colors: ['#ffffff', '#f4f8ff'] }, respawn: 7, love: 0.4 },
  honey: { label: '黏黏蜂蜜', sound: 'honey', react: 'sticky', h: 0.01, fx: { preset: 'sparkles', colors: ['#ffcf4d', '#ffe9a0'] }, love: 0.4 },
  donut: { label: '软软甜甜圈', sound: 'donut', react: 'squish', h: 0.14, sink: 0.06, fx: { preset: 'sparkles', colors: ['#ff8fb3', '#7fd6ff'] }, love: 0.4 },
  sprinkles: { label: '彩虹糖针', sound: 'sprinkles', react: 'fizz', h: 0.01, fx: { preset: 'sparkles', colors: ['#ff6fa3', '#7fd6ff', '#ffe066', '#9be89b'] }, love: 0.4 },
  // 天空
  cloud: { label: '软绵绵云朵', sound: 'cloud_puff', react: 'squish', h: 0.16, sink: 0.14, fx: { preset: 'fluff', colors: ['#ffffff'] }, love: 0.5 },
  star_tile: { label: '星星砖', sound: 'star_tile', react: 'chime', h: 0.03, note: true, fx: { preset: 'stars', colors: ['#ffe066', '#fff6c2'] }, love: 0.5 },
  rainbow: { label: '彩虹琴键', sound: 'rainbow', react: 'chime', h: 0.03, note: true, fx: { preset: 'notes', colors: ['#ff8fb3', '#ffd166', '#7fd6ff', '#9be89b'] }, love: 0.5 },
  wind_chime: { label: '小风铃', sound: 'wind_chime', react: 'chime', h: 0.03, fx: { preset: 'sparkles', colors: ['#ffffff', '#cfe8ff'] }, love: 0.4 },
  feather: { label: '轻羽毛', sound: 'feather', react: 'squish', h: 0.03, sink: 0.02, fx: { preset: 'fluff', colors: ['#ffffff', '#ffe3f1'] }, love: 0.3 },
  sky_bounce: { label: '弹力云', sound: 'sky_bounce', react: 'bounce', h: 0.26, fx: { preset: 'fluff', colors: ['#ffffff'] }, love: 0.7 },
  // 玩具屋
  bubble_wrap: { label: '噼啪气泡膜', sound: 'bubble_wrap', react: 'multipop', h: 0.04, fx: { preset: 'sparkles', colors: ['#e6f6ff'] }, love: 0.9 },
  keycap: { label: '咔哒键帽', sound: 'keycap', react: 'squish', h: 0.12, sink: 0.05, fx: { preset: 'sparkles', colors: ['#ffffff'] }, love: 0.6 },
  wood_block: { label: '积木', sound: 'wood_block', react: 'squish', h: 0.24, sink: 0.0, fx: { preset: 'stars', colors: ['#ffd166', '#7fd6ff'] }, love: 0.4 },
  plush: { label: '吱吱毛绒', sound: 'plush', react: 'squish', h: 0.16, sink: 0.08, fx: { preset: 'hearts', colors: ['#ff8fb3'] }, love: 0.5 },
  slime: { label: '咕叽史莱姆', sound: 'slime', react: 'sticky', h: 0.05, sink: 0.05, fx: { preset: 'sparkles', colors: ['#a8f5c8', '#c9a0ff'] }, love: 0.8 },
  piano_key: { label: '玩具钢琴', sound: 'piano_key', react: 'chime', h: 0.03, note: true, fx: { preset: 'notes', colors: ['#ffffff', '#ff8fb3'] }, love: 0.5 },
  kinetic_sand: { label: '沙沙太空沙', sound: 'kinetic_sand', react: 'squish', h: 0.06, sink: 0.04, fx: { preset: 'crumbs', colors: ['#ffb3d1', '#b3d9ff'] }, love: 0.6 },
  soap: { label: '脆脆肥皂', sound: 'soap', react: 'crunch', h: 0.1, fx: { preset: 'crumbs', colors: ['#c9f0ff', '#ffe0f0'] }, respawn: 7, love: 0.6 },
  // 水晶洞
  crystal: { label: '空灵水晶', sound: 'crystal', react: 'chime', h: 0.05, note: true, fx: { preset: 'sparkles', colors: ['#9fe8ff', '#e7b3ff'] }, love: 0.6 },
  cave_drip: { label: '叮咚水滴', sound: 'cave_drip', react: 'splash', h: 0.0, fx: { preset: 'water', colors: ['#9fd8ff'] }, love: 0.5 },
  gem: { label: '亮晶晶宝石', sound: 'gem', react: 'chime', h: 0.1, fx: { preset: 'sparkles', colors: ['#ff9ff3', '#9fe8ff', '#fff2a8'] }, love: 0.5 },
  rock_sugar: { label: '冰糖晶石', sound: 'rock_sugar', react: 'crunch', h: 0.08, fx: { preset: 'sparkles', colors: ['#d6e6ff', '#ffffff'] }, respawn: 6, love: 0.5 },
  glow_mushroom: { label: '荧光蘑菇', sound: 'glow_mushroom', react: 'bounce', h: 0.3, fx: { preset: 'spores', colors: ['#9fe8ff', '#e7b3ff'] }, love: 0.7 },
  stone_tile: { label: '石板', sound: 'stalagmite', react: 'squish', h: 0.06, sink: 0.0, fx: { preset: 'sparkles', colors: ['#d6e6ff'] }, love: 0.2 },
};

// 闯关元素的声音
export const MECH_SOUNDS = ['star_collect', 'key_get', 'gate_open', 'spring_pad', 'jump', 'land', 'level_clear', 'portal', 'switch_press'];
// 互动与配乐的声音
export const SHARED_SOUNDS = ['gift_sparkle', 'heart_pop', 'm_kalimba', 'm_bass', 'm_kick', 'm_shaker', 'm_clap', 'm_tap', 'v_happy', 'v_surprise', 'v_yay', 'v_curious', 'v_sleepy', 'v_thanks', 'ice_slide'];

export function soundsForTheme(theme) {
  const ids = new Set();
  for (const s of theme.surfaces) ids.add(s.step);
  for (const it of theme.items) { const m = ITEM_META[it.type]; if (m) ids.add(m.sound); }
  return [...ids];
}
