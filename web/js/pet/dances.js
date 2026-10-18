// 舞蹈动作库：每支舞都是一个关于"拍子"的程序化动画函数。
// fn(P, t, beat, pet) 修改姿态 P；events 在指定拍子触发音效/特效。
import { TAU } from '../core/util.js';

const S = Math.sin, Cs = Math.cos, A = Math.abs;
const fadeIn = (t, d = 0.25) => Math.min(1, t / d);
// 每拍一次的弹跳曲线 0→1→0
const hopCurve = (beat) => A(S(beat * Math.PI));

function evEvery(beats, every, data, from = 0) {
  const out = [];
  for (let b = from; b < beats; b += every) out.push({ beat: b, ...data });
  return out;
}

export const DANCES = [
  {
    id: 'sway', name: '摇摆舞', beats: 8,
    fn(P, t, b) {
      const f = fadeIn(t);
      P.rz += S(b * Math.PI) * 0.22 * f;
      P.y += hopCurve(b) * 0.05 * f;
      P.armL.z = 0.8 + S(b * Math.PI) * 0.6; P.armR.z = -0.8 + S(b * Math.PI) * 0.6;
      P.ear = S(b * Math.PI) * 4;
    },
  },
  {
    id: 'spin', name: '转圈圈', beats: 8,
    fn(P, t, b) {
      P.ry += ((b / 2) % 1) * TAU * (b < 8 ? 1 : 0);
      P.y += hopCurve(b) * 0.1;
      P.armL.z = 1.4; P.armR.z = -1.4;
      P.sy += hopCurve(b) * 0.05;
    },
    events: evEvery(8, 2, { fx: 'sparkles' }),
  },
  {
    id: 'bounce', name: '蹦蹦跳', beats: 8,
    fn(P, t, b) {
      const h = hopCurve(b);
      P.y += h * 0.32;
      P.sy += (h > 0.15 ? 0.12 * h : -0.18 * (1 - h / 0.15));
      P.armL.z = 2.4 * h + 0.2; P.armR.z = -2.4 * h - 0.2;
      P.footL.y = P.footR.y = h * 0.05;
      P.earFlap = h * 3;
    },
    events: evEvery(8, 1, { sound: 'land', gain: -6 }),
  },
  {
    id: 'heart', name: '比心心', beats: 8,
    fn(P, t, b) {
      const f = fadeIn(t, 0.4);
      // 双手举过头顶合成爱心
      P.armL.z = 2.65 * f; P.armR.z = -2.65 * f;
      P.armL.x = 0.35 * f; P.armR.x = 0.35 * f;
      P.rz += S(b * Math.PI * 0.5) * 0.12;
      P.y += hopCurve(b) * 0.04;
      pet_happy(P);
    },
    events: evEvery(8, 2, { fx: 'hearts' }, 1),
  },
  {
    id: 'wave', name: '波浪手', beats: 8,
    fn(P, t, b) {
      const w = S(b * Math.PI);
      P.armL.z = 1.6 + w * 0.9; P.armR.z = -1.6 + w * 0.9;
      P.rz += w * 0.12;
      P.y += A(Cs(b * Math.PI)) * 0.05;
      P.sy += Cs(b * TAU) * 0.04;
    },
  },
  {
    id: 'luckycat', name: '招财猫', beats: 8,
    fn(P, t, b) {
      const f = fadeIn(t);
      P.armR.z = -2.3 * f; P.armR.x = (0.4 + S(b * TAU) * 0.55) * f; // 招手
      P.armL.z = 0.3;
      P.rz += 0.1 * f + S(b * Math.PI) * 0.04;
      P.y += hopCurve(b) * 0.03;
    },
  },
  {
    id: 'wiggle', name: '扭屁屁', beats: 8,
    fn(P, t, b) {
      const f = fadeIn(t, 0.4);
      P.ry += Math.PI * 0.85 * f; // 背对镜头
      P.rz += S(b * TAU) * 0.18 * f;
      P.tail = S(b * TAU * 2) * 0.9;
      P.armL.z = 0.6; P.armR.z = -0.6;
      P.y += hopCurve(b * 2) * 0.03;
    },
  },
  {
    id: 'moonwalk', name: '太空步', beats: 8,
    fn(P, t, b, pet, a) {
      const ph = (b % 4) / 4; // 往后滑再回来
      const off = S(ph * TAU) * 0.25;
      P.footL.z = S(b * Math.PI) * 0.1; P.footR.z = -S(b * Math.PI) * 0.1;
      P.footL.y = Math.max(0, S(b * Math.PI)) * 0.04; P.footR.y = Math.max(0, -S(b * Math.PI)) * 0.04;
      P.rx += -0.1;
      P.armL.z = 0.5 + S(b * Math.PI) * 0.3; P.armR.z = -0.5 + S(b * Math.PI) * 0.3;
      P.y += 0.0;
      P.sx *= 1;
      P.zOff = off;
    },
  },
  {
    id: 'top', name: '小陀螺', beats: 6,
    fn(P, t, b) {
      const sp = Math.min(1, t / 1.0);
      P.ry += t * TAU * 1.6 * sp;
      P.sy *= 1 + 0.12 * sp; P.sx *= 1 - 0.05 * sp;
      P.armL.z = 1.2; P.armR.z = -1.2;
      P.earFlap = 4 * sp;
    },
    events: evEvery(6, 1, { fx: 'sparkles' }),
  },
  {
    id: 'bow', name: '鞠躬致谢', beats: 8,
    fn(P, t, b) {
      const ph = (b % 4) / 4;
      const bow = ph < 0.5 ? S(ph * 2 * Math.PI) : 0;
      P.rx += bow * 0.55;
      P.armL.z = 0.2 + bow * 0.3; P.armR.z = -0.2 - bow * 0.3;
      P.armL.x = bow * 0.6; P.armR.x = bow * 0.6;
      if (bow < 0.1) P.y += hopCurve(b * 2) * 0.03;
      pet_happy(P);
    },
  },
  {
    id: 'jacks', name: '开合跳', beats: 8,
    fn(P, t, b) {
      const h = hopCurve(b);
      const open = (Math.floor(b) % 2 === 0) ? h : 1 - h;
      P.y += h * 0.22;
      P.armL.z = 0.3 + open * 2.4; P.armR.z = -0.3 - open * 2.4;
      P.footL.x = -open * 0.08; P.footR.x = open * 0.08;
      P.sy += h * 0.08;
    },
    events: evEvery(8, 1, { sound: 'land', gain: -8 }),
  },
  {
    id: 'waddle', name: '小鸭步', beats: 8,
    fn(P, t, b) {
      const s = S(b * Math.PI);
      P.rz += s * 0.2;
      P.ry += S(b * Math.PI * 0.5) * 0.7;
      P.footL.y = Math.max(0, s) * 0.06; P.footR.y = Math.max(0, -s) * 0.06;
      P.armL.z = 0.7 - s * 0.3; P.armR.z = -0.7 - s * 0.3;
      P.armL.x = -0.5; P.armR.x = -0.5;
      P.tail = s * 0.6;
    },
  },
  {
    id: 'flip', name: '后空翻', beats: 8, big: true,
    fn(P, t, b) {
      const ph = b % 4;
      if (ph < 2) {
        const u = ph / 2;
        P.y += 4 * 0.9 * u * (1 - u);
        P.rx += -u * TAU;
        P.armL.z = 2.2; P.armR.z = -2.2;
      } else {
        const h = hopCurve(ph);
        P.y += h * 0.06;
        P.armL.z = 2.5; P.armR.z = -2.5;
        pet_happy(P);
      }
    },
    events: [{ beat: 2, sound: 'land' }, { beat: 2, fx: 'stars' }, { beat: 6, sound: 'land' }, { beat: 6, fx: 'stars' }, { beat: 0, sound: 'jump' }, { beat: 4, sound: 'jump' }],
  },
  {
    id: 'tap', name: '踢踏舞', beats: 8,
    fn(P, t, b) {
      const q = b * 2;
      const l = Math.floor(q) % 2 === 0;
      const h = A(S(q * Math.PI));
      P.footL.y = l ? h * 0.07 : 0; P.footR.y = l ? 0 : h * 0.07;
      P.footL.z = l ? h * 0.06 : 0; P.footR.z = l ? 0 : h * 0.06;
      P.rz += (l ? 1 : -1) * h * 0.06;
      P.armL.z = 0.9; P.armR.z = -0.9; P.armL.x = -0.3; P.armR.x = -0.3;
    },
    events: evEvery(8, 0.5, { sound: 'm_tap', gain: -4 }),
  },
  {
    id: 'headbop', name: '摇头晃脑', beats: 8,
    fn(P, t, b) {
      P.rz += S(b * Math.PI) * 0.16;
      P.rx += A(S(b * Math.PI)) * 0.12;
      P.sy += -A(S(b * Math.PI)) * 0.06;
      P.earFlap = S(b * Math.PI) * 5;
      P.armL.z = 0.4; P.armR.z = -0.4;
    },
  },
  {
    id: 'ballet', name: '芭蕾转转', beats: 8,
    fn(P, t, b) {
      const f = fadeIn(t, 0.5);
      P.sy *= 1 + 0.14 * f; P.sx *= 1 - 0.06 * f;
      P.y += 0.05 * f;
      P.ry += S(b * Math.PI * 0.25) * Math.PI * f;
      P.armL.z = 2.7 * f; P.armR.z = -2.7 * f;
      P.armL.x = 0.2; P.armR.x = 0.2;
      P.footL.y = 0.03 * f;
      pet_happy(P);
    },
    events: evEvery(8, 2, { fx: 'notes' }),
  },
  {
    id: 'clap', name: '拍拍手', beats: 8,
    fn(P, t, b) {
      const c = A(S(b * Math.PI));
      P.armL.z = 1.2 + c * 0.3; P.armR.z = -1.2 - c * 0.3;
      P.armL.x = 1.0 * (1 - c); P.armR.x = 1.0 * (1 - c);
      P.y += c * 0.04;
      pet_happy(P);
    },
    events: evEvery(8, 1, { sound: 'm_clap', gain: -3 }, 0.5),
  },
  {
    id: 'shy', name: '害羞羞', beats: 8,
    fn(P, t, b) {
      const f = fadeIn(t, 0.4);
      P.armL.z = 1.4 * f; P.armR.z = -1.4 * f; P.armL.x = 1.2 * f; P.armR.x = 1.2 * f; // 捂脸
      P.rz += S(b * Math.PI * 0.5) * 0.15;
      P.ry += S(b * Math.PI * 0.5) * 0.3;
      P.sy *= 1 - 0.04 * f;
      P.blush = 1;
    },
    events: evEvery(8, 4, { fx: 'hearts' }, 2),
  },
];

// 舞蹈中顺带开心表情（由 Game 根据 P.happy 应用）
function pet_happy(P) { P.happy = true; }

export function danceById(id) { return DANCES.find((d) => d.id === id) || DANCES[0]; }
