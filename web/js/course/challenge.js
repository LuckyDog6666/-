// 终点挑战：每一关最后的"大悬念"——限时砸开宝箱。
//
// 这是整关里唯一真的可能失败的地方，也是观众的互动最值钱的地方：
//  - 糯糯自己的力气每次都不一样（开始时暗中抽一个数），没人帮忙时大约四成能砸开
//  - 倒计时里观众的点赞 / 弹幕 / 礼物都会变成"力气"，进度条实时往上涨——点几个赞就可能把结局从"差一点点"变成"打开了"
//  - 砸开：金币喷泉 + 一个至少稀有的盲盒；没砸开：糯糯嘟嘴，下一关再来
// 竖屏里是"宝箱在下、糯糯在上面蹦"的上下构图，正好占满画面中间。
import * as THREE from 'three';
import { GIMMICK_TYPES } from './gimmicks.js';
import { Suspense } from './suspense.js';
import { roundedBox } from '../world/geo.js';
import { Spring, clamp, ease } from '../core/util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const GOLD = ['#ffd166', '#ffe9a8', '#ffb35c', '#ffffff'];
export class ChestChallenge extends Suspense {
  build() {
    const { M, G } = this.ctx, d = this.def;
    this.challenge = true;
    this.label = d.label || '终点宝箱';
    this.length = 2.9;
    const c = this.c = 1.45, W = 0.94, D = 0.64, HB = 0.44;
    this.dim = { W, D, HB, top: HB + 0.2 };
    const g = this.chest = new THREE.Group();
    g.position.set(c, 0.005, 0);
    this.group.add(g);
    const body = new THREE.Mesh(G.track(roundedBox(W, HB, D, 0.06, 3).translate(0, HB / 2, 0)), M.soft(d.color || '#ff9ec4', { rough: 0.55, rim: 0.4 }));
    body.castShadow = true; body.receiveShadow = true;
    g.add(body);
    const trim = M.soft('#ffd166', { rough: 0.35, rim: 0.5 });
    for (const x of [-0.3, 0.3]) g.add(new THREE.Mesh(G.track(roundedBox(0.09, HB + 0.012, D + 0.02, 0.012, 2).translate(x, HB / 2, 0)), trim));
    const lock = new THREE.Mesh(G.track(roundedBox(0.16, 0.18, 0.06, 0.03, 2).translate(0, HB - 0.03, D / 2 + 0.02)), trim);
    g.add(lock);
    // 缝里透出来的金光：砸得越多越亮
    this.seam = new THREE.Mesh(G.track(roundedBox(W + 0.03, 0.05, D + 0.03, 0.02, 2).translate(0, HB, 0)), M.track(new THREE.MeshBasicMaterial({ color: '#fff6c4', transparent: true, opacity: 0, fog: false })));
    g.add(this.seam);
    // 盖子：铰链在后面，向后翻开
    const hinge = this.hinge = new THREE.Group();
    hinge.position.set(0, HB, -D / 2);
    const lid = new THREE.Mesh(G.track(roundedBox(W + 0.05, 0.2, D + 0.05, 0.09, 4).translate(0, 0.1, D / 2)), M.soft(d.color2 || '#ff7fb1', { rough: 0.5, rim: 0.45 }));
    lid.castShadow = true;
    hinge.add(lid);
    for (const x of [-0.3, 0.3]) hinge.add(new THREE.Mesh(G.track(roundedBox(0.09, 0.208, D + 0.07, 0.03, 2).translate(x, 0.1, D / 2)), trim));
    g.add(hinge);
    // 箱子里的金光（打开以后才看得到）
    this.inside = new THREE.Mesh(G.track(roundedBox(W - 0.1, 0.05, D - 0.1, 0.02, 2).translate(0, HB - 0.04, 0)), M.glow('#ffe58a', 1.6));
    this.inside.visible = false;
    g.add(this.inside);
    this.sq = new Spring(240, 8, 1);
    this.wob = new Spring(150, 6, 0);
    this.opened = false;
    this.result = null;
    return this;
  }
  topY(x, z) {
    const { W, D, top } = this.dim;
    return !this.opened && Math.abs(x - this.c) < W / 2 && Math.abs(z) < D / 2 ? top * this.chest.scale.y : 0;
  }
  update(dt) {
    super.update(dt);
    const s = clamp(this.sq.update(dt), 0.7, 1.2);
    this.chest.scale.set(1 + (1 - s) * 0.4, s, 1 + (1 - s) * 0.4);
    this.chest.rotation.z = this.wob.update(dt);
  }
  _hit(G, p, k) {
    const c = this.c, { top } = this.dim;
    const wp = this.W(c, top, 0);
    this.sq.x = 0.86; this.sq.v -= 1.2;
    this.hinge.rotation.x = -0.05 * p * Math.random();
    this.seam.material.opacity = 0.15 + 0.85 * p;
    this.seam.scale.y = 1 + p * 1.6;
    G.sfx('wood_step', wp, { gain: 1 });
    if (k % 3 === 2) G.sfx('ice_crack', wp, { gain: -5 + p * 4, main: false });
    G.burst('crumbs', this.W(c, top - 0.18, 0.34), { colors: GOLD, count: 3 + Math.round(p * 5), scale: 0.6 });
    G.camBump(0.014 + p * 0.016);
    G.countStep();
  }
  async run(G) {
    const pet = G.pet, c = this.c, { HB, top } = this.dim, rng = this.ctx.rng;
    G.label(this.label);
    G.cam('frame', { center: this.W(c - 0.45, 0.6, 0), radius: 1.55, dir: V(0.5, 0.34, 0.8) });
    pet.expr('wide', 'open', 1.4, 'up');
    G.say('终点宝箱！把它砸开！');
    await pet.idleAction('peek', 0.9);
    G.unsay();
    const T = this.def.seconds || 12;
    // 糯糯这次的力气（观众看不到）：不靠帮忙大约四成能砸开
    const power = rng.range(0.062, 0.098);
    const need = Math.max(22, G.cheerGoal() * 0.45);
    let base = 0;
    const v0 = G.viewerPts();
    const prog = () => clamp(base + (G.viewerPts() - v0) / need, 0, 1);
    const topW = () => this.W(c, top * this.chest.scale.y, 0);
    await pet.hop(topW(), { height: 0.6, dur: 0.6 });
    pet.setGround(topW().y);
    pet.faceTowards(G.camPos().x, G.camPos().z);
    G.cam('frame', { center: this.W(c, 0.98, 0), radius: 1.38, dir: V(0.22, 0.3, 0.93) });
    G.prompt({ title: '💥 砸开宝箱！', sub: '快点赞、发弹幕，给糯糯加力气！', rate: 0, rateLabel: '宝箱裂开', seconds: T });
    const t0 = G.time;
    let last = t0, k = 0;
    this._hit(G, 0, k++);
    while (G.time - t0 < T && prog() < 1) {
      pet.expr(prog() > 0.7 ? 'happy' : 'open', 'open', 1, 'down');
      await pet.hop(topW(), { height: 0.34 + Math.random() * 0.14, dur: 0.44, anticipation: 0.05, keepFacing: true });
      pet.setGround(topW().y);
      base += power * (G.time - last);
      last = G.time;
      this._hit(G, prog(), k++);
      G.promptUpdate({ rate: prog(), seconds: Math.max(0, T - (G.time - t0)) });
    }
    const ok = prog() >= 1, pct = Math.round(prog() * 100);
    this.result = ok;
    const side = this.W(c - 1.02, 0, 0.08);
    side.y = G.yAt(side.x, side.z);
    if (ok) {
      G.promptUpdate({ rate: 1, seconds: null, sub: '裂开了！！' });
      await pet.hop(side, { height: 0.5, dur: 0.55, keepFacing: true });
      pet.setGround(side.y);
      G.promptHide();
      G.cam('frame', { center: this.W(c - 0.4, 0.7, 0), radius: 1.5, dir: V(0.35, 0.34, 0.87) });
      this.inside.visible = true;
      this.opened = true;
      const wp = this.W(c, HB + 0.2, 0);
      G.sfx('place', wp, { gain: 2 });
      this.fx.run(0.5, (u) => { this.hinge.rotation.x = -2.0 * ease.outBack(u); });
      G.reveal({ tag: '🎉 挑战成功', cls: 'win', title: '宝箱打开啦！', sub: '应援值 +25 · 再送一个稀有盲盒', secs: 2.4 });
      G.addCheer(25);
      pet.expr('happy', 'open', 3);
      for (let i = 0; i < 3; i++) {
        G.burst('confetti', wp, { colors: GOLD, count: 34 });
        G.burst('stars', wp, { colors: GOLD, count: 10 });
        G.sfx('gravel_step', wp, { gain: 1 - i, main: i === 0 });
        if (i === 0) G.camBump(0.05);
        await G.wait(0.3);
      }
      await pet.idleAction('celebrate', 1.2);
      const res = G.openBox({ boost: 0.6, min: 'r' });
      await this.revealItem(G, res, V(c, HB, 0), { hold: 1.8 });
    } else {
      G.promptHide();
      this.wob.v += 2.4;
      G.sfx('wood_step', this.W(c, top, 0), { gain: 0, main: false });
      G.reveal({ tag: '差一点点', cls: 'lose', title: `只裂开了 ${pct}%`, sub: '宝箱没砸开…下一关多给糯糯点点赞！', secs: 2.8 });
      await pet.hop(side, { height: 0.4, dur: 0.5, keepFacing: true });
      pet.setGround(side.y);
      G.cam('frame', { center: this.W(c - 0.45, 0.6, 0), radius: 1.5, dir: V(0.4, 0.34, 0.85) });
      pet.expr('half', 'o', 2.2, 'worried');
      await pet.idleAction('tilt', 1.2);
      pet.expr('happy', 'smile', 1.6);
      G.say('没关系，下次一定砸开！');
      await pet.idleAction('shake', 0.8);
      G.unsay();
    }
    // 从宝箱上面跳过去
    G.cam('front');
    pet.face(Math.PI / 2);
    const end = this.W(this.length + 0.12, 0, 0);
    end.y = G.yAt(end.x, end.z);
    await pet.hop(end, { height: 1.0, dur: 0.85 });
    pet.setGround(end.y);
    G.sfx(G.pathSound, end, { gain: -1 });
    this.done = true;
  }
}

Object.assign(GIMMICK_TYPES, { chest: ChestChallenge });
