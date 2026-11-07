// 解压闯关的"世界"。每个世界 = 一条闯关路线：解压站 / 任务站 与 闯关元素（跳跳石、蹦床、滑滑梯、气球、摇摇桥）穿插，
// 最后是一个巨大的终点解压物。关卡节奏参考 3D 马里奥的"起承转合"：
//   起：本世界的招牌解压材质；承：第一个闯关小挑战；转：滑梯 / 蹦床这种画面最热闹的转折；合：巨型终点。
// 每个世界只用一个材质 / 主题家族，声音和画面统一、不杂乱。所有声音都是真实录音（见 web/sounds/CREDITS.md）。
//
// 站点字段：type（stations.js 的解压站或 tasks.js 的任务站）、label（画面上的名字）、sound.step/heavy/special/pull（声音 id）、
//   gait（normal 普通 / stomp 重踩 / tiptoe 踮脚）、stepDur（每一步秒数，越大越慢越"沉浸"）、kneadable（可以踩奶）、外观参数。
// 闯关元素字段：type（hop/bounce/slide/float/bridge）、skin（外观）、label、land（落地声音）、各种颜色。

const SNOW = '#f8fbff', SNOW_P = '#b4c7e6';

export const STAGES = [
  {
    id: 'snow', env: 'outdoor', voteKeys: ['雪', '冰'], name: '雪国棉花糖谷', subtitle: '咯吱咯吱，每一脚都是新鲜的雪',
    sky: ['#7fb2ea', '#cfe3f8', '#f2f8ff'], fog: '#dde9f8', fogRange: [18, 60], exposure: 0.95, film: { glow: 0.3, threshold: 0.92, saturation: 1.12 },
    hemi: ['#ffffff', '#a9c2ea', 1.0], sun: ['#fff1e0', 2.4], ambient: 0.35,
    ground: '#e6effb', groundAlt: '#d3e2f6', hills: ['#eaf2fd', '#d9e6f8', '#c9dbf3'], path: '#d7e6f8', pathSide: '#a9c2e4',
    props: ['pine_snow', 'snowman', 'ice_crystal', 'snow_rock', 'pine_snow', 'igloo'], archColors: ['#ffffff', '#9fd8ff', '#ff8fb3'],
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
    gimmicks: [
      { type: 'hop', skin: 'snowball', label: '雪球跳跳石', color: '#bfe9ff', deep: '#7cc4ec', bed: '#e6f2fb', bank: '#ffffff', land: 'snow_step', landGain: -4, fx: 'snow', fxColors: ['#ffffff'], say: '踩着雪球跳过去～' },
      { type: 'slide', label: '冰雪大滑梯', color: '#a8dcff', color2: '#ffffff', pile: 'snow', land: 'snow_press', land2: 'snow_crunch', tubColor: '#e9f4ff', stepSound: 'snow_step', say: '哇！冰雪滑梯！' },
      { type: 'bounce', skin: 'cake', label: '雪蛋糕蹦床', sound: 'bounce' },
      { type: 'float', skin: 'balloon', label: '气球飞过冰河', color: '#bfe9ff', deep: '#7cc4ec', bed: '#e6f2fb', bank: '#ffffff' },
    ],
    finale: { type: 'soft', label: '超大雪蛋糕', sound: { step: 'snow_step', heavy: 'snow_crunch', special: 'snow_press' }, color: SNOW, colorPressed: SNOW_P, colorSide: '#f4f8ff', trayColor: '#bcd3ee', thickness: 0.34, depth: 0.14, rim: 0.5, glitter: '#ffffff', fx: 'snow', fxColors: ['#ffffff'], length: 3.0, width: 2.2, kneadable: true, finale: true },
  },
  {
    id: 'forest', env: 'outdoor', voteKeys: ['落叶', '叶子', '秋天', '树叶', '森林'], name: '秋日落叶林', subtitle: '沙沙脆脆的落叶，软软的小泥坑',
    sky: ['#f6b67a', '#fbd9a8', '#fff2dc'], fog: '#f8dfba', fogRange: [16, 55], exposure: 1.02,
    hemi: ['#fff1dc', '#c98b5a', 0.95], sun: ['#ffdcb0', 2.5], ambient: 0.32,
    ground: '#ecc890', groundAlt: '#dcae73', hills: ['#e9a25a', '#c8763a', '#9fbf6a', '#f2c46a'], path: '#f4dab0', pathSide: '#c99b62',
    props: ['tree_autumn', 'big_mushroom', 'bush_autumn', 'stump', 'tree_autumn', 'rock', 'flowers'], archColors: ['#f29b4b', '#ffd34d', '#ffffff', '#e9603b'],
    particles: { type: 'leaves', rate: 4, colors: ['#f29b4b', '#e9603b', '#f7c548', '#c8763a'] },
    ambience: 'amb_forest', ambienceGain: -2, pathSound: 'grass_step', pathGain: -2,
    accessory: 'flower',
    stations: [
      { type: 'crunch', label: '落叶堆', piece: 'leaf', count: 380, colors: ['#f29b4b', '#e9603b', '#f7c548', '#d77a3a', '#b8622e'], sound: { step: 'leaves_step', heavy: 'leaves_crunch' }, trayColor: '#c88b52', gait: 'stomp', stepDur: 0.64, specials: ['stomp'], length: 2.8 },
      { type: 'water', label: '小水洼', color: '#86c3d9', sound: { step: 'water_splash' }, trayColor: '#b88a5a', gait: 'stomp', stepDur: 0.8, specials: ['stomp'], length: 2.2 },
      { type: 'soft', label: '软软的泥巴', sound: { step: 'mud_squelch' }, color: '#9a6a46', colorPressed: '#6a4329', colorSide: '#835a3b', trayColor: '#c49b6c', thickness: 0.13, depth: 0.08, rim: 0.7, recover: 0.04, wet: true, fx: 'crumbs', fxColors: ['#8a5b3c', '#a77551'], gait: 'normal', stepDur: 0.78, kneadable: true, specials: ['knead', 'press'], length: 2.4 },
      { type: 'crunch', label: '彩色小石子', piece: 'pebble', count: 280, colors: ['#e9dccb', '#cfc2b0', '#f2e4d2', '#d7e3e8', '#f0cdb8'], rough: 0.7, sound: { step: 'gravel_step' }, trayColor: '#b48f66', gait: 'normal', stepDur: 0.6, specials: ['stomp'], length: 2.6 },
      { type: 'crunch', label: '金黄银杏叶', piece: 'leaf', count: 380, colors: ['#ffd34d', '#f7c548', '#ffe27a', '#efb93a'], sound: { step: 'leaves_step', heavy: 'leaves_crunch' }, trayColor: '#c7944f', gait: 'tiptoe', stepDur: 0.58, specials: ['stomp'], length: 2.6 },
    ],
    gimmicks: [
      { type: 'hop', skin: 'mushroom', label: '蘑菇跳跳', color: '#8fd3e6', deep: '#5aaecf', bed: '#c9a27a', bank: '#e9c48f', land: 'land_soft', landGain: -2 },
      { type: 'bounce', skin: 'mushroom', label: '大蘑菇蹦床', sound: 'bounce' },
      { type: 'slide', label: '树叶大滑梯', color: '#f2b56b', color2: '#a8754a', pile: 'leaves', land: 'leaves_crunch', land2: 'leaves_step', tubColor: '#c88b52', stepSound: 'wood_step' },
      { type: 'bridge', skin: 'log', label: '木头摇摇桥', color: '#8fd3e6', deep: '#5aaecf', bed: '#c9a27a', bank: '#e9c48f', stepSound: 'wood_step', postColor: '#a8754a', postColor2: '#ffd34d' },
    ],
    finale: { type: 'crunch', label: '超大落叶山', piece: 'leaf', count: 600, pile: true, colors: ['#f29b4b', '#e9603b', '#f7c548', '#d77a3a', '#ffd34d'], sound: { step: 'leaves_step', heavy: 'leaves_crunch' }, trayColor: '#b07a45', length: 3.0, width: 2.2, finale: true },
  },
  {
    id: 'slime', env: 'outdoor', voteKeys: ['史莱姆', '果冻', '捏捏', '起泡胶'], name: '史莱姆果冻工坊', subtitle: '黏黏的、Q 弹的、慢慢回弹的',
    sky: ['#c9a3ff', '#f3d9ff', '#fff0fb'], fog: '#f6e2ff', fogRange: [16, 52], exposure: 1.0,
    hemi: ['#fff4ff', '#c9a3ee', 0.95], sun: ['#fff1fb', 2.3], ambient: 0.38,
    ground: '#f6e3ff', groundAlt: '#ffe1f0', hills: ['#ffc2e3', '#e3c9ff', '#c9f0ff', '#fff0a8'], path: '#fff3fb', pathSide: '#e7c4f2',
    props: ['cake', 'cupcake', 'big_donut', 'jar', 'lollipop', 'gumdrop', 'candy_tree'], archColors: ['#ff8fb3', '#c9a0ff', '#7fd6ff', '#ffffff'],
    particles: { type: 'sparkle', rate: 5, colors: ['#ffffff', '#ffe3f1', '#e9d6ff'] },
    ambience: 'amb_fire', ambienceGain: -8, pathSound: 'path_step', pathGain: -2,
    accessory: 'bow',
    stations: [
      { type: 'slime', label: '蓝莓云朵史莱姆', color: '#9fd3ff', colorPressed: '#7fbff5', glitter: '#ffffff', sound: { step: 'slime_step', special: 'slime_squish', pull: 'slime_pull' }, trayColor: '#ffffff', gait: 'normal', stepDur: 1.1, kneadable: true, specials: ['knead', 'sit', 'press'], length: 2.4 },
      { type: 'jelly', label: 'Q 弹果冻', count: 3, colors: ['#ff8fb3', '#ffd166', '#9be89b'], fruit: '#ffffff', sound: { step: 'jelly_bounce' }, gait: 'normal', stepDur: 0.7, specials: ['bounce'], length: 2.6 },
      { type: 'squishy', label: '慢回弹面包', count: 2, shape: 'bread', colors: ['#ffd9a0', '#ffe2b8'], sound: { step: 'squishy_press' }, gait: 'normal', stepDur: 1.15, kneadable: true, specials: ['sit', 'knead'], length: 2.4 },
      { type: 'popit', label: '彩虹按压泡泡', sound: { step: 'plop_pop' }, gait: 'tiptoe', stepDur: 0.5, specials: ['tapdance'], length: 2.4 },
      { type: 'slime', label: '草莓奶昔史莱姆', color: '#ffb3cf', colorPressed: '#ff96bb', glitter: '#fff6a8', sound: { step: 'slime_step', special: 'slime_squish', pull: 'slime_pull' }, trayColor: '#ffffff', gait: 'normal', stepDur: 1.15, kneadable: true, specials: ['sit', 'knead'], length: 2.4 },
    ],
    gimmicks: [
      { type: 'bounce', skin: 'jelly', label: '果冻蹦床', color: '#ff8fb3', sound: 'jelly_bounce' },
      { type: 'hop', skin: 'gumdrop', label: '软糖跳跳', color: '#ffc2dc', deep: '#ff9ec4', bed: '#fff0f6', bank: '#ffffff', land: 'jelly_bounce', landGain: -6 },
      { type: 'slide', label: '彩虹糖滑梯', color: '#ff9ec4', color2: '#ffd166', pile: 'balls', land: 'plop_pop', land2: 'land_soft', tubColor: '#ffffff', stepSound: 'path_step' },
      { type: 'float', skin: 'balloon', label: '棉花糖气球', liquid: 'cloud', bed: '#fff0f6', bank: '#ffffff' },
    ],
    finale: { type: 'squishy', label: '超大捏捏', count: 1, shape: 'blob', colors: ['#ffc6dd'], sound: { step: 'squishy_press', special: 'slime_squish' }, length: 2.6, width: 2.2, kneadable: true, finale: true },
  },
  {
    id: 'rain', env: 'outdoor', voteKeys: ['水洼', '下雨', '泥巴', '雨天', '荷叶'], name: '雨天水洼花园', subtitle: '滴答滴答，踩水花、戳泡泡',
    sky: ['#7ea9cc', '#c0d9e8', '#eef6f6'], fog: '#d4e3ea', fogRange: [20, 62], exposure: 1.02, film: { glow: 0.42, saturation: 1.14 },
    hemi: ['#f2fbff', '#7fa3b5', 1.0], sun: ['#f6fbff', 1.9], ambient: 0.45,
    ground: '#bfe3ad', groundAlt: '#9fd18f', hills: ['#94cf86', '#7dbf78', '#b4dfa4'], path: '#eef5e8', pathSide: '#a9c49f',
    props: ['tree', 'flowers', 'bush', 'big_mushroom', 'rock', 'flowers'], archColors: ['#7fd6ff', '#ffffff', '#ffd166', '#9be89b'],
    particles: { type: 'bubbles', rate: 3, colors: ['#ffffff', '#d9f7ff'] },
    ambience: 'amb_rain', ambienceGain: 0, pathSound: 'grass_step', pathGain: -2,
    accessory: 'sailor',
    stations: [
      { type: 'water', label: '清清水洼', color: '#7fc4e6', sound: { step: 'water_splash' }, trayColor: '#9fbf96', gait: 'stomp', stepDur: 0.82, specials: ['stomp'], length: 2.4 },
      { type: 'bubblewrap', label: '彩虹肥皂泡', soap: true, sound: { step: 'bubble_pop' }, trayColor: '#d9f2ff', gait: 'tiptoe', stepDur: 0.5, specials: ['tapdance'], length: 2.4 },
      { type: 'soft', label: '湿湿的泥巴', sound: { step: 'mud_squelch' }, color: '#8d6648', colorPressed: '#5f3f28', colorSide: '#7a573c', trayColor: '#9fbf96', thickness: 0.13, depth: 0.085, rim: 0.7, recover: 0.05, wet: true, fx: 'water', fxColors: ['#c9b39a', '#e9e2d6'], gait: 'stomp', stepDur: 0.82, kneadable: true, specials: ['knead', 'press'], length: 2.4 },
      { type: 'crunch', label: '雨后小石子', piece: 'pebble', count: 280, colors: ['#dfe7ea', '#c7d3d8', '#eef3f4', '#d8d0c4'], rough: 0.5, sound: { step: 'gravel_step' }, trayColor: '#9fbf96', gait: 'normal', stepDur: 0.6, specials: ['stomp'], length: 2.4 },
      { type: 'water', label: '荷叶小池塘', color: '#8fd0c9', sound: { step: 'water_splash' }, trayColor: '#86ad7d', gait: 'normal', stepDur: 0.85, specials: ['stomp'], length: 2.4 },
    ],
    gimmicks: [
      { type: 'hop', skin: 'lily', label: '荷叶跳跳', color: '#9fdcc8', deep: '#5fb8a8', bed: '#a8c79c', bank: '#cfe6c4', land: 'land_soft', landGain: -2, stoneY: -0.02 },
      { type: 'float', skin: 'umbrella', label: '小雨伞飘飘', color: '#9fdcc8', deep: '#5fb8a8', bed: '#a8c79c', bank: '#cfe6c4' },
      { type: 'slide', label: '彩虹水滑梯', color: '#8fe0ff', color2: '#ffd166', pile: 'pool', land: 'water_splash', tubColor: '#ffd166', stepSound: 'path_step' },
      { type: 'bounce', skin: 'mushroom', label: '大蘑菇蹦床', sound: 'bounce' },
    ],
    finale: { type: 'water', label: '超大水坑', color: '#7fc4e6', sound: { step: 'water_splash' }, trayColor: '#86ad7d', length: 3.0, width: 2.2, finale: true },
  },
  {
    id: 'beach', env: 'outdoor', voteKeys: ['沙', '海边', '贝壳', '沙滩'], name: '彩虹沙滩', subtitle: '软软的沙子，圆圆的贝壳，咕噜咕噜的泡泡',
    sky: ['#5fbff0', '#bfe8f7', '#fff6e4'], fog: '#e3f3f6', fogRange: [18, 62], exposure: 1.0,
    hemi: ['#fff8ec', '#77b9cf', 0.95], sun: ['#fff1d6', 2.6], ambient: 0.32, sea: true,
    ground: '#f8e4bd', groundAlt: '#f0d3a0', hills: ['#f6dcae', '#9fdc8a', '#f2c98a'], path: '#fcefd4', pathSide: '#dcbc87',
    props: ['palm', 'big_shell', 'sand_castle', 'beach_umbrella', 'palm', 'sea_rock', 'beach_ball', 'coral'], archColors: ['#ff8fb3', '#ffd166', '#7fd6ff', '#ffffff'],
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
    gimmicks: [
      { type: 'hop', skin: 'rock', label: '礁石跳跳', color: '#7fdcec', deep: '#3fb6d6', bed: '#f2d7a8', bank: '#f8e4bd', land: 'sand_step', landGain: -2 },
      { type: 'slide', label: '海浪水滑梯', color: '#7fdcec', color2: '#ff8fb3', pile: 'pool', land: 'water_splash', tubColor: '#ff8fb3', stepSound: 'sand_step' },
      { type: 'bounce', skin: 'ball', label: '沙滩球蹦蹦', sound: 'bounce' },
      { type: 'bridge', skin: 'log', label: '椰子木小桥', color: '#7fdcec', deep: '#3fb6d6', bed: '#f2d7a8', bank: '#f8e4bd', stepSound: 'wood_step', postColor: '#e8b07a', postColor2: '#7fd6ff' },
    ],
    finale: { type: 'soft', label: '超大沙堡', sound: { step: 'sand_step', special: 'sand_press' }, color: '#ffd9a8', colorPressed: '#e9a865', colorSide: '#f7cb95', trayColor: '#e9c48c', thickness: 0.32, depth: 0.12, rim: 0.55, grain: true, fx: 'crumbs', fxColors: ['#ffd9a8'], length: 3.0, width: 2.2, kneadable: true, finale: true },
  },
  {
    id: 'toy', env: 'outdoor', voteKeys: ['键盘', '糖纸', '玩具', '按压', '积木'], name: '软糖键盘小屋', subtitle: '咔哒咔哒的大键帽，沙沙的糖纸',
    sky: ['#ffc896', '#ffe9d1', '#fff8ef'], fog: '#fff0e0', fogRange: [16, 52], exposure: 1.0,
    hemi: ['#fff8ef', '#e9b98f', 0.95], sun: ['#ffeeda', 2.2], ambient: 0.4,
    ground: '#f7e5d3', groundAlt: '#f1d7c0', hills: ['#ffd6e8', '#d6ecff', '#fff3c2', '#dcf7d6'], path: '#fff4e8', pathSide: '#e8c6a6',
    props: ['block_stack', 'toy_ball', 'rubber_duck', 'pencil', 'teddy', 'block_stack'], archColors: ['#ff8fb3', '#ffd166', '#9be89b', '#7fd6ff'],
    particles: { type: 'sparkle', rate: 3, colors: ['#ffffff', '#ffe9c2'] },
    ambience: 'amb_fire', ambienceGain: -4, pathSound: 'path_step', pathGain: -2,
    accessory: 'party',
    stations: [
      { type: 'keys', label: '软糖大键帽', colors: ['#ffd6e8', '#d6ecff', '#fff3c2', '#dcf7d6', '#e6dcff'], sound: { step: 'key_thock' }, trayColor: '#5d5470', gait: 'tiptoe', stepDur: 0.5, specials: ['tapdance'], length: 2.4 },
      { type: 'soft', label: '亮晶晶糖纸', sound: { step: 'paper_crinkle' }, color: '#f3e9ff', colorPressed: '#c9b4ef', colorSide: '#dfd2f7', trayColor: '#ffd6e8', thickness: 0.08, depth: 0.05, rim: 0.3, shiny: true, glitter: '#ffffff', bumps: 0.025, gait: 'normal', stepDur: 0.75, specials: ['press'], length: 2.4 },
      { type: 'popit', label: '彩虹按压泡泡', sound: { step: 'plop_pop' }, gait: 'tiptoe', stepDur: 0.5, specials: ['tapdance'], length: 2.4 },
      { type: 'jelly', label: '果冻软糖', count: 3, colors: ['#c9a0ff', '#7fd6ff', '#ff8fb3'], fruit: '#fff6a8', sound: { step: 'jelly_bounce' }, gait: 'normal', stepDur: 0.7, specials: ['bounce'], length: 2.6 },
      { type: 'squishy', label: '奶油小蛋糕捏捏', count: 2, shape: 'bread', colors: ['#fff0f5', '#ffe9c7'], sound: { step: 'squishy_press' }, gait: 'normal', stepDur: 1.1, kneadable: true, specials: ['sit', 'knead'], length: 2.4 },
    ],
    gimmicks: [
      { type: 'hop', skin: 'block', label: '积木跳跳', liquid: 'rug', color: '#9fd8ff', bed: '#f1d7c0', bank: '#fff4e8', land: 'place', landGain: -8 },
      { type: 'slide', label: '玩具大滑梯', color: '#ffd166', color2: '#7fd6ff', pile: 'balls', land: 'plop_pop', land2: 'land_soft', tubColor: '#ff8fb3', stepSound: 'path_step' },
      { type: 'bounce', skin: 'trampoline', label: '小蹦床', sound: 'bounce' },
      { type: 'bridge', skin: 'block', label: '积木摇摇桥', liquid: 'rug', color: '#9fd8ff', bed: '#f1d7c0', bank: '#fff4e8', stepSound: 'path_step' },
    ],
    finale: { type: 'popit', label: '超大按压泡泡', big: true, sound: { step: 'plop_pop' }, length: 3.0, width: 2.2, finale: true },
  },
  {
    id: 'kitchen', env: 'kitchen', voteKeys: ['厨房', '做饭', '松饼', '切菜', '煎饼', '蛋糕'], name: '糯糯小厨房', subtitle: '切切蔬菜、打打蛋、煎一摞香香的松饼',
    sky: ['#ffe9d6', '#fff4e8', '#fff8f0'], fog: '#fff1e2', fogRange: [12, 40], exposure: 1.0,
    hemi: ['#fff6ea', '#e8c4a0', 1.0], sun: ['#fff0dc', 2.2], ambient: 0.42,
    wall: '#fff3e8', tile: '#ffdfe9', cabinet: '#ffd6e2',
    props: ['toaster', 'kettle', 'fruit_bowl', 'herb_pot', 'mixer', 'teapot', 'cupcake', 'cookie_stack'],
    particles: { type: 'dust', rate: 2, colors: ['#fff6e0'] },
    ambience: 'amb_kitchen', ambienceGain: -6, pathSound: 'wood_step', pathGain: -8,
    accessory: 'chef', fixedOrder: true, noPath: true,
    stations: [
      { type: 'chop', label: '切切蔬菜', length: 2.4, say: '切切切～' },
      { type: 'whisk', label: '打蛋搅面糊', length: 2.0 },
      { type: 'pan', label: '煎松饼', length: 2.5 },
      { type: 'soft', label: '踩奶揉面团', sound: { step: 'squishy_press', special: 'squishy_press' }, color: '#fff1d6', colorPressed: '#f0d2a0', colorSide: '#f6e3c2', trayColor: '#f2c99c', thickness: 0.16, depth: 0.09, rim: 0.5, recover: 0.12, fx: 'fluff', fxColors: ['#ffffff', '#fff6e8'], gait: 'normal', stepDur: 0.9, kneadable: true, specials: ['knead', 'press', 'sit'], length: 2.4 },
      { type: 'cream', label: '裱花蛋糕', length: 2.0 },
    ],
    gimmicks: [
      { type: 'hop', skin: 'lid', label: '瓶盖跳跳', raised: true, stoneY: 0.07, color: '#d6f1fb', deep: '#9fd3ea', bed: '#e3e9ef', bank: '#ffffff', land: 'place', landGain: -10 },
      { type: 'slide', label: '汤勺大滑梯', color: '#e8eef7', color2: '#ff9ec4', pile: 'flour', land: 'sand_press', land2: 'land_soft', tubColor: '#ffffff', stepSound: 'wood_step', say: '哇！汤勺滑梯！' },
      { type: 'bounce', skin: 'pudding', label: '布丁蹦床', sound: 'jelly_bounce' },
      { type: 'float', skin: 'balloon', label: '气球飞过水槽', raised: true, color: '#d6f1fb', deep: '#9fd3ea', bed: '#e3e9ef', bank: '#ffffff' },
    ],
    finale: { type: 'squishy', label: '超大松饼塔', count: 1, shape: 'pancakes', colors: ['#f0b45a'], sound: { step: 'squishy_press', special: 'slime_squish' }, length: 2.6, width: 2.2, kneadable: true, finale: true },
  },
  {
    id: 'clean', env: 'room', voteKeys: ['打扫', '扫地', '房间', '叠衣服', '收纳', '洗澡'], name: '糯糯大扫除', subtitle: '扫一扫、擦一擦，房间亮晶晶',
    sky: ['#ffe9f2', '#fff4f8', '#fff8fb'], fog: '#fff1f6', fogRange: [12, 40], exposure: 1.0,
    hemi: ['#fff6fa', '#e8c4d4', 1.0], sun: ['#fff4ea', 2.1], ambient: 0.45,
    wall: '#fff2f7', wall2: '#ffe4ee', curtain: '#c9e8ff', sofa: '#ffc2d8',
    props: ['plant', 'plush', 'toy_chest', 'cushion_pile', 'floor_lamp', 'teddy', 'block_stack', 'plant'],
    path: '#ffffff', pathSide: '#ffc2d8', pathRug: true,
    particles: { type: 'dust', rate: 3, colors: ['#ffffff'] },
    ambience: 'amb_room', ambienceGain: -3, pathSound: 'path_step', pathGain: -3,
    accessory: 'kerchief', fixedOrder: true,
    stations: [
      { type: 'sweep', label: '扫扫灰尘', length: 2.8 },
      { type: 'mop', label: '擦擦地板', length: 2.6 },
      { type: 'fold', label: '叠叠衣服', length: 2.2 },
      { type: 'tidy', label: '玩具回家', length: 2.6 },
      { type: 'bubblewrap', label: '泡泡浴盆', soap: true, sound: { step: 'bubble_pop' }, trayColor: '#ffffff', gait: 'tiptoe', stepDur: 0.5, specials: ['tapdance'], length: 2.4 },
    ],
    gimmicks: [
      { type: 'hop', skin: 'cushion', label: '抱枕跳跳', liquid: 'rug', color: '#a8dcf7', bed: '#e8d2bd', bank: '#ffffff', land: 'land_soft', landGain: -2 },
      { type: 'slide', label: '被子大滑梯', color: '#ffc2d8', color2: '#ffffff', pile: 'pillows', land: 'land_soft', land2: 'cloth', tubColor: '#c9e8ff', stepSound: 'wood_step', say: '从床上滑下去～' },
      { type: 'bounce', skin: 'bed', label: '床上蹦蹦', sound: 'bounce' },
      { type: 'float', skin: 'balloon', label: '气球飘飘', liquid: 'rug', color: '#a8dcf7', bed: '#e8d2bd', bank: '#ffffff' },
    ],
    finale: { type: 'squishy', label: '超大软软床', count: 1, shape: 'bed', colors: ['#ffffff'], sound: { step: 'cloth', special: 'land_soft' }, length: 2.6, width: 2.2, kneadable: true, finale: true, sleep: true },
  },
];

export const stageById = (id) => STAGES.find((s) => s.id === id) || STAGES[0];

// 一个世界用到的所有声音 id（换世界时只加载这些，其余的释放，长时间运行内存稳定）
export function soundsForStage(st) {
  const ids = new Set([st.ambience, st.pathSound, 'land_soft', 'path_step', 'purr', 'whoosh', 'bounce', 'slide_roll', 'wood_step', 'place', 'plop', 'cloth']);
  for (const d of [...st.stations, st.finale]) {
    for (const k of ['step', 'heavy', 'special', 'pull']) if (d.sound && d.sound[k]) ids.add(d.sound[k]);
    for (const id of TASK_SOUNDS[d.type] || []) ids.add(id);
  }
  for (const g of st.gimmicks || []) for (const k of ['land', 'land2', 'sound', 'stepSound']) if (g[k]) ids.add(g[k]);
  return [...ids].filter(Boolean);
}

// 任务站自己用到的声音
export const TASK_SOUNDS = {
  chop: ['chop', 'place'], whisk: ['ice_crack', 'plop', 'slime_squish'], pan: ['slime_pull', 'sizzle', 'whoosh', 'place', 'plop'],
  cream: ['squishy_press', 'plop', 'sand_step'], sweep: ['fabric_swish', 'place'], mop: ['cloth'], fold: ['cloth', 'place'], tidy: ['whoosh', 'place', 'plop'],
};
