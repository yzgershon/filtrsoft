# Move collection to the gaming desktop

Prepared for Yish's HP OMEN MAX 45L, Ryzen 7 9700X, 32GB DDR5 and RTX 4070 Ti.
The September 15 HP OMEN installation is now recorded at the top of `HANDOFF.md`.
Use that checkpoint for actual results and unfinished checks; the procedure below
also applies to a future clean installation.

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
After setup is ready, run the installer without `--prepare`. Start through the
daily task as described below. Do not reuse the laptop's `node-id` file.

The installer fix on the desktop setup branch creates **Filtrsoft Daily Crawl**
when absent: daily 10 AM, current interactive user, `StartWhenAvailable`,
`IgnoreNew` and a five-minute launcher limit. An existing task retains its schedule,
principal and settings while its action is updated. Its old XML and any previous
shortcut/legacy launcher are backed up in runner state.

The original OMEN runtime at **43c4fa744134** predates that fix: it only
updates an existing task, and the first installation exited 1 when none existed.
For that revision, create the per-user task using `install-preview.json`, then
rerun the installer. This workaround was completed on the OMEN, which is now
updated to reviewed revision **a91943a1c898** with the installer/doctor fixes and
tested SQLite write-contention protection. The existing task was retained. Start the
collector with `Start-ScheduledTask -TaskName 'Filtrsoft Daily Crawl'` so it runs
independently of the terminal or Codex command session. Verify the task returns 0
and a fresh `supervisor.json`/`status.json` appears; invoking a shortcut alone is
not evidence that its child survived the session.

The doctor checks path presence. It does not validate the upload token or account
sign-in. The installed fix honors `--state` and the configured Node path; always
load `FILTRSOFT_AGENT_STATE` from the private environment file or supply `--state`
so doctor checks the intended installation. Check authenticated
diagnostics, actual marketplace results, and server acknowledgements separately.
The older eBay login command can mistake a generic greeting for a signed-in
session. The setup-branch fix requires positive account-header evidence and treats
unconfirmed sign-in as a failed check. A successful header check still does not
prove sold-search access; the OMEN's actual dated comps and applied server
acknowledgements provide that evidence.

If Collection is missing from Settings while signed in, the existing server
checks whether the account owns the device named by `FILTRSOFT_OWNER_REF`.
Inspect the production configuration and obtain approval for an owner-setting
change. Do not reuse browser cookies, bypass this check with the collector token,
or remove the account restriction to make the panel appear.

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
