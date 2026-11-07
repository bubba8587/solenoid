#!/usr/bin/env bash
# Screenshots a native renderer with no display: its own Xvfb, openbox (GPUI only starts drawing once a window manager
# has mapped its window), then the screen after a wait, with the window's title bar cropped off.
#   bash native/shot.sh <out.png> <wait-seconds> <command…>
# e.g. bash native/shot.sh /tmp/g.png 5 ~/.cache/solenoid-native/release/solenoid-gpui .dev/scenes/personal-finance --zoom 0.5
# Needs Xvfb, openbox and ImageMagick (apt-get install xvfb openbox imagemagick); GPU renderers run on Mesa's lavapipe
# (mesa-vulkan-drivers) when there is no GPU.
set -euo pipefail
out=$1 wait=$2
shift 2
disp=:$((90 + RANDOM % 100))
Xvfb "$disp" -screen 0 1600x1040x24 >/dev/null 2>&1 &
xvfb=$!
trap 'kill $xvfb 2>/dev/null || true' EXIT
sleep 1
DISPLAY=$disp openbox >/dev/null 2>&1 &
sleep 1
DISPLAY=$disp "$@" &
app=$!
sleep "$wait"
DISPLAY=$disp import -window root "$out.full.png"
kill $app 2>/dev/null || true
# Openbox's title bar is the top 20 pixels or so; keep the client area.
convert "$out.full.png" -crop 1600x1000+0+21 +repage -alpha off "$out"
rm -f "$out.full.png"
echo "$out"
