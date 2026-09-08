# Backend operations and verification

All commands run from the intended checkout with FILTRSOFT_DB explicitly set. Browser workers run under Node; database/server commands run under Bun. Do not run comparison scripts against the original database: matching can learn aliases or derive SKUs even without --apply.

## Runtime and build

Docker and CI pin Node 24.15.0 and Bun 1.3.14, matching the installed versions used for local checks. Both root and web installs require the committed bun.lock via --frozen-lockfile; there is no unconstrained fallback. The frontend build runs under Node. CI runs tests, typecheck, frontend build and docker build. Local node_modules/backups/worktrees/env/database files are excluded from the image context.

Local tests/typecheck/build have been exercised with existing dependencies. A clean dependency install, pinned-image Docker build and remote CI run remain unverified: the pinned base images are not cached and no installation/pull or push was performed. Run the committed workflow before promoting the image. Do not treat local linked dependencies as a clean-install result.

## Backup and recovery

`bun run src/scripts/backup.ts --local-only` explicitly requests a local backup. Without that flag, FILTRSOFT_BACKUP_CLOUD must designate the intended secondary directory; missing or failed secondary copy exits 2 while preserving the verified local copy. A directory copy proves copied bytes, not that a cloud client uploaded them. Provider/offsite backup coverage and recovery time are still unverified.

FILTRSOFT_BACKUP_DIR selects the local directory; FILTRSOFT_BACKUP_KEEP defaults to 14 verified snapshots. Each uniquely named backup is created with VACUUM INTO, integrity checked, hashed, copied and opened in a restore rehearsal, then published with a JSON manifest. Counts come from that snapshot. Foreign-key violations are reported, not erased. Retention ignores unverified files and never deletes the previous verified backup to make room for an unverified replacement.

`bun run src/scripts/restore.ts <verified-backup.db> <new-database-path.db>` verifies the sidecar manifest and restored bytes, and refuses to overwrite an existing database or its WAL/SHM files. First restore to a new path, run integrity and application checks there, and only then arrange a stopped-service cutover. This CLI deliberately does not change Railway paths or stop a service. Keep full backups private: they contain account and application data. Deployment archives contain only catalog/comps/retail data.

## Archive, scoring and rollback

Archive version 2 includes a SHA-256 content manifest and counts, exports from one consistent read transaction and replaces the artifact atomically with a previous copy. Imports are additive and idempotent; newer explicit correction timestamps can repair prior rows. An older archive is not a database rollback. For rollback after a migration/data import, restore the verified predeployment database to a new path and use the prior code/image, with the service stopped for cutover.

Before deployment: retain the prior code revision, deployed archive and verified production database backup; record current production health and new artifact manifest. After deployment, check engine/data version, imports, scoring queue failures/completion, quarantine/priceability, feed/detail/pulse and account ownership through an authenticated session. Compare cohorts at explicit timestamps; continuous crawling means total counts can change during a rollout.

## Billing before activation

Billing is configured only when the secret key and price ID exist. Webhooks also require the signing secret; this implementation does not configure any of these or enable billing. The signed raw request is verified before processing. Customers come from billing_accounts bound to the authenticated user, not a request ref/customer ID. Existing legacy entitlements are retained but do not claim a customer for an account automatically. Reconcile any legacy paid customer through verified ownership before activation.

billing_events records event identity, status, attempts and errors. Current provider subscriptions determine access; arrival order and event timestamps do not. Per-customer leases and fencing prevent concurrent stale writes. Active/trialing matching-price subscriptions need a future period end. Invalid signatures return 400; processing/provider/binding failures return 503 so Stripe can retry. Completed duplicates acknowledge without another state mutation. Checkout has stable customer/session idempotency keys and checks current provider state to prevent a second subscription while a webhook is delayed.

Configure and exercise signed test-mode events for checkout completion, subscription created/updated/deleted/paused/resumed, and invoice paid/payment_failed. Verify portal ownership, checkout retry, delayed events and provider failures before live activation. Synthetic transport regressions pass locally; no Stripe request, checkout, payment or provider configuration was performed. Subscription changes and invoice events trigger reconciliation rather than trusting their payload to grant access.

References: [Stripe webhook ordering and retries](https://docs.stripe.com/webhooks), [Stripe subscriptions](https://docs.stripe.com/api/subscriptions/list), [Node release](https://nodejs.org/download/release/v24.15.0/), [Bun installation and version pinning](https://bun.sh/docs/installation).
