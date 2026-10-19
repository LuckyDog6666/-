// 解压闯关的"世界"：每个世界是一条桌面微缩赛道，主打一种材质家族（声音和画面都统一，不杂乱）。
// 赛道由 5~6 个"解压站"组成，最后是一个巨大的终点解压物。
// 每个站点的声音都是真实录音（见 web/sounds/manifest.json 与 CREDITS.md）。
//
// station 字段：type（stations.js 里的类型）、label（画面上的小标签）、sound.step/special（声音 id）、
//   gait（normal 普通 / stomp 重踩 / tiptoe 踮脚）、stepDur（每一步秒数，越大越慢越"沉浸"）、
//   kneadable（可以在上面踩奶）、其余为外观参数。

const SNOW = '#f8fbff', SNOW_P = '#b4c7e6';

export const STAGES = [
  {
    id: 'snow', voteKeys: ['雪', '冰'], name: '雪国棉花糖谷', subtitle: '咯吱咯吱，每一脚都是新鲜的雪',
    sky: ['#8dbbec', '#cfe3f8', '#f2f8ff'], fog: '#e3eefa', fogRange: [16, 48], exposure: 0.9,
    hemi: ['#ffffff', '#b4c9e8', 1.05], sun: ['#fff6ea', 2.2], ambient: 0.4,
    ground: '#e9f1fc', groundAlt: '#d9e5f5', path: '#cfe0f5', pathSide: '#a9c2e4',
    props: ['pine_snow', 'snowman', 'ice_crystal', 'snow_rock', 'pine_snow', 'igloo'],
    particles: { type: 'snow', rate: 10, colors: ['#ffffff'] },
    ambience: 'amb_wind', ambienceGain: 0, pathSound: 'snow_step', pathGain: -12,
    accessory: 'scarf',
    stations: [
      { type: 'soft', label: '新鲜粉雪', sound: { step: 'snow_step', heavy: 'snow_crunch', special: 'snow_press' }, color: SNOW, colorPressed: SNOW_P, colorSide: '#e6eef9', trayColor: '#cfe0f5', thickness: 0.17, depth: 0.1, rim: 0.45, glitter: '#ffffff', fx: 'snow', fxColors: ['#ffffff', '#eef6ff'], gait: 'stomp', stepDur: 0.62, kneadable: true, specials: ['sit', 'knead', 'press'], length: 2.8 },
      { type: 'crunch', label: '雪球堆', piece: 'snowball', count: 200, colors: ['#ffffff', '#f3f8ff', '#eaf2fd'], sound: { step: 'snow_step', heavy: 'snow_crunch' }, trayColor: '#d9e7f7', gait: 'stomp', stepDur: 0.66, specials: ['stomp'], length: 2.4 },
      { type: 'ice', label: '薄薄的冰面', sound: { step: 'ice_crack' }, trayColor: '#cde5fb', gait: 'tiptoe', stepDur: 0.58, specials: ['stomp'], length: 2.4 },
      { type: 'soft', label: '草莓雪酪', sound: { step: 'snow_step', heavy: 'snow_crunch', special: 'snow_press' }, color: '#ffe4ef', colorPressed: '#eaa3c2', colorSide: '#ffd3e4', trayColor: '#ffd0e2', thickness: 0.16, depth: 0.08, rim: 0.45, glitter: '#ffffff', fx: 'snow', fxColors: ['#ffffff', '#ffe4ef'], gait: 'normal', stepDur: 0.66, kneadable: true, specials: ['knead', 'sit'], length: 2.6 },
      { type: 'crunch', label: '冰糖雪粒', piece: 'crystal', count: 240, colors: ['#e9f6ff', '#d7efff', '#ffffff'], rough: 0.25, sound: { step: 'snow_step', heavy: 'snow_crunch' }, trayColor: '#d2e6f9', gait: 'stomp', stepDur: 0.62, specials: ['stomp'], length: 2.4 },
    ],
    finale: { type: 'soft', label: '超大雪蛋糕', sound: { step: 'snow_step', heavy: 'snow_crunch', special: 'snow_press' }, color: SNOW, colorPressed: SNOW_P, colorSide: '#f4f8ff', trayColor: '#bcd3ee', thickness: 0.34, depth: 0.14, rim: 0.5, glitter: '#ffffff', fx: 'snow', fxColors: ['#ffffff'], length: 3.0, width: 2.2, kneadable: true, finale: true },
  },
  {
    id: 'forest', voteKeys: ['落叶', '叶子', '秋天', '树叶'], name: '秋日落叶林', subtitle: '沙沙脆脆的落叶，软软的小泥坑',
    sky: ['#f6b67a', '#fbd9a8', '#fff2dc'], fog: '#f8dfba', fogRange: [14, 42],
    hemi: ['#fff1dc', '#c98b5a', 1.0], sun: ['#ffe2b8', 2.3], ambient: 0.35,
    ground: '#e9c48f', groundAlt: '#dcae73', path: '#f1d7ae', pathSide: '#c99b62',
    props: ['tree', 'big_mushroom', 'bush', 'stump', 'tree', 'rock', 'flowers'],
    particles: { type: 'leaves', rate: 4, colors: ['#f29b4b', '#e9603b', '#f7c548', '#c8763a'] },
    ambience: 'amb_birds', ambienceGain: -1, pathSound: 'grass_step', pathGain: -2,
    accessory: 'flower',
    stations: [
      { type: 'crunch', label: '落叶堆', piece: 'leaf', count: 380, colors: ['#f29b4b', '#e9603b', '#f7c548', '#d77a3a', '#b8622e'], sound: { step: 'leaves_step', heavy: 'leaves_crunch' }, trayColor: '#c88b52', gait: 'stomp', stepDur: 0.64, specials: ['stomp'], length: 2.8 },
      { type: 'water', label: '小水洼', color: '#86c3d9', sound: { step: 'water_splash' }, trayColor: '#b88a5a', gait: 'stomp', stepDur: 0.8, specials: ['stomp'], length: 2.2 },
      { type: 'soft', label: '软软的泥巴', sound: { step: 'mud_squelch' }, color: '#9a6a46', colorPressed: '#6a4329', colorSide: '#835a3b', trayColor: '#c49b6c', thickness: 0.13, depth: 0.08, rim: 0.7, recover: 0.04, wet: true, fx: 'crumbs', fxColors: ['#8a5b3c', '#a77551'], gait: 'normal', stepDur: 0.78, kneadable: true, specials: ['knead', 'press'], length: 2.4 },
      { type: 'crunch', label: '彩色小石子', piece: 'pebble', count: 280, colors: ['#e9dccb', '#cfc2b0', '#f2e4d2', '#d7e3e8', '#f0cdb8'], rough: 0.7, sound: { step: 'gravel_step' }, trayColor: '#b48f66', gait: 'normal', stepDur: 0.6, specials: ['stomp'], length: 2.6 },
      { type: 'crunch', label: '金黄银杏叶', piece: 'leaf', count: 380, colors: ['#ffd34d', '#f7c548', '#ffe27a', '#efb93a'], sound: { step: 'leaves_step', heavy: 'leaves_crunch' }, trayColor: '#c7944f', gait: 'tiptoe', stepDur: 0.58, specials: ['stomp'], length: 2.6 },
    ],
    finale: { type: 'crunch', label: '超大落叶山', piece: 'leaf', count: 600, pile: true, colors: ['#f29b4b', '#e9603b', '#f7c548', '#d77a3a', '#ffd34d'], sound: { step: 'leaves_step', heavy: 'leaves_crunch' }, trayColor: '#b07a45', length: 3.0, width: 2.2, finale: true },
  },
  {
    id: 'slime', voteKeys: ['史莱姆', '果冻', '捏捏', '起泡胶'], name: '史莱姆果冻工坊', subtitle: '黏黏的、Q 弹的、慢慢回弹的',
    sky: ['#d7b4ff', '#f3d9ff', '#fff0fb'], fog: '#f6e2ff', fogRange: [14, 40],
    hemi: ['#fff4ff', '#c9a3ee', 1.0], sun: ['#fff4fb', 2.1], ambient: 0.42,
    ground: '#f6e3ff', groundAlt: '#ffe1f0', path: '#fff3fb', pathSide: '#e7c4f2',
    props: ['cake', 'cupcake', 'big_donut', 'jar', 'lollipop', 'gumdrop'],
    particles: { type: 'sparkle', rate: 5, colors: ['#ffffff', '#ffe3f1', '#e9d6ff'] },
    ambience: 'amb_fire', ambienceGain: -7, pathSound: 'path_step', pathGain: -2,
    accessory: 'bow',
    stations: [
      { type: 'slime', label: '蓝莓云朵史莱姆', color: '#9fd3ff', colorPressed: '#7fbff5', glitter: '#ffffff', sound: { step: 'slime_step', special: 'slime_squish', pull: 'slime_pull' }, trayColor: '#ffffff', gait: 'normal', stepDur: 1.1, kneadable: true, specials: ['knead', 'sit', 'press'], length: 2.4 },
      { type: 'jelly', label: 'Q 弹果冻', count: 3, colors: ['#ff8fb3', '#ffd166', '#9be89b'], fruit: '#ffffff', sound: { step: 'jelly_bounce' }, gait: 'normal', stepDur: 0.7, specials: ['bounce'], length: 2.6 },
      { type: 'squishy', label: '慢回弹面包', count: 2, shape: 'bread', colors: ['#ffd9a0', '#ffe2b8'], sound: { step: 'squishy_press' }, gait: 'normal', stepDur: 1.15, kneadable: true, specials: ['sit', 'knead'], length: 2.4 },
      { type: 'popit', label: '彩虹按压泡泡', sound: { step: 'plop_pop' }, gait: 'tiptoe', stepDur: 0.5, specials: ['tapdance'], length: 2.4 },
      { type: 'slime', label: '草莓奶昔史莱姆', color: '#ffb3cf', colorPressed: '#ff96bb', glitter: '#fff6a8', sound: { step: 'slime_step', special: 'slime_squish', pull: 'slime_pull' }, trayColor: '#ffffff', gait: 'normal', stepDur: 1.15, kneadable: true, specials: ['sit', 'knead'], length: 2.4 },
    ],
    finale: { type: 'squishy', label: '超大捏捏', count: 1, shape: 'blob', colors: ['#ffc6dd'], sound: { step: 'squishy_press', special: 'slime_squish' }, length: 2.6, width: 2.2, kneadable: true, finale: true },
  },
  {
    id: 'rain', voteKeys: ['水洼', '下雨', '泥巴', '雨天'], name: '雨天水洼花园', subtitle: '滴答滴答，踩水花、戳泡泡',
    sky: ['#8fb3c9', '#c3d8e3', '#eef5f6'], fog: '#d4e3ea', fogRange: [12, 36],
    hemi: ['#f2fbff', '#7fa3b5', 1.0], sun: ['#f6fbff', 1.6], ambient: 0.5,
    ground: '#cfe3c9', groundAlt: '#b7d3b0', path: '#e7efe2', pathSide: '#a9c49f',
    props: ['tree', 'flowers', 'bush', 'big_mushroom', 'rock', 'flowers'],
    particles: { type: 'bubbles', rate: 3, colors: ['#ffffff', '#d9f7ff'] },
    ambience: 'amb_rain', ambienceGain: 1, pathSound: 'grass_step', pathGain: -2,
    accessory: 'sailor',
    stations: [
      { type: 'water', label: '清清水洼', color: '#7fc4e6', sound: { step: 'water_splash' }, trayColor: '#9fbf96', gait: 'stomp', stepDur: 0.82, specials: ['stomp'], length: 2.4 },
      { type: 'bubblewrap', label: '彩虹肥皂泡', soap: true, sound: { step: 'bubble_pop' }, trayColor: '#d9f2ff', gait: 'tiptoe', stepDur: 0.5, specials: ['tapdance'], length: 2.4 },
      { type: 'soft', label: '湿湿的泥巴', sound: { step: 'mud_squelch' }, color: '#8d6648', colorPressed: '#5f3f28', colorSide: '#7a573c', trayColor: '#9fbf96', thickness: 0.13, depth: 0.085, rim: 0.7, recover: 0.05, wet: true, fx: 'water', fxColors: ['#c9b39a', '#e9e2d6'], gait: 'stomp', stepDur: 0.82, kneadable: true, specials: ['knead', 'press'], length: 2.4 },
      { type: 'crunch', label: '雨后小石子', piece: 'pebble', count: 280, colors: ['#dfe7ea', '#c7d3d8', '#eef3f4', '#d8d0c4'], rough: 0.5, sound: { step: 'gravel_step' }, trayColor: '#9fbf96', gait: 'normal', stepDur: 0.6, specials: ['stomp'], length: 2.4 },
      { type: 'water', label: '荷叶小池塘', color: '#8fd0c9', sound: { step: 'water_splash' }, trayColor: '#86ad7d', gait: 'normal', stepDur: 0.85, specials: ['stomp'], length: 2.4 },
    ],
    finale: { type: 'water', label: '超大水坑', color: '#7fc4e6', sound: { step: 'water_splash' }, trayColor: '#86ad7d', length: 3.0, width: 2.2, finale: true },
  },
  {
    id: 'beach', voteKeys: ['沙', '海边', '贝壳', '沙滩'], name: '彩虹沙滩', subtitle: '软软的沙子，圆圆的贝壳，咕噜咕噜的泡泡',
    sky: ['#6ec6f0', '#bfe8f7', '#fff6e4'], fog: '#e3f3f6', fogRange: [16, 46],
    hemi: ['#fff8ec', '#77b9cf', 1.0], sun: ['#fff3dc', 2.4], ambient: 0.35,
    ground: '#f6e3bf', groundAlt: '#efd3a3', path: '#fbeed2', pathSide: '#dcbc87',
    props: ['big_shell', 'sea_rock', 'coral', 'coral_fan', 'big_shell', 'anemone'],
    particles: { type: 'sparkle', rate: 4, colors: ['#ffffff', '#fff2c4'] },
    ambience: 'amb_waves', ambienceGain: -2, pathSound: 'sand_step', pathGain: -6,
    accessory: 'sailor',
    stations: [
      { type: 'soft', label: '粉粉的太空沙', sound: { step: 'sand_step', special: 'sand_press' }, color: '#ffc9d9', colorPressed: '#ee93b0', colorSide: '#f7b6ca', trayColor: '#ffffff', thickness: 0.16, depth: 0.07, rim: 0.5, glitter: '#fff6d6', grain: true, fx: 'crumbs', fxColors: ['#ffc9d9', '#ffdbe6'], gait: 'normal', stepDur: 0.6, kneadable: true, specials: ['press', 'knead', 'cut'], length: 2.6 },
      { type: 'crunch', label: '小贝壳', piece: 'shell', count: 140, colors: ['#fff1e6', '#ffd9cf', '#ffe9c7', '#f7d6e8'], rough: 0.4, sound: { step: 'gravel_step' }, trayColor: '#f2d7a8', gait: 'tiptoe', stepDur: 0.58, specials: ['stomp'], length: 2.4 },
      { type: 'bubblewrap', label: '海浪泡泡', soap: true, sound: { step: 'bubble_pop' }, trayColor: '#c7ecf7', gait: 'tiptoe', stepDur: 0.5, specials: ['tapdance'], length: 2.4 },
      { type: 'soft', label: '薄荷太空沙', sound: { step: 'sand_step', special: 'sand_press' }, color: '#bff0dc', colorPressed: '#7dcfae', colorSide: '#a8e6cd', trayColor: '#ffffff', thickness: 0.16, depth: 0.07, rim: 0.5, glitter: '#ffffff', grain: true, fx: 'crumbs', fxColors: ['#bff0dc', '#e2fff2'], gait: 'normal', stepDur: 0.6, kneadable: true, specials: ['cut', 'press'], length: 2.6 },
      { type: 'water', label: '浅浅的海水', color: '#6fd0e0', sound: { step: 'water_splash' }, trayColor: '#f2d7a8', gait: 'stomp', stepDur: 0.8, specials: ['stomp'], length: 2.4 },
    ],
    finale: { type: 'soft', label: '超大沙堡', sound: { step: 'sand_step', special: 'sand_press' }, color: '#ffd9a8', colorPressed: '#e9a865', colorSide: '#f7cb95', trayColor: '#e9c48c', thickness: 0.32, depth: 0.12, rim: 0.55, grain: true, fx: 'crumbs', fxColors: ['#ffd9a8'], length: 3.0, width: 2.2, kneadable: true, finale: true },
  },
  {
    id: 'toy', voteKeys: ['键盘', '糖纸', '玩具', '按压'], name: '软糖键盘小屋', subtitle: '咔哒咔哒的大键帽，沙沙的糖纸',
    sky: ['#ffd2a8', '#ffe9d1', '#fff8ef'], fog: '#fff0e0', fogRange: [14, 40],
    hemi: ['#fff8ef', '#e9b98f', 1.0], sun: ['#fff1de', 2.0], ambient: 0.45,
    ground: '#f7e5d3', groundAlt: '#f1d7c0', path: '#fff4e8', pathSide: '#e8c6a6',
    props: ['block_stack', 'toy_ball', 'rubber_duck', 'pencil', 'teddy', 'block_stack'],
    particles: { type: 'sparkle', rate: 3, colors: ['#ffffff', '#ffe9c2'] },
    ambience: 'amb_fire', ambienceGain: -3, pathSound: 'path_step', pathGain: -2,
    accessory: 'party',
    stations: [
      { type: 'keys', label: '软糖大键帽', colors: ['#ffd6e8', '#d6ecff', '#fff3c2', '#dcf7d6', '#e6dcff'], sound: { step: 'key_thock' }, trayColor: '#5d5470', gait: 'tiptoe', stepDur: 0.5, specials: ['tapdance'], length: 2.4 },
      { type: 'soft', label: '亮晶晶糖纸', sound: { step: 'paper_crinkle' }, color: '#f3e9ff', colorPressed: '#c9b4ef', colorSide: '#dfd2f7', trayColor: '#ffd6e8', thickness: 0.08, depth: 0.05, rim: 0.3, shiny: true, glitter: '#ffffff', bumps: 0.025, gait: 'normal', stepDur: 0.75, specials: ['press'], length: 2.4 },
      { type: 'popit', label: '彩虹按压泡泡', sound: { step: 'plop_pop' }, gait: 'tiptoe', stepDur: 0.5, specials: ['tapdance'], length: 2.4 },
      { type: 'jelly', label: '果冻软糖', count: 3, colors: ['#c9a0ff', '#7fd6ff', '#ff8fb3'], fruit: '#fff6a8', sound: { step: 'jelly_bounce' }, gait: 'normal', stepDur: 0.7, specials: ['bounce'], length: 2.6 },
      { type: 'squishy', label: '奶油小蛋糕捏捏', count: 2, shape: 'bread', colors: ['#fff0f5', '#ffe9c7'], sound: { step: 'squishy_press' }, gait: 'normal', stepDur: 1.1, kneadable: true, specials: ['sit', 'knead'], length: 2.4 },
    ],
    finale: { type: 'popit', label: '超大按压泡泡', big: true, sound: { step: 'plop_pop' }, length: 3.0, width: 2.2, finale: true },
  },
];

export const stageById = (id) => STAGES.find((s) => s.id === id) || STAGES[0];

// 一个世界用到的所有声音 id
export function soundsForStage(st) {
  const ids = new Set([st.ambience, st.pathSound, 'land_soft', 'path_step', 'purr']);
  for (const d of [...st.stations, st.finale]) for (const k of ['step', 'heavy', 'special', 'pull']) if (d.sound[k]) ids.add(d.sound[k]);
  return [...ids].filter(Boolean);
}
