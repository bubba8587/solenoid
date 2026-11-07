#!/usr/bin/env bash
# Drives a native renderer the way a person would: five wheel notches in at the center, then a drag up and left, and
# screenshots the result (half size). Needs Xvfb, openbox, xdotool and ImageMagick.
#   bash native/interact.sh <out.png> <command…>

out=$1; shift
disp=:$((120 + RANDOM % 50))
Xvfb $disp -screen 0 1600x1040x24 >/dev/null 2>&1 & X=$!
sleep 1; DISPLAY=$disp openbox >/dev/null 2>&1 & sleep 1
DISPLAY=$disp "$@" >/dev/null 2>&1 & A=$!
sleep 8
export DISPLAY=$disp
xdotool mousemove 800 520; sleep 0.3
for i in 1 2 3 4 5; do xdotool click 4; sleep 0.15; done
sleep 1
xdotool mousedown 1; for i in $(seq 1 15); do xdotool mousemove_relative -- -20 -10; sleep 0.05; done; xdotool mouseup 1
sleep 2
import -window root $out.full.png; convert $out.full.png -crop 1600x1000+0+21 +repage -resize 50% $out; rm $out.full.png
kill $A; kill $X
