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

Production application is complete using 53c3c44. The pilot scanned 6,400 rows through ID 19,264; the continuation scanned another 725,392 and finished at ID 749,273. Combined, 714,958 payloads were compressed, saving 1,585,672,293 payload bytes. Final readback at 2026-09-14T01:17:03.683Z decoded all 739,094 observed rows, checked every compressed checksum, confirmed zero compressed latest payloads, and returned SQLite quick_check **ok**. Reusable SQLite space: 1,203,003,392 bytes. Physical available space: 97,718,272 bytes. Normal application writes continued; row counts can increase. No unique record was deleted. The temporary maintenance and audit processes exited successfully.

The first deployed maintenance entrypoint used `{readonly:false}`, which Bun rejected before writing. The correction explicitly uses `{readwrite:true}` and has a command-line dry/apply/restore regression. Future changed verdicts now archive their superseded payload in the same transaction, keeping current JSON plain and preventing a return to uncompressed historical growth. Local tests cover byte-exact Unicode reconstruction, normal rollback, transaction abort atomicity, current JSON, historical personal decisions, real WAL freelist recovery, the actual CLI and the future-write path.
