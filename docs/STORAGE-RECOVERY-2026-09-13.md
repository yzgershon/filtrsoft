# September 13 storage recovery

Production reached SQLITE_FULL on its existing 5 GB Railway volume. Feed pagination no longer requires a database write (4006fbe). Verdict deduplication now disregards only the hourly scheduling revision when all actual evidence is unchanged (1dbf51d, test typing corrected in c9bd3bb). No historical verdict was deleted by these changes.

Direct Railway Console observations: 733,100 verdict rows; database page_count 1,079,273, page_size 4,096, freelist_count 0. The latest 1,000 payloads averaged 5,678.748 characters. The retained September 8 backup and its `.restore-check` copy each had SHA-256 `f42625699e5544dae2b2f1992403d03fb19609a4e1cf18164d480faa91c45368`. After an additional byte comparison, only that redundant `.restore-check` copy was removed. The original 115 MB backup and manifest remain. The exact removed bytes can be recreated by copying the retained original. Filesystem available space then measured 119,668,736 bytes.

## Lossless older-verdict compression

`src/scripts/compact-verdict-history.ts` opens only the explicitly named database; it does not migrate, rescore, import archives, or start crawls. It compresses only older verdict payloads; every row, ID, timestamp, version, call and latest JSON payload remains. Each gzip envelope includes a SHA-256 checksum; encoding verifies byte-exact reconstruction. Historical `decisionAt` readers decode the original evidence. Existing current-verdict readers continue seeing plain JSON.

Preparation is outside the write transaction. Each batch updates at most 128 rows with optimistic original-payload and still-historical checks. Every batch is atomic. SQLite checkpoints its own WAL after each batch. Less than 32 MiB physical headroom or a busy checkpoint stops additional work. A prior committed batch stays valid; no WAL file is manually removed. An `after` cursor permits explicit resumption.

Read-only sample (no `--apply`):

```sh
bun run src/scripts/compact-verdict-history.ts --db=/data/filtrsoft.db --batches=1
```

Bounded application, then inspect savedBytes, filesystem space, freelist and quick_check before continuing:

```sh
bun run src/scripts/compact-verdict-history.ts --db=/data/filtrsoft.db --apply --batches=50
```

Continue with `--after=N` using the returned cursor. Full application is explicit `--apply --batches=10000`. A dry run scans one batch by default. **Compression frees reusable SQLite pages, not physical filesystem bytes; the database file does not shrink.** Do not report reusable capacity as filesystem free space.

Normal rollback uses the same checksummed decoder and small transactions:

```sh
bun run src/scripts/compact-verdict-history.ts --db=/data/filtrsoft.db --restore --batches=1
bun run src/scripts/compact-verdict-history.ts --db=/data/filtrsoft.db --restore --apply --batches=50
```

Restoring expands payloads and needs sufficient reusable/physical capacity. Keep decoder compatibility in any application rollback while compressed rows exist. Latest payloads remain plain, but older decision lookups require the decoder. Do not perform a full VACUUM or replace the live database without separately planning the space and concurrent-writer requirements.

Local verification: **325 tests / 0 failures / 943 assertions**, TypeScript passed. Focused recovery cases prove byte-exact Unicode reconstruction, full rollback, transaction abort atomicity, preservation of current JSON, historical personal-decision lookups, and reusable pages on a real WAL database. This count includes the separate uncommitted market/follow-up work. **Production compression has not been applied yet**; deploy decoder compatibility before invoking the explicit maintenance script.
