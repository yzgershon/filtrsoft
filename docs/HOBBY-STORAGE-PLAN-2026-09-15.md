# Stay on the existing Railway plan

Yish declined the Pro upgrade and larger volume. No higher monthly spend, new paid storage provider or subscription is authorized. Both earlier approval questions are closed. Keep the existing Hobby plan and 5 GB volume.

## Measured result

The production read at 15:39 UTC measured a 4,447,391,744-byte SQLite file, 97,583,104 physical bytes available and 271,018 reusable 4,096-byte pages. `auto_vacuum=0`, so incremental vacuum cannot reclaim those pages from the filesystem without an initial rebuild.

A read-only `VACUUM INTO` snapshot was created in the existing container's temporary directory, not on `/data`. At 15:41 UTC it passed full SQLite integrity and foreign-key checks. It contains 7,379 listings, 757,551 verdicts, 31,992 comps, 577 SKUs, four accounts, 69 judgments and one outcome. The live source continued operating and was never replaced or truncated.

| File | Bytes | Decimal GB |
| --- | ---: | ---: |
| Live allocated database | 4,447,391,744 | 4.45 |
| Compact consistent snapshot | 2,715,983,872 | 2.72 |
| Snapshot compressed with gzip level 1 | 1,970,777,026 | 1.97 |
| Potential physical reduction at this snapshot | 1,731,407,872 | 1.73 |

Snapshot: `/tmp/filtrsoft-storage-ROWKrR/snapshot.db` in deployment `df4083fe-36fe-408c-b4d8-de5b5ef3c263`. SHA-256: `7ec6f8a835505664361f3c1501708e980dd670efd55cd01277e13572cc23c872`. Matching `.gz` and aggregate `.json` files exist beside it. This is **temporary diagnostic staging, not durable backup coverage**. It can disappear on restart/redeployment. It does not establish that writes made after its creation are backed up. Keep paths private; the actual database contains account records and must not enter Git.

The existing Windows C: drive had approximately 370 GB free. The separate local ingestion backup contains different data and is not a substitute for the production snapshot.

## Recommended implementation sequence

1. Retain a current, consistent production backup on Yish's existing PC, verify its checksum and perform an actual local restore. Use Railway's authenticated administrative transfer or a specifically owner-authorized backup channel; do not expose account data through the existing ingestion token or an anonymous download endpoint. No new paid destination is needed.
2. Prepare and rehearse an offline switch with a durable recovery marker, a fresh final backup, all database writers quiesced, and a startup path that refuses a partially copied database. Compare all tables and historical references, not just a few headline counts. The old and compact databases cannot coexist on the nearly full volume, so a casual rename or live file copy is unsafe. The measured temporary snapshot alone must never be used to overwrite later user writes.
3. Reclaim the physical space during that controlled maintenance. Consider enabling incremental vacuum on the staged replacement so future freed pages can be returned in small transactions. Verify normal account, feed, collection and scoring operations after reopening.
4. Retain production backups on the existing PC, later the gaming desktop. Stage backups on temporary server storage with bounded memory and disk use, transfer compressed data, acknowledge only after local verification, and retain the prior verified copy until the new one succeeds. Avoid repeated full downloads when nothing changed. Measure transfer/compute usage against the existing allowance; staying on Hobby is not a guarantee of a fixed usage bill.
5. Keep the existing verdict deduplication and lossless history compression. Track physical headroom, reusable SQLite pages, archive growth and the age of the latest verified production backup separately. Display missed PC backups honestly while the PC is off.

This plan preserves all listing, price and decision history and keeps the website on Railway while the PC is asleep. Moving the entire website to the gaming desktop would instead make home power/network uptime a requirement and is not necessary to solve the current capacity problem.

## Local improvement prepared

Backup hashing previously used `readFileSync` on the entire database. `src/db/file-hash.ts` now uses a reusable 1 MiB buffer and produces the same SHA-256. This avoids a multi-gigabyte allocation during backup verification. Four isolated checksum/backup/restore tests and TypeScript passed. The change is local, not deployed; no production storage was reclaimed in this assessment.

## Sources

- [SQLite VACUUM](https://www.sqlite.org/lang_vacuum.html): consistent compact snapshots, space requirements and concurrent-writer constraints.
- [SQLite auto-vacuum](https://www.sqlite.org/pragma.html#pragma_auto_vacuum): switching from mode 0 requires rebuilding the database.
- [Railway deployment storage](https://docs.railway.com/deployments/reference#ephemeral-storage): paid plans include temporary deployment storage, which does not persist across deployments. The filesystem's reported host free space is not an entitlement to use the entire host disk.

No billing, volume, DNS, login or credential change was performed. The initial browser approval-review timeout cleared on its permitted read-only retry; it is not an outstanding blocker.
