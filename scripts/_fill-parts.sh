#!/bin/sh
# Fill comps for the newly seeded parts catalog, in chunks so a failure loses
# one chunk rather than the run. Honours the pause switch between chunks.
cd /c/Dev/filtrsoft
for i in 1 2 3 4 5 6; do
  if [ -f "/c/Users/yzger/.filtrsoft/paused" ]; then
    echo "=== PAUSED by the switch, stopping after chunk $((i-1)) ==="
    break
  fi
  echo "=== chunk $i ==="
  bun run ebay:comps --skus 16 2>&1 | tail -6
done
echo "=== done ==="
