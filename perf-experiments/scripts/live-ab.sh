# usage: live-ab.sh <reps> <zooms> name1 cssfile1 name2 cssfile2 ...   (cssfile "-" = none)
cd /home/user/solenoid
REPS=$1; Z=$2; shift 2
OUT=/tmp/claude-0/-home-user-solenoid/a79503b6-598e-500e-955d-f85b1255b5b6/scratchpad/exp/live-ab.csv
: > $OUT
for r in $(seq 1 $REPS); do
  set -- "$@"
  args=("$@")
  for ((i=0; i<${#args[@]}; i+=2)); do
    name=${args[i]}; f=${args[i+1]}
    css=""; [ "$f" != "-" ] && css=$(cat "$f")
    CSS="$css" PANE_ONLY=1 NO_SHOTS=1 CSV=1 timeout 600 node scripts/.exp-mobile.mjs personal-finance --zooms=$Z 2>/dev/null | grep "^CSV" | sed "s/^CSV/$name/" >> $OUT
  done
done
python3 - "$OUT" <<'PY'
import sys,collections,statistics
rows=collections.defaultdict(list)
for line in open(sys.argv[1]):
    p=line.strip().split(",")
    rows[(p[0],p[1])].append([int(x) for x in p[2:6]])
for (n,z),v in sorted(rows.items(), key=lambda kv:(kv[0][1],kv[0][0])):
    cols=list(zip(*v))
    f=lambda c: f"{int(statistics.median(c)):5d} [{min(c)}-{max(c)}]"
    print(f"zoom {z:4s} {n:14s} n={len(v)}  paint {f(cols[0])}  layerize {f(cols[1])}  raster {f(cols[2])}  script {f(cols[3])}")
PY
