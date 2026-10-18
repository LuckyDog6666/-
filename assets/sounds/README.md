# 用真实录音替换声音（可选）

糯糯的所有声音默认由程序实时合成。如果你有更好的真实 ASMR 录音，可以替换其中任意一种：

1. 在这个文件夹里新建一个子文件夹，名字是**声音 ID**，例如 `slime`（史莱姆）、`snow_pile`（雪堆）。
2. 把录音放进去：支持 `wav / mp3 / ogg / m4a / flac`，可以放多个文件（随机轮换，越多越不重复）。
3. 每个文件只包含一次完整的触发声，开头不要留空白。
4. 刷新游戏页面生效；音量会自动对齐，删掉文件夹即恢复默认。

例如：

```
assets/sounds/
  slime/
    slime_01.wav
    slime_02.wav
  bubble_wrap/
    pop_a.wav
```

全部声音 ID 与对应物件见 `docs/使用手册.md` 第 9.2 节。
常用：`marshmallow` 棉花糖、`jelly` 果冻、`candy_wrapper` 糖纸、`bubble_pop` 泡泡、`snow_pile` 雪堆、`ice_crack` 薄冰、
`leaf_pile` 落叶、`puddle` 水洼、`macaron` 马卡龙、`biscuit` 饼干、`cloud_puff` 云朵、`bubble_wrap` 气泡膜、
`keycap` 键帽、`slime` 史莱姆、`kinetic_sand` 太空沙、`soap` 肥皂、`crystal` 水晶、`cave_drip` 水滴，
地面脚步 `step_grass`、`step_snow`、`step_sand`、`step_wood` 等。
