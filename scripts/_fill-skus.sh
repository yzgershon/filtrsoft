#!/bin/sh
# Fill every SKU that has no comps, in chunks.
#
# --skus N picks the N SKUs that most need comps and LINKS the results to them.
# That linkage is the whole point: --query stores sku_id = NULL and valueSku
# joins on sku_id, so a --query pull is invisible to every valuation.
#
# Chunked so a mid-run browser death costs one chunk, not the run, and so the
# crawl switch can stop it between chunks.
cd /c/Dev/filtrsoft || exit 1
for i in 1 2 3 4; do
  if [ -f "$HOME/.filtrsoft/paused" ]; then
    echo "=== PAUSED by the switch, stopping before chunk $i ==="
    break
  fi
  echo "=== chunk $i ==="
  bun run ebay:comps --skus 15 2>&1 | tail -6
done
echo "=== done ==="
