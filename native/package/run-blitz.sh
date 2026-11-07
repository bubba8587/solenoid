#!/usr/bin/env sh
# ./run-blitz.sh <scene> [tiles] [more flags…]
cd "$(dirname "$0")"
scene=${1:-getting-started}; tiles=${2:-1}
if [ $# -ge 2 ]; then shift 2; else shift $#; fi
exec ./solenoid-blitz view "scenes/$scene" --tile "$tiles" "$@"
