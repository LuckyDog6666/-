#!/usr/bin/env bash
# 下载打包声音所用的全部原始录音（开发者用；直播时不需要）。
# 所有来源都固定到具体提交，保证可复现、可核对授权。下载完成后运行：
#   python3 tools/build_sounds.py --spec tools/sound_spec.json --raw <RAW 目录> --out web/sounds
set -euo pipefail
RAW="${1:-./sound_sources}"
mkdir -p "$RAW"/{moodist,mtg,cc0col,blanket,music,extra}
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 只取需要的文件（blobless 克隆 + 按路径检出）
fetch_repo() { # url commit dest paths...
  local url="$1" commit="$2" dest="$3"; shift 3
  local dir="$TMP/$(basename "$url" .git)"
  git clone -q --filter=blob:none --no-checkout "$url" "$dir"
  git -C "$dir" checkout -q "$commit" -- "$@"
  for p in "$@"; do cp -r "$dir/$p" "$dest/"; done
}

# Moodist（Pixabay Content License / CC0）：踩雪、碎石、落叶、泡泡、纸、键盘、猫咪呼噜、雨、风、海浪
fetch_repo https://github.com/remvze/moodist.git 11c0be2200116a3635880d600fd6953899cc51a3 "$RAW/moodist" \
  public/sounds/nature public/sounds/things public/sounds/rain public/sounds/animals
# Minetest Game（CC0 / CC BY 3.0，见其 mods/default/README.md）
git clone -q --filter=blob:none --no-checkout https://github.com/luanti-org/minetest_game.git "$TMP/mtg"
git -C "$TMP/mtg" checkout -q c42e4d0c0ff9d27ff7b9b308c3cfc14098dd3a0f -- mods/default/sounds
cp "$TMP"/mtg/mods/default/sounds/*.ogg "$RAW/mtg/"
# CC0 合集（Ben Burnes 微型素材包、rubberduck、Kenney）
fetch_repo https://github.com/lavenderdotpet/CC0-Public-Domain-Sounds.git f2b6264f9ab89fabc266914c3654685d68c5a39b "$RAW/cc0col" \
  "Micro Pack - CaptSubtle - Melon" "bb - Bottle Plops (Apr 2021)" "bb - Keyboard Sounds (Mar 2021)" \
  25-CC0-mud-sfx 40-cc0-water-splash-slime-sfx kenney_impactsounds
# Blanket（CC0 / CC BY / Public Domain，见 SOUNDS_LICENSING.md）
git clone -q --filter=blob:none --no-checkout https://github.com/rafaelmardojai/blanket.git "$TMP/blanket"
git -C "$TMP/blanket" checkout -q 775f2a767230a9681850d1b1e085be58656f1382 -- data/resources/sounds
cp "$TMP"/blanket/data/resources/sounds/*.ogg "$RAW/blanket/"
# Kevin MacLeod 舞曲（CC BY，incompetech.com）
git clone -q --filter=blob:none --no-checkout https://github.com/cjthomas-opensource/mcmusic-kevin-macleod.git "$TMP/mcmusic"
git -C "$TMP/mcmusic" checkout -q 22cb68a5d78e2814ce3409768f79229fc24dda67 -- music
cp "$TMP"/mcmusic/music/* "$RAW/music/"
# 其它单个文件
SS14=https://raw.githubusercontent.com/space-wizards/space-station-14/81c150a7bd6002b838b1358a261785ae116bd5cf/Resources/Audio
for n in 1 2 3 4; do curl -fsSL -o "$RAW/extra/space-station-14__snowstep$n.ogg" "$SS14/Effects/Footsteps/snowstep$n.ogg"; done
for n in 1 2 3 4; do curl -fsSL -o "$RAW/extra/space-station-14__slime$n.ogg" "$SS14/Effects/Footsteps/slime$n.ogg"; done
curl -fsSL -o "$RAW/extra/space-station-14__diona_rustle1.ogg" "$SS14/Voice/Diona/diona_rustle1.ogg"
for n in 01 02; do curl -fsSL -o "$RAW/extra/mod-sounds__sounds_leaves_$n.flac" "https://raw.githubusercontent.com/AntumMT/mod-sounds/b5b9f68389a264d39733331e0a1d89ddc8ce77f8/sounds_src/sounds_leaves_$n.flac"; done
curl -fsSL -o "$RAW/extra/tgstation__soil_plop.ogg" "https://raw.githubusercontent.com/tgstation/tgstation/fc8891311753f3314248908ba944cd4b1f198449/sound/effects/soil_plop.ogg"
i=1; for h in 2ca22ae1 b5adcbc1 a580ffcf 5bd2035e e2b30149 3851a202; do curl -fsSL -o "$RAW/extra/conquest__step-sand-$i.mp3" "https://raw.githubusercontent.com/hoffspot/conquest/17afdba4484b457128189249cd443bd81900ce2a/client/sounds/step-sand-$i.$h.mp3"; i=$((i+1)); done
# Button Sounds（MIT，Josh Comeau）：真实的指尖泡泡（Pop-it）与机械键盘录音
curl -fsSL -o "$TMP/bs.tgz" https://registry.npmjs.org/button-sounds/-/button-sounds-0.0.0.tgz
tar -xzf "$TMP/bs.tgz" -C "$TMP"
for f in popper-dice popper-empty hi75-hard asus-kbd-medium halo-soft; do cp "$TMP/package/assets/$f.mp3" "$RAW/extra/npm-button-sounds__$f.mp3"; done
echo "原始录音已下载到 $RAW"
