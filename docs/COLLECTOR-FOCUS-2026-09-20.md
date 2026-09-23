# Prevent automatic collection from interrupting fullscreen games

## Cause and change

Chrome was headed and positioned off-screen. That hides its window but does not
prevent foreground activation, which can minimize an exclusive-fullscreen game.
Both the shared launcher and Facebook's separate launcher now route automatic,
headed Windows browsers through `windows-desktop.mjs` and
`windows-desktop-host.cs`.

The native helper creates/opens `FiltrsoftCollector` and starts Chrome with
`STARTUPINFO.lpDesktop = WinSta0\\FiltrsoftCollector`. It never switches the
user's input desktop. This is a Win32 desktop, not a Task View virtual desktop.
Chrome stays headed, uses the same profile and Playwright debugging pipes, and
keeps the existing marketplace options. Manual sign-ins (`background: false`),
headless tests and non-Windows launches retain their normal launch path.

Windows' built-in .NET compiler builds the helper once per source hash into
`FILTRSOFT_AGENT_STATE/browser-host` (default `~/.filtrsoft/runner/browser-host`).
Compilation runs without a visible console. No download, administrator setting,
new dependency, service, debug TCP port or execution-policy change is required.
Compilation/desktop/launch failures fail closed, with an error in the worker
log. There is no foreground fallback. An unnamed kill-on-close job owns Chrome
before its first instruction, so abrupt helper termination closes its browser
tree. Profiles remain protected by the existing lease and normal close flushes
their cookies.

Windows API references: [CreateDesktopW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-createdesktopw),
[STARTUPINFOW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-startupinfow).

## Measured on the OMEN, September 20

- 15 targeted collector/doctor/restart/desktop tests passed. Native integration
  uses real installed Chrome under Node and disposable profiles, including paths
  containing spaces and an apostrophe. The extended desktop test also passed
  after adding abrupt-host termination and profile reuse after a crash.
- Browser button interaction, screenshot rendering, second page, persistent
  cookie after close/reopen, Facebook's distinct launch path, missing-browser
  failure and released profile lease all passed.
- A 35-second read-only Windows observation captured 298 samples during repeated
  launches. Test Chrome windows appeared on `FiltrsoftCollector`; foreground PID
  stayed unchanged; zero samples showed Chrome in the foreground. Existing user
  Chrome windows remained on `Default`.
- A real Mercari search for `rtx 4070` returned 20 card links using the existing
  profile. Item `m87685110404` returned heading
  `Sapphire Pulse AMD Radeon RX 7900xtx Graphics Card` and complete item text.
  These probes read evidence only; they did not ingest or upload listings.
- TypeScript check passed after linking the worktree to the already-installed
  root and web dependencies. No packages were installed.
- An actual exclusive-fullscreen game was not launched during this check. This
  verifies browser desktop placement and foreground stability, not gaming FPS.

Local receipts: `C:/Dev/filtrsoft-runner-state/focus-qa-20260920`.

## Re-run and recover

Set `FILTRSOFT_TEST_CHROME` to the installed Chrome executable, set
`FILTRSOFT_NODE` if Node is not on PATH, and run
`bun test test/windows-desktop.test.ts`. Native browser tests are opt-in; manual
and platform-selection tests run normally. The tests use temporary profiles and
never the collector's sessions.

If a marketplace requests sign-in, pause collection and use its normal visible
login command. Resume through the existing collector control. Do not expose the
private desktop or change the automatic launch to `background: false`.
If compilation is blocked, inspect the logged native-launch error and repair
that specific condition; do not silently restore foreground Chrome.

Only browser startup changed. DB schema, scoring, schedule, node identity,
outbox, saved profiles and the laptop's pause state are unchanged.
