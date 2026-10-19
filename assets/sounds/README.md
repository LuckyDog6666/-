# 用你自己的录音替换内置声音（可选）

糯糯的所有声音默认使用 `web/sounds/` 里打包好的真实录音（来源与授权见 `web/sounds/CREDITS.md`）。
如果你有更喜欢的 ASMR 录音，可以替换其中任意一种：

1. 在这个文件夹里新建一个子文件夹，名字是**声音 ID**，例如 `slime_squish`（捏史莱姆）、`snow_step`（踩雪）。
2. 把录音放进去：支持 `wav / mp3 / ogg / m4a / flac`，可以放多个文件（随机轮换，越多越不重复）。
3. 每个文件只包含一次完整的触发声（踩一下、捏一下），开头不要留空白。
4. 刷新游戏页面生效；音量会自动对齐到同类声音，删掉文件夹即恢复内置录音。

例如：

```
assets/sounds/
  slime_squish/
    my_slime_01.wav
    my_slime_02.wav
  plop_pop/
    popit_a.wav
```

常用 ID：`snow_step` 踩雪、`snow_crunch` 重踩雪、`snow_press` 坐进雪里、`leaves_step` 踩落叶、`gravel_step` 踩小石子、
`sand_step` 踩沙子、`slime_step` 踩史莱姆、`slime_squish` 捏史莱姆、`slime_pull` 史莱姆拉丝、`squishy_press` 压慢回弹捏捏、
`jelly_bounce` 果冻、`mud_squelch` 泥巴、`water_splash` 水花、`bubble_pop` 肥皂泡、`plop_pop` Pop-it 按压泡泡、
`key_thock` 大键帽、`paper_crinkle` 糖纸、`ice_crack` 薄冰、`purr` 踩奶时的呼噜声、`music_dance` 答谢舞曲，
环境声 `amb_wind` `amb_birds` `amb_rain` `amb_waves` `amb_fire`。完整列表见 `docs/使用手册.md` 第 11.3 节。

> 请只使用你有权使用的录音（自己录的，或 CC0 / 允许商用的素材），并按授权要求署名。
