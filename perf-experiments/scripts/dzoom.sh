cd /home/user/solenoid
S=/tmp/claude-0/-home-user-solenoid/a79503b6-598e-500e-955d-f85b1255b5b6/scratchpad
OUT=$S/exp/dzoom2.txt; : > $OUT
declare -A V
V[base]=""
V[tag]=".solenoid-node::before{clip-path:none!important;display:none!important}"
V[framehead]=".react-flow__node .solenoid-node__frame-head{overflow:visible!important}"
V[svgs]=".react-flow__node svg:not(.solenoid-node__frame-head){overflow:visible!important}"
for r in 1 2 3 4 5; do for v in base tag framehead svgs; do
  css="${V[$v]}"; if [ -n "$css" ]; then K="--ko=$css"; else K=""; fi
  out=$(timeout 300 node scripts/zoom-perf-probe.mjs personal-finance --zooms=0.2 --nopan=1 --frames=80 "$K" 2>&1 | grep -o "zoom (.*")
  echo "$v $out" >> $OUT
done; done
python3 - <<'PY'
import re,statistics,collections
d=collections.defaultdict(list)
for l in open("/tmp/claude-0/-home-user-solenoid/a79503b6-598e-500e-955d-f85b1255b5b6/scratchpad/exp/dzoom2.txt"):
    m=re.search(r"^(\w+) zoom \((\d+) steps\): script (\d+).*?paint (\d+)\s+layerize (\d+)\s+raster (\d+).*?mainTask (\d+)",l)
    if not m: continue
    n,steps,sc,pa,la,ra,mt=m.groups(); steps=int(steps)
    d[n].append((int(mt)/steps,int(pa)/steps,int(la)/steps))
for k,v in d.items():
    c=list(zip(*v)); f=lambda x:"%.1f [%.1f-%.1f]"%(statistics.median(x),min(x),max(x))
    print(k,"n=",len(v),"per step: main",f(c[0]),"paint",f(c[1]),"layerize",f(c[2]))
PY
