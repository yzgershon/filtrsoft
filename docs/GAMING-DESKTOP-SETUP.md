# Move collection to the gaming desktop

Prepared for Yish's HP OMEN MAX 45L, Ryzen 7 9700X, 32GB DDR5 and RTX 4070 Ti.
This is a future migration, not evidence of installation on that computer.

## Code and data

The existing `yzgershon/filtrsoft` GitHub repository is private, verified September
15. Use it for reviewed code, pinned dependency lockfiles and the comp archive.
Keep `.env`, databases, backup files, runner state and browser profiles out of Git.
Do not copy the laptop's running worktree or its dependency junction to the PC.

On the desktop, sign into GitHub manually if needed, clone the existing repository
to `C:/Dev/filtrsoft-agent`, and check out the verified production revision named
at the top of `HANDOFF.md`. Install the lockfile's dependencies with the desktop's
native Node/Bun versions after their setup is approved. Use a separate development
checkout if you also want to edit code there; never edit the active runtime.

## Initialize ingestion

Use a fresh local ingestion database under `C:/Dev/filtrsoft-data`. Import the
committed comp archive with `FILTRSOFT_DB` set to that new path and
`bun run archive --import`. This seeds exact SKU identities and historical comps
without copying sessions or account records. Server account data already stays
on Railway and follows the same Filtrsoft sign-in on each device.

An optional existing local-history transfer must use a verified SQLite backup,
copied privately with its JSON manifest and restored to a new path using
`bun run restore <backup.db> <new-path.db>`. A cloned ingestion DB must receive
a fresh sync identity before both machines run, because outbox sequence numbers
are namespaced by client identity. Prefer a fresh database for a second host.
Never copy an active `.db` without its WAL-consistent snapshot.

Yish configures the collector environment on the desktop. The environment file
stays outside Git. No token is entered by the agent into a website or requested
in chat. Each marketplace needs a fresh manual sign-in in its own local profile;
do not move cookies between computers.

## Prepare, check, activate

Use the existing installer with `--prepare`, explicit `--node`, `--env-file`,
`--database` and `--state` paths, plus `--label "Gaming desktop"`. This writes a
reviewable configuration without installing startup. Run `bun run agent:doctor`
with the same state/environment/database paths; it prints presence checks only.
After setup is ready, run the installer without `--prepare` and start the generated
`start.cjs`. Do not reuse the laptop's `node-id` file.

Once the desktop appears in Settings > Collection, select **Gaming desktop** as
primary and keep the default five-minute offline grace for the laptop fallback.
The existing job owner finishes its current job. Verify a real desktop search,
upload acknowledgement and failed-host handoff before retiring the laptop role.

## Daily operation

Windows must be signed in and awake; turning off the display is fine. No power
settings are changed by the installer. The supervisor restores a crashed worker,
and configured logon startup recovers after the next Windows sign-in. A remote
sign-in prompt or marketplace challenge may still need manual attention.

The collector makes a daily verified local backup and retains three snapshots.
Same-disk backups protect against bad changes, not loss of the PC. Add a separate
backup destination and verify its restore before calling this disaster recovery.
GPU experiments remain opt-in and separate from production valuations.
