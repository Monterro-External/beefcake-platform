#!/bin/sh
# One status line a minute for a background subagent, for the Monitor tool.
#   watch-agent.sh <output_file from the Agent result> [dir the agent writes to]
# Prints STALL once the transcript has been quiet for 3 minutes, and DONE when
# the agent ends its turn, then exits.
F="$1"; D="${2:-}"
while true; do
  now=$(date +%s); mtime=$(stat -L -f %m "$F" 2>/dev/null || stat -L -c %Y "$F" 2>/dev/null || echo "$now")
  idle=$((now - mtime))
  files=$([ -n "$D" ] && ls "$D" 2>/dev/null | wc -l | tr -d ' ' || echo -)
  info=$(python3 -I - "$F" <<'PY' 2>/dev/null || echo "? ?"
import json, sys
n, last = 0, "-"
for line in open(sys.argv[1]):
    try:
        content = json.loads(line).get("message", {}).get("content")
    except ValueError:
        continue
    for part in content if isinstance(content, list) else []:
        if part.get("type") == "tool_use":
            n, last = n + 1, part["name"].replace("mcp__playwright-test__", "")
print(n, last)
PY
)
  echo "$(date +%H:%M) tools=${info% *} last=${info#* } files=$files idle=${idle}s"
  if [ "${info#* }" = SubagentHandback ] || { tail -c 4000 "$F" 2>/dev/null | grep -q '"stop_reason":"end_turn"' && [ "$idle" -gt 30 ]; }; then echo DONE; exit 0; fi
  if [ "$idle" -gt 180 ]; then echo "STALL: quiet for ${idle}s, last call ${info#* }"; exit 0; fi
  sleep 60
done
