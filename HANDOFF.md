# HANDOFF — Filtrsoft

**Master plan AND current state. Update before you stop working.** A stale line
here is worse than a missing one, because a fresh session will believe it.

**Last updated 2026-09-17.** Read section 0 first and in order; it is the record
of every session since the rename and it supersedes anything below it that
disagrees. Sections 1 onward are older material kept for the reasoning, not for
current numbers.

## THE PRODUCT WAS CALLED ASSYZE UNTIL 2026-09-04

Yish: *"I want a complete rebrand of assyze. COMPLETE REBRAND. I dont like the
sound of it nor the meaning."* Renamed to **Filtrsoft**, `filtrsoft.com`. **This
paragraph is the only place the old name survives on purpose** — it is here
because two things still carry it and a future session that meets them cold will
otherwise think it has found a second product:

- **`EBAY_CLIENT_ID` reads `YanivGer-Assyze-PRD-…`.** eBay issued that keyset and
  the string is theirs. Renaming it does not rename anything at eBay, it just
  breaks the key. **Leave it.**
- **`web/src/migrate.ts`** carries eight `assyze:*` localStorage keys onto their
  new names, once, so his saved listings and device id survive the rename. Delete
  it after he has opened the app on his phone and his desktop; the file says so
  itself.

Everything else — env vars (`FILTRSOFT_*`), the session cookie, the database
filename, the browser-profile root `~/.filtrsoft`, the repo, the folder
`C:\Dev\filtrsoft`, the icons, every string — moved. Quotes from Yish in code
comments had the product name substituted; the words are otherwise his.

### The Railway cutover is DONE (2026-09-04)

All of it. Recorded because the ORDER mattered and would matter again:

1. `ASSYZE_` -> `FILTRSOFT_` across every variable, via the Raw Editor.
2. Service renamed, `assyze.com` detached, `filtrsoft.com` added.
3. DNS at Namecheap: **ALIAS on `@`** (Railway's modal says CNAME; a CNAME at
   the apex is invalid DNS and Namecheap rejects it), plus the
   `_railway-verify` TXT — **copied with the modal's copy control**, because
   the displayed value ends in an ellipsis that reads as a hex digit.
4. Certificate issued a few minutes later. Until it does, the edge serves its
   own `*.up.railway.app` wildcard and you get `SEC_E_WRONG_PRINCIPAL` /
   `ERR_TLS_CERT_ALTNAME_INVALID`. **That is normal waiting, not a
   misconfiguration.**
5. `FILTRSOFT_CRAWL_PIN` and `FILTRSOFT_VISION_TOKEN` set.
6. `EBAY_DELETION_ENDPOINT` moved LAST, and that ordering is the one worth
   keeping. The endpoint URL is hashed into eBay's challenge response, so
   Railway has to answer with the new URL BEFORE the portal is changed —
   otherwise eBay computes one digest, the server returns another, and the
   error blames the verification token. Verified by computing both digests by
   hand before touching the portal.

⚠ **`EBAY_DELETION_ENDPOINT` is an `EBAY_`-prefixed variable holding an
`assyze.com` VALUE**, so the prefix find-and-replace walks straight past it. A
dead deletion endpoint eventually disables the keyset.

**Two corrections to earlier claims in this file.** The one-custom-domain limit
is GONE — he moved to Railway premium. And the keyset does NOT power sold comps:
comps come from `bun run ebay:comps`, which drives a signed-in Chrome against
eBay's WEBSITE. The API keyset feeds `bun run ebay:search` only.

### www, HSTS, and why the bare domain looked broken

`https://filtrsoft.com` worked while bare `filtrsoft.com` served the Namecheap
parking page, on the same machine, with correct DNS at every level — verified
against Google DNS, his own resolvers, the Windows cache, curl, and a fresh
Chrome profile carrying his own settings.

**Railway does 301 http -> https, but a 301 is a RESPONSE.** The browser has to
make the plaintext request to receive it, and Chrome's cached copy of
`http://filtrsoft.com/` won first. Different cache key from the https URL, which
is exactly why one worked and the other did not.

`src/api/index.ts` now sends `Strict-Transport-Security: max-age=15552000` on
https responses, which deletes the plaintext request entirely. **No `preload`
and no `includeSubDomains`** — preload is effectively irreversible and baked
into browser binaries.

`www.filtrsoft.com` **301s to the apex rather than serving**, and that is a
product decision, not the old plan limit: the session cookie is host-scoped and
`localStorage` is per-origin, so two hostnames both serving would hand a user a
second empty account with their Saved list missing and no way to tell why. Still
needs the Railway domain + a Namecheap CNAME to exist at all.

Last updated **2026-09-05**. **Read §0 first — it is the most recent session
and it supersedes anything below that disagrees with it.** Section 2 onward is
older material kept for the reasoning behind decisions, not for current state.

## 0. READ THIS FIRST — the 2026-09-04 to 09-06 sessions, in full

### September 17/18, recovery follow-up in progress: baseline and safe export support

**02:04 UTC audit checkpoint:** main `72685cf` passed 421 tests / 1,376 assertions and CI `35296669855`, active Railway deployment `21f25dd6-1186-4f9c-ab2e-2f7772ab9960`. Runtime is still `112aee0`, awaiting one consolidated safe update. Automatic job 52 finished; OfferUp/Mercari succeeded, but Facebook availability recording hit `SQLITE_BUSY` on a deferred read-to-write transaction. Its successful reads/uploads are retained. A competing-writer regression reproduces that failure; immediate transaction ownership corrects it without relaxing backoff.

The original 250 receipt at 01:56 UTC has **223 current complete reads, 15 confirmed unavailable, 11 source backoffs and one pending eligible read**, all engine 0.3.44. Intermediate calls are seven PASS / two FAIR / six RISK / 15 retired / 220 insufficient. **Do not treat these as final audited gains:** the manual audit found a false RISK from “No bent, broken or missing pin” and a false priced PASS pooling a compact GTX1650S manufacturer suffix with GTX1650, plus different board makers and GDDR generations. Candidate engine **0.3.45** corrects coordinated negation, retains the suffix conflict, and requires stated GPU board maker/VRAM generation/capacity in sold evidence. All four new regressions failed before their fixes and pass after; full 425 tests / 1,384 assertions passed. Deployment and installed verification remain pending.

Vision prompt v3 is frozen. Fresh holdout selected and manually annotated afterwards: eight new real listings, four categories, all 15 photos present at selection; SHA `0fe06336d6cd6189a4ccc06e65ba1bee5599f7a5a8081ffc1a73837caf47ddd7`. Both installed models completed new runs with some GPU-deferred cases retained as failures. Strict-prompt development and fresh holdout still fail precision/recall and unsupported-fact gates, including invented ECC/model claims. Private raw traces and all original outputs are retained. Positive printed ECC is unavailable in these cases, so ECC is not validated. No production photo writer or paid fallback is enabled.

**01:38 UTC checkpoint:** compatible main `2e5b1dd` / engine 0.3.44 passed CI `35294538000` including containers and deployed as Railway `34c5e339-50ce-474e-a5ec-97d7ec7eb97d`. Installed runtime merge `112aee0c8ad00dbe4231bc4cfb1096acabb290e4` resumed through the existing launcher at 01:19:47 UTC. Original node/sync identities and local ancestry remain intact; original dirty documentation was preserved as local commit `c5a2334`. Maintenance backup restored with zero FK violations: SHA `395495c3b52e3898510b587d6c66acbacf728b5068238a99bb7edfe64981057f`, 2,131 listings / 33,275 comps. Installed 28 tests / 100 assertions, typecheck and doctor passed. Laptop is still paused.

Owner form initially rejected the real HTTPS origin behind Railway TLS termination. `b4ad1fe` corrects the public-origin comparison with a regression and passed CI `35295000299`. All original **250 IDs were accepted at 01:23:59 UTC**; local 200 were seeded through safe maintenance. The first 15 desktop visits gave 14 complete reads / one confirmed gone / 15 upload acknowledgements. Initial local identity work resolved 46 existing/exact identities, creating five supported entries including Legion 5 15ACH6, RTX A2000 and exact Intel CPU suffixes. Acer Nitro still lacks its actual manufacturer model code. Catalog synchronization acknowledged 41 identities at the initial pass; remaining ones are not yet claimed complete.

Private production checkpoint `followup/cohort-stage-one.json`, 01:29:21 UTC: **4 PASS, 1 FAIR, 3 RISK, 5 unavailable, 237 unresolved**. Compared with the new baseline that is one newly priced PASS, two risks and three retirements. The added MacBook M3 PASS uses freshly read 8GB/512GB/14-inch facts and three matching sold records; its evidence came from text recovery against existing sales, not a new comp query. The risks disclose an iPad crack/battery problem and a $38 MacBook off-platform redirect. No BUY/VERIFY. These are intermediate counts, not the final result.

Transport timeouts around deployments interrupted maintenance uploads. An empty comp outbox alone was misleading: the capture cursor was still 112 rows behind. Follow-up `996f8f8` gives newly created exact cohort identities their own bounded query pass, retries saved transfers independently of new browser searches, withholds comps until their catalog is acknowledged, and counts successful accepted/duplicate acknowledgements separately from rejection. Further runtime update and final receipts are pending; do not claim those 112 rows uploaded yet.

Local vision: original image-to-case hashes all match. Original raw HTTP/stop metadata was not retained, so old truncation cannot be reconstructed. New evaluation records raw responses, stop/token metadata, prompt strategy, photo hashes and measured GPU samples, distinguishes field placement/placeholders/duplicates from unsupported facts, and counts unprocessed cases as failures with misses. OCR-first and full-image-plus-center-region experiments still invented identities/specs on the disputed negatives. Production writer remains off. Earlier explicit approval covered `qwen3-vl:4b-instruct`, so that official alternative was downloaded; its evaluation is currently GPU-deferred with no model loaded and 35–40% background GPU load. Additional 8B download is still unapproved. No paid fallback. At 01:35 UTC Railway's paid gates remained enabled, recorded spend $1.8979/$2; the requested pause approval is still pending.

Development is isolated in `C:\Dev\filtrsoft-followup-20260917`, branch `codex/recovery-followup-20260917`, based on main `e235c4f`. The installed checkout and its two measured-documentation working changes are preserved. Do not reset to the older checkpoint.

Fresh inspection at 00:37 UTC found the desktop supervisor and collector absent, despite stale status files showing job 50. Resumed the unchanged `C:\Dev\filtrsoft-runner-state\start.cjs`; the original desktop node reported online at 00:38 UTC and began automatic job 51. Laptop remains connected but **paused**. This is recovery from an observed stop, not proof of its cause.

Owner health at 00:38 UTC: engine 0.3.43, scoring complete/zero failures, physical production free **97,198,080 bytes**. Scheduled Claude reads and the interactive paid-read gate are **both enabled**; daily budget $2, recorded UTC-day spend $1.0021, latest read 00:38:00. Desktop visionLimit=0 does not disable these server paths. Approval to pause both Railway switches and to download a second local model has been requested; neither is yet claimed done. Existing cached Claude facts remain intact.

The original 250 cohort IDs and all old artifacts are preserved. New local baseline at 00:45 UTC is restore-verified, SHA `5c5019251f622df6f38c900ebecf09750b99bac71b38a959b2f1b8841b9b2859`, 2,131 listings / 33,002 comps / 602 SKUs / zero FK violations, under `C:\Dev\filtrsoft-recovery-data\followup`. It is an **OMEN ingestion backup**, not a production backup. OMEN had 748 GB free; the 97 MB constraint applies to Railway.

Support main `a97527798b7cf72b2ab05d0a90e2215603c52c1b` passed CI `35292678386` including containers; Railway `03fd8932-08b7-4fb9-bfae-fb81885a5f4d` is active. Owner-session-only snapshot streaming uses one read transaction, physical-headroom/deadline guards, backpressure and no server-side whole-database copy. Collector upload tokens cannot export accounts. Original same-volume backup guard is unchanged.

**Production backup succeeded:** snapshot began 00:54:17 UTC, downloaded 2,261,039,664 compressed bytes to the OMEN and restored with integrity checks and zero FK violations. Private `C:\Dev\filtrsoft-recovery-data\followup\production-before.jsonl.gz` SHA `3fb5f6f62bdc732458f9d2a4edd2ac9228a34bd8ab9a4b6551638cbd7c109939`; restore receipt beside `production-before.db`: 9,500 listings / 33,155 comps / 620 SKUs / 846,543 verdicts. This contains private account data; never commit or publish it. No second full copy was made on Railway.

The new production baseline uses the same original 250 IDs: **3 PASS, 1 FAIR, 1 RISK, 2 unavailable, 243 unresolved**, 59 complete receipts and 151 descriptions. Autonomous collection between the preceding final receipt and this backup accounts for the extra PASS/FAIR/retirement; do not credit those to this follow-up's unreleased resolver. Frozen original SHA remains `4938bbb2f72a47f163e3f1430336adf2ca9299c3f6dbbe0205609d20f1202228`. Additional implementation/vision outcomes remain unverified.

Engine candidate **0.3.44** implements leased deterministic identity jobs, exact manufacturer aliases, independent server validation and durable catalog acknowledgements, cohort-prioritized reads with existing completeness/backoff guards, bounded Craigslist recovery and idle desktop chunks. Exact laptop queries now retain screen constraints without requiring the literal word laptop. Broad Legion aliases cannot swallow an explicit 15ACH6/15ACH6H distinction. Both matching regressions fail on preserved `e235c4f` and pass here; the end-to-end fixture resolves identity, schedules the exact query, accepts matching sold evidence, acknowledges transfers and produces a supported PASS. **417 tests / 1,362 assertions, typecheck and build passed**. No corresponding live recovery gain is claimed until deployment/runtime/same-cohort verification.

### September 17, evidence recovery complete — verified production and OMEN

**Live engine 0.3.43, functional main `4834b3214a7f0a161a420350bfa6b6b83847224c`.** [CI 35286589225](https://github.com/yzgershon/filtrsoft/actions/runs/35286589225) passed including containers; Railway `cfad9f6f-b8a3-49e8-8361-967429f6b6f4` deployed that source. At **23:36:53 UTC**, production reported **0 pending scores / 0 failures**, database OK, health **480 ms**. Web assets match `index-C0OAYHY3.js` / `index-LTRDxhkn.css`. Subsequent documentation-only commits do not change that functional release.

**OMEN is running engine 0.3.43 from runtime merge `15370943a9c7de6cd88f17811fc05057b08b7cd8` in `C:\Dev\filtrsoft-agent`.** It retains original desktop ancestry `4acecefff1fb`, node `bc3313ad-0a65-4020-922c-e9a30505da21`, sync identity `7c09031a-1f31-4057-a6ba-b89c33755c26`, database, outbox, profiles, configuration and startup. Production verified the new revision at 23:34:18 UTC; exactly one supervisor, no pending uploads/reports, quick-check OK and zero FK violations. Config/env/launcher hashes match baseline. Gaming desktop remains primary, five-minute fallback grace, **30-minute rest after completed cycles**. The laptop remains persistently paused. Final measured documentation may be present as documentation-only local working changes; preserve it.

Safe update: owned processes exited through the supervisor stop mechanism; **restore-verified consistent backup** at 23:32 UTC contained **2,076 listings / 32,777 comps / 602 SKUs / zero FK violations**, SHA **`6435828f4e914b4c81b44e88307fe1909f6e65e95bcee34262a550f67001d0c0`**. No reset, reinstall, archive import, lost local commits or profile replacement. All **407 tests / 1,345 assertions**, typecheck/build passed; the installed merge passed **41 focused tests / 120 assertions**, typecheck and doctor. A normal eligible Mercari read on the final runtime captured full text, positive availability and **one acknowledged change** at 23:33:34 UTC, followed by resumption through the unchanged launcher.

**Two complete automatic cycles:** job 48 (22:12–22:32 UTC) had **32 new listings, 116 attempts, 96 complete reads, 134 availability observations, 166 acknowledged snapshots**. Job 49 (23:10:43–23:31:34 UTC) had **40 new listings, 120 attempts, 108 complete reads, 138 availability observations and 178 acknowledged snapshots**; all sources `ok`. Job 49 detail outcomes include three gone and nine failed/incomplete, honestly retained with retry state. Both ended with no pending uploads/reports. Existing complete-text acquisition was about **207/hour then 204/hour**, versus **96/hour then 115/hour** new unique arrivals; these are short-run evidence-acquisition rates, not successful valuations. A separate 60-visit frozen-cohort pass yielded **57 complete reads**, three failures and 60 acknowledgements. Two comp passes acknowledged **491 new sold observations**.

**Final frozen cohort receipt, 23:37:04 UTC, all 250 engine 0.3.43:** **two PASS, one supported RISK, one separately retired, 246 unresolved and unretired**. Seller text **82→151**; complete-read receipts **59**; above-low catalog identities **52→57**. Availability: 67 checked, one gone, nine unknown, 173 unchecked. The unchanged-facts counterfactual still has all 250 INSUFFICIENT_DATA. No new BUY/VERIFY or natural alert; false-recommendation rate is not estimable. One baseline chair was misclassified as a tablet and remains disclosed in the frozen denominator. Every changed call and two 20-row unknown samples were manually audited. Incorrect financing/port risks, pooled display/core variants, false CPU punctuation conflicts and component numeric mislabelling were corrected before the final receipt.

**Vision remains disabled:** approved official Qwen3.5-9B through Ollama 0.34.1 failed factual/held-out acceptance on real photos. 22 cases completed, nine abstained, three GPU-deferred; median 6.406 s / p95 9.087 s. Zero models loaded at 23:27 UTC. No local writer/production adapter enabled, no cloud-budget increase or recurring spending. **Production durable backup remains space-blocked** at about 97 MB physical free. Cold cutovers had timeouts; later health was sub-second. Phone test display was previously confirmed, but no naturally useful deal alert or live laptop failover is claimed.

Full implementation, per-source counts, audited examples, model digest/error analysis, artifact locations and limitations: [EVIDENCE-RECOVERY-2026-09-17.md](docs/EVIDENCE-RECOVERY-2026-09-17.md). Mercari **m87685110404 / #8154** has fresh $529, complete nonworking/as-is disclosure, positive availability and acknowledged upload; it correctly remains RISK. Do not revive or reprice it from historical handoff text.

### September 17, preceding final audit follow-up (superseded above)

**Current installed state:** OMEN is running, not maintenance-stopped. Runtime merge `79ce68284207` preserves all desktop ancestry and passed 39 focused tests, typecheck and doctor. Production confirms its original node `bc3313ad-0a65-4020-922c-e9a30505da21`; Gaming desktop stays primary, five-minute fallback grace, 30-minute rest after cycles, laptop paused. Configuration/env/launcher hashes match baseline. Job 49 is collecting automatically.

Functional main `e594d57` / engine **0.3.42** is active on Railway deployment `91d3a408-81b7-419d-8908-8c208da148d6`; CI `35284919930` passed including containers. At **23:16:12 UTC**, production scoring was **0 pending / 0 failed**, health **464 ms**, database OK, matching web assets. Verified maintenance backup SHA `690490bce50f3e44c66f9b4d29dee9ea6feefef7539361e2a70ca9a6fa0f78d7`, 2,036 listings / 32,777 comps / zero FK violations.

The frozen 250-row production receipt saved at 23:11:58 UTC shows **two PASS, one supported RISK, one separately retired and 246 remaining unresolved**. All 249 unretired rows have 0.3.42 provenance; retired #7743 retains its historical verdict. Seller text 82→151; complete receipts 58; above-low catalog matches 52→57. No new BUY/VERIFY or natural alert; false-recommendation rate is not estimable. One baseline chair was misclassified as a tablet and remains disclosed in the denominator. Two comp passes acknowledged **491 new observations**. See the detailed [measured report](docs/EVIDENCE-RECOVERY-2026-09-17.md).

An additional 20-row unknown audit found equivalent CPU punctuation falsely flagged as contradictory and GPU dimensions/bandwidth mislabelled as screen/storage. Functional main **`4834b3214a7f0a161a420350bfa6b6b83847224c` / 0.3.43** corrects those fields with failing-before regressions. All **407 tests / 1,345 assertions**, typecheck and build passed. CI **35286589225** passed including containers; Railway **`cfad9f6f-b8a3-49e8-8361-967429f6b6f4`** is active. Production health returned 0.3.43 in 292 ms at 23:26 UTC, with rescoring in progress and zero failures. Runtime update follows job 49 completion; do not confuse deployed 0.3.43 with the currently installed 0.3.42 runtime. Local vision remains disabled after Qwen3.5-9B failed acceptance, with zero models loaded at 23:27 UTC. Production durable backup remains space-blocked. No new spending or laptop resume.

### September 17, preceding evidence recovery checkpoint (superseded above)

All five requested workstreams are implemented. Engine 0.3.41 is live from main `e722cc7`; Railway deployment `1d917447-dfe1-4489-81c2-fccc5aa1811e` succeeded, CI `35282590824` passed including containers. OMEN runtime `87f23490ab16` completed bounded verification with the same node. At 22:58:31 UTC production scoring reached **0 pending / 0 failures**, public health 368 ms. Laptop stays persistently paused; desktop primary, 30-minute rest, five-minute fallback grace.

Automatic job 48 ran 22:12:38–22:32:38 UTC: **32 new listings, 116 detail attempts (96 reads, 13 gone, seven failed/incomplete), 134 distinct availability observations (112 alive, 16 gone, six unknown), 166 acknowledged listing snapshots**, all stages `ok`, no pending outbox/reports. These are change acknowledgements, not unique listings. It acquired complete text for **69 existing listings**, about 207/hour versus 96 new listings/hour during that cycle. Additional frozen-cohort verification made 60 visits: **57 complete reads, three failed; all 60 changes acknowledged**. One Mercari failure exposed Bun readline splitting JSON strings at Unicode U+2028/U+2029; the final candidate preserves those characters and has a failing-before/passing-after regression.

The first 250-row production snapshot showed three PASS and three RISK transitions, plus one separately retired Facebook listing. **Those six changes are not the final success count**: manual audit caught financing-offer wording falsely treated as carrier debt, uncertain cached photo visibility falsely treated as absent ports, and pooled laptop screen/GPU-core variants. Engine candidate **0.3.42** corrects those guards, retains conflicting iPhone model names, removes OfferUp accessibility boilerplate, and recognizes the concatenated eBay NEW LISTING badge. The unchanged-facts counterfactual still has 250 insufficient-data results. Baseline scope audit found one chair misclassified as a tablet; preserve the frozen IDs and disclose it, rather than replacing it silently.

OMEN is temporarily maintenance-stopped for this final candidate, with all owned processes confirmed exited. Consistent pre-update backup **690490bce50f3e44c66f9b4d29dee9ea6feefef7539361e2a70ca9a6fa0f78d7**, 2,036 listings / 32,777 comps / zero FK violations, restore verified at 22:59 UTC. Final candidate validation/deployment, runtime merge/resumption and final cohort receipts still pending. See [measured report](docs/EVIDENCE-RECOVERY-2026-09-17.md).

Qwen3.5-9B is installed after Yish's approval but failed factual acceptance; production local-photo writer stays disabled, collector paid-vision limit stays zero. Production durable backup is still space-blocked at roughly 97 MB physical free. No natural useful deal alert has been observed; the earlier physically received test is a separate result.

### September 17, earlier evidence recovery checkpoints (superseded by the current result above)

Final conservative-policy gate: bounded PASS/VERIFY now requires an explicit complete, untruncated source extraction receipt. Legacy captures without a completion marker cannot enter this new policy merely because no truncation flag was recorded. Engine candidate 0.3.41; regression includes missing, incomplete and truncated extraction metadata. This has no measured qualifying real listing yet and must not be presented as realized recovery.

22:28 UTC checkpoint: main `563fbd3` passed CI `35281367058` and Railway deployment `07b9949f-cf4c-495c-8f34-69f33d359c08` is successful/active. Live engine **0.3.40**; three sequential health samples were 286/180/150 ms with zero scoring failures (6,072 pending at that instant). OMEN is still completing job 48 on compatible runtime `cd1a53a54ab3`; wait for its bounded cycle before maintenance/backup/merging this follow-up. Mercari requested item and OfferUp exact-source checks each had one acknowledged upload. The ordinary account alert status shows one registered subscription, one standing search, nine paused legacy searches, and no natural delivery receipts. Do not claim a natural phone alert.

Read-only extraction audit of the first ten frozen Craigslist rows: nine complete descriptions, one HTTP 410/deleted_by_author (#6739). This audit made no production/collector writes; #6739 remained unchecked in the server detail at the observation time. Do not count that observation as a completed retirement. The 20-row manual unknown audit is saved privately and identifies a residual case-fan taxonomy issue (no recommendation), alongside catalog/kit/build gaps that remain conservatively unresolved.

Live verification follow-up: OMEN resumed through the existing launcher as `cd1a53a54ab3`, same node, and claimed job 48 at 22:12:38 UTC. One Mercari and one OfferUp change were acknowledged before resumption. Production #8154 now confirms $529 and RISK from the non-working disclosure. Primary/five-minute policy is unchanged; laptop remains paused. Follow-up `5d73907` passed CI `35280679942` including containers. The running cycle is still in progress.

That production detail exposed a recovery-note gap: the engine did not load the durable full-read receipt, even though queue selection did. The next candidate, engine 0.3.40, threads the content-matched receipt into stored verdicts (including photo identity), records completed Craigslist text, and requests scoring when a receipt arrives behind a newer search card. Duplicate receipts do not repeat scoring. Exact base versus suffixed CPU/GPU names now remain conflicts rather than assuming a shortened title. **399 tests / zero failures / 1,315 assertions**, typecheck and production build pass. Re-scoring the original frozen cohort still produces 250 insufficient-data / zero recommendations; p50 1.47 ms, p95 32.90 ms. Deployment/runtime receipts for this follow-up remain pending.

Release/runtime checkpoint: main `92202ad` passed CI `35279448058` including both container checks; Railway deployment `4a4c442d-af7f-4483-917a-e0088a7a34d8` succeeded. Live engine 0.3.39 and matching built assets verified. Initial health/poll requests timed out during startup; subsequent health completed in 292 ms with zero scoring failures (9,030 pending at that checkpoint). OMEN was stopped through its own stop flag, its owned processes exited, and the installed database backup was restore-verified (2,004 listings, 32,286 comps, zero FK errors; SHA-256 `b36bb8e3c02a3b7ae4824d5cebe9df442dfc98b626f33bf51cd5458756c498f7`). Runtime merge `6fb2507` preserves desktop parent `4acecef` and release `92202ad`; 41 runtime regressions and typecheck passed. Config/env/launcher hashes and node identity match before maintenance. Runtime is temporarily stopped pending live checks and this follow-up.

Fresh source panels at approximately 22:04 UTC: Mercari `m87685110404` has dedicated ItemPrice $529, complete seller text "Purchased from liqudation. Does not power on. sold as is for parts.", and positive live availability. OfferUp `c05b46e1-e7c6-3780-869d-6d5c23aba7d3` has a complete public description and active Ask/Make offer controls; its `›` breadcrumb separator exposed a narrow availability parser bug. This follow-up skips that separator while retaining repeated-recommendation guards: 168 targeted tests / zero failures / 579 assertions. Neither source read has been persisted/uploaded by the read-only verification helper yet. Production durable backup remains blocked by approximately 97 MB physical free space. Laptop remains paused.

Yish authorized all five recovery workstreams and the tested combined main/Railway release. See [the structured plan and evidence record](docs/EVIDENCE-RECOVERY-2026-09-17.md). Development is isolated from the running OMEN. Actual runtime `4acecefff1fb` contains main `526de33` and desktop setup commits; Mercari fix is already present. Laptop remains persistently paused. No resets, reinstalls, identity changes or volume cleanup.

Baseline frozen before code changes: **250 / 250 INSUFFICIENT_DATA**, across all four sources; private cohort SHA-256 `4938bbb2f72a47f163e3f1430336adf2ca9299c3f6dbbe0205609d20f1202228`. Original restored/verified desktop snapshot and frozen counterfactual database are separate from the installed ingestion DB. Production feed 2,568 at 20:58 UTC is a separate changing population. Production physical free space is approximately 97 MB and durable backup remains blocked by its space guard. No claim of recovery or deployment yet. The phone test was physically displayed, as confirmed by Yish; a naturally matched useful deal notification remains unverified.

Implementation milestone: shared evidence routing replaces both description-length gates; separate sequential recovery budgets, explicit extraction receipts, current-spec parsing, exact demand queries/query backoff and conservative closed-domain PASS/VERIFY policy are implemented in the isolated branch. Engine candidate is 0.3.39. Independent photo/recovery clocks and durable discovery telemetry are being validated. First full suite: 390 passed / four failures; three expectations reflected intentionally changed behavior and one comp-priority weighting defect was corrected. Typecheck and web production build passed before the latest sync changes; repeat validation remains required.

Yish approved a local model download. Installed Qwen3.5-9B (6.6 GB, digest `6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7`) through existing Ollama. Pre-annotated 24 real photo cases across four categories plus a deliberately conflicting image pair; 10 held-out cases. At 8192 context, 22 completed and three deferred under the GPU guard. The model misread a Flare X5 label as X6 and invented laptop/phone specifications on unreadable images. Automated field mismatches also include harmless schema/format differences and must not all be called hallucinations. **Acceptance failed; production photo writer remains disabled.** No cloud budget increase. Counterfactual analysis, release, runtime update and fresh collection verification are still pending.

Pre-release validation: **397 tests passed / zero failures / 1,307 assertions**, followed by 24 focused budget/ownership/sync/local-vision regressions after final budget changes (59 assertions). Typecheck, Node worker syntax and production web build passed; main JS `index-C0OAYHY3.js`, CSS `index-LTRDxhkn.css`. Frozen-facts counterfactual remains 250 insufficient-data / zero new recommendations after final identity fixes. Manual review of 20 stratified unknowns found misleading GTX 1650 Super and cross-brand ThinkBook matches (both low-confidence and already unpriced); fixed and regression-tested. No recommendations exist in this counterfactual to audit or probe. At 21:55 UTC actual OMEN still runs the old revision, with the same node/sync identities, zero listing outbox entries, 2,004 listings, 32,286 comps; laptop is paused. Production cadence is freshly confirmed 30 minutes. CI/container, deployment, and updated-runtime evidence remain pending.

### September 17, active engine, availability and notifications repair

**Display-damage follow-up ready to release:** The refreshed OfferUp **#7579** disclosed "Used , fully operable - there is a crack on the screen", yet had no damage signal and a working-screen margin. Added a separate quoted **DAMAGED_DISPLAY** blocker, preserving the distinction from non-working electronics and excluding negations, screen protectors and explicit repairs. Engine is now **0.3.38** so production revisits stored disclosures. Targeted end-to-end regression, typecheck and the full **385-test suite / zero failures / 1,259 assertions** pass. No fabricated repair-cost deduction or comp-filter relaxation. This server rule does not require another collector protocol change.

**Mercari patch pushed:** Main **9d25046** deployed successfully at **18:42:20 UTC**, Railway **6509704815**. CI **35260379546** passed. Yish has a follow-up prompt to merge it on the OMEN; no confirmation of that final desktop update yet. A public HTTP asset sweep timed out after deployment, while the signed-in live app subsequently loaded its full review queue. Do not turn that timeout into proof of a specific server defect or claim a fresh successful asset receipt until measured. The prior 363a269 assets are unchanged by this backend/worker patch.

**Completed updated collection; final Mercari follow-up, 18:40 UTC:** OMEN job **43** finished **18:32:55 UTC**, all three sources **ok**, after starting 18:20:50. Production scoring again reached **zero pending / zero failures**. In addition to the four Facebook rows below, OfferUp **#7089 and #7124** are now gone; **#7093** is checked alive and **#5569** is honestly unknown. Fresh Mercari text for **#8154** says "Does not power on. sold as is for parts" and production now calls it **RISK**. Its price remains the old **$599**, not the source's observed **$529**, because Mercari repeats its exact title as a separate breadcrumb before the real h1. This caused an unknown availability result and withheld the price update.

The local follow-up captures the actual Mercari h1 panel and its enabled controls separately from recommendations; the TypeScript parser ignores breadcrumb copies and refuses ambiguous legacy repeated titles. A real-page read verified the isolated panel and **$529.00 ItemPrice**. Regression failed before the fix and passes afterward, including sold and repeated-recommendation cases. **384 tests / zero failures / 1,258 assertions**, typecheck and Node syntax check pass. No valuation rule changed; engine stays **0.3.37**. Release this follow-up to main, then the OMEN needs one further runtime update. Do not claim this final worker patch or a $529 production price is on the OMEN yet. Phone registration remains explicitly deferred. Production storage/verified backup remains unresolved.

**First refreshed recommendations:** Job 43 completed Facebook details, detail-sync, probe and probe-sync. Production now records **gone** for former VERIFY rows **#4129, #5868, #4124 and #4125**, checked between **18:23:45 and 18:24:17 UTC**; all four left the live feed recoverably. The rolling-day description population rose **198 -> 210** while discoveries also rose **1,013 -> 1,044**; this is incoming-evidence proof, not a controlled coverage comparison. Scoring caught up again with **zero pending / zero failures**. OfferUp detail work is running. The intermediate feed is **2 BUY / 13 VERIFY / 30 FAIR / 170 PASS / 134 RISK / 2,542 can't-tells**; do not mistake retired unavailable VERIFY rows for failed categorization or claim all sources finished yet.

**Updated desktop running, 18:21 UTC:** OMEN node `bc3313ad-0a65-4020-922c-e9a30505da21`, revision `b8730555bb8a`, claimed automatic job **43** at **18:20:50 UTC**. Search and upload stages are advancing. Laptop node remains **paused**, with no job. This is proof of a running updated collector, not yet a completed detail/availability cycle. New uploads have requested additional scoring, so the zero-pending receipt below is a completed checkpoint, not a promise that an active ingestion queue stays empty. No failures were reported. Persisted comp-maintenance state still schedules its next attempt for **20:43 UTC** from the previous four-hour policy; the new one-hour interval applies after that attempt. Do not claim hourly collection has already been measured.

**Scoring complete, 18:16 UTC:** Production engine **0.3.37**, **zero pending / zero failures** at pricing signature `7252|2026-09-17T18`. The signed-in feed reports **BUY 2, VERIFY 17, FAIR 30, PASS 168, RISK 134, INSUFFICIENT_DATA 2,519**. The BUY population includes Yish's preserved manual override; this is not two engine BUYs. Counts are a new live measurement, not a controlled before/after cohort: collection continued during the work and unsupported valuations were withdrawn. Do not claim the can't-tell backlog has fallen. The review queue includes current source-check timestamps for Craigslist and explicit unchecked state for browser sources awaiting the updated desktop cycle. Browser automation verified the actual signed-in desktop feed; a later attempted viewport override did not change Chrome's measured 1440px viewport, so the 390px proof remains the earlier isolated component check, not a new production mobile test. Overrides were reset.

**Final server release verified, 18:13 UTC:** Main **`363a269`**, engine **0.3.37**, is live. Railway deployment **6509118135** succeeded at **18:09:43 UTC** and CI **35256928941** passed its complete Linux suite, typecheck, Vite, Docker verification and production-image build. Public HTTP receipt at **18:13:07 UTC** confirms all six JS/CSS assets and the HTML entry match the local build; private feed/push-status routes remain 401 without a session. Measured health returned in **469ms**, an ordinary API read in **305ms**. Health reported **32,252 comps / 28,478 usable / 433 generically priceable SKUs out of 602**, with `coverageCurrent:true`. Pending scoring was **3,436**, zero failures; it is historical backlog plus current revision work, not a claim that thousands of feed listings are unscored. Observe its completion and the updated OMEN's first collection receipt before the final operational report. Phone registration was explicitly deferred by Yish. Production backup/physical storage recovery is still unresolved.

**Health follow-up release checks:** Full suite **383 pass / zero failures / 1,251 assertions**; typecheck and targeted cold-health/concurrent-refresh tests pass. Ready to push and verify production under the standing main/Railway authorization. No frontend asset or verdict-rule change in this follow-up.

**18:06 UTC checkpoint:** OMEN production heartbeat now reports **`b8730555bb8a`**, same node identity, online and no pending uploads. This proves its runtime changed; it has not yet reported a completed collection cycle on that revision. Yish sent the update prompt and will handle phone registration later. Laptop remains paused.

**Responsiveness diagnosis:** `3a471b0` deployed at 17:56:26 UTC (Railway **6508895858**), CI **35255655848** passed. Further profiling identified a separate blocking path: cold `catalogCoverage()` took **11.84 seconds for 561 SKUs** inside `/v1/health`, exceeding Bun's default 10-second HTTP idle timeout. The next follow-up shares an asynchronous coverage refresh, yields between products, and returns `canPrice:null, pricingStatus:'refreshing'` while readiness is not yet measured. Finished health responses include `coverageCurrent` so a data change during refresh is not presented as a current result. Exact valuation rules are unchanged. Condition-statistic caches already track pricing revisions; do not clear them again on every short scoring pass. Local real-HTTP verification against the isolated snapshot returned the app in **581ms overall / 29ms request time** and health in **679ms**, while the full coverage calculation completed in **15.21 seconds** under concurrent tests. Its temporary localhost server stopped. Targeted tests and typecheck passed; full suite is running before release.

**Live verification and responsiveness follow-up, around 17:54 UTC:** `7ff3c29` deployed successfully (Railway **6508779132**, 17:49:07 UTC; CI **35254966549** passed). Production #8154 is now **VERIFY / UNTESTED** on 0.3.37 using its stored seller quote; #5299 is **INSUFFICIENT_DATA**, correctly prebuilt with **8GB RAM / 6GB VRAM**, with the unrelated laptop valuation removed. Railway logs confirm the new Craigslist recommendation sweep checked **12 and retired one** at 17:46:40 UTC. Do not extrapolate that to every browser-source recommendation. Re-scoring still has historical pending rows, zero failures, and restarts eligibility as real catalog revisions arrive.

Response-time verification encountered 8-30 second HTTP timeouts during active scoring. An isolated 50-row scoring profile took **4.23 seconds**, including one 1.28-second listing; the synchronous count-only batch can block Bun's HTTP thread. The next follow-up bounds each pass to **250ms between transactions**, always permits one-row progress, and schedules another pass after one second. This does not interrupt a single in-progress listing, change verdict rules, or discard pending work. **381 tests / zero failures / 1,249 assertions and typecheck passed** before release. The timeouts themselves do not establish that every network delay has this same cause.

**Live release, 17:43-17:49 UTC:** `da71588` is pushed to main. Railway deployment **6508647200** succeeded at **17:41:38 UTC**; GitHub CI **35254202916** passed. Public health serves **0.3.37**, and all six JS/CSS assets plus the HTML entry match the tested build byte-for-byte. The signed-in feed and Settings render the new availability and push-status UI. Re-scoring is running with zero failures, but old stored calls remain until their rows are processed. Live verification exposed a queue-order problem: historical rows precede actionable recommendations. A follow-up prioritizes explicit new facts/new listings, then live BUY/VERIFY, other live rows and finally delisted history, preserving retries and eventual completion. **380 tests / zero failures / 1,248 assertions and typecheck pass** for this follow-up. It changes processing order, not verdict rules, so engine remains 0.3.37. Release it to main and verify the affected production rows before claiming their corrections are visible.

**Account-specific notification correction:** `/v1/push/status` for Yish's signed-in account reports **zero subscriptions, zero standing alerts, nine paused legacy searches**. The earlier health figure of one subscription was site-wide and did NOT establish his account's phone registration. Do not claim it did. Yish will enable notifications from his phone later; physical phone receipt remains unverified. He has sent the collector-update prompt to Codex on the OMEN. At 17:44 UTC, production still reported the old desktop revision `a91943a1c898`, working with acknowledged uploads; laptop remains paused. Wait for actual new runtime receipts before claiming that collection improvements are operating. Production safe backup still refuses for low physical space; this release did not repair that separate operational issue.

**Final pre-push verification, 17:38 UTC:** Linux verification image passed **379 tests / 0 failures / 1,247 assertions plus typecheck**, including the final MacBook regression. Windows full suite passed the same totals before that last one-line correction; its targeted suite and typecheck passed afterward. Vite production build and production Docker build passed. The final controlled snapshot audit scored **5,212 live rows with zero exceptions**; results and transitions are in `docs/qa/actionability/isolated-comparison.json`. No missing descriptions or exact comp data were fabricated to lower the can't-tell count. Ready to push under Yish's standing explicit authorization for main and Railway, then verify the deployment. Desktop runtime and phone receipt are separate remaining checks.

**Release checkpoint, 17:36 UTC:** Implementation is complete locally, still not pushed. Windows and Linux each passed **379 tests / 0 failures / 1,247 assertions** before a final MacBook model-year regression; that targeted regression and typecheck passed, and the final Linux image suite is running. A permission-review deadline expired before the first final Docker command executed; its permitted retry started successfully. UI was checked using the built stylesheet and disposable local account, including exact 390 CSS-pixel listing detail, dark/light notification settings and desktop overflow. No production or phone UI verification is claimed yet. The temporary preview server is stopped and its source removed. Desktop update instructions are in `docs/COLLECTOR-UPDATE-2026-09-17.md`; deployment must precede the new desktop sync protocol. The exact same-facts comparison uses fresh copies of the isolated baseline, not mixed-age stored verdicts. Production storage/backup limitations below remain open.

Yish reports too few useful calls, stale BUY/VERIFY recommendations and no useful notifications. Work is in `C:/Dev/filtrsoft-backend` on `codex/frontend-redesign`; preserve the existing documentation changes and other checkouts. The laptop collector remains intentionally paused. No duplicate crawl has been started.

**Fresh production measurements, 13:54-14:01 UTC:** Gaming desktop is online, preferred primary, revision `a91943a1c898`, with acknowledged uploads and no pending uploads. Its browser interval is **30 minutes**. Production engine **0.3.36**, **32,201 comps / 28,427 usable**, **445 priceable SKUs**, scoring pending **0**, failed **0**. The signed-in feed has **2,159 INSUFFICIENT_DATA, 6 BUY, 22 VERIFY, 54 FAIR, 318 PASS, 99 RISK** across its current account/filter population. One of those six BUYs is Yish's manual override of an INSUFFICIENT_DATA result, not an engine BUY. Last-24-hour funnel: **839 captured, only 151 with any description, 178 with usable valuation evidence, zero alerted**. Push is configured with one subscription and one standing alert; last acknowledged alert is September 9. These are production measurements, not the older laptop snapshot.

**Implementation checkpoint, September 17 around 15:00 UTC, not deployed:** engine 0.3.37 in the working tree. Collection now plans at most 18 cards and 20 detail reads per source, persists per-item retry schedules, preserves condition chips, and receives bounded public repair targets from production when the collector advertises support. Probe identity/actions and sold badges are checked; observations synchronize separately from seller-text timestamps. Alerts have an independent timer, freshness checks and account-scoped delivery status; existing device subscriptions reconcile on sign-in/return. The paused laptop remains paused. The OMEN must receive the new collector code after server deployment; its running `a91943a1c898` revision does not yet contain these changes.

Live failures reproduced: Mercari **#8154** RX 7900 XTX was BUY despite stored "Untested sold as is" and now explicitly says "for parts" / Poor at a changed $529 ask. New condition rules prevent BUY. Mercari's cookie h1 and recommendations precede the actual item, so workers now scope item headings and read enough text. **#5299** Legion T5 desktop was matched to Legion 5 laptop and valued with a NIMO laptop plus RTX 4060/5070 laptop comps; VRAM 6GB also became system RAM despite explicit 8GB DDR4. Strict whole-category matching, RAM extraction, runtime comp identity and known laptop-configuration checks are under regression test. Handheld consoles also leaked through as unknown/prebuilt; the existing exclusion now includes Legion Go and ROG Ally.

Initial full run: 368 pass / 3 fail; those three failures were corrected (async alert initialization, old collection-budget assertion, missing fixture freshness). Additional cross-host, sync and alert tests are being added and full tests are running again. The first isolated re-score was **not a controlled old-code/new-code comparison**: stored verdicts span older engines and dates. It had zero exceptions but must not be claimed as production impact or attributed entirely to these edits. Prepare a same-facts comparison before release. The existing production backup/storage failure remains unresolved (about 97.6 MB free on a 4.69 GB volume); no destructive storage operation has been performed.

Plan, in order: (1) capture live actionable examples, missing-evidence cohorts and notification diagnostics; (2) repair detail scheduling, source availability and cross-host work coverage with regressions; (3) fix demonstrated identity/valuation failures while preserving exact variants and genuine unknowns; (4) verify fresh alert eligibility and delivery; (5) run isolated before/after scoring, full release checks, deploy under Yish's standing main/Railway authorization and verify production. Update this checkpoint as each stage completes. `C:/Dev/filtrsoft-audit/baseline.db` is an isolated consistent laptop-ingestion snapshot for experiments, not a current production backup.

### September 16, two-computer workflow and remote access preparation

Yish requested easier continuity between laptop and OMEN Codex sessions plus control of the PC from the laptop. Prepared `C:/Dev/TWO-COMPUTER-WORKFLOW.md` (local, outside this repository). This Codex session sees only the local host; the `Dev` saved project is `C:/Dev`, not a Git repository. Laptop Tailscale is running but lists only Yish's phone as a peer, not the OMEN. Chrome Remote Desktop was opened in the existing signed-in browser account and showed no registered hosts; one-time host setup on the OMEN is still needed. No software installation, credentials, remote-access permission, project migration, collector restart or deployment occurred. Preserve the paused laptop and inspect the OMEN's existing revision before changing it. The workflow guide also records that GatedSpace's ignored `HANDOFF.md` needs a private transfer if its development host changes; Git does not carry that file.

### September 16, laptop collection intentionally stopped for OMEN

Yish reports the gaming desktop is already configured as a collector and now powered on; he explicitly requested this laptop stop crawling. Ran the installed runtime's `pause --on`, which set `C:/Users/yzger/.filtrsoft/paused` and closed its dedicated crawl browsers. Waited until local job 27 returned to `status:paused`, `progress:waiting`, `jobId:null`, then wrote `C:/Dev/filtrsoft-runner-state/stop`. Elevated process inspection found neither supervisor PID 35420 nor collector PID 11096, and no Chrome processes with a `.filtrsoft` profile. Persistent pause prevents new crawls even if a logon/daily launcher restarts the supervisor. Do not resume the laptop without Yish requesting it. Its source, database and existing launchers remain intact.

Read-only production diagnostics at **2026-09-16 23:29:55 UTC** confirmed **Yishai XPS paused, no active job, no pending listing uploads**. The registered **Gaming desktop** (`bc3313ad-0a65-4020-922c-e9a30505da21`, revision `a91943a1c898`) was not fresh: last contact **2026-09-16 02:40:34 UTC**, `online:false`. This distinguishes Yish's power-on report from a verified resumed process. Primary preference is still **null**, five-minute fallback. Resume/check the existing desktop installation on that computer, then verify a fresh heartbeat and acknowledged uploads and select it as primary. Do not reinstall, replace its node identity, or reset its local revision: its setup changes are not present on fetched origin/main (`6bfbbc3`). Server Craigslist remains enabled. Production storage backup failure remains unresolved and is unrelated to stopping laptop collection.

### September 15, gaming desktop now available

Yish is home and reports access to the HP OMEN. Desktop migration has not started. Next setup session should run on that PC, read `docs/GAMING-DESKTOP-SETUP.md` and `docs/AUTOMATIC-COLLECTION-ROADMAP.md`, use a fresh dedicated runtime checkout and ingestion database, and preserve the current laptop collector until desktop discovery/upload and fallback are verified. This is availability reported by Yish, not a measurement of the desktop's tools, authentication or running processes. No new software, credentials or startup changes were made by this informational turn.

### September 15, Google button visual fix live

Yish confirmed Google sign-in works and supplied a screenshot of the white rectangle behind its dark pill button. The `.gbtn iframe` now explicitly uses `color-scheme: light`, matching Google's embedded document. This prevents the browser from painting an opaque canvas when the surrounding app uses a dark scheme; Google's SDK still controls its button theme, shape, accessibility and sign-in. Background transparency alone cannot fix a browser-painted iframe canvas. Explanation: `https://drafts.csswg.org/css-color-adjust-1/#color-scheme-effect`.

**`6bfbbc3` is on main and live.** At **20:20:45 UTC**, the public stylesheet `assets/index-LTRDxhkn.css` returned 200 and matched the local production build byte-for-byte. Real production GIS frames were visually verified without the white rectangle on sign-up at a **390px viewport** (317px frame) and sign-in at **1280px** (380px frame); both computed `color-scheme:light`, and neither form overflowed horizontally. Google's outline/light button was checked separately in a disposable local presentation fixture using the built palette; this is not a physical-phone or production light-mode login claim. CI **35018876540** passed the suite, typecheck, production build, Docker verification with network disabled and final Docker build at **20:22:09 UTC**. No backend/auth logic, credential or OAuth configuration changed. Temporary preview server and tabs stopped; documentation receipt is local to carry with the next source push.

### September 15, Google sign-in enabled and verified on production

Yish reported that neither Get started nor Sign in showed Google, and pointed to the open Chrome Google Auth tab. The pre-change public `/v1/auth/me` confirmed `google:false`, `googleClientId:null`, registration open. Existing `web/src/landing.tsx` already renders Google's official button in both modes when configured; the backend verifies issuer, audience, signature and expiry. The missing configuration required no application-code change.

Yish explicitly approved creation/configuration/deployment. Created **Filtrsoft Web** in Google project `filtrsoft`: **Web application**, sole JavaScript origin **https://filtrsoft.com**, no redirect URI (the existing implementation uses a JavaScript callback). Read the public client ID from the Clients list after closing the creation dialog; no client secret or personal token was copied. Added the public identifier as Railway production `GOOGLE_CLIENT_ID` and deployed the single-variable change, labeled **Enable Google sign-in for Filtrsoft**. Railway deployment **b343e291-603a-4d0a-b0fc-cd9f0fa774fd** Details explicitly reports **Deployment successful**, using unchanged application commit **43c4fa7441340abdfb27dd8d00f6ec4fbc854679** on main. No new source push was required.

**Live verification:** at **20:08:29 UTC**, public `/v1/auth/me` returned `google:true` with the matching public identifier, and registration/password remained enabled. In the existing Chrome production tab, both **Sign in with Google** and **Sign up with Google** rendered from Google's official GIS integration after a reload. The sign-in button opened Google's **Choose an account** screen for **filtrsoft.com**, with the real privacy link. Closed that test popup without choosing an account or granting consent; no completed personal login, account linking or phone login is claimed. Left the production sign-in form open for Yish. Health reported `ok:true`, `db:ok`, engine **0.3.36**, **31,992 comps**, **577 SKUs**; scoring at that sample was **3,645 pending, 0 failures**, so this is not a claim that all scoring had completed. Production storage recovery and durable backup remain unfinished as recorded below. Local documentation changes should travel with the next source push rather than trigger another deployment just for a receipt.

Google branding is visibly saved: homepage `https://filtrsoft.com`, privacy `https://filtrsoft.com/privacy`, authorized domain `filtrsoft.com`; the already-approved support/developer contact remains `yzgershon@gmail.com`. Privacy page returned 200 with Google disclosure. Google audience is External / Testing; no test users. Google's official audience documentation explicitly exempts Sign in with Google/basic name-email-profile requests from test-user restrictions, the seven-day expiry and warning: `https://support.google.com/cloud/answer/15549945`. No sensitive scopes, invented terms URL, paid services or OAuth app publishing were added. The user-owned Google setup tab remains on the Clients list; the temporary branding tab was closed after saving.

### September 15, marketplace search optimization live

Yish requested an explanation of the local gaming-PC harness and fewer unrelated search results on all four marketplaces. The harness already provides scheduling, process recovery, leases and durable upload retries; physical desktop migration and GPU evaluation remain deferred. No additional monthly spending is authorized.

**Application commit `43c4fa7` is on main and live**, engine **0.3.36**. Railway `a2d73ebd-6e35-4348-be3f-7d30c215a4de` Details explicitly confirms **Deployment successful** and that exact GitHub commit. Native CI `34994132254` passed all checks, including the production Docker build. The installed laptop runtime is clean at the same application revision, online with no error and no pending uploads at **16:25:44 UTC**. Supervisor PID **31200**, collector PID **9460**; stop and pause flags absent. Live health after deployment: **31,992 comps, 577 SKUs, zero pending scores and zero scoring failures**. Receipt: `docs/qa/searches/2026-09-15-release.json`. This verification is a local documentation commit after the application push; carry it forward with the next change rather than causing an extra deployment only for this receipt.

Editing checkout remains `C:/Dev/filtrsoft-backend`; installed runtime is `C:/Dev/filtrsoft-agent`. Shared source was not edited. Search changes use category IDs observed in each site's UI: Mercari Electronics `7` / Computer Components & Parts `775`; OfferUp Computers & Accessories `1.6` / Cellphones & Accessories `1.2`. Facebook alternates GeForce/Radeon families. Craigslist discovery skips obvious unrelated items before detail work and targets PC/VR hardware inside video gaming. The two core query slots retain their rotation, with one bounded extra hardware/phone slot per cycle. Cursor persistence was fixed so the extra rotation cannot be trapped at five entries. Short card titles such as GTX960 are retained instead of being replaced by a town name. Pricing/comp rules and engine version are unchanged.

Measured baseline: the installed collector's Mercari graphics-card pass parsed 90 cards and rejected 79 as out of scope. Separate matched worker samples now show **Mercari 9/91 candidates unfiltered versus 90/92 filtered** (two retained titles still unknown), **OfferUp 54/69 versus 74/75** (12 still unknown), and **Facebook GeForce 33/38**. Craigslist video gaming fell from 190 search results to 21 while retaining a real `monitor and pc` title and Quest headsets; computer parts returned 319, with 186 retained and 133 obvious unrelated/accessory results skipped. A verified hardware category permits description discovery of an unknown model name; it never fills in a specification or valuation. No inference/comp guard was loosened. A separate Mercari UI check showed 15 GPUs and one mini PC in its first 16 filtered cards. These are small current samples, not total-market precision or newly found profitable deals. Details: `docs/SEARCH-OPTIMIZATION-2026-09-15.md`; receipt: `docs/qa/searches/2026-09-15-samples.json`.

Final Windows and pinned Linux tests: **366 passed, 0 failed, 1,198 assertions** each; Linux network disabled. TypeScript and production build passed. An initial Windows rerun used a fresh DB filename beside another test DB and correctly hit the anti-shadowing guard; rerunning in an empty fixture directory passed. The browser audits opened no database, persisted no listings, visited no seller details and used no vision. A fresh consistent ingestion backup before the runtime switch passed restore verification with zero foreign-key violations: `C:/Dev/filtrsoft-runner-state/backups/pre-search-release/filtrsoft-2026-09-15T16-19-33-710Z-b2deac76-68b2-48c8-b70c-30c755bf063c.db`. Collector was stopped through its own supervisor, verified exited, updated and restarted with its existing hidden launcher. No new startup task or software was installed. Search workers were verified live, but an entire scheduled collection cycle on the new revision has not yet been observed. No shared DB rescoring or listing retirement was performed. The prior bounded-memory backup checksum fix in 7e055ce is now deployed; production storage recovery and a durable production backup remain separate unfinished work under the no-added-monthly-cost decision. The server still safely refuses its automatic backup with only 97,583,104 bytes free. Temporary `/tmp` snapshots from the earlier storage investigation must now be considered unavailable after redeployment; they were never durable backup coverage.

### September 15, six pieces shipped; desktop migration deferred

**Budget decision, September 15 follow-up:** Yish explicitly declined both storage/Pro proposals: no higher monthly spend. The approval is closed, not pending. Keep Hobby and the existing 5 GB volume; do not upgrade, resize, buy storage or add a paid backup provider. Investigating a workaround using existing storage, lossless reclamation and production backups retained on his existing PC. At 15:33 UTC the private health read still showed 4,447,391,744 DB bytes and 97,583,104 filesystem bytes free; the server backup remains safely refused. Temporary container storage may stage a snapshot, but is not durable backup coverage. No production database replacement is authorized merely by a successful temporary copy; require verified recovery and protection against concurrent writes. This paragraph supersedes the pending-upgrade wording below.

**Workaround verified at 15:41 UTC:** a consistent compact snapshot on temporary server storage is **2,715,983,872 bytes**, versus the live **4,447,391,744-byte** file, a potential **1,731,407,872-byte** reduction. Full integrity check passed with zero foreign-key violations; snapshot retains **757,551 verdicts, 7,379 listings and 31,992 comps**. Live source is untouched. Snapshot gzip is still 1.97 GB, so repeated full snapshots beside the live database are not a sustainable 5 GB design. Plan and exact temporary paths/hash: `docs/HOBBY-STORAGE-PLAN-2026-09-15.md`. First obtain a verified durable production backup on the existing PC, then rehearse a controlled offline replacement and use PC backup retention. No new private-data download endpoint, no ingestion-token access expansion, no deletion or unsafe live replacement. Backup hashing was changed locally to use 1 MiB chunks rather than loading the whole database into RAM; four isolated backup/hash tests and TypeScript passed. Not deployed. Do not mistake this assessment for completed storage recovery or automatic offsite backup setup.

**`789213d` is on main and live**, engine **0.3.36**. Railway `df4083fe-36fe-408c-b4d8-de5b5ef3c263` succeeded; native CI `34986826853` succeeded including its production Docker build and network-disabled tests. Final Windows/Linux checks: **358 passed, 0 failed, 1013 assertions**. TypeScript/build and four mobile/desktop, light/dark Settings fixture checks passed. Live HTML serves the exact built `index-DdXzI38N.js` bundle. Receipt: `docs/qa/collector/six-part-release.json`.

The installed laptop runtime is clean at `789213d`, online, no local error, zero queued listing changes. Its existing hidden startup/daily launcher remains installed; supervisor PID **34204**, collector PID **13660** at the latest check. Temporary release pause was removed and collection resumed. First automatic local backup passed its restore check, and the bounded free comp refresh uploaded **92 acknowledged records**, bringing production to **31,992 comps**. Those are actual dated sales; a broad old MacBook SKU exposed during this run now cannot mix hardware generations in valuation. Historical rows remain intact. Automatic refresh skips ambiguous MacBook families; Intel/M1 and base/Pro/Max chip generations require explicit matching. Re-scoring is still in progress on production; do not claim all listings have finished.

**One production infrastructure decision remains pending:** the 15:13 UTC private health read measured a **4,447,391,744-byte DB**, **97,583,104 bytes free** on a **4,685,873,152-byte filesystem**. The automatic server snapshot was safely refused by its capacity guard. Railway's actual workspace page confirms **Hobby, maximum 5 GB**, superseding old notes that said premium. A larger volume requires **Pro: $20 monthly minimum including $20 resource usage**, with usage beyond that charged separately. Storage remains **$0.15/GB-month actually used**. The original 32-GB/storage-only approval question omitted this plan requirement and has been explicitly superseded by a new question asking to **upgrade Hobby to Pro and resize to 32 GB**. Only the complete approval authorizes that change. No plan/volume/billing changes have been made. Local ingestion backup does not substitute for a production-account-data backup. No separate offsite destination is configured. Preserve existing records and snapshots.

The deployment log confirms **750,170 verdict rows** and **278,547 free SQLite pages of 4,096 bytes** inside the allocated DB. Hourly-marker deduplication and lossless history compression already exist; they must not be replaced by a duplicate implementation. The independent 50-row/5-second scoring timer also already exists, in addition to the crawler's scoring pass. Existing historical rows were not deleted. This final verification record is a local documentation commit after the application push; carry it forward in the next release.

At the last follow-up, pending scores had fallen from **7,377 to 5,878**, with **zero failures**; catch-up is running. The release stop and pause flags were both absent. Railway's volume `e927adfa-d59c-40b7-afa2-938c91fb3237` remains named `assyze-volume`, mounted at `/data`; do not rename or wipe it. The Chrome Railway plan page was left available for the pending complete approval.

All six code pieces are implemented; physical gaming-PC migration, fresh manual marketplace sign-ins, choosing it as primary, sleep/reboot/fallback soak tests, and actual 4070 Ti model/VRAM/gaming measurements remain intentionally deferred by **prepare here; migrate later**. The repo `yzgershon/filtrsoft` is already private. See `docs/GAMING-DESKTOP-SETUP.md`, `docs/LOCAL-VISION-EVALUATION.md` and `docs/AUTOMATIC-COLLECTION-ROADMAP.md`. Shared `C:/Dev/filtrsoft` source edits to `web/src/detail.tsx` and `web/src/types.ts` remain untouched. Only `C:/Dev/filtrsoft-backend` is the editing checkout. Never edit an active runtime.

### September 15, six-part reliability release validation

Follow-up verification: **a47716a is live** (Railway `52ddeb5b-a0e8-4ad4-991d-0808e7a3061b`), native CI `34985585243` succeeded. Laptop runtime at that revision is online with zero queued listing changes. Its first daily backup passed and its first bounded comp refresh uploaded **92 acknowledged sales**, bringing production to **31,992 comps**. That real run exposed an older ambiguous `Macbook Air 13` SKU pooling generations. A stricter shared generation guard is being released as **engine 0.3.36**, retaining the sales but withholding generic-family valuations and skipping ambiguous automatic targets. Windows now passes **358/0/1013**. The first server backup was safely refused for insufficient verified free space; do not claim server backup coverage. Private health now includes storage sizes so the required capacity can be measured. Desktop migration/GPU tests remain deferred.

All six pieces have local implementations. Windows and pinned Linux (network disabled) each passed **357 tests, 0 failures, 1012 assertions**, plus TypeScript and the production build. Final host-failure dispatch and paused-presence regressions passed too: a dead modern host can requeue without the normal 45-minute rest, and maintenance heartbeats can trigger queued work without paused nodes doing so. The real Settings component and API passed an isolated browser fixture at 390px/1280px in dark/light themes: preference persistence, explicit field labels, 44px minimum controls, no horizontal overflow or browser exceptions. Saving now preserves the open form. This is fixture UI evidence, not authenticated physical-phone testing. No new production deployment yet.

For release, job #11 was paused through the existing flag, saved partial results were uploaded, and the idle old runtime's supervisor/child were verified stopped. Consistent backup `C:/Dev/filtrsoft-runner-state/pre-six-part-release/filtrsoft-2026-09-15T14-59-58-101Z-38469e2f-cbdd-403c-b014-299d5790d1f8.db` passed integrity, foreign-key and restore checks: **31,900 comps, 561 SKUs, 4,901 local listings**. The release owns `release-pause-owned` in the state folder; resume its temporary pause after the verified runtime update. Do not leave the laptop stopped after release verification.

Yish requested all six roadmap pieces in order and confirmed **prepare here, migrate the gaming desktop later**. Sole editor remains `C:/Dev/filtrsoft-backend`. Existing GitHub repo was verified **private**; no new repository is necessary. Features: owner-only source health and primary/fallback selection; stable node identity and lease-loss cancellation; restart/network regressions; Facebook card-first capture before bounded enrichment/probes; persistent source challenge backoff; daily restore-verified laptop/server snapshots; bounded free sold-comp maintenance with an exact-product guarded durable upload; digest-pinned local photo evaluation that never writes valuation facts. Engine remains **0.3.35**. No paid vision, model install, login or source filter relaxation. Actual gaming-PC setup, manual marketplace sign-ins, physical sleep/reboot and GPU measurements await that machine. Follow `docs/AUTOMATIC-COLLECTION-ROADMAP.md` and `docs/GAMING-DESKTOP-SETUP.md`; preserve current laptop startup and the shared checkout's two existing edits. Before updating the runtime, stop its supervisor and verify owned processes exited; take a consistent backup first.

### September 15, automatic startup installed and collector online

Yish approved permanent automatic collection in his follow-up. The previously rejected installation was rerun with that approval and succeeded: hidden logon shortcut installed, existing daily task updated, and the collector started from `C:/Dev/filtrsoft-agent` at `d3d116e`. Backups: `C:/Dev/filtrsoft-runner-state/legacy-startup-20260915095051.cmd` and `legacy-task-20260915095051.xml`. Production confirmed revision `d3d116eb2802` online at **13:51 UTC**, with no local error. A real daily-task invocation returned **0** and preserved the same supervisor/collector PIDs (15060/26088), confirming duplicate exclusion. This is on **Yishai_XPS**, not the future gaming PC. No approval remains pending for this installed setup; the older blocked checkpoint below is historical. No reboot or multi-day reliability test has been completed. Next-work recommendation: `docs/AUTOMATIC-COLLECTION-ROADMAP.md`.

At **13:53 UTC**, the server automatically assigned **job #10**, which the installed collector claimed. The **13:54 UTC** receipt shows its Facebook search stage running with a fresh production heartbeat. Receipt: `docs/qa/collector/startup.json`. This verifies automatic dispatch and execution beginning; the complete multi-source cycle was still in progress at this checkpoint.

### September 15, collection release checkpoint before startup approval

**Final application revision `d3d116eb28027e00200efe45d09287014fd48612` is on main and live.** Railway deployment `4fe80218-e48a-4f2c-9257-887d5b1dff25` succeeded. Native amd64 CI `34932156679` completed successfully, including tests, typecheck, frontend build, network-disabled Docker tests and production image build. This fixes the child-reaping race discovered by the previous CI run. Windows and pinned Linux verification passed **346 tests, 0 failures, 996 assertions**. Dedicated runtime `C:/Dev/filtrsoft-agent` is clean at detached `d3d116e` with existing dependencies reused. Release and aggregate receipts: `docs/qa/collector/`.

At 05:18 UTC, production confirmed all **eight new recovery captures** (Facebook 3, OfferUp 2, Mercari 3), 160 Craigslist captures/24h, healthy DB, low storage pressure and zero pending/failed scores. Engine remains **0.3.35**; no valuation or comp guard was loosened. The eight captures are not eight BUY recommendations. Exact sold evidence remains absent for some new listings.

**Remaining operational step:** the hidden logon launcher installation, existing daily-task update and collector start were rejected by automatic approval review before execution. One direct question asking permission for these persistent startup changes is pending. Do not bypass that rejection or treat the release as proof the desktop collector is online: its status remains offline, and the existing launchers have not been changed. After explicit approval, install/start from the dedicated runtime and verify its actual revision, polling receipt and remote presence. See `docs/DESKTOP-COLLECTOR.md` and `docs/CRAWLER-RECOVERY-RESULTS-2026-09-15.md`. Shared checkout's pre-existing `web/src/detail.tsx` and `web/src/types.ts` changes remain untouched.

The chronological checkpoints below describe intermediate states; the final receipt above supersedes their pending-release claims.

Production 221e7a3 is live (Railway status success). Authenticated aggregate diagnostics at 05:14 UTC confirm 160 Craigslist captures/24h and the eight new desktop captures (Facebook 3, OfferUp 2, Mercari 3). Last-week live Craigslist cohort: 3 VERIFY, 5 FAIR, 16 PASS, 5 RISK, 114 insufficient-data, 659 out of scope, no BUY. Native CI 34931811775 exposed a supervisor shutdown race: it exited before reaping its child. Fixed by retaining ownership until child close; targeted Windows/Linux collector tests pass. Shipping that correction next. Startup approval remains pending; do not install or start via an alternate route.

Pushed **221e7a3** to main; Railway/CI verification is in progress. Dedicated clean runtime exists at `C:/Dev/filtrsoft-agent` (detached 221e7a3), with a junction to existing dependencies. Automatic approval review rejected the command to install the hidden logon launcher, repoint the daily scheduled task and start the collector, citing missing exact authorization for persistent startup behavior. The command did not execute. One explicit approval question is pending with Yish; do not route around that rejection. Ordinary release verification continues.

Release checkpoint: final Windows and pinned Linux **346 pass / 0 fail / 996 assertions**, typecheck and build pass. Mercari viewport retention verified live: 89 cards, three new tech captures (two PASS, one insufficient-data), all acknowledged by production. Total new recovery captures: eight across Facebook/OfferUp/Mercari. Exact hidden Windows startup action passed its disposable fixture. Implementation is ready for the dedicated runtime switch and authorized main/Railway push. Results: `docs/CRAWLER-RECOVERY-RESULTS-2026-09-15.md`. No deployment claimed yet.

Checkpoint: Windows and pinned Linux tests passed **344/0/994 assertions**, plus the new isolated supervisor test passed. Verified backup `C:/Dev/filtrsoft/backups/runner-recovery/before-current-runner-20260915T044846Z.db` (integrity OK, 4,788 listings, 16,591 verdicts, 31,900 comps) preceded current-schema migration of the shared ingestion DB. Bounded unpaid live runs captured **3 Facebook + 2 OfferUp** listings; production acknowledged initial source snapshots (529 Facebook, 479 OfferUp, 109 Mercari), subsequent enrichment and 24 sold-status probes (one Mercari retirement). These are acknowledged changes, not that many new listings. New Facebook examples lack exact sold evidence: GTX 1650 base model is absent (only Super exists); two PCs lack matching build comps. Mercari search yielded only unrelated cards after scrolling; UI inspection found GPUs in the initial viewport. Fixing lost virtualized cards by retaining every viewport. No deployment/startup switch yet. Shared checkout source edits remain preserved.

Yish authorized fixing and optimizing the stale collection pipeline. Sole editor in `C:/Dev/filtrsoft-backend`; main/Railway push remains authorized. Plan: `docs/CRAWLER-RECOVERY-PLAN-2026-09-15.md`. Preparing truthful worker failures, fair rotating searches with incremental uploads, and a hidden managed runner from a dedicated current checkout. Existing ingestion DB must be backed up before migrations. Preserve shared checkout changes and all unrelated processes. No new paid vision during recovery. Gaming PC: HP OMEN MAX 45L, Ryzen 7 9700X, 32GB DDR5-6000, RTX 4070 Ti, 1TB NVMe, 1200W PSU and 360mm AIO (Yish supplied); its setup is future work, not an installed runner yet.

### September 15, missing fresh deals diagnosis

Yish reports no recent good listings. Read-only checks found **no fresh Facebook/OfferUp/Mercari captures locally in 24h**, recent daily runs timing out/interrupted, and both laptop launchers still using **C:/Dev/filtrsoft at e5a7023 / engine 0.3.33**, while production runs 0.3.35. The laptop pause flag is currently absent; no active crawler was found. The scheduled job's last result is 0xC000013A; startup log records a September 14 21:41 EDT launch but it is no longer running. Public production health at September 15 ~04:24 UTC: DB healthy, low storage pressure, 31,900 total / 28,313 usable comps, **0 pending / 0 failed scores**. This is evidence of a collection/release gap, not proof every engine verdict is correct. Production Craigslist arrival/verdict distribution still needs an authenticated read; local Craigslist is a stale separate copy. Preserve main's detail.tsx/types.ts edits. No crawl, runner change, engine change or deployment performed. Full evidence and next action: `docs/CRAWL-DIAGNOSIS-2026-09-15.md`.

### Current release: September 14 UTC, account sync and public website live

**Pushed and verified:** final application commit **d922b11fc02b8fbc178aa110f77284abb01ac077** follows implementation **ddb5c5b** on main. Railway deployment **6429540507** succeeded **2026-09-14T02:50:03Z**. Native amd64 CI **34800487989** completed successfully **02:51:15Z**, including all tests, typecheck, frontend build, Docker verification and production image build. The **02:51:06Z** public receipt matched all six JS/CSS assets and both WebP images by SHA-256, confirmed anonymous isolation and public registration, and found engine **0.3.35**, **31,900 total / 28,431 usable comps**, healthy DB, low storage pressure and **zero pending / zero failed scores**. Receipt: `docs/qa/account-sync/production.json`.

The live public website and eight-character signup helper/HTML minimum were visibly verified. Cross-device theme/save/removal and account separation were verified against disposable sessions on independent loopback origins; no physical phone test or signed-in production sync test is claimed because the available production browser was signed out. Google remains unconfigured and its prepared setup still awaits Yish's final client-creation action. No credential was handled. The local disposable preview was stopped after QA. This release supersedes the in-progress checkpoints below.

Yish requested same-account sync across computers/phone, eight-character passwords, and a richer public website with generated images and animations. Sole editor in `C:\Dev\filtrsoft-backend`, clean start `48b0953`; shared main remains untouched. Plan: `docs/ACCOUNT-SYNC-WEBSITE-PLAN-2026-09-14.md`. Saved listings, preferences, local history/notifications and read markers need new account persistence; reviews, purchases, inspections, market pins, dismissals and saved searches are already account-owned. Preserve old device records during owner-verified migration, prevent account mixing and stale deletion resurrection, and show real sync/retry/conflict state. Public artwork is illustrative, never listing evidence. Main/Railway deployment remains authorized. Google client creation is still pending with Yish.

Implementation checkpoint: per-entry account revisions, owner-checked legacy import, offline outbox, deletion tombstones, per-field conflict choices and cache recovery are implemented. Windows and pinned Linux **337 pass / 0 fail / 975 assertions**; typecheck/Vite pass. Two independent browser origins verified preference sync and saving/removing the same listing in both directions; a separate account opened an isolated workspace. Public website inspected at desktop and in a 375px frame; menu, keyboard-operated walkthrough tabs and FAQ work. Linux first pass exposed two test fixture imports resolving from a temporary directory; fixed using the existing absolute package-fixture convention and full rerun passed. Ready to push. No physical-phone verification claimed. Results: `docs/ACCOUNT-SYNC-WEBSITE-RESULTS-2026-09-14.md`.

Push checkpoint: application `ddb5c5b` reached main; Railway `6429522886` succeeded at `2026-09-14T02:48:08Z`. Final signup visual check found one stale helper sentence spelling out twelve despite correct eight-character input and API enforcement. Corrected it to derive from the shared constant; final live verification follows that copy correction.

### Previous release: 2026-09-13 EDT / September 14 UTC, access and market history live

**Pushed and verified live:** application commit **20df9209703f34c1b60c1580f03d05c42fcf2db4** is on `origin/main`. Railway deployment **6428823295** succeeded at **2026-09-14T01:32:29Z**; native CI **34796210266** passed. The public release check at **01:33:41Z** matched all six compiled JS/CSS assets by SHA-256, verified the real privacy document and anonymous API isolation, and observed registration open, engine **0.3.35**, **31,900 total / 28,431 usable comps**, database healthy, storage pressure low, and **zero pending / zero failed scores**. Receipt: `docs/qa/market/production.json`.

**Signed-in production UI verified after deployment:** Review rendered ten real listings with no purchase follow-up banner. Price history opened the live catalog (563 non-console products), then Ryzen 5 5600X: 3M showed **55 sales / $129.99 median**; 3Y showed **74 sales / $130 median**, explicitly only seven of 37 months with observations. Actual eBay item links and configuration-specific CSV links were present; deployed desktop dark presentation was visually inspected. No fabricated purchase, seller contact, account creation, label or removal was used for this verification.

**Final checks and limits:** Windows and network-disabled Linux ARM64 each passed **328 tests / 0 failures / 951 assertions**, plus TypeScript, Vite and the pinned image/privacy checks. Storage recovery is applied and audited, retaining every historical verdict and creating about **1.2 GB reusable SQLite capacity**; the physical file did not shrink. Future changed verdicts now atomically archive the preceding payload in production. Native RAM/storage history is sparse, and universal three-year history is not available. Google branding exists but the client creation/public client ID and manual sign-in remain pending with Yish. Do not claim Google sign-in live. Results: `docs/MARKET-HISTORY-RESULTS-2026-09-13.md`.

The following checkpoints record the investigation in progress; the verified release above supersedes their pending-work and not-yet-applied claims.

**Release gates complete:** final source passed **328 tests / 0 failures / 951 assertions** on Windows and network-disabled Linux ARM64, TypeScript, Vite, pinned container build, and a real built-image public privacy-route check. Browser checks include measured 360px light layout, desktop light layout, dark presentation, source/configuration controls, URL range changes, retained CPU pins and keyboard inspection. Final application commit and Railway/CI receipts will be recorded after the push. Price-history native coverage remains limited to existing observations, particularly sparse RAM/storage. Google is the sole external configuration step still waiting on Yish.

**Pre-release checkpoint (supersedes earlier recovery-in-progress text):** production history recovery finished and passed checksum readback plus SQLite quick_check. At 2026-09-14T01:17:03.683Z, all 739,094 observed rows decoded; 714,958 older payloads were compressed, zero latest payloads compressed. Reusable SQLite capacity 1,203,003,392 bytes; physical available space 97,718,272 bytes. The physical file did not shrink. Normal app writes continued and no unique history was deleted. Maintenance processes are done. Locally, future changed verdicts now archive the preceding payload atomically, with a regression covering rollback and current JSON. Market/follow-up/auth release checks are being finalized; the earlier 327-test Windows/Linux runs passed before this last archival addition. Final archive audit accepted 25,354 rows across 496 products. Results/limits: `docs/MARKET-HISTORY-RESULTS-2026-09-13.md`. Google client remains prepared for Yish's final Create click; do not claim Google sign-in configured or manually verified. No personal tokens or client secrets handled.

**Recovery deployment checkpoint:** `7c15cb2` deployed successfully (Railway 6428457171, CI 34794052332 passed). Its maintenance command failed before writing because Bun rejects `{readonly:false}` open flags. Corrected to explicit `{readwrite:true}` in **53c3c44**, added a real command-line dry/apply/restore regression, and pushed main. The corrected command has now completed its first bounded production batch: 6,400 historical rows scanned, 1,491 compressed, 449,705 payload bytes saved, no rows deleted. Cursor 19,264. This small early-history sample created no free pages; integrity/readback checks and further compression are in progress. Do not claim the physical file shrank. New frontend QA found and fixed a global `.active` CSS rule interfering with selected controls; renamed the feed-pill class and aligned chart tabs. Market fixture at 127.0.0.1:3214 uses isolated accounts plus the packaged archive, not production data.

**Storage checkpoint, September 14 UTC / September 13 EDT:** Railway Console confirms c9bd3bb active. Direct DB observation: 733,100 verdict rows, 1,079,273 pages at 4,096 bytes, no free pages. An exact SHA-256 and byte comparison proved the old backup `.restore-check` was identical to the retained backup. Removed only that duplicate; original backup and manifest remain, and its copy is recoverable from that original. Filesystem space recovered to 119,668,736 bytes. No unique records removed. Lossless older-verdict compression with checksum verification, historical reader compatibility, small transactions/checkpoints and a restore mode is now being tested locally; not applied live. Procedure and rollback: `docs/STORAGE-RECOVERY-2026-09-13.md`. The market/follow-up/auth feature suite passed **322 tests / 0 failures / 928 assertions** before this new compression work. Archive audit in `docs/qa/market/archive-audit.json`: 25,355 accepted market observations across 496 catalog products, including only 18 RAM observations and no storage observations; full three-year coverage and a measured memory spike are not available from this archive.

**Late checkpoint (active work, not a release claim):** sole editor in `C:\Dev\filtrsoft-backend`, branch `codex/frontend-redesign`. `4006fbe` restored the signed-in feed and reopened registration; volume still measured full, so saved writes and crawling remain unresolved. `1dbf51d` stops hourly pricing markers from duplicating otherwise identical verdict history and adds diagnostics. GitHub Railway receipt 6427881915 says success, but only the first deployment's startup diagnostics have been observed in Railway UI. Its CI caught a test-only excess-property TypeScript error; corrected in **c9bd3bb**, pushed main. Verify the active Railway image/logs rather than inferring that storage recovered.

Uncommitted implementation now includes account-owned seller-click follow-ups, Google script loading/retry fixes, `/market` with product search/pins, 1m/3m/6m/1y/3y/all series, configuration/condition/price-basis cohorts, explicit gaps, chart keyboard control, source links, chart table and complete CSV export. Market APIs are authenticated and cache without writes; no engine comp guard was loosened. Dedicated regressions cover kit/latency/ECC/RGB, GPU board variants/whole-machine rejection, phone capacities, gaps/shipping, account isolation, exports over 100 rows and revision invalidation. **19 focused tests passed**; TypeScript and Vite passed before the latest identity refinements. Full release gates and visual verification remain pending. The archive is unchanged, and its older dates are sparse; no complete three-year history is claimed.

Google Cloud: created separate project **filtrsoft**, display name Filtrsoft. Yish approved `yzgershon@gmail.com` as public support/developer contact and explicitly approved the Google API Services User Data Policy. Branding setup was created successfully. A **Web application** client named **Filtrsoft Web**, JavaScript origin **https://filtrsoft.com**, no redirect URIs, is prepared at `https://console.cloud.google.com/auth/clients/create?project=filtrsoft`. It is **not created yet**: handed off the final Create click to Yish under his credential rule. No personal tokens, client secrets, paid services, account login automation or hosting-plan changes. Public Google client ID remains unconfigured in Filtrsoft. Chrome control is intermittent; new tabs work when old ones report Debugger unattached.

**Yish explicitly wants public account creation restored.** The September 12 registration closure was an incorrect interpretation of his private-scanner plans; it is superseded. Keep account-owned data isolated and add Google sign-in to both authentication modes. Google needs a public OAuth web client ID, not Yish's personal token. No credential handling or paid services.

Current requested work: fix the production feed failure; only ask purchase follow-ups for actual clicks to original seller listings; build interactive product market-price history across supported categories, with truthful time coverage and exact variants; complete useful integrated improvements and release. Plan: `docs/MARKET-HISTORY-PLAN-2026-09-13.md`. Work only in `C:\Dev\filtrsoft-backend`, clean start `7f8ac6c`, remote main verified `d04ce5d`. Preserve shared checkout edits and database. Existing permission to push main and deploy Railway persists.

Initial diagnosis: failure reproduced in Yish's signed-in Chrome. A direct authenticated `/v1/feed?quality=review&limit=60&offset=0` returns **Internal Server Error**, so the UI's connection explanation is unsupported. Old follow-up eligibility reads detail-view history, not outbound clicks. No current-task fixes deployed yet. Historical coverage remains unmeasured; never fabricate a three-year series from the current sold-search archive.

**Urgent recovery checkpoint:** Railway logs confirm `SQLITE_FULL` at `feedWindow`'s pagination INSERT, plus failed enrichment and crawl writes. Railway volume UI reports **5 GB, 100% capacity**. Prepared a bounded memory pagination cache (account/filter isolation and 409 recovery retained), default-open signup, accurate API/UI storage errors, storage-pressure health and startup file/table-size diagnostics. SQLite performs its own guarded WAL checkpoint; no manual file deletion, user-record removal, volume resizing or purchase. Windows and network-disabled Linux ARM64: **314 tests / 0 failures / 915 assertions**, TypeScript and Vite passed. This small deployment precedes outcome and market-history work so live storage can be diagnosed first. Engine and archive unchanged. Recovery is not yet verified live.

**Recovery release 4006fbe is live:** Railway 6427778854 succeeded 2026-09-13T23:32:48Z; native amd64 CI 34789971514 passed. The signed-in production Review feed now visibly renders ten real listings. Storage remains critical, so writes/crawling are not claimed recovered. Startup measured database 4,416,393,216 bytes, WAL 13,279,232 bytes, zero filesystem space available. SQLite checkpoint correctly refused with SQLITE_FULL; no files removed. Additional diagnostics are prepared for freelist, backup files and row counts. Verdict persistence now ignores only the global scheduling revision when every actual fact/comp/value is identical, preserving the original stored payload and historical engine changes. Separate uncommitted work adds seller-click follow-ups; Google and market history remain pending.

### Previous release: 2026-09-12, private workspace, pushed and live

Yish requests a sustained frontend/backend improvement pass with implementation, and a researched tech software business that does not distribute the same scarce local deals. **Filtrsoft's scanner is intended for private use for now.** Plan and checkpoints: `docs/ECOSYSTEM-PLAN-2026-09-12.md`. Sole editor in `C:\Dev\filtrsoft-backend`, clean start `75fc352`; pre-release remote main was `c85a75b`, now `d04ce5d`. Shared main `C:\Dev\filtrsoft` is at `e5a7023` with existing `web/src/detail.tsx` and `web/src/types.ts` edits; preserve it and its database. Existing main/Railway deployment authorization persists. No new paid services, seller messages or duplicate crawls.

September 12 production baseline: engine 0.3.35, DB healthy, 31,900 total / 28,567 usable comps, 118 discoveries/scored in the last day, laptop agent last poll September 10. The health observation has **554 pending scores / 0 failures**; previous complete-scoring counts below are historical. That baseline preceded this release. No manual shared or production data operation was performed; deployment applies the additive schema and starts the existing scheduler. Scope: private registration, actual listing history, persistent account-owned inspection notes/checks, and purchase resale/cost recording with honest realized profit. Research recommendation will remain separate from a public launch.

**Verified release checkpoint:** **311 tests / 0 failures / 907 assertions** on Windows and Linux ARM64, TypeScript and Vite passed. The real-API workspace browser suite covers privacy, authenticated thumbnails, chronological asking prices, account-owned inspections, drafts/failed saves, exact sale costs, pipeline health, rejected lazy imports and ten viewport/theme combinations. **10 workspace groups** passed. Existing 15 detail and 6 comparison browser groups also passed; a separate synthetic AfterBuild concept passed at 360/768/1440 widths. **Application commit d04ce5d5db783ffa91ac3df3f28f025d7cb4d788 is on origin/main and live.** Railway deployment **6412820697** succeeded at 2026-09-12T18:13:54Z; native amd64 CI **34710515278** passed every gate. At 18:17:02Z, all five live JS/CSS assets matched local SHA-256 hashes, new registration was closed, anonymous listing/inspection/purchase/thumb requests returned 401, and health reported DB ok, 31,900 total / 28,567 usable comps, 492 priceable models and **0 pending / 0 failed re-scores**. No authenticated production record was changed for verification. Receipt: `docs/qa/workspace/production.json`; complete result: `docs/ECOSYSTEM-RESULTS-2026-09-12.md`.

Implemented closed new registration (existing accounts remain usable), private cached thumbnails/operational diagnostics, listing price history, inspection notes/checks, sale/cost editing with revisions, inventory/sold views, exact shared money formatting, pipeline status, atomic fact/history writes and separate local-read/source/auth rate limits. Sold items no longer inflate inventory estimates. Unknown costs never become zero. Drafts survive closing within the current browser tab, and stale versions are offered for recovery. Added lazy loading plus recovery boundaries for failed chunks. Normalize compact GPU suffix spacing without relaxing exact variants. Engine remains 0.3.35; verdict rules and the 31,900-comp deployment archive are unchanged.

Measured archive-status overhead: six uncached reads took 340–539 ms each; after caching verified file metadata, first read 345.47 ms and repeated reads 0.03–0.18 ms. This is a local benchmark of archive status, not an end-to-end production latency claim. Imports still validate fully, file replacement invalidates the summary, and import acknowledgements remain fresh.

Operations and routes: `docs/PRIVATE-WORKSPACE-OPERATIONS.md`. Business recommendation, competitor evidence, pricing hypothesis and validation gates: `docs/AFTERBUILD-OPPORTUNITY-2026-09-12.md`. Local synthetic concept: `docs/prototypes/afterbuild.html`, serve with `node src/browser/afterbuild-preview.mjs` on 3212. It does not run diagnostics, send messages, collect customer data or appear in the production app. Keep the scanner private; choose/validate a commercial workflow before adding billing. Native gaming FPS remains unavailable; rendering is still separate. Public health intentionally omits private pipeline details; signed-in More > Pipeline status exposes them. Full checkpoints: `docs/ECOSYSTEM-PLAN-2026-09-12.md`. Closing release evidence is recorded locally after deployment so it does not trigger a second production build; application and research are already pushed.

### Current release: 2026-09-09, hardware comparison, pushed and live

**Comparison workspace is live.** Application commits `e3ba3ae` and final correction **`c85a75b526f9d8073c377c8a00d47acb7086f1fb`** are on origin/main. Railway deployment **6362974473 succeeded** at 2026-09-10T01:58:53Z. Final native amd64 CI **34427576666 passed**: **296 tests / 0 failures / 881 assertions**, TypeScript, Vite, the network-disabled verification container and production image. Initial Windows/Linux ARM64 full suites passed 296 tests / 880 assertions; the final additional source-link assertion passed in the focused 14-test comparison suite and native amd64 CI. **21 browser groups passed** (6 comparison plus 15 affected tabbed-detail groups); the 6 comparison groups passed again after the final wording correction. No page errors. No physical-phone testing is claimed.

Implemented authenticated two-listing comparisons, CPU/GPU/RAM/storage/board/PSU views, picker/search/paging, URL persistence and Back, differences view, both themes, staged reveal with skip/replay/reduced motion, original seller links, recorded specs and conflicts, existing listing asks/resale estimates, 6 sourced manufacturer-reference models and 10 verified UserBenchmark provider IDs for external pair links. Enter from **Compare hardware** in a listing, desktop sidebar or mobile More. Source/card prices retain their original scope; pending or changed facts withhold stale identity and value. Malformed stored payload shapes cannot break a candidate page. Comparison does not mutate listings, labels, aliases, comp data or verdicts. Root was the sole editor in `C:\Dev\filtrsoft-backend`, branch `codex/frontend-redesign`; shared checkout/database/crawls/archive untouched. Engine remains **0.3.35** because these comparisons do not change verdict computation.

**Remaining requirement: native gaming/FPS scoring is unavailable.** Yish explicitly chose **gaming performance and value**, then **free only**, suggesting UserBenchmark. Its public Effective Speed is a calibrated index, not measured game FPS. No supported free score API or score-republication permission was verified; this is not a claim that reuse is prohibited. Filtrsoft links to exact observed provider IDs, with GPU family warnings, rather than scraping scores, bypassing challenges or inventing game performance. Blender 4.5.0 / Windows supplies separately labeled rendering only: 1,312 raw cohorts, not 1,312 supported exact models, retrieved 2026-09-10T01:06:19.675Z. At least 10 submissions, exact form/variant matching; laptop and mixed-memory families cannot win an exact comparison. Manufacturer reference specs never fill missing seller facts. Do not call the requested native gaming-score layer complete or substitute rendering for it. No paid provider, purchase, new credentials or seller messages.

At **2026-09-10T01:59:41.664Z**, production HTML referenced the tested entry and all JS/CSS bytes matched, including the lazy comparison chunk. Worker and manifest match after normalizing Windows CRLF/Linux LF. Comparison/candidates/feed/pulse remain 401 without a session. Health: engine 0.3.35, DB ok, **31,900 total / 28,745 usable comps**, scoring 0 pending / 0 failures / complete. Evidence: `docs/sessions/2026-09-09-comparison-release.json`.

Read-only verification in Yish's existing signed-in Chrome selected real Facebook listings **6234 / 2814**, RTX 3070 $250 versus RTX 4070 $475. Existing resale estimates $274.99/$506.98, unknown seller VRAM, distinct original seller URLs, manufacturer references and the exact UserBenchmark pair link rendered correctly. Rendering showed 3,158.8/5,176.5 samples/min with 235/211 submissions and correctly withheld a precise winner for pooled RTX 4070 memory revisions. The final live reload confirms source links open readable benchmark queries. No review/removal, seller message or account settings mutation was used for QA.

Research report: **`docs/MARKETPLACE-RESEARCH-2026-09-09.md`**. Ten competitor/source products examined; prioritized proposed features are exact-hardware alerts, listing/price history, Pickup mode, deal stages/actual outcomes, market-evidence quality, My PC upgrades and saved comparisons. These proposals are report-only until Yish selects them. Plan: `docs/COMPARISON-PLAN-2026-09-09.md`. Browser assertions and synthetic screenshots: `docs/qa/comparison`. Synthetic preview remains **http://127.0.0.1:3204/compare?ids=201,202**. Closing documentation is committed locally after the application push and does not require another deployment.

### Current release: 2026-09-09, tabbed detail and light mode, pushed and live

**Release complete.** Application commits `0c18f9f` and final correction **`7e5374a1f2962d47761c613504d84809c8d43216`** are on **origin/main**. Railway deployment **6361897832 succeeded** at 2026-09-10 00:19:53 UTC. Native amd64 CI **34420787710 passed**, including the full suite, TypeScript, Vite, network-disabled verification container and production image. Final Windows and Linux ARM64 checks: **282 tests / 0 failures / 824 assertions**. Browser coverage across the release: **54 groups**, including 15 final tabbed-detail groups and 39 earlier frontend/mobile/workflow/offline groups. No browser page errors.

At **2026-09-10T00:20:29.272Z**, public JS/CSS hashes and worker/manifest match the final tested build, and unauthenticated feed/pulse remain 401. Production: **engine 0.3.35**, database healthy, **31,900 total / 28,745 usable comps**, stored re-scoring **0 pending / 0 failures / complete**. Archive unchanged. Evidence: `docs/sessions/2026-09-09-tabbed-detail-release.json`. Closing evidence is committed locally after the application push and does not require another deployment.

Implemented Decision / Specs / Evidence / Inspect tabs, swipe-first filled hero and linked title, a review/share/trash action bar, account-owned recoverable removal with Undo and Settings restoration, three recorded eBay Comparable sales before expansion, one Copy questions control, Light/Dark/System appearance, source-backed specs with unknowns/conflicts, exclusive-payment-only concern detection, and bounded feed-photo fallbacks. Light mode: More > Settings > Appearance. Specs use frozen seller/photo evidence rather than catalog defaults or a new vision call.

Read-only verification in Yish's existing signed-in Chrome session inspected real listing `/c/4254`: tabs, source title/gallery, three actual eBay item links, seller text, specifications, questions and action bar. It found and fixed flattened Extras leaking into Case, an AIO LCD being treated as the computer Display, and sticky-tab switches hiding the start of the new panel. Final live recheck confirms the Case stops at tempered glass, Extras remain additional evidence, no AIO Display field exists, and Inspect begins below its tab strip. No live review/removal, credential handling or physical-phone verification is claimed.

Photo investigation found expired Facebook links and sampled Craigslist pages without galleries. Cached/first-photo failure now falls through to later recorded photos; Facebook intake retains its own card thumbnail when detail gallery loading fails. Expired signed URLs still require fresh capture by the regular laptop crawler. No duplicate crawl, shared database mutation or archive replacement occurred. Details and limits: `docs/TABBED-DETAIL-PLAN-2026-09-09.md` and `docs/sessions/2026-09-09-tabbed-detail.md`. The built synthetic preview remains at http://127.0.0.1:3202/c/101.

Yish rejected the stacked-card organization as insufficiently different. He explicitly wants tabs (numbers/calculations, sold evidence, concerns/questions, plus a dedicated accurate specifications section), review controls in a better position, simpler copying, three clickable sold comps shown before expansion, swipe-first filled photo hero, linked title instead of View listing, recoverable trash action, full light mode, crypto-only payment detection and investigation of missing marketplace photos. This supersedes the previous detail layout below. Work started clean at `7271d9a` in `C:\Dev\filtrsoft-backend`; root is the only editor. Plan: `docs/TABBED-DETAIL-PLAN-2026-09-09.md`. Inspect actual seller/photo facts and label unknowns/conflicts; never fill specifications from a generic SKU.

### Prior implementation: 2026-09-09, listing detail organization

Yish requested a premium, organized listing detail screen. Work started clean at `b2411b7` in `C:\Dev\filtrsoft-backend`, branch `codex/frontend-redesign`; root is the sole editor. Implemented grouped listing identity/photos, verdict/valuation, inspection and seller evidence, compact native disclosure rows, a two-column desktop report, exact-cent money and inventory offers, visible gallery controls and confirmed clipboard feedback. Defects, serious signals, unknowns and match identity remain visible. All valuation formulas, verdict rules and API writes preserve their contracts. No changes to shared checkout, crawls or archive.

Local checks: **268 tests / 0 failures / 763 assertions**, TypeScript and Vite passed. **48 browser groups passed** (15 existing redesign + 9 mobile + 9 workflow + 6 real service-worker + 9 new detail), including 30 report/viewport cases, exact prices/tiers, selected-channel math, unknowns, disclosed defects, keyboard disclosure, failed clipboard/photo/review handling, landscape and larger text. The first detail harness run used the wrong accessible name for the photo close button; corrected to `Close photos` and verified its hit target and actual dismissal. No application fault there. Built assets: `index-BOtPGx8i.js`, `index-6DxMC26D.css`. Archive SHA-256 unchanged at `0285af42b39f7d9105882ba52591d311823b6b8cf790aa871161862b1ea3e635`.

Preview: `node src/browser/detail-preview.mjs`, **http://127.0.0.1:3197/c/101** (102 unknown, 103 risk, 104 inventory, 105 long text). Synthetic fixtures only. Local preview process left running. Both pinned native Linux ARM images built, and all 268 tests / 763 assertions plus TypeScript passed in the network-disabled verification container. Full report: `docs/LISTING-DETAIL-REDESIGN-2026-09-09.md`.

**Pushed to main: `57f80c5`**, `Organize listing details into a focused valuation and evidence report`. Non-force push advanced remote main from `59c1b55`, including the previous release's local closing documentation. Railway deployment `6360954276` reports **success**. At `2026-09-09T22:59:15.885Z`, public production HTML, JS/CSS bytes, service worker and manifest match the tested build; private feed/pulse remain 401. Health: engine 0.3.34, database ok, 31,900 total / 28,791 usable comps, scoring 0 pending / 0 failures. Evidence: `docs/sessions/2026-09-09-listing-detail-release.json`. The new detail build is live. **Native amd64 CI run `34414722201` succeeded**, including the host suite, TypeScript, Vite, verification container and production image. This pass is complete. Closing release evidence/documentation is committed locally after the application push; it does not require another deployment. No authenticated production UI or physical handset verification is claimed.

### Current implementation: 2026-09-09, preserve current style and fix audit bugs

Implementation and local release checks are complete. Search is first; promotional headlines are removed and functional titles are compact. Current mobile cards/colors and full desktop shell are preserved. All **268 tests / 763 assertions pass**, locally and in the pinned native Linux ARM verification image with networking disabled. TypeScript, Vite and both Linux image builds pass. **39 browser groups pass**, including real installed-worker, offline, session/deep-link, network failure and feature-preview cases. Final assets: `index-CIJd4S-Z.js`, `index-DJ892ZD4.css`. The local amd64 cross-build hit the known QEMU segfault; native amd64 CI is checked after push. Full report: `docs/FRONTEND-FIX-REPORT-2026-09-09.md`.

Feature preview: **http://127.0.0.1:3194/** (`node src/browser/feature-preview.mjs`), using current components for Compare, fixed-batch Review/Next/Undo and personal notes/checks. Synthetic memory-only state, excluded from the production entrypoint. The preview process is left running for Yish. No authenticated production UI, actual handset/PWA gesture or real notification delivery has been claimed.

**Release complete.** Application commit `b45769831645dc1826a7df6bb9ce214086897675` and CI-only follow-up `59c1b556188530d87cddee3df1738d0e6c56d1dd` are on main and live. Railway status for GitHub deployment `6357466601` is **success**. GitHub Actions **`34394124805` succeeded**, including native amd64 268 tests / 763 assertions / 0 failures, TypeScript, Vite, both Docker builds and the network-disabled test container.

The initial CI run `34393742522` killed one existing isolated evidence fixture at its default 5000ms limit. The direct CI step now uses the same bounded 30000ms allowance as the existing Docker harness; assertions and production deadlines remain unchanged. The rerun passed in both the host and isolated container.

At **2026-09-09T19:20:23.560Z**, public production HTML references the tested assets and their bytes match: JS `index-CIJd4S-Z.js` SHA-256 `5e6cf738ca2224770dcd1bb9b7464a6b7443523fabc824ad9c5b3d3ecb33bded`; CSS `index-DJ892ZD4.css` SHA-256 `e0a2646fdfee56c143171e429750068df4dc0182837a1dd75961c0188559b636`. Worker/manifest match, unauthenticated feed/pulse remain 401. Health: engine **0.3.34**, database ok, **31,900 total / 28,791 usable comps**, scoring **0 pending / 0 failures**. Archive hash is unchanged. Full evidence: `docs/sessions/2026-09-09-frontend-fixes-release.json`.

No application work or release check remains for this pass. The final handoff/evidence documentation is saved locally after the release; it does not require another production deployment. The next product choice is which optional feature, if any, Yish wants from the current-style preview. The three older design alternatives remain unselected.

Yish prefers the existing Filtrsoft design to the three alternatives. **Do not implement A/B/C.** He asked to put search at the top, remove corny mobile headlines (use restrained functional titles where needed), **fix all bugs in the frontend audit**, and show a separate preview of possible features. This supersedes the layout-choice-pending checkpoint below. Work starts clean at `46abf65` in `C:\Dev\filtrsoft-backend`, `codex/frontend-redesign`. Root is the only editor; agents review bounded areas read-only. Plan and progress: `docs/FRONTEND-FIX-PLAN-2026-09-09.md`. Preserve the existing visual system and full desktop shell. Feature prototypes use examples, not live state. Production/database/crawl facts below remain historical until freshly checked.

### Current design exploration: 2026-09-09, audit and prototypes ready; layout choice pending

Yish requested a deeper frontend audit, mature mobile-app practices, useful features, and **different layout options to choose from before moving to a new design**. Work is in `C:\Dev\filtrsoft-backend`, branch `codex/frontend-redesign`, starting clean at `ff9bb8a`. Three agents reviewed structure, quality and feature feasibility read-only; root was the sole editor. The complete report is **`docs/FRONTEND-DEEP-DIVE-2026-09-09.md`**.

Three interactive prototypes are ready at **http://127.0.0.1:3192/**: **A Shortlist**, **B Market**, **C Workbench**. Start with `node docs/design-lab/serve.mjs` if the loopback server has stopped. They use static example listings and existing local photo fixtures. All prices, calls, comp counts and workflow state are labeled examples. No application APIs or account writes occur; state resets on reload. Root recommends **A as home + B Browse, then C's deal workspace once persistent state is ready**. A choice question was presented to Yish; the chosen design must retain his **full desktop app** requirement, not a desktop phone frame.

**10 prototype browser scenario groups passed**, covering mobile widths 360/390/430, the comparison studio at 375/768/1024/1440, menus/Back/focus, save/Undo/compare, exact saved-search criteria, explicit review/Undo/Next, notes/checklists/stages, reversible themes, OS/app reduced motion, landscape and text expansion. No uncaught page errors or application API requests. Run `node docs/design-lab/check.mjs`; evidence and visual review are in `docs/qa/design-directions`. These checks are static local prototypes, not authenticated production or a physical phone test.

The audit found real remaining frontend/API gaps: selected-channel math differs from the simulator; Saved errors can look empty; malformed Purchases errors can crash the app; OutcomePrompt sends `gone` instead of `dead_listing` and claims success before persistence; alert mutations lack reliable failure handling; saved-search names omit enforced category/source criteria; generic service-worker API caches lack private/account boundaries; purchase totals substitute asking price for unknown paid amounts. Navigation context, early evidence, photo overlay behavior and CSS consolidation also need work. The report separates reproduced cases, source-confirmed paths and proposed features. **These findings are not fixed in the application by this exploration.**

Application source, shared checkout, databases, archive, engine and dependencies remain unchanged. No new push or deployment occurred in this design exploration; prior production verification below is historical, not a fresh health measurement. Next: take Yish's layout choice, then the report's trust/interaction phases before adding the selected real UI and account-backed features. A review progress counter must use a captured batch because the live ten-item Review endpoint refills as labels are recorded.

### Current mobile refinement checkpoint: 2026-09-08 evening, pushed and live

Yish reviewed the first mobile design and asked for a more professional, compact app, crisp purposeful animations, small popup menus leading to full destinations, and **explicitly requested pushing to main so he can try it on his phone**. That deployment is authorized. Active branch remains `codex/frontend-redesign` in `C:\Dev\filtrsoft-backend`; root is the sole editor. Remote main was freshly fetched and remains the deployed ancestor. No archive, engine, database or dependency change is planned.

Implemented compact Discover header/search/review controls, a horizontal featured card on mobile, and shared animated popups for More/Account/Notifications/Sort/Filters/Your call. Menus lead to existing full screens; notifications remain unread until their full screen is opened. Popups trap focus, lock the background, restore focus/scroll, dismiss on Back/Escape/backdrop, and respect OS plus app reduced motion. Closed popup Forward entries no longer add an invisible Back stop. A successful review still refreshes if its request outlives the panel. Saved tabs now follow query navigation even when Saved is already open. No backend, archive or dependency source change.

Verification: **260 tests passed, 0 failed, 755 assertions**, both locally and inside the pinned Linux verification image with networking disabled. TypeScript, Vite, verification image and production image builds passed. **24 browser scenario groups passed** across the existing 15-group redesign harness and new 9-group mobile harness, with no page errors. First price ends at y=430 at 360px and y=425 at 390/430px; large counts fit, landscape panels scroll fully, keyboard/focus/reduced motion and delayed review saves pass. Screenshots in `docs/qa/mobile-polish` and `docs/qa/frontend-redesign` use a synthetic API, not production records. Local and Linux assets agree: `index-rSi9psDU.js`, `index-DJVdkxDg.css`.

**Application commit `c4515e31e94b6665d0e653ef6b0441cf06b1a1ff` was pushed to main and is live.** It includes the earlier full redesign (`05c877b`) and the mobile refinement. Non-force push advanced remote main from `7f9f2ea`; shared local main was preserved. Railway deployment **`cec4673c-a91a-4889-a27c-ac7f25a3476c` succeeded**. GitHub Actions **`34303262922` succeeded**, including full tests, typecheck, frontend build, both Docker builds and the network-isolated verification container.

At **2026-09-09T02:30:07.875Z**, public production HTML serves the tested assets, and both match local bytes exactly: JS `index-rSi9psDU.js` SHA-256 `1d11e6b22b0148d72b41ed2e43af261102efe03b3bb4aa511af549fd9a0cff9a`; CSS `index-DJVdkxDg.css` SHA-256 `e7dab7d37dd0ad2eddf6552c7cf82e8cabf8617118a4026e1318a107defafb8f`. Manifest and service worker return 200 with the correct content; worker text matches after expected Git CRLF/LF normalization. Unauthenticated feed/pulse remain 401. Health: engine **0.3.34**, database ok, 31,900 comps, 28,832 usable, original archive import/hash preserved, scoring complete with **0 pending / 0 failures**. Full evidence: `docs/sessions/2026-09-09-mobile-production-release.json`. Archive file SHA-256 remains `0285af42b39f7d9105882ba52591d311823b6b8cf790aa871161862b1ea3e635`.

The existing signed-in Chrome session was reloaded at a temporary 390x844 viewport. Live Review showed ten records; More opened the new panel, Settings opened its full page, and Back retained the prior feed query. The RTX 4090 detail rendered current evidence, Your call offered all five labels, and browser Back dismissed the panel before returning to the feed. **No real label, setting, subscription, account or seller action was submitted.** The viewport override was reset. This is browser mobile-size verification, not a physical-phone test; Yish can now test on his phone. Refresh an already-open page to load the new assets.

The application release is complete. This closing documentation and evidence are saved locally after the push; no application change remains unpublished. Shared checkout, databases, credentials and concurrent crawl work were preserved.

### Prior frontend checkpoint: 2026-09-08, first redesign before mobile refinement

Yish explicitly requested a **complete redesign**, **UI/UX Pro Max**, and a **full desktop app**. Work is on `codex/frontend-redesign` in `C:\Dev\filtrsoft-backend`, based on the completed backend audit (`fe95f89`; deployed code baseline `7f9f2ea`). The former desktop phone frame is superseded by this request. **This frontend redesign is local and has not been pushed or deployed.** Standing permission to push main and trigger Railway exists from the backend release; this turn presents the new visual direction for review.

- Rebuilt the desktop/mobile shell, sidebar and bottom navigation, discovery search/filter/sort, cards and featured listing, ten-item Review layout, detail photo/evidence columns, public landing page and authentication styling. Preserved the wordmark, verbal verdict labels, risk colors, API contracts and exact valuation guards.
- Added abortable detail requests with retry; corrected all five Your call options including FAIR; explicit sorting now retains server order. Entry-owned history restores Back/Forward and query-only navigation. Long feed restoration follows cursor pages beyond the server's 200-row limit, preserves scroll, recovers from reconnects, and stops expired cursor retries. Stream completion synchronizes the route. Network failures are distinct from empty results.
- Removed obsolete no-sign-in/device-only claims, the console filter, illustrative earnings claims, and promises that every listing/photo is read. The public illustration has no invented price or availability.
- Validation: TypeScript and Vite production build passed; 49 targeted Bun tests passed (151 assertions). The Node synthetic browser harness passed 15 scenario groups, including 48 app route/viewport checks across 360/375/768/1024/1440 and 844x390, plus public landing/auth, reduced motion, larger text, keyboard focus/dialog closure, sorts, 360-row restoration, request races, reconnects, FAIR review with a decision token, and synthetic SSE completion. No browser page errors. Read `docs/qa/frontend-redesign/checks.json` and `docs/FRONTEND-REDESIGN-PLAN.md`.
- Preview: `node src/browser/frontend-preview.mjs` serves built assets on **127.0.0.1:3188**, synthetic signed-in data by default; `/?preview=landing` shows the public page. It imports no API/database code. The harness is `node src/browser/frontend-redesign-check.mjs` on temporary port 3189. Existing repository test photos and synthetic records are layout fixtures, not production measurements. Preview process was left running for Yish to review.
- Only the root agent edited this worktree. Shared `C:\Dev\filtrsoft`, the original inventory worktree, shared databases and production were untouched. No crawl, manual vision, credentials, software install, seller message or production training label. The authenticated production workflow has not been re-tested for this redesign.


### Current checkpoint: 2026-09-08, production deployment verified

**Continuation check, 2026-09-08 evening EDT / 2026-09-09T01:11:35Z:** read the current checkpoint, implementation report/plan, operations runbook, committed release/backup/snapshot evidence and original audit. Remote main remains 7f9f2ea; remote audit branch and local worktree remain fe95f89, clean before this documentation note. Shared main remains e5a7023; its two modified-status frontend files have no content differences and were preserved. Fresh public health: engine 0.3.34, database ok, 31,900 total comps, 28,832 currently usable comps, 492 generically priceable SKUs, matching imported archive hash, scoring complete with 0 pending / 0 failures. Health still reports agent offline and billing disabled. No application code, database, browser worker, crawl, score, deployment or account state was changed for orientation. No additional implementation was selected; ready for Yish's next request. This continuation note is local documentation only.

**Final deployed main: 7f9f2ea84594e27836369d528bd4a6f2a1ad345f.** Railway deployment **82a81ba9-e8b6-443c-9b7c-a3a89a112450** succeeded. GitHub Actions **34265992387 succeeded**. Recheck at **2026-09-08T18:58:05.629Z** confirms engine 0.3.34, 31,900 comps, original archive import preserved, and **0 pending / 0 failed scoring**. The final JS asset /assets/index-P8UgZ_GF.js matches the local build byte for byte (SHA-256 7796dd8ec8d756e2e54c331c6e0035fa0b4f714ec850a0937fd74c11538b65e1); authenticated /c/4254 displays the corrected decision-comp wording.

All application changes are on main and live. This closing evidence-only checkpoint is saved on codex/backend-hardening after the deployment; it does not require another production redeploy. Shared local main is still e5a7023 with the same two modified-status/no-content-diff files preserved. No further backend implementation or release check remains for this audit; the explicit laptop/provider/data limits below are operational follow-ups.

This checkpoint supersedes the chronological implementation and release notes below. Yish explicitly authorized pinned dependency downloads and pushing to main for Railway deployment; do not request that approval again.

- All F01-F20 implementations and the inventory/Review work reached remote main in **52433cea248719354fe7b5389a97034dc3abe686**. That successful Railway deployment **d53d34f9-161e-4c7f-95d7-e950d576c0f9** was superseded by the final 7f9f2ea deployment recorded above. Engine **0.3.34**, **31,900 comps**, matching archive SHA-256, imported at 2026-09-08T13:48:30.409Z.
- Public production verification at **2026-09-08T18:51:35.276Z**: database ok, scoring complete, **0 pending / 0 failures**, 492 of 556 current in-scope SKUs generically priceable. Root/compiled JS/CSS return 200 and asset hashes match the local verified build; unauthenticated feed/pulse return 401. Every live listing uses 0.3.34 in the subsequent read-only database audit.
- GitHub Actions **34234175387 succeeded**. Pinned clean Linux amd64 install/build, 260 tests / 755 assertions / 0 failures, TypeScript, Vite, network-disabled test container and production image checks passed. First push 53738ec failed Railway Dockerfile parsing before build; 52433ce fixed the unsupported RUN network flag and deployed successfully.
- A real production backup and verified restore copy remain on /data/backups; identity/counts in docs/sessions/2026-09-08-production-backup.json. Same-volume recovery is verified; offsite coverage is not.
- Production comparison at **18:52:25Z**, using the backup's same 6,124 live-listing IDs: INSUFFICIENT_DATA **1,135 -> 1,200** before retirement exclusion, **1,185** among those still live. **99 repeated appliances** were retired recoverably by the normal scheduler (84 out-of-scope and 15 insufficient). Current complete population: 6,117 live, BUY 6 / VERIFY 35 / FAIR 38 / PASS 234 / RISK 77 / INSUFFICIENT_DATA 1,209 / OUT_OF_SCOPE 4,518. Continuous crawling/enrichment makes this an observed production comparison, not a controlled engine-only experiment. Earlier 76-retirement figures remain snapshot results only.
- Existing signed-in Chrome session verified the actual Review batch of ten, detail /c/4254 with four recorded matching-build comps, label controls and Back navigation. Opened and canceled controls; no fake label or seller message. Live comp copy incorrectly promised date sorting while provenance retained evidence order; final follow-up changes only wording to recorded decision comps. TypeScript/Vite and hosted CI passed; the final deployed follow-up is recorded above.
- **Laptop agent is offline**. Agent code is in remote main but the shared local checkout remains preserved; no browser worker reconnect/crawl was run. Billing remains disabled and live Stripe activation tests remain a prerequisite to enabling it. Existing production vision/crawl schedules continued automatically; no manual paid model request was initiated by release verification.
- Worktree C:/Dev/filtrsoft-backend, branch codex/backend-hardening. Shared C:/Dev/filtrsoft is not reset or updated. Read docs/BACKEND-IMPLEMENTATION-REPORT.md and docs/sessions/2026-09-08-production-release.json for final evidence and explicit limits.

### Historical checkpoint: 2026-09-08, local implementation and release progression


Yish read the complete backend audit and authorized implementation of all findings, with a structured plan and frequent handoff updates. This checkpoint supersedes older status/next-step claims below.

- Active worktree: **C:/Dev/filtrsoft-backend**, branch **codex/backend-hardening**, based on main e5a7023. Shared C:/Dev/filtrsoft and original inventory worktree are preserved.
- Saved inventory implementation e7863ae was reconciled into this branch as **6d3b804**. Only the version comment conflicted. Both predecessor changes use 0.3.33; new verdict work must receive a fresh engine revision.
- Implementation tracker: **docs/BACKEND-IMPLEMENTATION-PLAN.md**, all F01-F20 mapped to six phases and acceptance checks. Phases 1 and 2 are verified locally. F01/F02 core regressions are fixed locally: explicit parts categories, legacy storage interpretation and correct query suffix, canonical catalog names independent of aliases, strict brand/model/RAM layout/ECC variants, complete Ti Super/XTX extraction, and no sparse capacity/tier fallback to known mismatches.
- Engine is **0.3.34**, not deployed. RAM SKUs without explicit kit layout remain unpriceable; no kit layout was invented to increase coverage. Existing wrongly linked parts comps are rechecked against strict identity at valuation time.
- Verification: **260 tests passed, 0 failed, 755 assertions**; current TypeScript check passed. Vite production build passed again for the cursor client integration. No authenticated production UI run is claimed. The BUY-copy test uses its own synthetic prices/economics.
- F07 fixed locally: eligibility before delivery limits, account override and availability revalidation at send time, durable retry/terminal/delivered states, a 60-second claim lease, bounded backoff and a 15-second transport timeout. Only transport success writes alert_sent. Mocked tests cover starvation, 503 recovery, concurrent attempts, abandoned leases and terminal 410. A crash after remote acceptance but before acknowledgement can still retry; the existing service-worker per-listing notification tag replaces the same visible notification rather than promising impossible exactly-once transport.
- F11 fixed: job expiry and rolling vision/feed counts compare ISO T/Z timestamps consistently. Tests cover same-day expiry, midnight and exact TTL boundaries. Persistent agent heartbeats were completed in F12 below.
- F08 fixed locally: subscriptions/searches/test-send, overrides and purchases enforce session ownership. Existing unowned push subscriptions require possession of their exact browser subscription keys to adopt; the UI re-registers the browser-held subscription without a new permission prompt. Numeric IDs alone never claim a record. Legacy personal outcomes migrate only when one existing account makes ownership unambiguous; multi-account unassigned rows stay private for explicit reconciliation. Device refs retain their existing first-owner association.
- F04 core fixed: stored attributes and seller references reach the same pipeline as fresh facts; applicable vision survives text refreshes, and stale prompt/model or changed/incompletely hashed photo sets cannot supply cached evidence. Actual photo URLs replace dummy placeholders. Synchronous photo metadata preserves unchanged hashes; background jobs update only still-current URLs.
- F06 fixed for sweeps: accepted price observations atomically update both canonical/displayed asks and history, then create a durable listing_rechecks row. Stale observations and missing/zero prices do not reverse an accepted ask. The scheduler now also recovers listings with no verdict and clears successful rechecks. Broader sync and batch retry/cursor work was completed in F03/F09 below.
- Audit and evidence: **C:/Dev/filtrsoft-backend-audit-2026-09-07/BACKEND-AUDIT.md**. Audit measured 31,900 local comps versus 25,171 production comps at its recorded times, not current continuously updated counts.
- The current local archive now contains 31,900 comps / 559 SKUs / 35 retail quotes from the September 8 consistent snapshot; it replaces the older inherited 31,210-comp artifact. It has not been deployed.
- Existing dependencies are junctions; no installation. Tests, comparisons and migrations must use isolated database paths. No shared re-score, crawl, push or deployment has occurred in this implementation session.
- F03 verified locally: versioned destination-specific persistent outbox, exact per-change acknowledgement, replay protection, original capture/observation times, separate retirement precedence, preserved detail/hash evidence, portable matching vision and durable server recheck requests. Version 2 push acknowledges facts before background scoring/images; legacy push remains compatible but does not refresh an existing observation clock. Eight new regressions cover sync and enrichment. A disposable audit-snapshot copy queued all 461 Facebook, 440 OfferUp and 109 Mercari rows, including old/undated/retired entries. These were queue writes on a disposable copy, never production sends.
- F05 verified locally: photo reads use stored facts across sources without re-fetching marketplace pages or resetting last_seen; changed photos re-enter the queue and null analysis is counted as failure. Mercari gallery parsing requires the exact item ID on its observed CDN path; detail refreshes preserve hashes, timestamp evidence and enqueue scoring. Agent and daily runs flush facts after enrichment/probes. Paid model/browser transports were not exercised.
- F09 code verified: database triggers version pricing inputs on insert/correction/relink/delete, hourly expiry invalidation, per-listing durable scoring checkpoints and retry backoff, bounded 400-row scheduler passes, missing-verdict recovery and public completion/failure counts. Condition cache follows the same revisions. V2 archives use a consistent transaction, content hash/count manifest, atomic replacement with a previous copy, import ledger and mutation-clock-ordered comp corrections. Legacy archives remain readable and cannot overwrite newer corrections.
- F10 verified locally: retail imports are additive and exact-repeat idempotent even into nonempty tables; historical duplicates remain intact. Newest source availability wins before eligibility, known capacity/tier must match, and all corroborating quotes must be fresh. Consoles removed from retail priority.
- Phase 3 snapshot comparison: 4,416 live rows, zero failures, no retirement/apply. Before: BUY 12, VERIFY 27, FAIR 46, PASS 337, RISK 62, INSUFFICIENT_DATA 953, OUT_OF_SCOPE 2,979. After: BUY 12, VERIFY 34, FAIR 46, PASS 292, RISK 61, INSUFFICIENT_DATA 998, OUT_OF_SCOPE 2,973. This is the disposable copy of the audit snapshot, not production or the current shared database. Inspectable result: backups/tests/phase3-comparison-final.json. Coverage did not uniformly improve; strict evidence guards refuse unsupported configurations.
- Comparison caught and fixed GPU board vocabulary filtering laptops and bare mid-tower cases routing as whole PCs; both have regressions. A seller's explicit 5412GB remains unresolved, not silently changed to 512GB. The new laptop regression exposed getEconomics returning null in an unseeded DB; explicit test economics used, production/default economics handling remains F15.
- One test attempt was blocked by automatic review usage exhaustion before execution; Yish said continue, the retry was approved and all 236 tests passed. No reset redeemed or credits purchased.
- F12/F17 core verified locally: persistent agent presence, running heartbeats, owner-checked terminal job updates and stage records, durable retryable completion reports without stored authorization, bounded network/photo reads and provider deadlines, independent discovery/vision/thumbnail/scoring loops, 50-row scoring chunks, browser-profile ownership, and Windows process-tree cleanup in both agent and daily runners. Actual browser lifecycle/process-kill integration is not claimed tested; Node syntax, typecheck and isolated lock/route/timeout tests passed.
- Photo analysis uses per-task directories with owner markers; pruning skips live owners/symlinks, cleanup only clears its own paths, and legacy unowned folders have a 24-hour grace. Full galleries over 40 images or incompletely loaded galleries do not silently trigger a partial paid read. Probe attempts persist separate timestamps and exponential failure backoff; equal-priority rows advance by oldest probe. Undated feed/thumbnail rows use real observation/capture timestamps for freshness while postedAt remains null.
- Verification replaced a brittle source-string date test with a real authenticated feed plus thumbnail-expiry regression. Seven new isolated workflow tests; 242 total pass. No actual notification, provider login, browser launch, paid vision call, installation, shared edit or deployment.
- F13 verified locally: ingestion requires explicit eBay sold evidence and an unambiguous positive price/date. Undated, impossible/future dates, provisional/non-USD evidence cannot price listings or ship in archives. Rejected new rows enter comp_quarantine; existing ineligible rows remain recoverable through quarantined_comp_history. The historical provisional seeder now refuses without opening the DB. Historical eligible sales remain archived after the 90-day valuation window. Existing eBay raw soldAt is preserved as legacy parser evidence; new captures also retain the seller's sold line and capture time.
- F14 core verified locally: recentLinkedSkus is explicitly raw linkage; skusPriceable and category breakdown use actual generic used-condition valuation excluding console SKUs. This is not exact listing-configuration coverage. Collection records fetched/parsed/accepted/saved/error counts, prioritizes live unresolved exact-model demand then evidence freshness/coverage, and backs off repeated empty/duplicate-only/interrupted queries up to seven days. Vision backlog uses the actual current-photo eligibility function. The discovery-to-visible funnel was completed with decision provenance in F15 below.
- Disposable audit-snapshot measurement on 2026-09-08: total 31,900, currently dated/eligible 28,871, quarantined 0, exportable historical comps 31,900, generically priceable 492 of 547 in-scope SKUs. Artifact backups/tests/phase4-evidence.json. This is a copy of the September 7 03:43:53 UTC audit, not a fresh measurement of shared/production data. Health plus export plus ranking took 7.8 seconds; catalog coverage is revision-cached. No crawl or archive replacement occurred.
- F15 first batch verified locally: every new engine decision records exact selected comp observations and condition adjustments, facts hash/snapshot, engine/data revision, signals/match, vision hash and economics inputs/hash/scope. Details return explanation, comps and price from the same stored decision; explicit drive-time projections use one fresh calculation and remain unpersisted. Legacy decisions without provenance are identified as such, never paired with unrelated current comp rows. A missing economics seed uses the existing documented defaults. Concurrent personal checks cannot overwrite canonical feed decisions; one-shot fetch coalescing shares only canonical work. Check bodies and drive bounds are validated before execution. Two new regressions preserve evidence across comp corrections and isolate simultaneous economics.
- F15 pagination verified: feed eligibility/labels/discovery filters run across the complete population before paging. Account/filter-bound 30-minute cursor windows freeze membership/order while rechecking current eligibility; arrivals do not shift page 2 and retired rows disappear. Client follows cursors and reloads expired windows; stale fetch responses cannot overwrite a newer filter. Pulse uses monotonically ordered first-eligible verdict IDs, filters account labels before limiting, drains 20-row pages including same-timestamp bursts, and ignores ordinary re-scores of already-eligible listings. Input bounds include feed/check/drive/outcomes; legacy offset/since remain accepted, updated client uses cursors.
- F14 full stage funnel now reported: one 24-hour capture cohort with described/photos/recorded identity/usable valuation/scored/base feed/synced/acknowledged-alert counts, observed first-score latency p50/p95, unscored backlog/oldest capture and persisted agent stages. Missing sync/provenance stays unknown, and definitions distinguish generic evidence, base feed eligibility and per-account Review visibility. No conversion or delivery success is invented.
- Three new regressions cover a 1,210-row feed, mid-pagination insert/retirement, a 51-row pulse burst with five excluded personal labels, and observed funnel/input semantics. Synthetic positive sold dates were moved one day into the past to avoid subsecond clock-skew flakes at the future-date boundary; future-date guards remain strict.
- F16 verified locally: whole-build evidence distinguishes GPU-family towers from at least three comps explicitly matching CPU/GPU/RAM/storage together. Broad family estimates remain low confidence; parts fallback records the original weights, ratio and unpriced roles. Both uncertain methods return INSUFFICIENT_DATA rather than actionable profitability. Existing dollar weights, whole-unit ratio and local/channel policy remain unchanged. Exact CPU suffixes are preserved. Motherboard/PSU/case lookup now uses its actual catalog category in parts evidence. This is an evidence guard, not a claim of market calibration.
- F18 verified locally: labels create append-only judgment history with the displayed decision/facts/economics snapshot. Account-bound expiring decision references link detail/stream views to labels; fallback callers bind the canonical decision at record time. Clearing an active label removes it from current evaluation without deleting history. Engine revisions append rather than rewrite referenced historical verdict versions. Outcomes bind contemporaneous decision/SKU; disappearance records observed ask in its own field with sold price null. Legacy inferred asks remain preserved but excluded from sale calibration by evidence kind. Reported transactions alone drive price error, and realized margins require known costs. The score script evaluates current account labels with false BUY weighted five; --replay uses frozen inputs and requires an explicit disposable FILTRSOFT_DB; --export freezes the regression set. No paid call or real outcome was recorded.
- Validation: three new isolated cases cover mismatched vs matched whole builds, displayed personal-label snapshots surviving later scoring, and disappearance vs reported resale calibration. TypeScript and Vite build passed. No claim that historical labels have been fully backfilled or pricing weights calibrated; legacy labels without recorded inputs are reported unavailable for replay.
- The feed client cursor file is tracked as web/src/feed.tsx (lowercase). Its verified local edits were missed by an earlier uppercase path-specific stage on Windows; they are included in this batch. Use the tracked case from git ls-files when staging.
- All F01-F20 now have local implementations and evidence. Final report: docs/BACKEND-IMPLEMENTATION-REPORT.md. Release checks remain explicit there; all work remains local, engine 0.3.34.


- F19 verified locally: unique WAL-consistent backups, integrity/hash manifests, restore rehearsal before publication, refusal to overwrite restore targets, verified-only retention, explicit secondary-copy failures. Docker/CI pin installed Node 24.15.0 and Bun 1.3.14 and require both lockfiles. Clean-install CI and pinned-image Docker build remain unrun; images are not cached and no installation/pull occurred. Runbook: docs/BACKEND-OPERATIONS.md.
- F20 verified with synthetic transports: authenticated customer ownership, stable checkout retry keys, current-subscription checks, signed-event verification, durable event status/attempts, retryable 503 responses, per-customer lease fencing and authoritative out-of-order reconciliation. Legacy customer bindings require verified reconciliation; no Stripe calls or billing activation occurred.
- The old manual ingest script now preserves unchanged photo hashes, carries seller references, bounds galleries and refuses partial/changed paid reads, matching the modern pipeline's guarantees. It was typechecked; no live ingest or paid vision was run.
- Final shared Git inspection: main remains e5a7023 and has uncommitted web/src/detail.tsx and web/src/types.ts changes. Preserve them; inspect overlap before integration. The shared database remains untouched. Those modified-status files show no content diff; preserve their index/worktree state. The final current snapshot/archive/comparison/restore and build are now complete.

- Final comparison on facts-v2.db/comparison-v3.db: 4,456 live, zero errors. BUY 12 -> 6; VERIFY 27 -> 33; FAIR 46 -> 38; PASS 338 -> 233; RISK 62 -> 61; INSUFFICIENT_DATA 961 -> 1,081; OUT_OF_SCOPE 3,010 -> 3,004. Excluding 76 appliance candidates gives 4,380 live and 1,069 insufficient. These are snapshot/projected cleanup results; no shared or production apply. Six former BUYs lacked matching build configuration, one was an Omen laptop misclassified from a desktop replacement sentence. That routing error is fixed and tested. A new BUY has four explicit matching build comps. See the final report for IDs and limitations.
- Final archive manifest: 0f1a2363ffdbf3ac458ddcbe47d9e182052106f222d57aa20cb03afbe4a9386b, 31,900 comps / 559 SKUs / 35 retail. Fresh old-to-new import adds 6,729 comps and 125 SKUs; second import changes zero rows, zero skips, integrity ok. Generic coverage 492/547 in-scope SKUs, 28,871 date-eligible comps, zero quarantine. Snapshot backup/restore hashes/counts match, 16,531 verdict rows retained, zero FK violations.
- The first filtered snapshot omitted the migration ledger and replayed historical deduplication on its disposable copy. Final facts-v2.db/comparison-v3.db include schema_migrations. Ignore earlier facts.db/comparison.db/restore-drill.db for final evidence. No original data was affected.
- Public production health at 2026-09-08T12:54:33Z: engine 0.3.33, 25,171 comps, 443 runtime SKUs, September 5 archive with 434 SKUs; billing disabled. Production still lacks this branch and its archive. Health readiness now follows actual suitable-evidence priceability; stale/raw counts cannot report canPrice=true.
- Next release steps: clean-image/CI verification (pinned images are not cached; no installation/pull performed), verified production backup coverage, one explicit authorization for pushing to main and the Railway production deployment, then authenticated production and agent checks. No automatic push, deployment, paid action or provider activation. The earlier main-push approval rejection has not been bypassed. Runbook: docs/BACKEND-OPERATIONS.md; final evidence: docs/sessions/2026-09-08-backend-evidence.json.

- Release authorization: Yish explicitly approved downloading pinned build dependencies and pushing to main to trigger Railway production deployment on 2026-09-08. Do not ask again. Current release work: clean amd64 production image built with both frozen lockfiles; separate verification stage includes frontend test dependencies without shipping them in the serving image. Under ARM-host amd64 emulation, fixture timeouts need 30s at the harness level; production deadline guards stay unchanged.
- Railway existing browser session verified: managed backup page is unavailable on the current plan; do not purchase an upgrade. A full production WAL-consistent backup and restore copy were created on /data/backups before deployment; integrity/hash match verified through the existing service console, with 25,171 comps, 443 SKUs, 6,192 listings, 20,488 verdicts, 69 judgments and 1 outcome. This is a real production rollback copy, separate from the earlier filtered local snapshot; it is on the same volume, not offsite.

- Release checks complete before push: pinned Linux amd64 images downloaded with authorization; both lockfiles enforced. Dedicated Docker verification runs all 260 tests / 755 assertions with network disabled. Serving-image smoke proves engine 0.3.34, 31,900 imported comps, matching archive manifest, 492 priceable SKUs, compiled JS/CSS HTTP 200 and private unauthenticated routes HTTP 401. Full production rollback identity is in docs/sessions/2026-09-08-production-backup.json. Push is authorized and next; do not reinterpret older permission-pending notes as a new approval requirement.

- First authorized push succeeded: 53738ec reached main. Railway deployment 9471bcd2 failed before image build because its parser rejects RUN --network=none even in the unused verification stage; old production stayed online. Fix: verification target uses CMD and CI runs it with docker run --network none. The already-passed test command, frozen dependencies and serving image are unchanged. No Railway settings or backup plan changed. Retrying the authorized deployment after checking the portable Dockerfile.

### Current checkpoint: 2026-09-06, late evening

**This checkpoint supersedes the historical counts and pending tasks below.**
Work was isolated in `backups/worktrees/placeholder-inventory`, branch
`codex/placeholder-inventory`, because another session was editing the comp picker
in the main checkout. Do not overwrite that session's ongoing crawl work.

- Engine **0.3.33** adds itemized placeholder-price handling. The preceding
  **0.3.32** re-verdict already happened: commit `ee9c3d8` measured local live
  INSUFFICIENT_DATA **1,007 -> 988**. The old "not bumped" warning below is history.
- `918567a` already retired **83 shop advertisements locally**. This pass adds
  recoverable retirement for repeated household appliances: **76 candidates**,
  requiring at least four Craigslist copies at the same price AND an appliance
  noun, with a separate computer/GPU exclusion. MacBook and Gaming PC duplicates
  survive. The scheduler runs the same cleanup on production before re-verdicting.
- **Shipped archive prepared: 31,210 comps / 559 SKUs / 35 retail quotes.**
  Production health at **2026-09-07 03:10 UTC** still reported engine 0.3.32,
  25,171 comps and the September 5 archive. Local comp counts are NOT production
  counts. Check `/v1/health` after deployment before claiming these are live.
- On an isolated, consistent database snapshot, importing that archive,
  re-scoring and retiring the 76 appliance rows produced **4,340 live listings**:
  BUY 13 / VERIFY 25 / FAIR 42 / PASS 334 / RISK 62 / INSUFFICIENT_DATA 949 /
  OUT_OF_SCOPE 2,915. Baseline: 4,416 live and 988 INSUFFICIENT_DATA. Of the
  39 fewer can't-tells, **27 got priced using new comps and 12 were appliances**.
  There were zero failed re-score checks. These are snapshot measurements,
  not an assertion about production's independently crawled inventory.
- The default feed is now **Review**, up to **10 priced, unreviewed live rows**.
  BUY / VERIFY / FAIR / PASS qualify. Your existing `Your call` label removes
  the item from this batch, including an agreement with the engine. Removing
  that label makes it eligible again. All / Buy it / Verify / Risky still serve
  their full populations. No listings are deleted to make this batch.
- Placeholder inventory now exposes item, quantity, asking-price basis and the
  seller's exact quote. Four real ads yielded **43 offer rows**: #590 14,
  #648 3, #651 12, #1984 14. #590/#1984 are repeated watercooling inventory.
  **None has matching sold comps**, so all four correctly remain can't-tells.
  A per-stick tier or price range is never guessed into one total. Memory
  valuation requires brand, generation, speed, total capacity AND explicit kit
  layout; the current catalog does not establish the latter for these offers.
- Tests: **203 passing**, TypeScript check and Vite build passed; inventory
  visually inspected at 360px using the built stylesheet. No paid vision run.

**Next data-quality investigation:** the new `ram` / `psu` / `motherboard` /
`case` catalog categories are not consistently recognized by `resolveCategory`.
It can still report `component` for bare RAM or SSDs, while `compMatchesQuery`
requires category equality. The live backfill log showed 122 WD SN850X rows
rejected and zero saved, and storage SKUs currently get a `desktop memory`
search suffix. Correct this taxonomy/search mismatch with product-specific
regressions; do NOT relax variant, unit, or whole-machine comp guards.

See `docs/sessions/2026-09-06-inventory-review.md` for the photo discrepancies,
the remaining placeholder population, commands and validation limits.

The sections below are historical unless explicitly superseded above.

**Measured 2026-09-06, after the parts pass:**

| | |
|---|---|
| engine | **0.3.31** |
| comps | **28,546** |
| SKUs | **559**, of which **446** have comps |
| live listings | **4,499** |
| live verdicts | OUT_OF_SCOPE 3,049 · INSUFFICIENT_DATA 1,013 · PASS 313 · RISK 62 · FAIR 39 · VERIFY 21 · BUY 7 |

⚠ **The verdict counts above are BEFORE a re-verdict pass.** The 2026-09-06
session added 5 whole component categories, 39 build SKUs and ~3,400 comps, and
fixed three bugs that were silently discarding good comps — but `ENGINE_VERSION`
was NOT bumped, so nothing has been re-scored against any of it. **Bumping it is
the single highest-value action available**, and until someone does, the
INSUFFICIENT_DATA number means nothing.

### 0a. What "can't tell" actually is — his guess was 10% of it

Yish: *"the cant tells start around listing 200 out of 1000 ... so a solution to
this could be to just get more comps and get a ton of them."* Comps were the
obvious answer and the smallest bucket. Measured over 1,193:

| count | why | what fixes it |
|---|---|---|
| 692 | a spec is not STATED — storage 326, gpu 162, cpu 133, ram 71 | vision + descriptions |
| 384 | no model could be matched at all | catalog + matcher |
| 117 | genuinely no sold comps inside 90 days | more comps |

**Then running vision showed even that was too optimistic: 122 photo reads
produced 2 verdict changes.** Vision was never the problem — see §0c.

After the session: **INSUFFICIENT_DATA 1,229 -> 1,005**, almost entirely from
dropping consoles (§0d). The two remaining buckets are **384 "exact model"** and
**~250 storage**.

### 0b. Over half the actionable feed was a scam farm

Yish spotted it by hand before the engine did: *"all of them were $66 or $85 or
$67 ... the titles were too perfect like Iphone 14 Pro Max Blue 128gb VXG9I."*
**34 of 59 BUY/VERIFY listings matched.** Every one ended in a random 4-6
character token and asked 3-29% of its own comps.

`src/verdict/scam.ts`. **The token alone never convicts** — a real Gigabyte card
titled `... 32G GV-N5090` ends in a part number at 0.59 of market. Two traps
already paid for: Intel part numbers (`i7-8565U`) are the same SHAPE as farm
tokens and must be excluded explicitly, and separating words from noise by
looking for a vowel lets `SAQR` through as a word.

VERIFY 52 -> 23, RISK 35 -> 69, BUY 7 unchanged.

### 0c. Vision read the GPU off the photo and the engine threw it away

**Remember this one, because every observable said vision was broken and vision
was fine.** It read a Dell OptiPlex 7080 perfectly —

    gpu: "Intel UHD Graphics 630"   cpu: "Intel Core i5-10500T"
    ram: "8GB"                      storage: "119GB"

— and the verdict still returned **"Can't be valued: gpu not stated."** The
accepted vocabulary in `signals/index.ts` was
`integrated|igpu|iris|radeon graphics`, missing the most common integrated GPU
on earth, plus `HD Graphics`, `Vega 8`, `Arc`, and the plain statement that a
machine has no card in it. **We paid for the read and discarded the answer,
which is worse than never reading it.**

Also added: **a micro-form-factor office desktop has nowhere to PUT a GPU.**
OptiPlex Micro, ThinkCentre Tiny, EliteDesk Mini, NUC — one-litre boxes with no
PCIe slot. 28 of the 157 gpu-blocked listings were these. Same shape as the
Apple rule beside it: a field only makes sense for products that have one.

gpu-blocked 157 -> 132.

⚠ **`bun run vision` runs the pass LOCALLY and is not redundant with the
container loop.** `visionPass` re-fetches each listing to reach its photos, and
**338 of the 692 are on Facebook, OfferUp or Mercari, which Railway cannot fetch
at all** — which is why `visionCandidates` deprioritises them. This machine has
the browser and the sessions. The shared `vision_spend` ledger is checked before
EVERY listing, so local and container runs cannot together exceed
`FILTRSOFT_DAILY_BUDGET_USD`. Per-run count is 10 (was 3); ~$0.008 a read.

### 0d. Consoles are out entirely

Yish: *"get rid of all the consoles on the app they are hard to resell. I dont
want ANY consoles on it."* **224 of the can't-tells were consoles.**

⚠ **The `CONSOLES` check is NOT gated on `!match.skuId`, unlike every other
exclusion beside it.** That gate is right for the rest — a matched SKU is
evidence we cover the thing — and exactly wrong here, because consoles ARE in
the catalog with comps and their own `VALUE_FIELDS` entry. An Xbox Series X
matches a SKU and would sail straight past a rule written to exclude it.

It takes **games and controllers** with it, intentionally. `ps5` and
`xbox series` were also removed from `DEFAULT_QUERIES` in `marketplace-crawl.ts`.

**VR is deliberately NOT in the list.** A Quest is a headset, not a console, and
he named consoles. One word each if he ever says so — his call, not one to slip
in under this rule.

### 0e. Alerts existed but could never fire

Yish: *"the entire point of the app was to send me a notification when there is
a buy and a verify first but its still not working. this may be because the
alerts only work for custom alerts that i make."* He diagnosed it exactly:
`runAlerts` iterates `saved_searches`, and health showed **3 subscriptions, 0
saved searches** — the loop body had never run once.

A standing ROW rather than a parallel code path, because dedupe (`alert_sent`),
the `created_at` backlog guard, dead-subscription cleanup and `matches()`
already work on rows.

- **`created_at` is NOW, not the subscription's date.** Backdating fires one
  notification per historical match on ship — about thirty — and the existing
  comment on that guard already records what happens next.
- **The standing row cannot be DELETED, only narrowed to Buy-it-only.** Delete
  returns the device to silence through a control that looks like tidying up.
- **The lock-screen title names the CALL.** "Buy it" vs "Verify first" is the
  entire decision.

Health now separates `push.usable` (VAPID keys load) from `subscriptions` /
`standingAlerts` / `lastAlertAt`. It reported `usable: true` the whole time
alerts did not work.

### 0f. Sold listings, and the probe that was wired to nothing

`bun run probe` was built on 2026-08-28 for this exact complaint and **called by
nothing**, so it only ran when someone ran it by hand. Meanwhile the server-side
sweep covers **Craigslist only** (`tracker/index.ts` filters
`source = 'craigslist'`, because the rest need a logged-in browser) — so
Facebook, OfferUp and Mercari were never checked for being sold by anything at
all. It is a step in every crawl now.

**Both probe queues sort by what he can ACT on before staleness.** They were
ordered dustiest-first, which spends a bounded budget on whichever rows happen
to be oldest: all seven Facebook VERIFY listings had gone unchecked for over two
days while unpriceable monitors were probed. 34 sold listings retired.

### 0g. Mercari: dead for nine days, reporting "ok"

**Mercari had produced 10 listings ever, all on 2026-08-26.** Cause: a Cloudflare
interstitial — "Just a moment...", a Ray ID — served to headless Chrome. The
scraper read that as "the search returned nothing", for every query, and
**exited 0**, so the agent reported `mercari: ok` over a source reading a block
page.

- The worker detects the challenge by title and body and emits an ERROR naming
  the page.
- `marketplace-crawl.ts` exits **3** when every query returns zero LINKS. Gated
  on links, never on parsed cards — a search returning 200 brackets and RGB
  strips with nothing in scope is a normal day.

⚠ **HEADED IS REQUIRED EVERY TIME, NOT ONCE.** A headed run does NOT leave a
clearance headless can use. Measured back to back on the same profile: headed
read 28 links per query, headless immediately afterwards read zero and was
challenged seven of seven. Cloudflare fingerprints the browser, not a cookie.
`mc:crawl` runs without `--headless` in the agent for this reason alone.

**`mc:detail`** is the Mercari equivalent of `ou:photos`: a search card carries a
title and a price and nothing else, so the first working crawl produced 99
listings of which 90 were INSUFFICIENT_DATA. Descriptions **0 -> 97 of 109**.

⚠ Its parser reads **backwards from the LAST "Description" heading**. The item's
own text sits ~300 lines down, under checkout copy and a "Similar items"
carousel repeating dozens of OTHER listings' titles and prices. Scanning
forwards gets a competitor's listing.

### 0h. Crawling without being asked, and windows that stay out of the way

- **The server queues a crawl by itself every 45 minutes** (`autoQueueCrawl`),
  but ONLY while an agent is actively polling — otherwise it builds a pile that
  all fires at once when his machine next boots, three crawls against one
  browser profile.
- **`bun run agent:install`** puts a launcher in the Startup folder so the agent
  starts at logon and restarts itself if it dies. **The Startup folder, not
  `schtasks /SC ONLOGON`** — that needs admin and fails with a bare "Access is
  denied". The session matters: a task that runs whether or not the user is
  logged on gets session 0, which has no desktop, and Mercari's headed Chrome
  would hang until the agent's 12-minute timeout. **Never as SYSTEM** — the
  Chrome profiles holding the logins live under this user.
- **Automated browser windows launch at `--window-position=-32000,-32000`.**
  Headless is not available (Mercari), and `--start-minimized` is not a real
  Chrome flag — Chromium ignores it, so the window keeps stealing focus while
  looking configured not to. Measured: `screenX=-16384` with it, on screen
  without. `fb:login` and `ebay:login` pass `background: false`, because a
  sign-in he cannot see is one he cannot complete.

### 0i. WAL, because one lock killed a 120-listing probe

A Facebook probe died at ~40 with `SQLITE_BUSY: database is locked` — a comps
backfill was writing — after having already retired 13 sold listings, and threw
away the rest. Several writers against one file is the NORMAL case here.

    journal_mode = WAL    readers and one writer proceed together
    busy_timeout = 5000   "locked" becomes a wait, not an exception

SQLite's default is `busy_timeout = 0`, i.e. fail instantly. The probe also no
longer loses a whole run to one failed write.

### 0j. Hardware — the always-on question

Facebook needs a logged-in session, so background crawling needs a machine that
is on. **Yish has waived both the credential-location and account-ban concerns.
Do not re-raise them.** His hardware, and the ranking:

- **Surface Pro (gen 5 or 7) — recommended.** Windows, so this codebase runs
  unported: profile paths, the `taskkill /T` process-tree kill, the
  Startup-folder installer.
- **2015 MacBook Air — works, needs porting.** `CHROME_PATH` default, a launchd
  plist instead of Startup, and the POSIX branch of the tree-kill has never been
  exercised. An hour or two.
- Leaving his desktop on already works today.
- A VPS with the session copied up plus a residential proxy is the only
  genuinely fragile option — expect to re-copy the session periodically.

### 0k. Open, and what he asked for next

**Historical queue, now superseded by the current checkpoint above.**

1. **RE-VERDICT EVERYTHING.** Bump `ENGINE_VERSION` past 0.3.31 and let
   `reverdictStale` re-score production. Five new component categories, 39 new
   build SKUs, ~3,400 new comps and three fixed comp-discarding bugs have all
   landed since the last scoring pass, and **not one listing has seen any of
   it.** Measure INSUFFICIENT_DATA before and after; do not assume it drops.
2. **Dealer spam — 151 listings across 45 repeated ads.** One Craigslist
   reseller posting microwaves, ice makers, washing machines and food
   processors into the electronics category, the same title 4 to 14 times each
   at a fixed price with 20+ showroom photos. Bigger than the furniture pile
   was. Detector is cheap: identical title, same seller, 4+ live copies.
   **Authorization corrected:** Yish's pasted brief explicitly authorizes
   recoverable retirement. Repetition still requires independent non-tech or
   inventory-ad evidence; it never justifies deleting real repeated devices.
3. **50 listings whose ask is a placeholder.** "Ram For Sale" at $1 carries
   `1x32gb DDR4-2400 $100 / 2x32gb $200 / 8x32gb DDR4-2666 $800` in the
   description with five photos. Yish, 2026-09-06: *"this is the exact scenerio
   where you need to go into the description and images and figure out what ram
   it is if you want to price it out."* Most of the 50 are dealer ads (see 2),
   but the genuine ones are real inventory the engine currently throws away.
4. **"Limit it to around 10 listings"** so he can start training the engine on
   what tech to skip. He was explicit this comes AFTER the can't-tells. Not done.
5. **`www.filtrsoft.com`** needs the Railway custom domain plus a Namecheap
   CNAME. The app already 301s it to the apex.
6. **Google / Apple sign-in are off.** Google needs `GOOGLE_CLIENT_ID`; Apple
   needs the paid membership. No password reset — that needs outbound email.

### 0l. The logo — 2026-09-05, SHIPPED

Nine options were drawn and shown at real sizes:
`docs/20260905-logo-options-preview.html`. Yish picked **01 The Cut** with the
brand gradient on the dot of the i — *"i want 01 filter and a gradient dot on
the i uncapitalized f filtrsoft"*. **That page is a record now, not a menu.**

**The mark is three shapes: a wide bar, a narrower bar, one rounded square.**
Wide, narrower, the one — 4,482 live listings down to the 28 worth driving for.

**⚠ THE BOTTOM SHAPE IS A SQUARE, NOT A THIRD BAR.** Three narrowing bars is the
generic filter glyph that ships in every data table on the internet, *including
the filter control in Filtrsoft's own feed toolbar*. The square stops being part
of the stack and starts being the thing the stack produced. Simplify it back to
a bar and the logo collides with a button.

**`web/src/brand.tsx` is the only definition of either.** The wordmark had been
literal JSX in five places (App.tsx once, landing.tsx four) and the icon was
hand-made, which is how it was still painting an August orange after the palette
changed. Three files draw the mark now — `brand.tsx`, `web/public/icon.svg` and
`src/browser/make-icons.mjs` — all on the same 24-unit grid, with no build step
deriving one from another, so **the numbers should be character-for-character
identical in all three.**

**Two inks, deliberately.** In the app the bars are 40% and 75% of the muted ink
so the logo *loses* the fight against the BUY and VERIFY chips one line below
it. The standalone icon has nothing to defer to and uses 55% and 85% white,
because at 16px the in-app opacities are dust.

Three traps this cost, none of which were visible by reading the code:

- **AN INLINE SPAN AROUND A SINGLE LETTER HAS WIDTH 0.** Chrome shapes text
  across inline element boundaries, so in `f<span>i</span>ltrsoft` the span's
  box is zero wide, its background has no area to paint, and both layers
  silently do nothing — while devtools reports `background-clip: text, text`
  and the right sizes. The letter just renders plain white. `display:
  inline-block` on `.wmi` is the fix and it is load-bearing.
- **TWO HYPHENS IN A ROW ARE ILLEGAL INSIDE AN XML COMMENT.** The first
  `icon.svg` carried a comment naming the CSS custom properties it copies, and
  every one of those starts with two hyphens, so the document was malformed and
  Chrome refused it. Every PNG beside it kept working, so the only symptom was
  a broken favicon. Name the tokens in prose in that file, never with their
  leading hyphens.
- **A flex `gap` on `.brand`** splits `filtr<span>soft</span>` into separate
  flex items and prints a hole through the middle of the word. The mark carries
  its own margin instead.

**The tittle is a BACKGROUND STOP, not a dotless i.** Swapping in U+0131 and
drawing a square over it looks identical and puts *"fıltrsoft"* into copy-paste,
find-in-page and the accessibility tree. Instead the real "i" stays and two
background layers are clipped to the glyph — gradient over the top `0.46em`,
flat ink under everything — with the seam landing in the blank gap between the
tittle and the stem. **0.46em and the -0.028em `fi` kern compensation are
measured by `scripts/measure-tittle.mjs`, not eyeballed. Re-run it if the
heading font ever changes**, or it silently paints half a stem.

`scripts/shot-preview.mjs` renders any local preview headless and reports font
load, dangling `<use>` refs and console errors. It exists because the Claude in
Chrome extension was not connected, and every one of the three traps above was
found by looking at a render rather than at the source.

### 0m. The engine could not price RAM, storage, PSUs, boards or cases

**2026-09-06. The biggest correctness gap the project has had, and Yish found
it, not the app.**

He said a 2TB NVMe was $300+; I said $90 from memory. He was right. The reason
the app could not correct me is the reason this section exists:

- The `component` category was **56 CPUs and nothing else.** No RAM, no
  storage, no motherboards, no PSUs, no cases.
- The comps crawler is driven by the SKU catalog. It had run **382 queries, all
  GPUs, phones, MacBooks and prebuilts.** It never asked eBay about memory.
- So all 25,171 comps were real and none of them answered the question. Every
  "2TB NVMe" row in the database was a whole machine (a 2019 iMac, a Dell
  Inspiron) whose title happened to name the spec.

**A bill-of-materials estimate built from a model's priors is fiction.** Get the
price from the comps, from `bun run retail`, or from Yish.

**Now in the catalog:** `ram` 20, `motherboard` 12, `psu` 9, `case` 7, plus CPU
gaps filled (Intel Core Ultra, 10th-gen-and-newer i3/i5/i7/i9, AMD 5000 / 7000 /
9000 Ryzen 5/7/9). 559 SKUs, 446 with comps, 28,546 comps.

**Measured prices, eBay sold, so nobody quotes these from memory again:**

| part | n | new | used |
|---|---|---|---|
| Kingston Fury Beast 32GB DDR5-6000 | 110 | **$419** | **$350** |
| 1TB NVMe M.2 | 97 | **$150** | **$118** |
| Ryzen 7 9700X | 79 | | **$239** |
| RTX 5070 bare card | 62 | $700 | $600 |
| RTX 5070 Ti bare card | 106 | | **$948** |
| RTX 5080 bare card | 111 | | **$1,325** |

#### Three bugs that were silently throwing away correct comps

**A UNIT IS NOT A VARIANT.** `compMatchesQuery` required a non-alphanumeric
character right after any number in the query, so `i5-8500` could not match
`i5-8500T` — correct, different chips. But eBay writes memory speed as
`6000MT/s`, so the token `6000` read as a prefix of another variant. **One Fury
Beast pull returned 122 rows and this rejected 81 of them, every one correct**,
including `Kingston FURY Beast 32GB (2x16GB) DDR5 6000MT/s` at $405 and $549.
Fixed with a `UNIT_SUFFIX` allowance in `src/sources/ebay.ts`; the same query
then rejected 8, all genuinely different products. NOTE: `t`, `x`, `s` and `w`
are deliberately ABSENT from that unit list. They are exactly the letters that
separate real parts (8500T, 5800X, 265F).

**A WHOLE MACHINE OFTEN NEVER SAYS "PC".** The `partLike` filter in
`valuation/index.ts` drops comps whose head noun is a machine word. Real comp
stored against the `HP OMEN 45L` case SKU:

    $680  HP OMEN 45L GT22-0182 | AMD RYZEN 9 5900X | 1TB | 32GB | NO OS

No head noun to catch, just an OEM model number. It became the ONLY comp for
that SKU, so a case worth about $180 was priced at $680. The reliable signal is
the **spec list**: a bare part names its own spec, a machine enumerates what is
inside it. Two or more different component FAMILIES in one title means machine.
It counts families, not mentions, so "Samsung 990 PRO 1TB NVMe" (storage twice)
and "Kingston Fury Beast 32GB DDR5-6000" (memory three ways) both stay parts.

**`queryForSku` HARDCODES A SEARCH SUFFIX PER CATEGORY.** `component` appends
"CPU processor". A RAM SKU filed as `component` would search eBay for *"Corsair
Vengeance 32GB CPU processor"*. A new category needs its own suffix there or it
silently collects garbage.

### 0n. One switch to stop every crawl on this laptop

Yish, 2026-09-06: *"sometimes I want to conserve battery or im doing something
on my computer that wont allow popups ... there should be like 1 shortcut or
button on my computer to turn it on and off."*

**Desktop shortcut "Filtrsoft Crawls"** runs `scripts/toggle-crawls.cmd`, which
runs `bun run pause`. Double-click stops it, double-click starts it, and it
prints which state it landed in. Flag file: `~/.filtrsoft/paused`.

**TWO SCHEDULES RUN HERE, AND A SWITCH THAT CAUGHT ONE WOULD BE WORSE THAN
NONE**, because it would look like it worked:

1. `Filtrsoft Agent.cmd` in the **Startup folder** — loops forever, polls
   `/v1/jobs/next` every 15s, runs whatever the server queued. The server
   queues a crawl every 45 min but ONLY while an agent polled inside
   `AGENT_FRESH_MS` (120s).
2. The **`Filtrsoft Daily Crawl` scheduled task at 10:00** — runs `daily.ts`
   DIRECTLY and never asks the server for a job.

Both read the flag. Verified: paused, then `bun run daily` exited with
`daily: PAUSED - skipping` instead of opening a browser.

**PAUSED MEANS THE AGENT STOPS POLLING, and that is the mechanism rather than a
side effect.** `/v1/jobs/next` hands a job out exactly once, so
polling-and-discarding would drain the queue and bin the work. Going quiet means
the server stops seeing an agent and never queues anything. **The visible cost:
the app shows the agent as OFFLINE while paused.** That is honest, and the
toggle says so on screen.

Pausing also closes any crawl browser already open, matched on the
`~/.filtrsoft` profile path in the command line and **never on the image name**,
or it would close his own Chrome with every tab in it. `taskkill /T`, because
Chrome is a process tree and a surviving renderer keeps the profile locked.

### 0o. Why a custom tower says "can't tell"

A custom build has no model number, so it cannot match a SKU the way a MacBook
does. `valueWholeBuild` handles that with exactly one lookup:

    SELECT id FROM skus WHERE category='prebuilt' AND model = 'Gaming PC ' || <GPU>

and returns null on a miss. **Measured 2026-09-06: 50 of 64 GPUs had no such
row**, and 9 more had a row with zero comps, so six GPUs in the entire catalog
could price a build. `bun run seed:builds` added the 39 missing ones.

**THE MODEL STRING MUST BE EXACTLY `Gaming PC <gpu model>`.** That is a literal
equality on a built string, not a search. "Gaming Desktop RTX 3070" or "Gaming
PC RTX3070" are invisible to it. The GPU half is read out of the `gpu` SKUs so
the two cannot drift apart.

**NOT EVERY GPU GETS ONE.** A "Gaming PC GTX 480" search returns e-waste, and a
comp set built from junk is worse than no comp set: the engine would stop saying
"I do not know" and start being confidently wrong, which this project refuses to
do.

### 0p. "Computer desk" is a desk

**13 of 23 furniture listings in the live feed were classified `tech`**, every
one reported as `bundle listing led by "computer"`. That rule exists for
`"Acer XB271HU Monitor, Black Desk, and Chair"` — a real monitor sale with
furniture thrown in — and it was firing on **compound nouns**, where the tech
word is an adjective: computer desk, laptop stand, laptop bag, laptop tote. A
leopard-print Betsey Johnson tote was being priced as a laptop.

Fixed by **adjacency**: a tech noun within two characters of a following
furniture or accessory noun is a modifier and drops out. The gap in "monitor,
black desk" is eight characters, so the case the rule exists for still works.
**There is a test that fails if that window is ever widened.**

The bundle rule now also requires the tech noun to appear BEFORE the furniture
noun, which is what "led by" means. "Bunny Ear Gaming Chair + Optional Mic / PC
Gamer" was led by a `pc` at the end describing who the chair is for. And "tote",
"carryall", "handbag", "briefcase" joined the accessory lexicon.

**105 live furniture listings retired** as `out_of_scope` by `bun run retire:oos`.

**DELISTED, NOT DELETED, AND THE ROW STAYING IS THE POINT.** The crawlers skip a
`source_id` they have already seen, including a delisted one, so the row is what
stops the same desk being re-added on tonight's sweep. A hard DELETE would clear
the feed today and let every one of them back in by morning.

**RETIREMENT ASKS `resolveProductType`, NEVER A KEYWORD SWEEP.** A regex for
`desk|chair|stand|bag` also finds *"Hp Gaming computer with Brand new gaming
monitor microphone and mount"*, which is a real gaming PC. `--only accessory`
exists and would take **869 more rows**; Yish authorised furniture only.

### 0q. What "can't tell" is actually made of — measured 2026-09-06

1,018 live INSUFFICIENT_DATA, re-bucketed by what the listings actually ARE
rather than by what the engine called them:

| count | what |
|---|---|
| ~356 | laptops, tablets, phones |
| **147** | **genuine desktop PCs** - the 0o gap |
| **140** | **genuine bare parts** - the 0m gap |
| ~200 | phones inside the "other" pile |
| ~151 | dealer spam (see 0k item 2) |
| 105 | furniture, now retired |

**DO NOT CLASSIFY THESE BY HEAD NOUN.** `resolveProductType("HP Laptop
17-cn2775st 8GB RAM 480GB SSD i5")` returns head **`ssd`**. It is a laptop whose
spec list ends on a component noun. A first pass using head nouns reported 57
listings as "ram" and 32 as "ssd" that were all laptops.

### 0r. Corrections Yish made, and what they cost

**Each one was a confident wrong answer the app could not catch.**

- **2TB NVMe is $300+, not $90.** Quoted from training data during a NAND price
  run-up. See 0m.
- **The Ryzen 5 X3D chips are real.** I called the 7600X3D fake. It is a real
  Zen 4 chip with 3D V-Cache and a Micro Center launch exclusive, which is
  likely why a catalog built from marketplace observation never saw it. The
  catalog had **every X3D except the Ryzen 5 ones**; 5600X3D, 7600X3D and
  9600X3D are now added. Yish: *"You CANNOT make this mistake."*
- **A $1 ask is not an unpriceable listing.** See 0k item 3.
- **Brand matters within a GPU model.** Yish: *"asus gpus price differently than
  gigabyte."* True, and NOT yet modelled: the catalog is one SKU per chip. The
  AIB brand is present in `comps.raw_title` and could be read at valuation time
  without exploding the catalog into 5 brands x 60 chips.

## 1. What Filtrsoft is

**A marketplace of only the good deals.** Open it, see used-tech listings the
engine actually verified, tap one for the reasoning and a link to the seller.

It is **not** a paste-a-link tool. That flow exists as a secondary feature; the
feed is the product.

**The thesis:** used tech has *binary, hidden value-destroyers* that price comps
never capture — iCloud Activation Lock, blacklisted IMEI, carrier lock, EFI
lock, battery health, mined GPUs, datacenter cards with no display outputs.
Every competitor values the **model**. None value the **risk**.

**Governing principle: reliability over coverage.** Missing a deal costs
nothing. Sending someone 45 minutes to a scam ends the brand. The engine is
allowed to say "I don't know."

**Scope:** laptops, phones, GPUs, prebuilt PCs, consoles, tablets, desktop
components. **Out:** furniture, accessories, cameras.

---

## 2. Current state — 2026-08-31

**The app is LIVE at `https://filtrsoft.com`, pricing real listings, and has
found real deals.** Valid certificate, HSTS, `assyze.com` detached and returning
404 by design. The generated `<service>-production.up.railway.app` name is a
debugging fallback, never the address of the product.

**Everything below this line predates the 2026-09-04/05 session. Where §0
contradicts it, §0 is right.**

> **2026-08-31, and this is the first one that matters.** The feed surfaced an
> **RTX 5090 FE at $2,800 on Craigslist, 30 minutes after it posted**, and Yish
> opened a conversation with the seller. Engine: median **$4,149** across 58
> comps (high confidence), eBay net $3,584 / local net $3,527, **+$727 against
> the $135 floor**, new retail $4,400 corroborated at Micro Center. One
> unresolved check (display outputs, in person) and one **high-severity negative
> signal — `SCREENSHOT_ARTIFACTS`, "image 2 shows window chrome"** — which is
> exactly what the question "send photos you took yourself with today's date on
> a piece of paper" exists for. Whatever happens with the sale, **the product
> did the thing it was built to do**: found it fast, priced it, and flagged the
> one reason to be careful.

```
PRODUCTION   engine 0.3.26
listings   717 in the feed  (377 craigslist · 193 facebook · 147 offerup)
verdicts   550 INSUFFICIENT_DATA · 111 PASS · 25 RISK · 15 VERIFY · 13 FAIR · 3 BUY
comps    18,588   ALL REAL, from eBay sold listings
skus        428
thumbs      334 self-hosted card images, 5.6 MB  (see §18f)

LOCAL
listings 2,773  (2,390 craigslist · 222 facebook · 151 offerup · 10 mercari)
           1,308 live and inside the feed's 28-day window
skus       423   (211 laptop · 56 component · 56 gpu · 45 phone · 43 prebuilt · 12 console)
           46 of them DERIVED from listing titles rather than hand-written
comps   18,588   283 of 423 SKUs covered
photos  12,010   596 of them OfferUp full-resolution (§18f)
judgments   79   (69 original + 10 re-reviewed WITH the comps visible)
outcomes     4   observed, from delistings
retail      35   quotes across newegg · microcenter · bestbuy, per board tier
```

⚠ **THE HEADLINE NUMBER IS 550 / 717 = 77% INSUFFICIENT_DATA, AND IT IS THE
BIGGEST THING WRONG WITH THE PRODUCT.** Three BUYs is not the engine being
strict — of the 163 listings it CAN price, 12 clear the profit floor and 9 of
those are correctly held at VERIFY by `riskGate`. Everything else never gets
priced at all. **Read §18g before touching the engine**: it breaks the 550 down
by the reason the verdict itself gives, and names the two fixes that have not
been done.

### What shipped most recently

- **2026-08-31 — §18.** Ten items from one message: verdict-coloured overlay
  chips (`.b-*` had never been defined), a real Back that restores scroll
  position, OfferUp full-resolution photos, self-hosted thumbnails because
  Facebook's CDN urls expire in ~2 days, a density pass, the button audit, and
  Recently viewed. Plus §18g, the 77% diagnosis, which is OPEN.
- **2026-08-31 — the VaultX restyle** (`0e0be89`). The whole app moved onto the
  demo's design system. `docs/VAULTX-DESIGN-SYSTEM.md` is the measured source of
  truth; every value there was read off the running demo, not chosen.
- **2026-08-30 — §17.** The frontend audit, in six commits.

### Baselines — anything worse than these is yours

```
bun test           126 pass / 0 fail
bun run typecheck   clean
ui-verify          170 pass / 0 fail   (node src/browser/ui-verify.mjs <label> [url])
```

⚠ `ui-verify` runs under **Node**, not Bun — Playwright hangs under Bun on this
machine. `bun test` proves the functions, `ui-verify` proves the running app,
and `src/browser/measure.mjs` + `shots.mjs` are the scratch tools for a design
pass.

### HISTORY — the 2026-08-26 session, in one table

⚠ **THESE NUMBERS ARE FROM 2026-08-26 AND ARE HERE FOR THE SHAPE, NOT THE
VALUES.** The current counts are at the top of this section. Kept because the
BEFORE/AFTER is the clearest record of what a correctness pass actually moves,
and because the INSUFFICIENT_DATA line is a warning: it went 425 -> 181 in one
day and is back at 550 as the crawler reached wider, which is §18g.

Yish went through the live feed and found four wrong answers in about a minute.
Diagnosing them turned into the largest correctness pass so far.

| | before | after |
|---|---|---|
| comps | 6,247 | **13,981** |
| SKUs | 224 | **291** |
| SKUs with comps | 91 | **227** |
| INSUFFICIENT_DATA | 425 | **181** |
| OUT_OF_SCOPE | 54 | **164** |
| PASS | 35 | **69** |
| FAIR | 4 | **11** |

**The engine version went 0.3.0 -> 0.3.7 in one day.** Every bump is a
behaviour change that production re-scored itself for; the list in
`engine/index.ts` is the changelog.

### The eval set has two generations — `score` uses the newer one

**6/10 exact, 2 harsher, 1 softer.** Up from 1/10, and the improvement came from
BOTH sides moving:

The original 69 judgments were made from Yish's mental model of market value,
before a single real comp existed. `bun run review` puts the listing, the
engine's arithmetic and the actual sold comps on one page; re-grading with that
visible moved **6 of 10 grades, 5 of them TOWARD the engine** — including the
Tesla P100 (*"i didnt realize there was no video output"*) and the Latitude 7420
(*"good call"*). `score` prefers `judged_by='yish-rereview'` where it exists.

His notes on the other side found four real engine bugs, all now fixed and each
documented in Live traps: salvage comps in working medians, "NEW LISTING" read as
a condition, a partial parts sum discounted twice, and Apple machines sent down
the parts path.

**Do not tune the engine toward the eval set.** Ten cases cannot settle a
valuation dispute. `bun run outcomes` is the referee that is neither party —
observed clearing prices accumulate every time the sweep runs.

### Commands
```
bun run api                       HTTP API + serves web/dist          :3177
cd web && bun run dev             frontend dev server                 :5177

bun run crawl [--pages N] [--limit N] [--vision N] [--cat sya,moa]
bun run sweep [--probe N]         re-crawl; record delistings + price moves
bun run fb:login                  sign in to Facebook by hand (once)
bun run fb:crawl [--query ...] [--limit N] [--vision N] [--headless]
bun run ebay:login                sign in to eBay by hand (once)
bun run ebay:comps [--query ...] [--skus N]
bun run retail [--skus N] [--sku "RTX 5070"] [--source newegg] [--replay]
                                  NEW retail from Newegg / Micro Center / Best Buy
bun run archive [--check|--import]
                                  ship the comps archive to production

bun run ou:crawl --query "graphics card"      OfferUp   (local basis)
bun run ou:photos [--limit 40]                OfferUp full-res photos, per listing
bun run mc:crawl --query "rtx 4070"           Mercari   (eBay basis)
bun run thumbs [--limit 200] [--prune]        self-hosted card thumbnails
bun run push --source facebook                local crawl -> filtrsoft.com

bun run check <url>               one listing, staged timings
bun run verdict                   re-score every stored listing
bun run score                     engine vs Yish's 69-listing audit
bun run stats                     archive health
bun run backup                    verified snapshot -> backups/ + OneDrive

bun run agent                     the local worker: polls filtrsoft.com for jobs
bun run daily                     the 10:00 routine (FB + OfferUp + push)
bun run probe                     is each listing still up? marks delistings
bun run vision [--limit N]        read specs off listing photos
bun run mc:detail                 Mercari description pass

--- added 2026-09-06 ---
bun run pause [--on|--off|--status]
                                  ONE SWITCH for every crawl on this laptop.
                                  Desktop shortcut "Filtrsoft Crawls" runs it.
                                  Flag: ~/.filtrsoft/paused . See 0n.
bun run seed:builds [--dry]       a `Gaming PC <GPU>` SKU per gaming GPU. See 0o.
bun run retire:oos [--dry] [--only furniture|accessory|all]
                                  retire live listings the classifier does not
                                  call `tech`. Defaults to furniture. See 0p.
bun run typecheck                 tsc --noEmit
bun test                          194 pass / 0 fail as of 2026-09-06
node scripts/shot-preview.mjs <html> <out.png> [full|top]
                                  render a preview headless and report font
                                  load, dangling <use> refs, console errors
node scripts/measure-tittle.mjs   where the dot on the wordmark's "i" sits
```

**Two runtimes, and mixing them hangs the process.** Anything driving a browser
is `node`, everything else is `bun`. See section 3.

---

## 3. Architecture

### Two runtimes, and it is not a style choice
**Playwright HANGS under Bun on this machine.** Measured 2026-08-24:
`chromium.launch()` never resolves under Bun; identical code under Node 24
launches Chrome in ~3s. Bun cannot be dropped — `bun:sqlite` is the database.

```
src/browser/*.mjs     NODE.  Drives Chrome. Emits RAW text as NDJSON on stdout.
everything else       BUN.   Spawns it, and does ALL parsing + storage.
```

**Workers are dumb by design.** They emit raw card text, raw body lines, raw
row text. Every parser lives in TypeScript beside the rest of the code, so a
site's markup change is fixed with a pure function and a test — never by
launching a browser to see what happened.

### Browser setup
- **`playwright-core`, not `playwright`**, driving the INSTALLED Chrome via
  `executablePath`. Playwright ships x64-only browser bundles on Windows and
  the ARM64 request was closed as not planned; its bundled Chromium would run
  emulated. The installed Chrome is native ARM64 (PE machine type 0xAA64).
- **Forward slashes in the Chrome path.** `"C:\Program Files\..."` in a JS
  string silently becomes `C:Program FilesGoogleChromeApplicationchrome.exe`.
- **One profile per site**, under `~/.filtrsoft/`, OUTSIDE the repo. They hold live
  session cookies; one `git add -A` with them inside and the sessions are on
  GitHub. Separate profiles so a challenge on one site cannot log out the other.
- **Headed by default.** eBay 403s headless outright; Facebook fingerprints it.
  A visible window at human pace looks like what it is.

### No credential handling exists, and none may be added
Yish signs in by hand in a real Chrome window. The browser holds the cookie; we
only drive the browser. **Do not add a login helper to any source file, ever.**

### `checkFetched(listing)` is the seam
Facebook needs a logged-in browser so it cannot hide behind `fetchListing`.
Once a source produces a `RawListing`, every stage after it is source-agnostic
and MUST stay that way. **Nothing after the fetch may branch on `source`** — the
moment something does, the eval set stops meaning anything.

---

## 4. Sources

### Craigslist — `src/sources/craigslist.ts`
Boston, 5 categories. **The search endpoint IGNORES its offset parameter**:
`&s=120` returns the byte-identical 332 listings as `&s=0`. So `--pages N` was
doing N× the requests for nothing; sweep defaults to 1 page.

### Facebook Marketplace — `src/sources/facebook.ts` + `browser/fb-worker.mjs`
- **Photos must be scoped to the listing.** A real page had 26 Facebook-CDN
  images of which **20 were "More like this" thumbnails** and 4 were 36px icons.
  Cut at the `Seller information` node; require width >= 200.
- **The carousel loads one photo at a time.** `View photo N` labels give the
  real count; click through until they are all collected. Never sample photos.
- **Text must be scoped to `[role="main"]` and sliced from the title.**
  `document.body.innerText` dragged in ~34 lines of Facebook nav as the
  "description", which the regex signal layer then scanned for red flags.
- **Location prefixes**: "Listed a day ago in / Pick up in / Located in".
- **Facebook's Condition dropdown is structured data** the seller PICKED —
  better than any regex over prose. Craigslist has no equivalent.
- Two browser passes per crawl: find what is worth opening, then open only
  those. Opening 100 pages to discard 80 is what gets an account flagged.

### eBay sold comps — `src/sources/ebay.ts` + `browser/ebay-worker.mjs`
**THE COMPS UNBLOCK, and Yish found it, not me.** I said repeatedly that sold
comps were gated behind the Marketplace Insights API — genuinely Limited
Release, genuinely closed to new users, and completely irrelevant: **eBay's own
website shows sold prices to any signed-in account.** Two sessions of planning
were built around the wrong constraint. `LH_Sold=1&LH_Complete=1`.

Measured, in this order, because each step failed differently:
```
headless, fresh profile   HTTP 403
headed, fresh profile     200 but "Security Measure" interstitial
headed, warmed profile    homepage OK, ACTIVE search returns 62 items
headed + sold filter      redirected to "Sign in or Register"
```
So: **headed, warmed, and signed in.** Warming is not superstition — going
straight to a search URL on a cold profile is what triggered the challenge.

---

### OfferUp — `src/sources/marketplace.ts` + `browser/marketplace-worker.mjs`
### Mercari — same files

**Both are USED markets, closer to eBay than to Craigslist.** Yish's
correction, 2026-08-25, and `BASIS` encodes it:

- **Mercari** is national, shipped, ~10% seller fee -> **eBay-basis**. Running
  its prices through the local discount takes ~15% off a number that already
  has eBay economics in it. That double-discount read the NZXT build at $890
  against a real $1,375.
- **OfferUp** is mostly local pickup but has shipped listings, so basis is
  decided **per listing** from what the card says, not per source.

Neither needs a login to browse, which is why they can eventually run in the
container — unlike Facebook. Both render client side, so they are browser-driven.

**Two parser bugs, each of which made a full page look EMPTY:**

- **OfferUp URLs are `/item/detail/<uuid>`.** A pattern of
  `/(item|p)/([A-Za-z0-9_-]+)` captured the literal string `"detail"` for every
  card — one shared id, 54 of 55 deduped away, reported as *"70 links -> 1
  card"*. The id is the LAST path segment.
- **Cards are PIPE-separated, not newline-separated**:
  `White Custom Gaming PC Build | $1,400 | Salem, MA`. Splitting on newlines
  left the whole card as one line, so the price was never isolated and the
  longest-line title rule returned the entire string.

    bun run ou:crawl --query "graphics card"
    bun run mc:crawl --query "rtx 4070"

### Facebook reaches production by PUSH — `POST /v1/push`

**Facebook cannot run in the container and that is architectural.** It needs a
logged-in Chrome profile Yish signs into by hand, and session cookies do not go
into a server image. So it crawls locally and pushes.

    bun run fb:crawl --query "rtx 4070"     # local, real browser
    bun run push --source facebook          # -> filtrsoft.com

**The push carries FACTS ONLY — never verdicts.** The server re-scores
everything on arrival. If clients sent verdicts, the feed would mix calls from
whatever engine version happened to be on a laptop, and `reverdictStale` could
never correct them because they would already claim the current version. Facts
are portable; judgements are not.

Auth is `FILTRSOFT_PUSH_TOKEN`, set in BOTH the local `.env` and Railway
Variables. **Without it on the server the endpoint refuses every request** — an
unauthenticated write path into a deals feed lets anyone put anything in front
of a buyer. A re-push UPDATES rather than skips, because that is how a price
drop arrives, and a price drop is the most actionable event in the system.

---

## 5. The comps quality gates — every one from a real failure

`compMatchesQuery` rejects before storing. **Comps are kept FOREVER, so a bad
row poisons every future valuation of that SKU rather than one run.**

1. **Digit-token match, separator-insensitive.** A query for `rtx 3080` returned
   RTX 5090s at $4,876. The query's digit-bearing tokens must appear in the
   title. eBay writes `i5-10310U`, `i5 10310U` and `i5_10310U` for one part, so
   compare with separators stripped — a literal match dropped six real comps on
   punctuation alone.
2. **Category agreement.** The first bulk pull stored **898 laptop prices as CPU
   comps**, implying an i5-1335U is worth $321. `resolveCategory(title)` must
   match the SKU's category.
3. **Multi-unit rejection.** `LOT OF 10 HP ZBook` at $1,300 became the most
   expensive "CPU" in the archive. Quantity is a lie about price, not noise.
4. **Accessory rejection.** Waterblocks, backplates and brackets "for RTX 3080"
   are not an RTX 3080.
5. **Title from the ANCHOR, not the row.** "Longest non-price line" picked
   `tspence007 100% positive (41)` — the SELLER — as a product name.

Effect on the first pull: range went **$8–$4,876 → $108–$699**.

**`queryForSku` names the part type** — `"Intel i5-8365U CPU processor"`, not
the bare model — which is what surfaces boxed chips instead of laptops.

**KNOWN LIMITATION: "RTX 3080 Ti" passes an `rtx 3080` query.** "3080" is a
substring of "3080 Ti" and the Ti is materially more valuable. Variant suffixes
(Ti/Super/XT/Pro/Max) need handling before comps drive real BUY calls.

---

## 6. Product type is decided by GRAMMAR, not keywords

`src/signals/product-type.ts`. A `--query "gaming pc"` crawl returned computer
desks, chairs, a glass computer table and a laptop bag, and paid for VISION on
three of them. Yish: *"make it so it doesnt mindlessly scan for the keyword
computer"*.

**The rule: an English product title's HEAD NOUN comes last.** "computer desk"
is a desk; "desk computer" is a computer. It generalises to nouns nobody
enumerated — "computer hutch", "monitor riser", "PC trolley".

Refinements, each from a real miss:
- **Lists.** A separator BETWEEN two nouns means a bundle -> first tech noun
  wins. It must sit between them: "Glass and Metal Computer Table" joins
  adjectives; "PC gaming chair with RGB" introduces a feature.
- **"for X" is compatibility, never the product.** "Headset & Mic for
  PlayStation" is a headset. Without this the most impressive noun always won —
  backwards, since the pricier the named device, the more confidently a cheap
  accessory gets misclassified. `for sale|parts|repair|free` excluded.
- **Negation.** "Monitor - NO Power Adapter" is a monitor.
- **Product LINES are tech nouns** (precision, latitude, xps, ideapad...).
  Without them "Dell Precision 5760 + Charger" had one recognisable noun —
  "charger" — and five real laptops were thrown out.

### `resolveCategory` deliberately does NOT use head-last
Marketplace titles put specs at the END: "HP EliteBook 840 Laptop i5 8GB RAM
256GB SSD" is a LAPTOP, and head-last calls it an SSD. For CATEGORY, a
whole-device noun outranks a component noun wherever it appears. Furniture
detection still uses head-last, because "computer desk" really is a desk.

### Crawl triage is stricter than the verdict
The crawl requires `tech`; the verdict only rejects furniture/accessory.
Deliberate: a crawl is speculative spending, so an unrecognisable title is not
worth a page fetch, while a pasted link is a direct request and still gets
answered. Real tech with an odd title is rescued by the model-number rule.

---

## 7. The catalog is derived from observation

`src/catalog/derive.ts`, **dry run by default**.

**Decide what the LISTING is, then extract the matching model.** Previously
every extractor ran against every listing, so "Dell Latitude 5530 Laptop Intel
i5-1235U" produced a **CPU** SKU — the CPU pattern matched and nothing checked
whether a CPU was for sale. That one omission is what put 898 laptop prices into
the archive as CPU comps. `prebuilt` still allows component extraction, because
the GPU and CPU inside a desktop genuinely do trade separately.

**Soldered mobile CPUs are not products.** Intel U/H/HQ/HK/Y/G and AMD U/H/HS/HX
parts are soldered to the board — which is exactly why an eBay search for one
returns laptops. 13 such SKUs were created and then deleted. Desktop parts
(K, KF, F, T, X, or no suffix) do trade standalone and are kept.

**Refuse family names.** A model with no digit — bare "MacBook Pro" — is a
product LINE, not a thing with a price, and `matchSku` would match a 2012 and a
2024 equally. That is the same bug that matched a 2019 Intel machine to an M3.

**Title only, not description.** Dealer listings ("Spring Laptop Blowout Sale!")
name forty models in their body copy; including descriptions created a SKU for
each and inflated counts.

**One model token, not two** — except "EliteBook 840 G6" and "XPS 13 9310".
Greedy two-token capture produced "Dell XPS 9310 2" and "Dell XPS 9520 14",
fusing a stray "2-in-1" or a screen size onto the model.

---

## 8. Vision

`src/vision/index.ts`. Anthropic API, **`claude-haiku-4-5` PINNED as a
constant** — not an env var, so no stray Railway variable can move it onto a
model that costs ten times as much. Structured output via a zod schema.

**Measured 2026-08-24:** Haiku, Sonnet 5 and Opus 5 all read the CPU, GPU, RAM
and storage correctly off the same spec screen. Opus cost **10x** and took 4x as
long, and the bigger models wrote hedging prose INTO the component fields
("RTX 5070 (12 GB) — exact SKU not legible") which the catalog matcher cannot
match on. **Measure before upgrading a model; on this task the cheap one wins.**

### NEVER downscale or re-encode a source photo
MASTER-PLAN specified 768px. At 768 the model read **"Ryzen 5 5600X" off a
screen that says "Ryzen 5 9600X"** — a Zen 5 chip read as a 4-year-old Zen 3,
~$110 of error on one component. **The saving was a third of a cent.** Originals
now go byte-for-byte; the old code also re-encoded every JPEG at quality 82, a
second lossy pass on an already-lossy source.

**The ceiling is not ours to pick.** Haiku 4.5 is STANDARD-tier vision: long
edge **1568px** and **1568 visual tokens** (`ceil(w/28)*ceil(h/28)`), whichever
binds first; the API downscales anything larger before the model sees it. The
high-res tier (2576px / 4784 tokens) is Claude 4.7+. Craigslist serves ~900px,
so in practice nothing is touched.

Cost scales with photo count: 3 photos ≈ $0.0066, 17 photos ≈ $0.02.

### Cache by CONTENT, not listing id
Two tiers. Tier 1: same listing, photo URL set unchanged, same model and prompt
version — no download. Tier 2: same photo dhashes on ANY listing — catches
reposts and stolen photos. **`PROMPT_VERSION` is part of the key**; without it a
prompt fix keeps serving answers from the old prompt and looks inert.
Measured: repeat check 9,658ms -> 41ms.

---

## 9. Spend and abuse protection

`src/api/guard.ts`. **`GET /v1/checks/stream` was public, defaulted vision ON,
and had no auth, rate limit, quota or ceiling.** I demonstrated the exploit
myself against production from an unauthenticated machine. It was also a GET
doing paid state-changing work, so a link scanner or chat unfurler could spend
money by merely previewing a shared link.

Four independent layers:
1. `FILTRSOFT_VISION_ENABLED=0` — kill switch, no redeploy
2. Bearer token (`FILTRSOFT_VISION_TOKEN`)
3. Daily USD ceiling (`FILTRSOFT_DAILY_BUDGET_USD`, default 2), summed from
   `vision_results.cost_micros` — integer micros, because float drift in a money
   guard is how a cap stops matching reality
4. Per-IP token bucket + single-flight coalescing by URL

**It FAILS CLOSED.** With no token set, paid vision is refused for everyone
including production. An unset secret must never mean "no security". An
unauthorised caller still gets a real text-layer verdict, so the safe default
does not feel like a regression.

CORS was wildcard; it is now an explicit origin list.

---

## 10. Delisting tracker — the comps source nobody can revoke

`src/tracker/`. Craigslist states WHY a posting went, via **HTTP 410** plus an
explicit sentence:

| body says | meaning |
|---|---|
| `deleted by its author` | the seller took it down. Sold, or gave up. |
| `expired` | aged out. Says NOTHING about a sale. |
| `flagged` | removed by users. Says nothing. |

Without that split a disappearance is ambiguous. With it, author-deletions are a
usable population. First sweep: 341 live, 4 delisted (3 author, 1 expired). The
NZXT gaming PC sold at **$750 in 2 days**.

**Price history is free** — the search page carries price for ~330 listings in
one fetch. Rows written only on an actual change.

**The confound that would ruin it:** sellers delete and repost to get back to
the top, which looks identical to a sale and would bias every clearing price
UPWARD. `looksLikeRepost` uses photo dhash (>=2 photos within Hamming 10),
falling back to title+price.

---

## 11. Deployment — Railway

Project `selfless-freedom`, service `filtrsoft`, branch `main`, auto-deploy on,
volume `filtrsoft-volume`, custom domain `filtrsoft.com`.

Build is a **Dockerfile** (not Nixpacks). Multi-stage: Node builds Vite, Bun
runs the server. One service serves API + frontend on one origin.

```
FILTRSOFT_DB          = /data/filtrsoft.db
FILTRSOFT_PHOTOS      = /data/photos
ANTHROPIC_API_KEY  = set
FILTRSOFT_VISION_TOKEN = NOT SET -> paid vision refused in production
```

**⚠ The Railway volume is NOT the archive.** It holds a fresh seed. Every comp,
listing and verdict lives in `C:\Dev\filtrsoft\filtrsoft.db` on Yish's PC, because the
crawlers and comp pullers run locally with his browser sessions.

**⚠ Vision does not run in production** until `FILTRSOFT_VISION_TOKEN` is set.

---

## 11b. Risk enforcement — SHIPPED 2026-08-25 (audit P0-2)

`src/verdict/risk-gates.ts`. Per-category required checks with three states, and
**the default is `unresolved`** — silence is not safety. Most listings never
mention activation lock, and reading that absence as "probably fine" is exactly
what turns a $400 phone into a $40 paperweight.

**REMOTE vs IN-PERSON is what keeps the gate from killing the feed.** Requiring
every check resolved before BUY sounds safe and is useless: sellers never write
"clean IMEI, paid off, signed out of iCloud", so no phone would ever be BUY.

| | |
|---|---|
| **remote** unresolved | caps at VERIFY. Asking costs one message. |
| **in-person** unresolved | does NOT block BUY; becomes a MANDATORY condition on it. |
| **failed** | RISK, always. |

BUY means "worth leaving the house for" — Yish's floor is $100 profit to make a
trip, not a promise the money is safe to hand over. Activation lock genuinely
cannot be settled remotely; the rule is you never hand over cash without seeing
the home screen, not that you never go look.

**Vision overrides text.** `bootScreenOnly` forces ACTIVATION_LOCK back to
unresolved even when the description claims otherwise — sellers of locked phones
photograph exactly that.

**Negation matters.** "no MDM, no firmware password" is a seller CLEARING the
check; a bare `\bmdm\b` read it as a disclosure and turned the cleanest possible
MacBook listing into a RISK.

## 11c. Outcome loop — SHIPPED 2026-08-25

`src/tracker/outcomes.ts`, `bun run outcomes`. Two kinds, kept distinguishable:

- **OBSERVED** — the delisting tracker saw it vanish. Free, automatic, says the
  market cleared at a price. Only `likely_sold` is recorded; reposts and expiries
  are noise that would drag every measured clearing price around.
- **REPORTED** — Yish bought or passed. Rare, and the only source of true
  realised margin. Mixing the two would turn "what the market paid" into "what
  Yish earned", which are different numbers.

Headline metric is **valuation error**: predicted median vs actual clearing
price. Consistently positive means pricing HIGH and every BUY is overstated —
the failure that loses money quietly, because each verdict still looks fine.

## 11d. Retail ceiling — SHIPPED 2026-08-25, THREE SOURCES

### The three retailers, and why one was not enough

`RETAIL_SOURCES = ["newegg", "microcenter", "bestbuy"]`, best first for the
categories Yish trades. Yish's call, and the live numbers back it:

| SKU | Micro Center | Newegg | Best Buy | spread |
|---|---|---|---|---|
| RTX 5090 | **$4,339.99** | $4,900 | $4,830 | $560 |
| RTX 5080 | **$1,499.99** | $1,550 | $1,600 | $100 |
| RTX 5070 | $800 | $800 | **$795.59** | $4 |
| RTX 3060 | $480 | **$459.99** | $466 | $20 |

**Micro Center is the only source here that is a PLACE.** The Cambridge MA
store (`storeid=121`, pinned in the worker) is ~20 minutes from Newton, so for
a local buyer it is a genuine alternative rather than a theoretical one — which
is exactly what a ceiling is supposed to measure. It is also the only page that
states LOCAL STOCK (`14 IN STOCK`), so a ceiling from it means "you can drive
over and have one today at this price". Prices are per-store, which is why the
store id AND the store cookie are both set: without them the site answers for
whichever store it infers from the IP, and a Texas price is not a ceiling.

**A Best Buy markup was assumed and was wrong.** The first read of $795.59 for
an RTX 5070 looked like a 45% markup over a ~$549 MSRP. Newegg then said
$799.99 and Micro Center $799.99. The card's street price simply IS ~$800.
That correction is the cross-check paying for itself on its first run.

### The ceiling is the cheapest quote another retailer corroborates

Not `MIN(sources)`. Cheapest-wins is the right definition of a ceiling, but
with three sources it is three chances for a bad parse to win, and the cheapest
bad parse always does. Nine Best Buy ceilings could be hand-verified; thirty
across three retailers cannot.

`latestRetail` takes the latest NEW quote per source, then: if the cheapest is
below `CORROBORATION_FLOOR` (0.6) of the next, the retailers disagree by more
than retailers actually disagree, so the outlier is DISCARDED and reported. A
single-source quote is still used — it is real and it passed every gate — but
`corroborated: false` travels with it.

**Only the comps-disagree branch requires corroboration.** Refusing to price a
SKU is the biggest hammer in `buildVerdict` and should not swing on one page.
The asking-above-new branch does not require it: it quotes a specific real
offer the reader can go check, and being wrong there costs one PASS instead of
every verdict for that SKU.

`skusNeedingRetail` orders by **how many retailers we have asked, fewest
first** — not by whether we have any price. The same SKU list goes to all three
on every run, so corroboration accumulates. Ordering by "has any price" would
mark a SKU done the moment ONE retailer answered, which is the single-source
case the whole design exists to avoid.

### A PREBUILT HAS NO RETAIL TWIN — `NO_RETAIL_TWIN`

Caught live and it was about to do real damage. `--sku "RTX 5070"` also matched
the `Gaming PC RTX 5070` SKU, which pulled three "matching" new machines: a
Yeyian with a Core Ultra 7 270K, a PowerSpec with a Ryzen 5 7500X3D, and a
ViprTech with a Ryzen 7 8700F. **$1,400 to $1,950, sharing one component.** The
CPU, RAM, storage, PSU and case are most of the price and all of them vary, so
"a new gaming PC with an RTX 5070" is a CATEGORY, not a product.

At a $1,400 "ceiling" against a $1,599 used median, the comps-disagree branch
would have returned INSUFFICIENT_DATA for every RTX 5070 build in the feed —
and it would have read as a data-quality finding, which is precisely the trap
`retailMeaning` exists to avoid. `RETAIL_CATEGORIES` already excluded
prebuilts; `--sku` bypassed it. There is now a guard at the write boundary AND
a filter on `--sku`.

### Parser notes per source

- **Newegg** — cards run `QUICK VIEW` ... `Compare`, which also drops the
  SPONSORED block free (those carry no `QUICK VIEW`, and on a GPU search they
  are prebuilt PCs). The name is the line before `Model #:`. **Take the LAST
  bare price in a card, not the first** — Newegg prints the struck-through list
  price first. A `Save:` line is NOT a reliable marker of that pattern; the
  Newegg Refreshed cards show two prices with no Save line. `NEWEGG_PROMO`
  exists because promo text sits BETWEEN the title and `Model #:` and is long
  and word-like: *"Get CONTROL Resonant with selected purchase, limited offer"*
  was read as a $1,200 RTX 5070.
  **Known gap:** `Sold by Newegg` on the page is a FILTER toggle, not a
  per-card marker, so marketplace sellers cannot currently be excluded there.
- **Micro Center** — cards start at `Add SKU:NNNNN to wishlist`. The name is
  the first long line AFTER the card's `Compare` (`Compare Item <title>>` above
  it is a truncated duplicate with a stray `>`). **`Our price` beats `Original
  price`** — both are printed, in that order, so a positional rule takes the
  pre-discount number every time. Their search does loose matching and returns
  unrelated stock when a card is discontinued, which the comp gates handle.
- **Best Buy** — see the card-boundary notes below. Weak on phones.

### `main` can exist and still be EMPTY — a silent-zero trap

Micro Center returned zero lines for the RTX 5070 and 5090 while working for
the 4060, 5080 and 3060. `document.querySelector("main") || document.body`
found the `main` element and read an empty string out of it, because results
render into a sibling on some layouts. **An `||` fallback cannot help — the
element was found, it just had nothing in it.** The worker now checks LENGTH
(>200 chars) before preferring `main`, and retries once.

A silent zero was the worst possible shape: it reported as *"nothing parsed —
the page layout may have changed"*, which would send the next person to rewrite
a parser that was never wrong.

---

## 11e. Retail ceiling — the original Best Buy build

**The feature no comp set can provide.** Every competitor compares used to
used, so a seller who anchors on what they paid just looks expensive next to
other used listings and the comps drift up with them. A buyer can always walk
into Best Buy and pay for a NEW one, which caps what any used unit can fetch.

Two uses, and the second was not the plan:

1. **Asking at or above new.** `buildVerdict` returns PASS with
   *"Buy it new instead — $800 at Best Buy"* once the ask reaches 95% of the
   shelf price. 95% not 100% because retail excludes tax: at 95% pre-tax the
   used unit is already ~89% of what a new one costs out the door, with no
   warranty and no return window.
2. **An independent check on OUR OWN comps.** A used median ABOVE new retail
   cannot be true, so the comps are matching something else. Every other
   confidence signal (comp count, spread, recency) is computed FROM the comps
   and therefore cannot catch a systematically mis-matched set. This can, and
   it refuses to price rather than pricing badly.

`retailMeaning()` splits three ways: `ceiling`, `comps_wrong`, and
`implausible` (retail under 35% of the used median) — the last is a parse
escape, NOT evidence about the comps, so a scraper bug can never masquerade as
a data-quality finding.

**Nine ceilings pulled so far and all nine agree with the archive** — the used
median lands at 53-93% of new on every one. That is nine independent
confirmations that the comps are matching the right products.

### Best Buy is strong for consoles and GPUs, weak for phones

Found live, and it drives the `RETAIL_CATEGORIES` order (`console, gpu, laptop,
tablet, phone`). **Best Buy no longer sells carrier iPhones outright** — only on
a 36-month instalment, and every one of those cards is Sold Out for outright
purchase. The single new outright price on the whole iPhone 16 page was the
16e. The first queue was fourteen phones and would have returned nothing.

`saveNoRetail()` records the absence so the queue stops re-asking dead
questions. The Xbox One X is discontinued and Best Buy has never carried the
Valve Index; without a dated "we looked, there was nothing" row those two head
the never-observed list on every run forever.

### `--replay` re-scores archived pages instead of scraping

Every run writes the raw page lines to `docs/testset/retail-lines.json`. Every
parser fix so far came from staring at lines already captured, so re-running a
browser to re-test a pure function is slow, is another session Best Buy sees,
and re-introduces the one variable you were trying to hold still.
`bun run retail --replay` costs seconds.

### The gates are shaped differently from the comp gates, on purpose

**Cheapest-wins inverts the burden of proof.** A bad comp is one vote among
many; the ceiling takes the single cheapest offer, so anything that slips
through IS the answer. The comp gates say "reject if clearly wrong" — correct
there, insufficient here. `titleCoversQuery` says "require it to be clearly
right": every meaningful query word must appear, with the FIRST word optional
because it is the brand and Best Buy drops the manufacturer on first-party
hardware ("XBOX Series X", never "Microsoft Xbox Series X").

Caught in one live run. Every one of these was stored as a real ceiling before
the fix:

| Stored as a ceiling | Actually | Gate that now stops it |
|---|---|---|
| $12.99 KontrolFreek Thumbgrips | not a Valve Index | `titleCoversQuery` — "Valve Index" has no digits, so the digit gate had nothing to check |
| $39.99 Quest 3S Facial Interface | an accessory | named accessory + the 40%-of-page-median floor |
| $449.99 "Explore Nintendo Switch 2" | a navigation tile | `NAV_TILE` |
| $539.99 iPhone 16**e** | a cheaper sibling | `compMatchesQuery` digit boundary — the hand-rolled `includes` had to go |
| $599.99 PS5 Slim **Digital** | no disc drive | new `console` variant pattern |
| $0.00 sold-out iPhone 15 | financing-only | `available` / `financedOnly` |

**The page-median floor is the one that generalises.** The named-accessory list
only catches words I thought of, and Best Buy's accessory catalog is unbounded.
Results for a device query are mostly that device, so anything under 40% of the
page median is a different kind of object. It only ever removes CHEAP outliers
— an expensive one cannot win a cheapest-wins pick anyway.

**`parseBestBuy` segments on card boundaries, not price proximity.** The first
version walked backward from each price to the nearest plausible title; the live
capture killed it. The title-to-price gap is 3 lines on one card and 9 on
another, and the filler is review text long enough to look like a product name
(*"(1 review from bestbuy-ca)"* was parsed as a $449 phone). Every card ends
with the literal word `Compare`. Inside a card the name is the LAST plausible
line BEFORE the first price — not the first line of the segment, because the
first segment on any page is the whole filter sidebar plus the first product,
and reading forward picked up *"Brand new in the original packaging."* (the
Condition filter's help text) and priced it as a phone.

### Two catalog fixes fell out of this

- **VR headsets are devices.** `headset` sits in ACCESSORY because a gaming
  headset is a $40 peripheral, so a real $600 *"Meta - Quest 3 512GB | Virtual
  Reality Headset"* was thrown out as an accessory. The qualifier is what
  distinguishes them and it is always present on the device.
- **"Digital" is a variant only where a DISC sibling exists.** The Xbox Series
  S and every Switch are digital-only by design, so the retailer writes
  "All-Digital Console" as a description of the only model there is. Treating
  it as a variant rejected the sole new Series S on the shelf.
  `DIGITAL_ONLY_LINE` in `ebay.ts`. On a PS5 or a Series X the distinction is
  real and worth $80-100, so it stays enforced there.

**Retail is keyed on (sku, storage_gb).** SKUs are capacity-agnostic on purpose
— the LISTING's storage picks the comp tier at valuation time — so a ceiling
stored against the SKU alone would cap a 512GB phone with the 128GB shelf price
and look authoritative doing it.

**Stale ceilings are dropped, not used** (`RETAIL_STALE_DAYS = 45`). Retail
moves; last year's launch price would cap nothing and flag nothing.

**Still open: PSVR2 titles mistype as accessories.** *"Sony PlayStation VR2
Headset"* still resolves to `accessory` even with the lexicon terms added. It
costs nothing today — Best Buy's PSVR2 page is games and refurbs, so "no
ceiling" was already the right answer — but the term is not matching and the
reason has not been chased down.

---

## 11e2. A chip is not a product — board tier, 2026-08-25

**Yish's observation**, and the measurements back it. He said a graphics card
search returns a very broad price range because brands, fan counts and cooler
tiers differ, and the same is true of RAM and other parts.

Measured across Newegg, Micro Center and Best Buy on one day, 42 genuinely-new
in-stock RTX 5070s ran **$795.59 (PNY Epic-X) to $1,669 (ASUS T1) — 110% for
identical silicon.** Normalised against the cheapest card for each chip:

| tier | n | median vs cheapest card for the same chip |
|---|---|---|
| base | 66 | 1.07x |
| mid | 48 | 1.16x |
| premium | 54 | **1.40x** |

An ASUS PRIME RTX 5070 was $819.99 and the PRIME **White** $919.99 on the same
page — **$100 for a colour**, a bigger step than base-to-mid. Confirmed
independently at Micro Center. `special` promotes one tier for that reason.

### The used market COMPRESSES the tier premium, and that is the useful part

Measured within each chip, salvage excluded, on SKUs with >=6 comps in both
buckets: premium/base is **1.36x (5080), 1.03x (4090), 1.11x (3080 Ti)** —
3/3 positive, median **1.11x**. Against 1.40x new.

So the honest scope is narrower than the raw range suggests, and the
interquartile spread of used GPU comps is only **1.08x-1.25x** — the median is
robust and the extremes are the tails, not the bulk. Tier matters:

1. **Enormously for the retail ceiling**, which takes the CHEAPEST offer and so
   always lands on the budget card. Comparing an ASUS TUF listing to a PNY
   ceiling is the worst case in the system, because the ceiling drives a PASS.
   `retail_prices.board_tier` now stores one ceiling PER TIER per source — the
   offers are already on the page, so the extra rows cost nothing. Resolved
   RTX 5070: base $796, mid $810, premium $900.
2. **Modestly for the comps.** The filter is gated at **n>=8** rather than the
   storage filter's 5, precisely because tier is a weaker discriminator and a
   thin tier-matched sample trades a small bias for a large variance.

Cards naming no known line are KEPT in both places. Silence is not
disagreement, and treating an unnamed card as budget runs in the direction that
turns a good deal into a PASS.

**The ladder is NAMED, not inferred** (`signals/board-tier.ts`). Deriving tiers
from observed prices needs retail coverage for every chip, and would be
circular for the ceiling — the thing being corrected. Validation is empirical
though: the first run left 19 cards `unknown` whose median was 1.27x, i.e. they
were not unclassifiable but PREMIUM lines missing from the ladder (ZOTAC
Apocalypse/ARCTICSTORM, ASUS NOCTUA, Gigabyte MASTER). Adding them dropped
unknown to 12 at 1.16x — mixed, as unknown should be.

**Still to do: the same treatment for RAM, SSDs and PSUs.** Yish named them and
they have the identical shape — CL latency and kit brand for RAM, DRAM vs
DRAM-less and TLC vs QLC for SSDs, 80+ tier and modularity for PSUs. The
`component` SKUs are unsplit today.

---

## 11f. The domain — DNS reference, the cutover is done

**`filtrsoft.com` is live and serving** as of 2026-09-04 (see §0, "The Railway
cutover is DONE"). What follows was written for `assyze.com` on 2026-08-26 and
is kept because **the records and the traps are identical for any future
domain** — the truncated-TXT one in particular cost a day.

⚠ **The one-custom-domain limit no longer applies.** He moved to Railway
premium on 2026-09-04, so more than one domain can be attached at once and a
future move does not need a hard cutover. `www` still must not SERVE — see §0
for why that is a product decision about host-scoped cookies rather than a plan
limit.

The generated `<service>-production.up.railway.app` name always works and is a
fallback for debugging, **not the address of the product** — never quote it to
Yish or put it in user-facing copy.

**The one-custom-domain limit is GONE — he moved to Railway premium on
2026-09-04.** It shaped the cutover while it lasted: `www` was never servable
(*"You have hit the custom domain limit for your plan"*), and `assyze.com` had
to be detached before `filtrsoft.com` could be added, with no overlap and no
redirect. That is history now; more than one domain can be attached at once, so
a future move does not need a hard cutover.

**But `www` still must not SERVE the app, and that is a product decision, not a
plan limit.** The session cookie is host-scoped and `localStorage` — Saved,
history, the device ref — is per-origin, so two hostnames both serving means a
user who lands on `www` gets a second, empty account surface with no way to tell
why. `src/api/index.ts` 301s `www.*` to the apex for exactly that reason.

Certificate issuance takes a few minutes after the DNS lands. Until it does,
the edge falls back to its own `*.up.railway.app` wildcard, which produces
`SEC_E_WRONG_PRINCIPAL` / `ERR_TLS_CERT_ALTNAME_INVALID` — that is normal
waiting, not a misconfiguration.

### What was wrong: the TXT verify value was pasted TRUNCATED

Worth keeping, because nothing about it looked like a typo:

    railway-verify=a05568e0d5fb544fb073a78d0778cb…
                                                  ^ an ELLIPSIS, not a hex digit

It is the string Railway's "Configure DNS Records" modal DISPLAYS — the `…` is
the UI marking the value as cut off, and selecting the visible text copies it.
Railway never verified, never requested a certificate, and the dashboard sat on
*"Waiting for DNS update"* with a green tick on the CNAME row and a warning on
the TXT row. On :443 the edge fell back to its own `CN=*.up.railway.app`
wildcard, which does not cover `filtrsoft.com` — the `SEC_E_WRONG_PRINCIPAL`
error. **Use the modal's copy control, never the visible text.**

### CORRECTION: `n3reqlxc.up.railway.app` was never stale

An earlier entry said that target was dead because it returns 404 `Application
not found`. **Wrong, and the mistake is worth keeping.** Railway's edge routes
by HOST HEADER, so the bare CNAME target has no app bound to it and 404s BY
DESIGN. With the right Host it always worked:

    curl -H "Host: filtrsoft.com" http://n3reqlxc.up.railway.app/v1/health   -> 301

The DNS target was correct the whole time. Do not "fix" it.

### The working DNS, for reference

| Record | Host | Value |
|---|---|---|
| ALIAS | `@` | `n3reqlxc.up.railway.app.` |
| CNAME | `www` | `n3reqlxc.up.railway.app.` (resolves, not served) |
| TXT | `_railway-verify` | the FULL `railway-verify=...` token |

An **ALIAS** at the apex is correct — a CNAME there is invalid DNS, and
Namecheap's ALIAS is the right instrument. No CAA records, so nothing blocks
issuance.

### Production could not price anything — FIXED 2026-08-25

    before:  {"ok":true, "comps":0,  "skus":62}
    after:   {"ok":true, "canPrice":true, "comps":6247, "skus":221}

**Zero comps.** Live, healthy, serving the frontend, and returning
INSUFFICIENT_DATA for every single listing because it held not one sold price.
The boot seed fires only when `skus == 0` and plants only the hardcoded
catalog — it never carried a comp, so the empty-database check passed happily
forever and `/v1/health` said `ok: true` the whole time.

**Fix: `data/archive.json.gz` is COMMITTED** (390 KB: 221 SKUs, 258 aliases,
6,247 comps, 35 retail quotes). The container imports it on boot when its comp
count is materially below the archive's. See `src/db/archive.ts` and DEPLOY.md.

    bun run archive           export local -> data/archive.json.gz
    bun run archive --check   what the committed archive holds
    bun run archive --import  merge it into THIS database

**Why a committed file.** Every other route to the volume needs a credential —
CLI login, SSH, an upload endpoint with a shared secret. This travels the path
already authorised and already working: commit, push, Railway builds, import on
boot.

**Idempotent, verified.** `UNIQUE(source, source_item_id)` on comps and a
unique `alias`, so every insert is `ON CONFLICT DO NOTHING`; a second import
adds 0 rows. A newer archive MERGES, never replaces, and nothing is deleted.

**SKU IDS ARE REMAPPED, NEVER CARRIED.** Local and production `skus.id` are
independent autoincrements seeded in different orders, so copying
`comps.sku_id` verbatim would file thousands of comps against the WRONG
products — silently, with confident wrong medians as the only symptom. Comps
reference their SKU by `category|brand|model` and re-resolve on import.

Verified against a fresh database seeded exactly as production is: 62 catalog
SKUs, then +159 SKUs and +6,247 comps in 107ms, every spot-checked median
matching local to the dollar (RTX 5080 $1251/n=99, RTX 5070 $615/n=64, iPhone
16 Pro Max $756/n=51). Then verified LIVE — the same Craigslist URL returns the
identical verdict from production and local ("Overpriced — $392 underwater
after fees", 179 comps).

**`/v1/health` now sets `ok` from `canPrice`** (comps > 0 && skus > 0) rather
than the literal `true`. A liveness probe that cannot tell "working" from
"structurally unable to answer" is a ping, not a health check.

### The feed now REFRESHES — production crawls Craigslist itself

Fixed in the same pass, because a pricing engine with nothing to price is the
same bug one layer up. filtrsoft.com was serving **three Craigslist listings, all
2+ weeks old, `lastCrawl: null`** — `crawl` is a CLI script and nothing in the
container ever called it.

`src/api/scheduler.ts` runs it on a self-rescheduling chain. Measured on a
fresh database: **1,376 live Craigslist listings discovered across the five
categories in 2 seconds**, and 160 analysed produced 18 PASS, 2 FAIR, 2 VERIFY,
24 OUT_OF_SCOPE and 114 INSUFFICIENT_DATA.

- **Backfill mode.** Under 400 listings it runs 4x the limit every 3 minutes;
  above that, 40 every 45. A day-long fill for an empty marketplace is not
  worth waiting for and the analysis is text-only and cheap.
- **A self-rescheduling chain, not `setInterval`.** The delay is decided AFTER
  each run so backfill can switch back to steady, and the next run is scheduled
  from the END of the last, so a slow crawl cannot stack up behind itself.
- **`maxVision: 0`.** The budget guard is $2/day and an unattended loop is
  exactly how it gets spent on listings nobody asked about. Vision runs on
  demand when someone opens a listing.
- **Never throws.** An unhandled rejection in the loop would take down the
  server; a failed crawl is not a reason to stop serving.
- `FILTRSOFT_CRAWL=off` disables it. `FILTRSOFT_CRAWL_LIMIT` / `FILTRSOFT_CRAWL_INTERVAL_MS` tune it.

**FACEBOOK CANNOT RUN IN THE CONTAINER, and that is architectural.**
`sources/craigslist.ts` is a plain `fetch()`. Facebook Marketplace needs a
logged-in Chrome profile that Yish signs into by hand, and shipping credentials
into a server image is both a security problem and against the standing rule
that no credential handling gets added. **Facebook listings must be crawled
locally and pushed** — no mechanism for that exists yet.

**71% of analysed listings come back INSUFFICIENT_DATA**, because most
Craigslist items do not resolve to a SKU that has comps. That is the real
coverage ceiling on the feed, and it is a catalog problem, not a crawler one.

Live state 2026-08-26, 523 analysed listings on filtrsoft.com: 373
INSUFFICIENT_DATA, 109 OUT_OF_SCOPE, 35 PASS, 4 FAIR, 1 VERIFY, 1 RISK.
**Actionable calls are ~1%.** That is the honest yield of a Craigslist-only
feed against the current catalog, and growing the catalog — not crawling
harder — is what moves it.

### The live feed immediately exposed a matcher bug — FIXED 2026-08-26

The first production crawl put two network switches in the feed as **VERIFY at
$311 and $269 net on $5 and $50 asking prices.** A D-Link Ethernet switch was
matching the Nintendo Switch 2 SKU and being priced against console comps.

**Root cause, and it was much wider than one silly match.** `matchSku` filtered
model tokens with `w.length > 1`, which DROPPED the single most discriminating
token a model name can carry. `norm("Switch 2")` splits to `["switch","2"]`,
the `2` was filtered out, and the SKU was left with NO discriminators — so the
generation guard directly above it silently did nothing for any model whose
generation is one character:

    "Sony PlayStation 4 console"  -> priced as PlayStation 5
    "Sony PlayStation 3 slim"     -> priced as PlayStation 5 Slim
    "Xbox One S console"          -> priced as Xbox One X
    "D-Link Ethernet Switch"      -> priced as Nintendo Switch 2

It defeated the exact trap that guard was written to catch. Single characters
are now kept, and **a single character in a MODEL name is treated as a
discriminator** — digit or letter, because model names are curated catalog data
where a lone character is never noise and is usually the whole distinction
(Xbox One **X** vs **S**).

### Variants now gate the MATCHER, not just the comps

Found in the same pass. `n.includes(alias)` is a substring test, so **"ASUS TUF
RTX 5070 Ti" matched the plain RTX 5070 SKU at HIGH confidence** and was priced
~40% under what a Ti is worth — turning a genuinely good listing into a PASS.
"RTX 4070 Super" did the same against the base 4070.

`compMatchesQuery` had guarded the COMPS against this for weeks; the matcher
never learned it. The longest-alias rule cannot help either, because the more
specific SKU **does not exist in the catalog at all** — which is precisely when
being wrong is most expensive.

Both the alias path AND the token path check it. Guarding only the alias path
moved the bug rather than fixing it: "RTX 5070 Ti" fell through to token
matching, scored 2/2 = 1.0 against the plain 5070 and came back MEDIUM, which
`valueSku` happily prices since only `low` is refused.

`variantPattern` moved to **`src/signals/variants.ts`**. It lived in
`sources/ebay.ts`, and the catalog must not depend on a source.

Re-verdicting all 366 stored listings after the fix: 269 INSUFFICIENT_DATA, 54
OUT_OF_SCOPE, 36 PASS, 5 FAIR, 1 RISK, 1 BUY. More INSUFFICIENT_DATA than
before, which is the point — those were confident wrong numbers.

### ENGINE_VERSION IS LOAD-BEARING — bump it on any behaviour change

The matcher fix above deployed cleanly and **the two bad rows stayed on the
live feed anyway.** The feed reads STORED verdicts, and the crawler skips
listings it has already seen, so shipping an engine fix changed nothing a user
could see. That is the shape to watch for: the fix was correct, deployed, and
invisible.

`verdicts.engine_version` was already being recorded and never read.
`reverdictStale()` in `api/scheduler.ts` now compares it against
`ENGINE_VERSION` on every crawl tick and re-scores anything older —
`checkStored` re-runs signals, matching and valuation against listing text
already in the database, so no refetch and no source traffic.

**Forgetting the bump is now the way a fix silently fails to reach users.**

**THE ARCHIVE DRIFTS. `bun run stats` now says so.** Production prices off the
committed file, not your local db, so every comps pull widens the gap
silently — the same shape as the original bug. Re-export and commit after any
`ebay:comps` or `retail` run.

**Vision IS configured in production** — `visionEnabled: true`,
`tokenRequired: false`, `$2/day`, `claude-haiku-4-5`.

### `www` will not work on the current plan

The Networking page reads *"You have hit the custom domain limit for your
plan"* with one custom domain used. Railway treats `www.filtrsoft.com` as a
SECOND custom domain, so the `www` CNAME resolves but Railway will not serve
it — no binding, no certificate. Apex-only until the plan changes. The record
is harmless to leave in place for later.

---

## 11g. The 2026-08-26 correctness pass — every bug the LIVE FEED found

**None of these were visible before the feed had real listings in it.** Yish
opened the "can't tell" verdicts, found four wrong answers in a minute, and
diagnosing them exposed several more. Counting outputs is not reading them.

### The matcher was blind to single characters

`matchSku` filtered model tokens with `w.length > 1`, dropping the single most
discriminating token a model name can carry. `norm("Switch 2")` splits to
`["switch", "2"]`, the `2` was filtered out, and the SKU was left with **no
discriminators at all** — so the generation guard sitting directly above it
silently did nothing for any model whose generation is one character:

    "Sony PlayStation 4 console"  -> priced as PlayStation 5
    "Sony PlayStation 3 slim"     -> priced as PlayStation 5 Slim
    "Xbox One S console"          -> priced as Xbox One X
    "D-Link Ethernet Switch"      -> priced as Nintendo Switch 2, $311 net on
                                     a $5 network switch

A single character in a MODEL name is now a discriminator, **digit or letter** —
model names are curated catalog data where a lone character is never noise and
is usually the whole distinction.

### Variants gate the MATCHER now, not just the comps

`n.includes(alias)` is a substring test, so **"ASUS TUF RTX 5070 Ti" matched the
plain RTX 5070 SKU at HIGH confidence** and was priced ~40% under what a Ti is
worth — turning a good listing into a PASS. `compMatchesQuery` had guarded the
COMPS against this for weeks; the matcher never learned it, and the
longest-alias rule cannot help when the more specific SKU **does not exist in
the catalog at all**, which is exactly when being wrong is most expensive.

**Both paths check it.** Guarding only the alias path moved the bug: the Ti fell
through to token matching, scored 1.0 against the plain 5070, and came back
MEDIUM — which `valueSku` prices, since only `low` is refused.

`variantPattern` now lives in **`src/signals/variants.ts`**. It was in
`sources/ebay.ts`, and the catalog must not depend on a source.

### The title decides the category; the description only breaks ties

    "NVIDIA GeForce RTX 4090 Founders Edition 24GB GDDR6X Graphics Card"
    -> category `prebuilt` -> "Can't be valued — cpu not stated."

The seller had pasted NVIDIA's own marketing copy into the description
("ultra-high performance gaming", "gamers and creators"), which trips the
prebuilt pattern. **Filtrsoft asked a graphics card which CPU it had.** That
listing is a BUY at $653 net; the bug was hiding it.

### `laptop` runs BEFORE `prebuilt`

They are both whole machines, so the machines-before-parts ordering never
applied between them — and prebuilt's vocabulary swallows portable hardware.
**31 laptops were being priced as desktops**: "Dell 5540 Mobile Workstations
8-Core i9", "Lenovo P50 Mobile Workstation", "Dell Precision 7510 Workstation
Laptop". A mobile workstation is a laptop. `all-in-one` also needs a computer
word nearby, because "PRINTER HP ENVY 6055E---Wireless All In One" was a
prebuilt asked for its GPU.

### A bare "i7" is a stated CPU

"Lenovo P50 Mobile Workstation. Windows 10 Pro, i7, 32GB RAM" came back "cpu not
stated" with the CPU in the middle of the title. It is a weak spec, but the
field asks whether the seller SAID it — and the comp spread already expresses
the uncertainty.

### RAM was being read as STORAGE

The drive-word lookahead let the RAM figure claim the drive word sitting behind
the real storage figure. Fourteen characters is exactly enough to step over one:

    "Dell XPS 16GB RAM 512GB SSD"   -> storage 16
    "MacBook Air M3 8GB 256GB SSD"  -> storage 8
    "Gaming PC 32GB DDR5 1TB NVMe"  -> storage 32

`valueSku` filters comps by storage tier, so this quietly priced laptops and
phones against the wrong capacity band.

### `unknown` is OUT OF SCOPE, and so are monitors and bulk listings

An **autographed Aaron Rodgers jersey** reached the deals feed reading
*"Couldn't identify the exact model"*. A jersey has no model. `inScope()`
already existed and already returned false for it — `buildVerdict` just never
called it.

**46 monitors, TVs, routers and hard drives** said the same thing. They are
genuinely tech, so the grammar layer correctly called them tech and they fell
through to a failure message. A 24-inch Asus monitor is not something Filtrsoft
covers and never will be: there are no comps because nobody ever asked for any.
`NOT_OUR_MARKET` says so plainly. `BULK_LISTING` catches inventory dumps
("24 Computers, Printers, Monitors left starting at just $30").

### COUNTERFEITS — checked FIRST, before anything can price them

*"Apple iPhone 15 Pro Max 1TB CLONE Unlocked"* at $99 read as **VERIFY with $433
of net profit**. Every layer downstream did its job correctly on the assumption
the thing was real: the matcher resolved a genuine SKU, the comps were genuine
1TB comps, the margin genuinely was enormous.

Nothing later in `buildVerdict` can undo that, because the rest of that function
reasons about PRICE. A counterfeit is not mispriced — it is a different object,
worth nothing to resell at any price, and reselling one is fraud. **There is no
asking price at which the answer changes, which is what makes it a blocker
rather than a discount.** So it is settled before valuation, alongside
out-of-scope.

Matched on the **title only**: a description reading "genuine, not a clone" or
"beware of clones on here" is a seller distinguishing themselves FROM one, and
reading that as a confession punishes the honest listing. `refurbished` and
`aftermarket battery` are deliberately absent — a repaired real phone is a real
phone.

### The scam signals the RTX 5090 exposed

A $2,500 Gigabyte RTX 5090 at 59% of market, in Nonantum, returned **zero
flags**. Three separate failures:

1. **The Craigslist parser dropped BARE attributes.** It required a `labl`
   span, and flag attributes render with no label — so `cryptocurrency ok` and
   `delivery available`, the two strongest signals on the page, were discarded
   as structured data Craigslist hands us for free.
2. **`analyze()` never read attributes at all**, only title and description.
3. **`IRREVERSIBLE_RAILS` had no crypto** — it listed Zelle, Venmo, Cash App
   and wire, but not the one rail that is untraceable as well as irreversible.

Added `SHIPS_ON_LOCAL_MARKET`: a pickup-market listing offering to ship, gated
at $400+. Not a veto on its own — some genuine sellers ship — but next to crypto
and a price far below market it is the whole pattern in one post.

**That card was never found on Facebook Marketplace** (two searches). The only
5090 results were people BUYING at $4,450-4,500 — nearly double what this seller
was asking, ten minutes from him.

---

## 11h. Production runs itself — crawl loop, re-verdict, archive

### `ENGINE_VERSION` IS LOAD-BEARING. BUMP IT ON ANY BEHAVIOUR CHANGE.

The matcher fix deployed cleanly and **the bad rows stayed on the live feed**,
because the feed reads STORED verdicts and the crawler skips listings it has
already seen. Shipping an engine fix changed nothing a user could see.

`reverdictStale` in `api/scheduler.ts` compares `verdicts.engine_version`
against `ENGINE_VERSION` on every crawl tick and re-scores anything older.
**Forgetting the bump is now the way a fix silently fails to reach users** — and
it happened again the same day, on the storage fix, which is why 0.3.6 exists.

It DRAINS the backlog rather than nibbling: 400 per tick was fine during
backfill (3-minute ticks) and useless in steady mode (45-minute ticks), where a
945-listing backlog took over two hours.

### The crawl loop — `src/api/scheduler.ts`

filtrsoft.com served **three Craigslist listings, all 2+ weeks old, `lastCrawl:
null`** — `crawl` is a CLI script and nothing in the container ever called it.
Fixing the comps archive gave the engine the ability to price and nothing to
price. Same bug, one layer up.

- **Backfill mode.** Under 400 listings: 4x the limit every 3 minutes. Above:
  40 every 45. The first crawl found 1,376 live Craigslist listings in 2
  seconds.
- **A self-rescheduling chain, NOT `setInterval`** — the delay is decided AFTER
  each run so backfill can switch back, and the next run is scheduled from the
  END of the last, so a slow crawl cannot stack up behind itself.
- **`maxVision: 0`.** The guard is $2/day and an unattended loop is exactly how
  that gets spent on listings nobody asked about.
- **Never throws.** An unhandled rejection would take down the server.

### The comps archive ships as a COMMITTED FILE

Production ran for weeks reporting `comps: 0, skus: 62` — live, healthy, serving
the frontend, returning INSUFFICIENT_DATA for **every single listing**. The boot
seed fires only when `skus == 0` and plants only the hardcoded catalog, so the
empty-database check passed happily forever.

`data/archive.json.gz` is committed and imported on boot.

    bun run archive           export local -> data/archive.json.gz
    bun run archive --check   what the committed archive holds
    bun run archive --import  merge it into THIS database

**It imports UNCONDITIONALLY.** The old gate was `comps >= archive.comps * 0.9`
and it silently blocked everything that was not a comp: `MacBook Air M5` was
added, exported, deployed — and production kept answering "Couldn't identify the
exact model", because its comp count already matched. SKUs, aliases and retail
quotes were riding on a comp-count check that had nothing to do with them.

**SKU ids are REMAPPED, never carried.** Local and production `skus.id` are
independent autoincrements seeded in different orders, so copying `comps.sku_id`
verbatim would file thousands of comps against the WRONG products — silently,
with confident wrong medians as the only symptom. Comps reference their SKU by
`category|brand|model`.

**THE ARCHIVE DRIFTS and `bun run stats` says so.** Production prices off the
committed file, not your local database, so every comps pull widens the gap.

### `/v1/health` means something now

`ok` is computed from `canPrice` (comps > 0 && skus > 0) rather than the literal
`true`. A probe that cannot tell "working" from "structurally unable to answer"
is a ping, not a health check.

### The feed pages

It served 40 of 425 with no pager, so the rest was unreachable and the on-screen
count contradicted the header. `offset` + `total` on the API, a **Show more**
button in the web app. Ranking happens across the whole pool, so page 2 is the
continuation of one ordered list rather than a second-best bucket.

### The app shell — read this before touching any layout CSS

**THERE IS NO FAKE PHONE FRAME AND THERE MUST NEVER BE ONE AGAIN.** A
`.stage`/`.phone` pair used to draw a simulated iPhone at `min-width: 880px`
with a "Shown at iPhone 16 size" hint. It was a desktop preview aid and it
leaked onto real devices, causing three symptoms that all looked like separate
bugs:

- the document was WIDER than the viewport, so the page could only be scrolled
  with two fingers and pinch-zoom stayed enabled;
- the frame was a fixed-height box and `.tabs` was `position: absolute` inside
  it, so the bottom nav rendered at the END OF THE SCROLL CONTENT — Deals /
  Check / You were unreachable until you scrolled past 285 listings;
- every measurement taken in a desktop browser looked correct, because at
  desktop width the simulation is what you are supposed to see.

`.app` is now a plain `max-width: 560px` centred column and `.topbar` is
`position: sticky`. **Verify layout at 384x832, DPR 3, `isMobile: true`** — a
1280px headless check cannot see any of the above.

**There is no bottom nav.** Three tabs was one place and two actions: pasting a
link is something you DO and a profile is not a destination you visit. Both are
icon buttons in the top bar; the feed owns the screen.

**The grid card radius is hard-coded 18px, on purpose.** It does not read
`--r-lg`. It is deliberately rounder than Facebook Marketplace's ~8px and it is
the single shape decision that makes the feed read as an app rather than a web
grid, so it must not be able to change as a side effect of a token tweak
somewhere else.

**Stats are overlaid on the photo, not printed under it.** `.gshot::after` is a
scrim over the LOWER 58% only — it exists to make the numbers legible, not to
dim the product.

**The clipboard is the primary action on Check.** `navigator.clipboard
.readText()` behind "Paste link and check". You arrive there having just copied
a link elsewhere; tap-hold-wait-Paste is four gestures for something the browser
gives up in one. It throws when refused or unavailable, and the catch focuses
the input — the old behaviour, never a dead button.

**Supported sources are stated as chips before you paste.** `badUrl` accepts
Craigslist only, so an OfferUp link used to come back as an error that read like
the app was broken. When a source goes live, flip its chip in `App.tsx` AND
`SUPPORTED` in `src/api/index.ts` together.

#### A class rename that lands on one side is INVISIBLE

The feed hero rendered with no card, border or radius for a full session. The
JSX said `dealhero`; the CSS said `.fhero`. Every INNER class (`.hshot`,
`.hover`, `.hprice`) still matched, so it did not look broken — it looked like a
deliberately flat hero. Screenshots confirmed "the hero is there" while a
`document.querySelector` check kept returning null, and the contradiction got
written off as a hydration race. **Trust the selector, not the screenshot:** a
partially-styled component is the failure mode a screenshot cannot show you.

#### A disabled brand-fill button reads as BROKEN, not inactive

`.cta:disabled { opacity: .4 }` over a solid orange fill is still obviously
"the orange button", just dim — it reads as a button that failed rather than one
waiting for input. Disabled drops the fill entirely and falls back to a bordered
ghost.

---

## 11i. The tracker, alerts, billing — shipped 2026-08-26

### The sweep now RUNS. It never did before.

`sweep` was written, worked, had a script, and nothing in the container ever
called it, so the feed had never once checked whether its listings were still
up. Now on its own 24h chain (`startSweepLoop`) with a `sweeping` flag separate
from `running`, so a sweep and a crawl overlap without delaying each other.
First run at +10min; probes capped at `FILTRSOFT_SWEEP_PROBE` (60) so the first
production sweep does not fire hundreds of requests in one burst.

**Delisted listings are hidden from the feed by default**, `?gone=1` shows them.
They rank last rather than being deleted, because "sold in 4 days at $650" is
the clearing evidence the outcome loop is built on.

#### ⚠ `listing_prices` was NOT a history, and the drop read as zero

The move branch only writes on a CHANGE; the baseline branch only fires when a
listing had no price at all. So a listing captured at $1,800 and cut to $1,500
held ONE row, containing $1,500 — and `MIN(observed_at)` returned the CURRENT
price, giving a drop of zero. That is why the feed showed no price moves on the
day a sweep reported four. Sweep now seeds `(asking_price_cents, captured_at)`
where no row exists at or before capture: idempotent, backfills, and it is a
real observation rather than an invented one. Seeded 492 locally.

#### ⚠⚠ ZERO IS "NO PRICE SHOWN", NEVER A PRICE

A search card whose price fails to parse yields 0 and the guard only tested for
`null`, so two listings had a real `$145 -> $0` history — a 100% discount that
would have been the top-ranked deal on the site. Same family as the "missing
asking price became zero" trap. Guarded at the source AND in the feed. A drop
must clear **$5 and 3%** to be badged; below that it is a seller rounding their
own number, and badging it trains people to ignore the badge.

### The app shell has a bottom toolbar again

Removing it was wrong. The bug was `position: absolute` inside the fake phone
frame, which put it at the end of the scroll content. It is `position: fixed`
with `env(safe-area-inset-bottom)` now, `.scroll` reserves its height, and
there are four real destinations: Deals / Check / Saved / You. **Settings is
NOT a tab** — twice-a-year screen, and it would cost the room Saved needs.

**`.gcard` is a DIV, not a button.** It contains a save button, and a button
inside a button is invalid HTML that browsers "fix" by hoisting the inner one
out, detaching the tap target. `.gopen` fills the card; `.gsave` sits on top.

### Watchlist stores IDS, never listings

`/v1/watchlist?ids=` re-reads current state every visit. Storing a copy would
freeze the price at save time, which defeats the point — you save something to
be told when it CHANGES. localStorage means no account; ids the server no
longer resolves are pruned or the count drifts from the screen forever.

### Alerts: the push subscription IS the account

`src/api/alerts.ts`. VAPID + `web-push`. Rules, each one a way the feature gets
itself switched off:

- **Only listings captured AFTER the search was saved.** Matching the backlog
  sends fifteen notifications for week-old listings.
- **Every query word must appear**, not any. "rtx 4090" on "rtx" alone returns
  every GPU on the site.
- **A listing with no price never satisfies "under $1,400."**
- `alert_sent` is a real table: a re-verdict bumps a listing without changing
  its id, so "already sent" cannot be inferred from timestamps.
- Alerts run right after the crawl, not on a timer — the whole value is latency.

#### ⚠ TWO kinds of dead subscription

404/410 is the push service. But a bad `p256dh` fails while web-push is
ENCRYPTING, before any HTTP request, so there is **no status code** and the row
survives to be retried every crawl forever. Both are dropped now. Verified
against a real FCM 410.

`applicationServerKey` needs raw BYTES, not the base64 string — the string
fails with an opaque `InvalidCharacterError`.

### Billing is BUILT AND OFF

`src/api/billing.ts`. `billingEnabled()` is false until `STRIPE_PRICE_ID` is
set; every endpoint 503s and the UI shows the free plan. The Phase 3 gate is
"10 payers, >=3% conversion" and there are no users — a paywall in front of an
audience of one costs the only thing that matters. Flipping it on is one env
var.

**No card details ever reach this server** (hosted Checkout). **The webhook is
the ONLY thing that grants access** — `?paid=1` is a hint to refresh, never
proof, which is the most common way a checkout integration gives the product
away. Signature verification needs the RAW body; re-serialised JSON breaks it
and the usual "fix" is to skip verification, which makes the endpoint a free
subscription generator. Verified both ways: forged event -> 400 and no
entitlement, HMAC-signed -> 200 and active.

Subscription id is stored on the way in because `customer.subscription.*` carry
no `client_reference_id`, so without it a cancellation can never be matched and
access is never revoked.

### Share target — ANDROID ONLY

`share_target` in the manifest -> `/share`. **The link arrives in `text`, not
`url`**, on the most common path (Chrome's page share sends a text blob), so
all three params are joined and a URL extracted from anywhere in the string.
History is REPLACED, or Back re-runs the check. **iOS cannot do this** — Web
Share Target is Chromium-only and Safari has never shipped it.

### eBay is now a SOURCE

`src/sources/ebay-source.ts`, Browse API, `bun run ebay:search "rtx 4090"`.
Asking prices on active listings — never comps. Marked `basis: ebay` because
eBay-to-eBay pays fees on BOTH ends.

#### ⚠ `conditions:` IS SILENTLY IGNORED — use `conditionIds:`

The `conditions` filter takes a fixed enum (USED_EXCELLENT, USED_VERY_GOOD, …).
The obvious `conditions:{USED|VERY_GOOD|GOOD|ACCEPTABLE}` is not rejected, it is
IGNORED — the request succeeds unfiltered. A live search returned a $1,453 NEW
card and a $465 open-box one, i.e. retail inventory in an arbitrage feed. Now
`conditionIds:{3000|4000|5000|6000}`; 1000 (New) and 1500 (Open box) are
deliberately absent. FIXED_PRICE only — an auction's current bid is not a price
you can buy at.

### Environment variables added

    VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT   push alerts
    STRIPE_SECRET_KEY / STRIPE_PRICE_ID / STRIPE_WEBHOOK_SECRET   billing (off)
    FILTRSOFT_SWEEP=off · FILTRSOFT_SWEEP_INTERVAL_MS · FILTRSOFT_SWEEP_PROBE

---

## 11j. The 2026-08-28 pass — four things Yish caught in one sitting

### ⚠⚠ THE OFF-PLATFORM REDIRECT SCAM — settled before pricing

He messaged two listings the feed was RECOMMENDING, got an instant reply from
each with a link to an outside "store", and Facebook's own banner said the
seller was likely in another country. The $85 MacBook Air M2 had been reported
as **VERIFY with $416 of net profit**.

The evidence was already in the description we had captured:

    "More photos and details are available here: www . wzwote . com
     (Please remove the spaces when entering the website.)"

`SPACED_DOMAIN` is dispositive on its own — writing a domain with spaces and
asking the reader to remove them is deliberate evasion of the platform's link
filter, and has no innocent explanation. `offPlatformDomain()` catches the plain
version on LOCAL marketplaces only. `randomSuffix()` (UPZT, URVQ, KSDX, G7FQ) is
the botted-inventory fingerprint and corroborates rather than convicts.

Returns **RISK, not PASS**: PASS reads "priced too high", this needs to read
"do not engage". 4/4 caught, 0 false positives across 1,129 listings.

#### ⚠ A NEGATIVE LOOKAHEAD CANNOT EXPRESS "domain not in this list"

The obvious form is
`(?:https?:\/\/|www\.)(?:www\.)?(?!(?:craigslist|amazon|…)\.)`. It DOES NOT
WORK and the failure is invisible until tested: `(?:www\.)?` is optional, so
when the lookahead correctly rejects "craigslist" the engine **backtracks**,
declines to consume `www.`, and re-tests against "www" — which is not on the
list. `https://www.craigslist.org` and `www.amazon.com` both matched as
off-platform links. Extract the domain and check it in code. Pinned by tests.

#### ⚠ `\s*` ALLOWS ZERO SPACES

The first `SPACED_DOMAIN` used `www\s*\.\s*`, which matched a plain
`www.amazon.com` in an honest monitor listing and called it deliberate filter
evasion. Whitespace must be REQUIRED adjacent to both dots or the pattern does
not mean what its name says.

Yish also observed both accounts were created in 2026. Strong signal, **not
captured** — the crawler never reads the seller profile. Worth adding.

### NO FEES ON A LOCAL SALE — `prefers_channel` is honoured now

*"I don't like how it is adding cost of fees and shipping when I'm usually
buying and selling locally."* He was looking at a $183 eBay fee and $15 of
shipping on a machine he hands over in a parking lot.

`SHIP_CENTS` now has `laptop`, `console` and `prebuilt` as **null** — eBay is
not an available channel, so there are no fees to subtract. `phone`, `tablet`,
`gpu` and `component` keep a number; for those the detail screen shows a
**Local / eBay switch**, defaulting to local. `laptop` is the debatable one and
it is local because he said so; give it a shipping number and the toggle appears
automatically.

**`prefers_channel` had been on `user_economics` from the beginning and was
never read.** Without it the verdict prose described a sale he will never make —
*"$653 net on ebay after $332 fees"* directly above a panel reading *"Selling
locally, +$625"*. Two answers on one screen, and the louder one was for a
channel he does not use.

### A BLOCKER IS A DISCLOSED DEFECT, NOT AN UNKNOWN

*"most of the time they aren't actually hard blockers... with graphics cards
there's always this hard blocker about how it's unknown if the card has display
ports."*

DISPLAY_OUTPUTS is `unresolved` on essentially every graphics card — you cannot
see an I/O bracket from a listing — so the panel shouted HARD BLOCKER at every
card in the feed. **A check that fires on everything carries no information**,
which this repo already says elsewhere.

Only `failed` renders, under "What's wrong with it". Unresolved in-person checks
became a quiet "Check when you get there" list; unresolved remote ones became
questions. **The GATE is unchanged** — an activation-locked phone still cannot
read as a deal. This is about what is worth SAYING, not what is enforced.

### TWO QUESTIONS, CHOSEN FOR THE LISTING

Was up to seven, ending in five fixed category questions, so every card asked
for an I/O photo and whether it had been mined. Ranked by how much the answer
moves given what this listing already says: signal fired > remote blocker >
missing field > one category fallback. **In-person checks are excluded** — a
text message cannot settle them, so asking wastes one of two slots.

`buildQuestions` is called AFTER `riskChecks` now. Built before, it could not
see them and `gateQuestions` had to prepend its own on top, which is how the
list reached seven.

### ⚠ AN OLD API SERVER FIGHTS `bun run verdict`

Running the re-score while a server on an OLDER engine is up gets it silently
undone: the server's crawl loop runs `reverdictStale`, sees verdicts at a
version that is not its own, and re-scores them BACKWARDS. Measured — 0.3.23
rows replaced by 0.3.21 ones **13 seconds later**, and the feed kept serving the
old headline while the database appeared to hold the new one. **Stop the server
before a manual re-score**, or run it with `FILTRSOFT_CRAWL=off`.

---

## 12. Live traps

### ⚠⚠ ONLY A **REMOTE** UNRESOLVED BLOCKER VETOES BUY

Removed on 2026-08-27 during the Codex audit, on the reading that
`RISK-MODEL.md` says "an unresolved hard blocker overrides any price gap...
never a BUY". **That IS what the document says**, and applying it to IN-PERSON
checks empties the product.

Measured immediately: **BUY = 0 across all 976 listings.** Every VERIFY was
blocked by one in-person check, `DISPLAY_OUTPUTS`, and none by a remote one.

That check is the anti-mining-card test — you cannot answer it from a listing,
you have to look at the card. So vetoing on in-person checks means **no
graphics card is ever a BUY at any price, forever**, and activation lock does
the same to every phone, which is the most valuable category.

The reconciliation, which is what the document intends:

> **BUY means "worth leaving the house for", not "safe to hand over money."**

    remote   unresolved -> caps at VERIFY. Asking costs one message.
    inPerson unresolved -> rides along as a MANDATORY condition printed on the
             verdict: "Do not hand over money until you have seen them."

Never getting scammed is preserved. Never going to look is a different rule.
A gate that fires on every listing carries no information.

Restored, `ENGINE_VERSION` 0.3.21, and `test/backend-pure.test.ts` now asserts
BOTH directions — an in-person check conditions a BUY, a remote one vetoes it.

#### A measurement error worth not repeating

Diagnosing this I reported four listings as "BUY before the change". **Only one
was.** The RTX 5090 and the two RTX 3090s are VERIFY from the PRICE-RATIO
branch — "priced at 59% of market" — which fires before the risk gate and is a
deliberate rule (a gap that large is simultaneously the strongest deal signal
and the strongest scam signal). Reading `riskChecks` alone does not tell you
which branch produced a verdict; read the headline too.


### ⚠ ARCHIVE-LEVEL STATISTICS DO NOT BELONG INSIDE A PER-COMP LOOP

`valueSku()` adjusts every surviving comp into the target condition. Each
adjustment called `measuredMultiplier()`, and that function scanned condition
rows across the full **18,603-comp archive**. An RTX 5070 valuation could repeat
the same category aggregation once per comp; 100 valuations did not finish in
30 seconds.

The multiplier is now cached by category + condition and invalidated when the
comp table's max id changes. Re-scoring all **936 listings fell from 21.5s to
1.87s (11.5x faster)** with the exact same distribution:
553 OUT_OF_SCOPE · 268 INSUFFICIENT_DATA · 95 PASS · 11 FAIR · 6 VERIFY ·
2 BUY · 1 RISK.

### ⚠ A SOLD DATE IS A UTC CALENDAR DATE, NOT THE SERVER'S LOCAL MIDNIGHT

`Date.parse("Aug 20, 2026")` produced `04:00Z` on Yish's Windows/Eastern box
and `00:00Z` in the Railway Linux/UTC container. The day stayed the same, so it
looked harmless, but a parser fixture did not have one stable answer across the
two runtimes. eBay exposes a sold DATE, not a local time; append `UTC` explicitly
for both year-bearing and inferred-year dates.

### Regression suite started 2026-08-27

`bun test`: **36 tests / 65 assertions** covering hard-blocker gates, vision budget,
listing facts, verdict retention, product grammar,
generative model parsing, eBay money/date/condition/variant gates, storage
extraction, OfferUp card boundaries, and all three committed retail fixtures.
The suite spends nothing and opens no browser.

### ⚠ VERDICT HISTORY WAS 75% IDENTICAL REPEATS

The table held **12,291 rows for 936 listings**. Comparing each row to the one
immediately before it found **9,212 byte-identical consecutive answers**. Every
reader selects only the latest row, so those repeats carried no product value.

A one-shot migration keeps the LAST row in each identical run and preserves
every real transition (A → B → A remains three rows). Local result:
**12,291 → 3,079 rows**, with 2,266 SQLite pages (~9.3 MB) returned to the
freelist for reuse. The file is deliberately not VACUUMed on boot; reuse stops
future growth without blocking production to rewrite the file.

`storeVerdict()` now appends only when call, confidence or payload changes. If
an engine bump produces the same answer, it refreshes the latest row's engine
version in place so stale-verdict detection still works.

### ⚠ DATA CHANGES CAN STALE A VERDICT AS COMPLETELY AS CODE CHANGES

The scheduler retried the newest 200 INSUFFICIENT_DATA listings every 3 minutes.
There were 268, so the oldest **68 were permanently starved**. It also meant an
existing BUY/PASS never saw a changed comp median or retail ceiling because its
engine version was already current.

At the measured 21.5s/936-listing rate before the cache fix, the old loop did
~96,000 redundant checks or about **37 minutes of CPU per day**. It now hashes
the max ids of comps, SKUs, aliases and retail quotes, then re-scores every
listing exactly once when that signature moves. Verification: first pass checked
936 in 2.32s and stored the 54 real 0.3.15 → 0.3.16 changes; an immediate second
pass checked **zero** and stored zero.

The split 3-minute scheduler also had stopped writing `crawls`, which froze the
API's `lastCrawl` at the final pre-split run. Every tick is recorded again and
the table is capped at 10,000 rows (about three weeks) so observability itself
does not become unbounded storage.

### ⚠⚠ THE HEAD NOUN DECIDES **WHEN THERE IS ONE** — otherwise use the title

I introduced this regression myself fixing the iMac-plus-keyboard case.
`resolveProductType` returns `head: null` for a title with no recognised
product noun, so `NOT_OUR_MARKET.test(head.head)` ran the regex against the
string `"null"` and **every router and switch stopped being rejected** — they
went from correctly out of scope to looking like an engine failure.

Both halves are needed:
- a KNOWN head noun beats the title, so "iMac ... keyboard and mouse" stays a
  computer rather than becoming keyboard gear;
- a MISSING head noun means the title's own words are the only evidence there is.

`head.head ?? input.title`. And the reasoning string must not call
`.toLowerCase()` on a null head — it crashed for exactly the case the fallback
was added to serve.

### ⚠ SOME WORDS BEAT THE HEAD NOUN — `NEVER_OUR_MARKET`

Head-noun gating let two shapes through even after the fix above:

    "DELL Poweredge R900 SERVER computer PC"      head is "pc"
    "Cisco SG220-26 26-Port Gigabit Smart Switch" no head noun at all

**A rack server IS a computer**, which is exactly why the head noun cannot save
us — it is a computer nobody in this market buys. `server`, `poweredge`,
`proliant`, rackmount, and switch/port patterns are decisive on the raw title
because they never appear as a bundled accessory on something we would price.

### Apple desktops derive from their A-NUMBER

An A-number (A1311, A1312, A2115) is Apple's own canonical model id and pins
the exact machine including year and screen size — more precise than any prose
a seller writes. Use it and stop when present.

Otherwise line + size + generation, where generation is an Apple-silicon chip
or a model year. **A bare "iMac" is refused**: it spans 2006 to today and
fifteen price points, and the catalog already treats a digit-free model as a
FAMILY rather than a product.


### The split loop — discovery is cheap, analysis is what costs

`src/crawler/queue.ts`. **One discovery pass over all five Craigslist
categories is 5 requests and ~0.8-1.4s for ~1,372 listing ids.** Measured, twice.
Finding out WHETHER something new exists is nearly free; deciding what it is
worth is not.

The old loop did both every 45 minutes, which is fatal for alerts: average
detection delay 22 minutes, worst case 45, before analysis even starts. Ticks
are now **3 minutes** and detection is ~90 seconds.

- `discover()` fetches search pages and queues anything unknown.
- `drain(limit)` analyses from the queue, bounded, so a 711-listing backlog
  spreads over ticks instead of blocking one for an hour.
- **The queue is a TABLE, not an array.** The container restarts on every
  deploy; an in-memory queue loses the backlog and the same listings get
  rediscovered forever.
- **Saved-search matches jump the queue.** `fetchSearchResults` returns the
  TITLE in the same request, so priority is decided before any detail page is
  fetched. The alert path must be the fastest path, not the slowest.
- Three failed attempts and a queued url is dropped — a listing deleted between
  discovery and analysis otherwise retries forever.

### Vision is its own pass now, and runs LAST

`src/crawler/vision-pass.ts`. It used to run inside the crawl on listings
discovered in that same run, so a listing analysed yesterday could NEVER get
its photos read however obviously it needed them. That left 62 listings sitting
at "cpu not stated" — exactly the case a photo resolves — permanently
unrevisited.

Running last also protects alert latency: the text verdict is what fires an
alert, and making somebody wait on a photo read to hear about a 4090 spends the
latency the split loop exists to recover.

**Measured cost: $0.0031 per listing**, ~6k tokens, ~10s for 10 photos.

#### ⚠⚠ VISION_PER_RUN MUST SCALE WITH THE TICK RATE

8 per 45-minute crawl is ~256 attempts/day. The same 8 at a 3-minute tick is
**3,840/day, about $12 against a $2 budget** — the guard stops it, but only
after burning the whole allowance in four hours every morning. Now 3.
**If you change the tick interval, redo this arithmetic.**

#### ⚠ AN ACCESSORY *FOR* A DEVICE READS AS THE DEVICE

`resolveProductType` returned `kind: "tech"` for "HP XL 17" Laptop **Bag**"
(head: "laptop") and "Logitech Rugged **Folio** with Keyboard - iPad" (head:
"ipad"). Both reached the vision shortlist, where they would have cost real
money to photograph a bag.

The general classifier is used in a dozen places, so **the money-spending path
carries its own stricter filter** (`isAccessoryFor`) rather than changing
head-noun rules everywhere. Refusing costs one skipped read; being wrong costs
cash on every pass forever.


### Tapping a listing OPENS it — do not rebuild the hero-promotion morph

The feed briefly promoted a tapped card into the hero slot with a
shared-element view transition. Yish asked for it, used it, and called it a bad
decision on 2026-08-27 — correctly. Tap-to-open is the gesture every
marketplace trains you on, and spending it on rearranging the page meant the
only way to actually SEE a listing was to tap it twice.

The hero is now simply the top-ranked listing: a highlight, not a slot you
fill. `promote`, `heroId`, `flushSync` and the `::view-transition-*` rules are
all deleted. **Do not reintroduce them** — the animation was genuinely nice and
that is not the same as being right.


### The generative matcher — the catalog grows from what walks past

`src/catalog/derive.ts`. Parses a model OUT of a listing title and mints the
SKU, instead of a human enumerating models. Built after hand-adding 39 laptop
SKUs moved "couldn't identify" by **125 -> 132**, i.e. not at all.

Covers **laptops** (Dell Latitude/Precision/Vostro/OptiPlex/Inspiron/XPS, HP
EliteBook/ProBook, Lenovo ThinkPad) and **GPUs**. GPUs are the better fit by
far: every consumer card is `<family> <number> <variant?>`, which is a grammar
rather than a list.

Four safety rules, all load-bearing, because this writes catalog rows from
untrusted seller text:

1. A known LINE token is required — "Dell laptop" is a family, not a product.
2. A DIGIT-BEARING model token is required, and only text AFTER the line name
   is searched. Model numbers essentially never precede their line; spec
   numbers do constantly ("15.6 inch Dell Latitude").
3. Spec numbers are explicitly rejected as models: years, screen sizes,
   capacities, bare generations.
4. Reseller ads and multi-unit listings are refused outright.

**Confidence is MEDIUM, never high.** A derived SKU is a name parsed from a
title, not a product anyone confirmed. `source='derived'` on the row marks them
for audit and for comps prioritisation.

**The GPU variant is part of the model, never a suffix.** `RTX 4070 TI` is its
own SKU — see the alias trap below for what happens otherwise.

### ⚠⚠ AN ALIAS MUST MATCH ON WORD BOUNDARIES

`n.includes("thinkpad x1")` is TRUE for "ThinkPad **X13** Gen 2", so an X13
resolved to the X1 Carbon SKU and was priced as a different, more expensive
machine. Live the whole time; found 2026-08-26 while testing the generative
matcher.

Model numbers are PREFIXES of each other constantly — x1/x13, 840/8400,
t14/t14s. `n` is already normalised to lowercase alphanumerics and single
spaces, so padding both sides with a space makes `includes` a whole-token test
with no regex. Still permissive where it should be: " iphone 15 pro max "
contains " iphone 15 ".

### ⚠ The catalog had SKUs that were not products

"Lenovo Thinkpad I5", "Dell XPS I5", "Apple Macbook Pro I7" — a line name plus
a CPU, minted by `catalog:derive` from bad titles, all with zero comps. They
actively caused wrong matches (ThinkPad X13 hit "Thinkpad I5" via token
overlap). Deleted. **A model whose only distinguishing token is a spec is not a
product** — check for this shape after any bulk catalog import.


### ⚠⚠ A RESELLER'S INVENTORY AD IS NOT A LISTING

The largest single group inside "couldn't identify the model" was shops, not
products. The engine was trying to price a whole stock as one machine and
honestly reporting that it could not — but "can't tell" is the wrong answer
when there is no unit to tell about. `RESELLER_AD` in `verdict/index.ts`.

Three tells, any one sufficient:

- **"up to N GB"** — a RANGE of machines. A single laptop has an amount of RAM,
  not a ceiling. Strongest signal and the one most of them share.
- **Retail-event language** — "Spring Laptop Blowout Sale!", "Holiday Laptop
  Deals!". Private sellers do not run seasonal promotions on one laptop.
- **A PLURAL product noun** — "Mobile Workstations", "Touchscreens".

**Do NOT extend this to spec soup** ("i7, SSD, Windows 11"). A genuine private
listing reads identically and matching on it deletes real inventory.

### ⚠ USED LAPTOPS ARE A LONG TAIL — enumerating SKUs does not scale

Measured on the live feed: **44 unmatched laptops spanned ~17 distinct models,
almost all appearing once or twice.** Adding rows fixes the seventeen you saw
and not the seventeen next week.

What IS worth enumerating is the recurring LINES — Latitude, ThinkPad,
EliteBook, XPS are the bulk of the off-lease market. 39 added on 2026-08-26.
The genuine tail needs a GENERATIVE matcher (brand + line + model number
parsed from the title, SKU created on demand), not more catalog rows.

**Matching is not pricing.** These resolve to a SKU and still return
INSUFFICIENT_DATA until comps exist. Pull comps after adding SKUs or nothing
visible changes.

#### The 2026-08-26 result — hand-adding SKUs UNDERDELIVERED, measured

39 laptop SKUs added, comps pulled to 18,603 across 284/383 SKUs. Effect on
"couldn't identify the exact model": **125 -> 132.** It did not move. The 19
that left INSUFFICIENT_DATA were 18 reseller ads correctly reclassified plus
**6 genuinely newly priced**.

That is the long tail proving itself. Do not respond to this by adding another
40 rows — the next 40 listings are 40 different models. **The fix is a
GENERATIVE matcher**: parse brand + line + model number out of the title
(`Latitude 5480`, `EliteBook 840 G7`, `ThinkPad T14s`), create the SKU on
demand, then pull comps for it. The parsing already exists in pieces —
`resolveProductType` finds the line and `matchSku` already treats a
digit-bearing token as a discriminator.

Current composition of the 267 unpriceable:

    132  couldn't identify the model    <- generative matcher
     45  no recent sold comps           <- comps queue
     78  a required field not stated    <- VISION, capped at 8/crawl
     12  build/parts gaps

The 78 "cpu not stated" / "ram not stated" are a DIFFERENT problem and vision
is the lever, not the catalog: the listing genuinely does not say, and the
spec is usually in a photo.


### The server OWNS its VAPID keypair — no env var required

Push used to require two environment variables, which put an 87-character and a
43-character base64url string through a human, a clipboard and a hosting
dashboard. One arrived wrong: production ran with a **60-character** "private
key" and every push failed. Nothing about push needs a human in that loop — the
pair is generated, not chosen, and nobody has to know its value.

Order of resolution (`resolveKeys` in `alerts.ts`):

1. `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` **if they actually load.** An
   existing deployment keeps its keys and therefore its subscriptions.
2. Otherwise a pair stored in `app_config` on the volume.
3. Otherwise generate one, store it, log it.

**THE PAIR MUST BE STABLE ACROSS RESTARTS.** Regenerating per boot silently
invalidates every subscription — a browser's subscription is bound to the
public key it subscribed with, so a new pair means every device goes quiet with
no error anywhere. Verified across three boots on one volume.

A bad env var is now a WARNING, not an outage. `/v1/health.push.keySource`
says `env` or `generated`.

### ⚠ AN EMPTY ENV VAR IS UNSET, AND `??` DOES NOT AGREE

`process.env.X ?? "default"` keeps the EMPTY STRING — nullish coalescing only
catches null and undefined. A dashboard variable created with a blank value
produces exactly that, and push died with "No subject set in
vapidDetails.subject" for a variable that visibly exists. Use `envOr()`.

Same shape as the `null ?? 1500` shipping trap in `valuation`.

### ⚠ `setVapidDetails` THROWS — never call it outside a try/catch

`web-push` validates hard: the subject must be `mailto:` or `https:`, the public
key must decode to 65 bytes, the private key to 32. A key pasted into a hosting
dashboard with a trailing newline fails all of that, and the failure surfaced as

    POST /v1/push/test  ->  500 Internal Server Error   (no body)

which names none of the three. It also killed `runAlerts` on every crawl,
silently, because that calls the same function.

`configure()` catches, caches the reason, and returns false. Env values are
TRIMMED — copy-paste through a browser picks up whitespace constantly and a
trailing newline in a base64url key is invisible in every UI that shows it.

`/v1/health.push` now reports `usable`, `error`, and the key LENGTHS (expect
**87** public, **43** private). Lengths, never values: a truncated or padded key
IS the failure mode, so the number is the whole diagnosis.

`/v1/push/vapid` returns `configured: false` and a null key when the server
cannot load the pair, so the app never offers to subscribe against a keypair
that can never deliver.


### ⚠⚠ COMP THE WHOLE MACHINE — and make sure the SKU EXISTS

This rule was already written down and was still unreachable in practice:
exactly ONE build SKU existed (`Gaming PC RTX 5070`), so every other build fell
through to the parts sum **by default rather than by judgement**. Yish rejected
a $467 valuation on an i7-10700/RTX 2080 build and was right.

The parts path prices components at eBay SOLD prices and then takes 25% off via
`WHOLE_UNIT_RATIO`. That is a PART-OUT valuation. An assembled, tested,
Windows-installed machine sold to a gamer is not a bag of parts.

    parts sum      $467, 22 comps, LOW confidence
    whole machine  $549, 18 comps, HIGH confidence

14 `Gaming PC <GPU>` SKUs now exist (5090 down to GTX 1660).
**When you add a GPU tier, add the matching build SKU and pull its comps**, or
that tier silently reverts to the parts sum.

### ⚠⚠ A COMP MUST BE THE PRODUCT, NOT A MACHINE CONTAINING IT

Sold listings for `i7-10700` return bare CPUs AND every Dell OptiPlex, XPS,
Precision and G5 built around one. Measured: **26 bare chips at $140, 38 whole
computers at $275, combined median $199** — the CPU was valued 40% high.

Filtered in `valueSku` for `component` and `gpu` only, by HEAD NOUN via
`resolveProductType`. Prebuilt SKUs are exempt: whole machines are the point
there. A substring match on "desktop" is WRONG — it throws away
"i7-10700 Desktop Processor" along with "Dell G5 Desktop i7-10700".

### ⚠⚠ NO LOCAL DISCOUNT ON SOMETHING THAT CANNOT SHIP

`FACEBOOK_GROSS_RATIO = 0.85` is a BUYER-POOL penalty — eBay reaches the
country, Facebook reaches your metro. Real for a phone or a GPU.

**Not real for a tower.** `ship === null` already means eBay is not an
available channel, and the eBay comps we hold for it are overwhelmingly
local-pickup sales — the small-pool constraint is ALREADY priced in, because it
is why the thing cannot ship. Charging it twice valued every gaming PC 15%
under its own observed sales, on the only channel it has: 18 sold RTX 2080
builds at a $549 median reported as $467.

Facebook charges no fee, so the discount can only be justified by pool size,
and for local-only categories it cannot be. `fbRatio` is 1 when
`basis === "local"` OR the item cannot ship.

**The 0.85 that remains is still an assumption, never measured.** The outcome
loop replaces it. Do not treat it as fact.


### ⚠⚠ NEVER pool a category to measure a ratio — Simpson's paradox
`measuredMultiplier` pooled all component comps and computed new/used = **6.07x**.
That is not a condition premium; 59 of the "new" rows were an expensive current-gen
i7-14700KF while "used" was dominated by cheap 6700K/6700/8500 sales. **It measured
the SKU MIX.** Within the 14700KF alone the ratio is 1.12x.

The pooled figure then "adjusted" a $425 new chip down to ~$53 and pushed that
SKU's used median to **$62 for a CPU that plainly sells for ~$250** — a
confidently-derived four-fold error with real data on both sides and nothing
anywhere reporting a problem.

Fix: compute the ratio **within each SKU**, then take the median across SKUs.
Requires 3+ comps on each side per SKU and 3+ SKUs, else fall back to the prior.

### ⚠ A SKU is not a price point — storage tiers differ by hundreds
An "iPhone 16 Pro Max 1TB" was valued against a median that included 256GB
sales. `valueSku` now drops comps whose title states a DIFFERENT capacity, keeps
ones that state none (silence is not disagreement), and abandons the filter
below 5 survivors rather than returning a confident number from four rows.

**Still open: RAM and CPU tier do the same thing on laptops.** A "Latitude 7420
i7 32GB" is priced against i5/8GB units in the same SKU.

### ⚠⚠ SALVAGE IS A DIFFERENT MARKET — exclude it, never adjust it
Yish, reading the comps table: *"you cant calculate that into the median when
the listing doesnt say it has any problems."* He is right, and the bug beneath
it was worse than a modelling choice.

**`normalizeCondition` could not parse its own output.** The stored enum is
`for_parts` with an UNDERSCORE; the pattern looked for `for parts` with a space.
So it returned null, `adjustPrice` returns its input unchanged when `from` is
null, and **every for_parts and open_box comp went into every median at face
value** — $75 and $91 no-boot iPhones sitting in a working phone's median.

Even fixed, adjusting is wrong. The phone multiplier is 0.18, so restating a $75
salvage sale as "used" DIVIDES by 0.18 — inventing a $417 data point and
multiplying the prior's error by 5.6x. `comparable()` now refuses to mix working
and salvage in either direction, and `BROKEN_TITLE` catches sellers who write
"No Boot" in the title while eBay's condition field says used.

### ⚠ eBay's "NEW LISTING" badge is not a condition
It is glued to the title with no separator — `NEW LISTINGApple iPhone 15
Unlocked` — and `^new` matched it. Recently-listed USED phones were stored as
`new`, dragged through the new->used multiplier, AND corrupted the measured
multiplier itself: phone new/used read **1.03** because half the "new" bucket was
used phones. After repair it reads 1.24.

**The `raw_json` rule saved this one.** A first fix rejected any condition line
over 40 characters and destroyed 2,141 good rows — eBay writes
`Open Box · Nintendo Switch · ...`, condition first, specifics after. All 5,940
were restored from the archived payload. Split on `·` and test the FIRST field.

### ⚠ A partial parts sum must be scaled UP before the whole-unit discount
Yish on a $650 build valued at $130: *"its an entire pc not just the gpu I think
you didnt add all of the parts together."* The error compounded — gpu $175 + cpu
$42 = $216 at 64% coverage, then x0.6 whole-unit = $130. **The 0.6 assumes a
COMPLETE parts list**, so applying it to 64% coverage charged the discount twice.
Divide by coverage first, then discount once.

`valueByParts` also priced components with a raw SQL `AVG` (in a column named
`med`), bypassing condition adjustment, salvage exclusion and the 90-day window —
an RTX 5070 read $674 inside a build and $615 standalone. It now calls
`valueSku` per part. **A component's price cannot depend on which path asked.**

### ⚠⚠ COMP THE WHOLE MACHINE. A parts sum is the FALLBACK, not the method.
Yish, twice, before the data agreed with him: *"its an entire pc not just the
gpu"* and then *"there shouldnt be any % of ebay at all because im not buying it
from ebay."* He was right about the number and about the method.

```
NZXT build (RTX 5070 + Ryzen 5 9600X), asking $750
  parts sum, scaled and discounted        $890
  USED whole PCs with an RTX 5070         $1,375 median, n=25
  nearest comps   $1,140 (RTX 5070 + 9700X + NZXT case)
                  $1,200 (RTX 5070 + 7600X)
```

**The assumption underneath the parts path was backwards.** It discounted an
assembled machine below its components. For current-gen gaming PCs the market
pays a PREMIUM for built-and-working — iBUYPOWER and Skytech towers clear ABOVE
component cost. `valueWholeBuild` looks up a `Gaming PC <GPU>` SKU and uses real
tower sales; the GPU is the anchor because it sets the tier and every listing
names it. Parts remain the fallback, and the parts-vs-whole spread is still what
tells you whether parting OUT beats selling whole.

Verdict went $890/PASS -> $1,416 market, $454 profit, **BUY** — matching Yish.

### ⚠ `??` DESTROYS A DELIBERATE null
`SHIP_CENTS.prebuilt` is `null` meaning "a tower cannot be shipped, so eBay is
not a channel". `SHIP_CENTS[category] ?? 1500` evaluates that to **1500** —
nullish coalescing cannot distinguish an intentional null from a missing key — so
the local-sale-only branch was UNREACHABLE and every gaming PC was priced as if
you could post it for $15. Use `category in SHIP_CENTS`.

### ⚠ Compare the asking price to the RIGHT market
The below-60%-of-market escalation compared a LOCAL asking price against an eBay
median. Local prices are systematically under eBay — that gap IS the flip — so
every Craigslist listing looked suspiciously cheap. The NZXT build read "53% of
market" and was escalated purely for being local. Now compares against
`best.grossCents`, the price in the channel actually available.

### ⚠ A check that fires on everything carries no information
The BIOS/supervisor-password check ran on every prebuilt and held a custom NZXT
gaming build at VERIFY with $454 of margin, waiting on a question about a
password no enthusiast builder sets. `RISK-MODEL.md` lists it under BUSINESS
off-lease units, where corporate IT sets them. Now gated on `BUSINESS_OEM`
(OptiPlex, EliteDesk, ThinkCentre, off-lease, asset tag). This is the
over-flagging CALIBRATION 10c warns about.

### ⚠ Know what market a price is denominated in
Yish: *"why did you * 0.6 and then *0.85 the build? theres no fees if i resell
it on marketplace."* Two separate double-counts, stacked:

**1. The local discount was applied twice.** `FACEBOOK_GROSS_RATIO` (0.85) is
NOT a fee — eBay's 13.25% is charged separately — it is a claim that the same
item fetches ~15% less locally. But a tower cannot be shipped
(`SHIP_CENTS.prebuilt` is null), so an assembled PC only ever sells locally and
the whole-unit ratio already lands in that market. `netByChannel` now takes a
`PriceBasis`; a parts valuation declares itself `local` and is not re-discounted.

**2. The whole-unit ratio was applied to the wrong base.** The research reads
*"parting out realises 60-80% of component value; selling whole realises
50-70%"* — both are percentages of COMPONENT VALUE, but our parts sum is built
from eBay SOLD prices, which is the realised part-out figure already. The ratio
that actually applies is whole-versus-part-out: 60/70 = 0.86, times ~0.87 for
the eBay fees a real part-out would pay = **~0.75**, not 0.6.

Effect on the NZXT build: $712 -> **$890**, and the verdict moved PASS -> VERIFY
with $140 of margin against a $135 floor. Yish graded it BUY; the remaining gap
is the GPU display-output check, which is in-person and correctly still open.

**0.75 is a PRIOR, not a measurement.** The outcome loop replaces it: a build we
valued and then watched clear is the only honest source for this number.

### ⚠ Apple machines are whole units, never part sums
Yish: *"its an apple imac, your not supposed to grade it off of just gpu and cpu
because most of the time its not gonna give that info."* The GPU is soldered,
nobody parts one out, and the listing says "2019 27-inch 5K". Routing it down the
prebuilt path made the engine demand two fields that do not exist and return
INSUFFICIENT_DATA on every Mac desktop ever crawled. `isAppleWholeUnit()` gates
both the bundle path and the missing-value-field check.

### ⚠ Anchor every gitignore and dockerignore pattern
A bare `photos/` matched `src/photos/` at any depth and silently excluded source
code from every commit. Railway crashed on `Cannot find module` forever while
local builds worked. **When a deploy says a module is missing, the FIRST check
is `git ls-files <path>`, not a theory about Docker.**

### ⚠ Never pass `-c user.email` on a commit
27 commits landed attributed to a different person. GitHub attributes by EMAIL.
A `.git/hooks/pre-commit` guard now blocks the wrong email.

### ⚠ Do NOT patch source files through Python heredocs
`\b` in a non-raw Python string is a literal **BACKSPACE (0x08)**. It silently
corrupted three regexes across this session — `stripListedPrefix` returned its
input unchanged while the identical regex worked inline, and `cat -A` showing
`/^listed^H.*?^Hin/` was what finally revealed it. **Use the editor tool for
anything containing backslashes.** Audit: `grep -c $'\010' src/**/*.ts`

### ⚠ Index spaces must match when comparing positions
`findNouns` searched a NORMALISED copy (punctuation stripped, whitespace
collapsed) and returned indices into it, which were compared against separators
found in the RAW title. Offsets never lined up, and stripping punctuation
deleted the very commas the list rule needs.

### ⚠ `\blaptop\b` does not match "laptops"
A laptop listing resolved to "keyboard" for want of an `s?`.

### ⚠ `Date.parse("Aug 20")` returns YEAR 2001, silently
It does not fail. That comp then sits 9,000 days outside the 90-day window and
is dropped from every valuation with nothing reporting a problem. eBay omits the
year on recent sales — most of them. Only trust `Date.parse` when a 4-digit year
is present.

### ⚠ A SKU with no digit in its model is a FAMILY, not a product
`matchSku` requires every digit-bearing SKU token to appear in the listing, so a
bare "MacBook Pro" SKU matches a 2012 and a 2024 equally.

### ⚠ Wrong-generation matching — FIXED, keep the rule
A 2019 Intel MacBook matched "MacBook Pro M3" on `{macbook, pro}` = 0.67
overlap. A **SKU token containing a DIGIT is a discriminator** and every one
must appear in the listing. Ties break toward the MORE specific SKU. Defence in
depth: `valueSku` gets null for any `confidence: "low"` match.

### ⚠ The CPU regex demanded a part number
Vision returned `cpu: "Intel Core i7 2.6 GHz 6-Core"` and the verdict still said
"cpu not stated" — `VALUE_FIELDS.laptop` required `i7-9750H`, and a Mac spec
screen never shows one. Both patterns now accept a bare `core i7`.

### ⚠ Missing asking price became ZERO
Making every unpriced listing look like free money. It was masked by other
checks firing first, which is luck.

### ⚠ Sum-of-parts was unreachable dead code
`EXPECTED_ROLES` had 7 entries, only gpu+cpu were priced, max coverage
2/7 = 0.286 against a 0.30 gate. And `sum / R * R` is the identity function
while the computed value was discarded anyway. Coverage is now weighted by what
components are actually worth (GPU 42%, CPU 22%).

### Deploy traps
- Nixpacks cannot detect Bun from `bun.lock`; Bun OOMs running Vite.
- **SQLite creates the FILE, never the DIRECTORY.**
- **Bind `0.0.0.0`.** Loopback in a container is invisible to the platform.
- **`/v1/health` must not require the database** — it turned a DB fault into a
  silent 91s timeout.
- Cross-building amd64 on this ARM64 machine is unreliable (QEMU segfaults).

### Engine traps
- **Never sample photos.** The funnel may drop LISTINGS; once a listing reaches
  vision it must never drop PHOTOS.
- **Don't regex the model's prose — ask for a boolean.** A port check fired on
  "no visible damage."
- **Store every comp forever.** eBay exposes ~90 days.
- **Verdicts are RELATIVE TO THE USER.**
- **Never ask a user for Facebook or eBay credentials.**

### ⚠ A refresh is an observation, not a new capture
The engine and authenticated push endpoint used different listing upserts. The
engine reset `captured_at` every time vision revisited a listing, while the push
endpoint changed only three fields. That destroyed the first-observed baseline,
left titles/descriptions/photo sets stale, and never wrote pushed price moves to
`listing_prices`. A shared `upsertListingFacts` now preserves `captured_at`,
updates every current fact, normalises zero prices to NULL, and writes one price
event only when a positive price actually changes.

### ⚠ Background photo cleanup can race the download that creates the file
Text-only checks launched `persistPhotos()` without awaiting it, then immediately
called `releasePhotos()` and nulled `local_path`. The async download could create
the directory *after* cleanup; its `.then()` removed bytes eventually but left
the database path behind. Measured locally: the photo directory was empty while
**666 `listing_photos.local_path` values still claimed files existed**.

Text-only hashing now fetches bytes in memory and never writes the volume. Jobs
for the same listing are serialised so a later paid pass cannot replace rows
while an old hash job is finishing. The paid path owns its files inside a
`try/finally`, so API, parser and database failures all release them and clear
the paths. The daily prune remains a crash backstop, not normal cleanup.

### ⚠ A missing `vision` option must mean free
`checkFetched()` treated `undefined` as vision ON. `marketplace-crawl` omitted
the option, so a supposedly text-only card crawl could call Anthropic for every
persisted listing. Paid vision is now strict opt-in (`vision === true`); only the
guarded API and dedicated candidate pass request it. Engine **0.3.17** carries
this behavioural change.

### ⚠ Never truncate an authenticated push's photo set
The push endpoint kept only the first 24 URLs even though the risk model's core
rule is every photo, every time. It also retained yesterday's photos when the
new set was empty. Push now de-duplicates exact URLs, stores all of them, and
replaces the old set even with an empty set.

### ⚠ A caller-side budget check is not a spending cap
The API, crawler and vision pass each checked the same daily total before a
call, but `analyzePhotos()` itself did not. `bun run ingest --vision` bypassed
the cap entirely, and concurrent requests for different URLs could all observe
the same remaining balance before any of them wrote a result. Failed/refused
calls also wrote no result, so their billed usage was invisible to the guard.

Engine **0.3.18** moves the authoritative gate to the paid boundary. Every call
first creates a worst-case reservation in `vision_spend` inside a SQLite
`BEGIN IMMEDIATE` transaction. A response settles it down to actual token cost;
a crash, connection error or unwritable volume leaves the maximum reserved for
the UTC day. Old unlinked `vision_results.cost_micros` plus the new ledger are
counted without double-counting linked results. The API/crawler checks remain
only as cheap early refusals. A budget of `0` now really disables spend.

### ⚠ `bun run api` is not a harmless local preview
It uses Bun hot reload and starts the real crawl, alerts, sweep and paid vision
timers unless explicitly disabled. An API process orphaned by an interrupted
audit kept running on port 3177 and, over 52 minutes, made **15 paid calls for
$0.085278**, added **40 listings**, and moved the database underneath the audit.
Before any local API smoke test set all three:

```
FILTRSOFT_CRAWL=off
FILTRSOFT_SWEEP=off
FILTRSOFT_VISION_ENABLED=0
```

Then verify the port closes when the test ends. Do not trust a clean git tree to
mean no local runtime was left behind.

### ⚠ Vision eligibility must include model and prompt version
The candidate selector excluded a listing if *any* vision row existed. A prompt
fix therefore helped new listings but permanently skipped every listing read by
the old prompt. The selector now suppresses only the current model+prompt pair;
the fingerprint cache still prevents paying twice for unchanged current work.
On the 976-listing local database, two legacy results became eligible again
(66 eligible with no result versus 68 with no current result, before the strict
tech/accessory filters).

### ⚠ A hard blocker does not become safe because it is checked in person
The code invented an exception that is not in `RISK-MODEL.md`: remote unknowns
capped a verdict at VERIFY, while an in-person unknown was allowed through to
BUY with a warning attached. The model's governing rule says **any unresolved
hard blocker overrides any price gap**. A warning on a BUY is still a BUY.

That exception created both BUYs in the 976-listing database:

- the $295 **2019 iMac** had $192 margin but received no Apple risk checks at
  all, because Apple desktops route through `prebuilt`; Activation Lock and
  EFI/MDM were silently treated as laptop-only;
- the $1,500 **RTX 4090** had $653 margin while display outputs were explicitly
  unresolved. The risk model says a GPU without a clear I/O-bracket photo is
  incomplete.

Engine **0.3.19** applies Apple lock/firmware/MDM checks to Apple desktops,
lets every unresolved hard blocker cap at VERIFY, and promotes a disclosed
category blocker to RISK before missing-data or price logic can hide it. Full
re-score changed exactly those two calls: BUY **2 → 0**, VERIFY **6 → 8**;
the other 974 calls were unchanged. That is commercially uglier and correct.
The way back to BUY is evidence, not weakening the gate.

### ⚠⚠ The two category resolvers must agree before catalog matching
`detectCategory()` and `resolveCategory()` had drifted into separate product
taxonomies. The signal regex saw `RAM`, `SSD` or a CPU before its narrower
desktop pattern recognized `OptiPlex`, `EliteOne`, `Micro PC`, `ThinkCentre`
or a bare `Desktop`. `matchSku` was then handed `component` and confidently
matched the Intel CPU inside an entire computer.

Measured on the 976-listing database, **seven whole desktops were PASS only
because the engine priced the whole listing from bare-CPU comps** (IDs 27, 56,
134, 194, 339, 351 and 488). They now resolve as `prebuilt` and return
INSUFFICIENT_DATA until the GPU/model evidence needed for a whole-machine
valuation exists. A leading catalog brand also fences whole-device matching,
so a Dell cannot token-match an Apple SKU; the guard deliberately does not run
for GPUs, where an ASUS board correctly maps to an NVIDIA-chip SKU.

### ⚠⚠ A supported SKU is a scope claim, not just a useful search string
`HP Envy 6055E` existed as a **laptop** SKU with **15/15 printer comps**. The
median looked valid because every row agreed with every other row; the product
was simply not a laptop. Worse, those rows participated in the laptop-wide
condition multiplier, so one unsupported SKU could move legitimate laptop
valuations. Removing it moved listing 54 from FAIR to VERIFY at 58% of market.

Engine **0.3.20** has a one-shot migration that deletes that exact SKU, alias
and 15 comps (and clears any outcome reference), and printer titles now exit as
OUT_OF_SCOPE before a mistaken SKU can override scope. A full archive audit for
SKUs whose comp titles were at least 50% printer/router/monitor/switch found no
second polluted SKU.

### ⚠ Seller capacity shorthand often omits the B
`128G` and `256G` are normal phone-listing shorthand, not missing storage.
Requiring `GB` left five local phones unpriceable even though the capacity was
in the title. Engine **0.3.20** accepts 2-4 digit `G` storage; the generic
attribute path requires at least 64 so `RTX 3080 10G` cannot become a 10GB
drive. Four newly crawled iPhones moved INSUFFICIENT_DATA → PASS (they were
overpriced), and the S24 Ultra now filters comps at its stated 256GB tier.

Final 0.3.20 re-score over **976 listings** took **2.07s** and was deterministic:
OUT_OF_SCOPE **571**, INSUFFICIENT_DATA **288**, PASS **97**, FAIR **10**,
VERIFY **9**, RISK **1**, BUY **0**. The 0.3.19 baseline was 563 / 293 / 100 /
11 / 8 / 1 / 0 respectively. Coverage improved where evidence was present;
the reduction in PASS is primarily the removal of silently wrong CPU pricing.

---

## 13. Decisions the maintainer made — do not re-litigate

- **Craigslist crawling proceeds despite their Terms of Use.** Green-lit
  2026-08-24: *"Im not worried about getting caught or anything so go right
  ahead even if it is against their terms."*
- **Facebook Marketplace automation likewise.** Same call. The realistic penalty
  is his account, which is why the crawler runs at human pace in a visible
  window rather than headless and fast.
- **Pushing to GitHub needs no permission** (and it auto-deploys). Still ask
  before tagging, installing, publishing a release, or spending money.
- **Highest resolution always** on source photos.
- **Haiku for vision**, pinned.

---

## 14. Codex audit — status

`docs/AUDIT-FINDINGS-2026-08-24.md` (technical) and
`docs/ECOSYSTEM-EXPANSION-2026-08-24.md` (product ideas).

**Fixed:** P0-1 (unauthenticated paid vision), P0-2 (category hard-blocker gate),
P1-6 (dead sum-of-parts),
P1-5 (asking price -> 0), P1-1 (stale vision cache).

**Confirmed and still open:**
- **P0-6/P0-7** production DB is disconnected from the local archive, has no
  volume backup, and the local backup excludes ~117 MB of photos.
- **A first backend suite now exists:** 43 tests / 80 assertions over catalog,
  product grammar, sold/retail parsers, listing facts, verdict retention and the
  atomic vision ledger. Coverage is still narrow, but "zero tests" is no longer
  true.
- P0-4 Craigslist ToU — decided, see §13.
- P0-5 eBay API — see "The eBay production keyset" below. **Codex was right:**
  a keyset does NOT unlock sold comps.

### The eBay production keyset — LIVE as of 2026-08-26

`bun run ebay:auth` proves it end to end. Credentials in the gitignored `.env`.

**WHAT DISABLED IT, AND WHY THE ERROR LIES.** A production keyset with neither
a deletion endpoint nor a granted exemption **cannot authenticate at all**, and
eBay reports that as `invalid_client — client authentication failed`. The keys
were byte-exact the whole time; the portal carried a "Your keyset is currently
disabled" banner that nobody had read. **Never debug eBay credentials without
looking at the keyset page first.**

Satisfied by `src/api/ebay-deletion.ts` at `https://filtrsoft.com/v1/ebay/deletion`.
Endpoint over exemption because an exemption is a review queue with no deadline
and we already run HTTPS on a stable domain. `EBAY_VERIFICATION_TOKEN` and
`EBAY_DELETION_ENDPOINT` are set in Railway; `/v1/health` reports
`ebay.deletionConfigured` so it can be checked without letting eBay fail a
challenge (which disables the keyset again).

**Measured surface, 2026-08-26:**

| API | Status | Use |
|---|---|---|
| Buy → Browse | **200** | active listings, with condition / price / buying-option filters |
| Commerce → Taxonomy | **200** | category tree AND per-category item aspects |
| Buy → Marketplace Insights | **403 Access denied** | sold comps. Closed, as documented. |

**SO THE BROWSER COMP SCRAPER STAYS.** Nothing about the 13,981 comps changes.
What the keyset actually buys is eBay as a SOURCE (next actions §6, which was
going to need another crawler and is now an API call), the Sell APIs for the
Phase 5 sell side, and Taxonomy aspects as an authoritative schema for the
catalog.

**⚠ Browse search is as dirty as any scraped title.** A `q=rtx 4090` query
returns laptops CONTAINING a 4090, external GPU docks, 4080s, and a $29.99
1:1 scale REPLICA. Browse results must go through `matchSku` and the counterfeit
signals exactly like every other source — a filtered `total` is not a count of
the product you asked for.

---

## 15. Next actions

⚠ **THE ONE THAT MATTERS IS §18g: 550 OF 717 LISTINGS (77%) NEVER GET PRICED.**
Everything else on this list is smaller than that number. Measured 2026-08-31,
broken down by the reason each verdict gives, with the two candidate fixes
named. It is the difference between a feed with 3 buys and a feed with enough
to choose from — and on 2026-08-31 one of those 3 was an RTX 5090 FE at $2,800
that Yish opened a conversation about, so the ones that DO land are worth real
money.

The two things under it, neither started:

1. **Junk is reaching a verdict at all.** *"20 PlayStation 2 Games"*, *"PS5
   video game Warhammer 40,000"*, *"Vintage Symphonic CRT TV/VHS"*, *"Astec
   Cisco Power Supply"*, *"Otterbox Defender Phone Case"* — media and
   accessories, already out of scope per §1, padding the "Couldn't price these"
   bucket Yish has said twice he does not want. Tightening the grammar gate is
   the cheapest win available. **Needs an `ENGINE_VERSION` bump** so production
   re-scores itself.
2. **51 listings matched a SKU and have no comps.** Purely a data pull:
   `bun run ebay:comps` on his machine, then re-export the archive.

⚠ **DO NOT ATTACK IT BY LOOSENING THE MATCHER.** §7 already records that
hand-enumerating the catalog does not work — 39 hand-written laptop SKUs moved
the unmatched count 125 → 132. The 158 "couldn't identify" rows are a genuine
long tail mixed with genuinely unidentifiable listings (*"Gaming pc"*, *"Pc
whole setup"*), and a looser matcher prices the second group WRONGLY rather
than leaving them honest.

---

**Yish's stated order, 2026-08-26: UI and the Codex-audit features are next.**
Everything below the line is engine work he has already asked to be deferred
until after that.

1. ~~**UI + the features Codex flagged.**~~ **DONE 2026-08-30**, and extended
   2026-08-31 (§18). The frontend audit's six commits all shipped; see 17a and
   17e. What that pass did NOT build, and said so rather than skipping
   silently: a **distance/radius filter**, which needs geocoding at ingest
   because `listings.location` is free text with no coordinates. See section 14
   for the Codex audit status.

---

2. **Keep filling the comps queue.** 140 of 423 SKUs still have zero comps.
   `bun run ebay:comps --skus 10` orders itself worst-first; ten batches is
   about thirty minutes and moved INSUFFICIENT_DATA from 425 to 181 in one
   session. **Re-export the archive afterwards or production stays behind** —
   `bun run stats` reports the drift, and the shipped archive is currently from
   2026-08-29.

3. **The remaining INSUFFICIENT_DATA is mostly real coverage now**, not bugs.
   Composition measured 2026-08-31 in §18g. ⚠ `bun run catalog:derive` NO
   LONGER EXISTS as a script — the generative matcher lives in
   `src/catalog/derive.ts` and runs inside the pipeline; 46 of the 423 SKUs are
   `source='derived'`.

4. **Retail coverage is GPU-heavy.** Newegg and Micro Center are shipped and
   cover gpu/component well. Phones and laptops have no usable ceiling — Best
   Buy sells carrier phones on financing only, and neither of the other two
   sells phones at all. Walmart is the obvious next source. **Yish ruled out
   Apple deliberately on 2026-08-25.**
5. **Phone comps are the open valuation dispute.** iPhone 15 128GB and iPhone
   16 Pro Max are the two remaining eval disagreements and Yish reads the
   medians as low. Retail cannot referee this one, so it needs better comps or
   `bun run outcomes`.

6. **eBay as a SOURCE, not just a comp feed.** Yish raised it 2026-08-25: good
   deals exist there if you are alerted the moment they post. **It changes the
   margin math** — eBay-to-eBay means fees on both ends, so it needs a
   different basis from local arbitrage. Alerts come after the UI, his call.

7. **Expand tests.** 126 now, covering product grammar, risk gates,
   persistence, the vision ledger, captured eBay/retail parsers, the web
   shell's routing and filters, OfferUp detail photos and the thumbnail bounds.
   `matchSku` still needs an isolated catalog fixture, and scheduler/queue
   behaviour still has no integration coverage.

8. ~~**Run `bun run sweep` daily.**~~ **AUTOMATIC since 2026-08-26** — the
   container runs it on a 24h loop (§11h). The script still exists for a manual
   run; nothing needs doing here.

9. **`/v1/checks` still only accepts Craigslist URLs.** Facebook, OfferUp and
   Mercari need a browser to fetch a single listing, so the paste-a-link box
   cannot serve them the way the crawlers do. `badUrl` says so honestly.

10. ~~**`retail` and `riskChecks` do not reach the web API.**~~ **DONE.** Both
    are on the verdict payload `/v1/checks/:id` returns, and the detail screen
    renders them as `Ceiling` and `Blockers` (§17e). Verified live on
    2026-08-31 against the RTX 5090 listing: one unresolved risk check and a
    corroborated $4,400 Micro Center ceiling, both on screen.

---

## 16. Key documents

| File | What it is |
|---|---|
| `DEPLOY.md` | Railway deploy, DNS, and why not Vercel |
| `docs/MASTER-PLAN.md` | Product design, architecture, GTM, sequencing |
| `docs/RISK-MODEL.md` | **The moat.** Hard blockers vs flags, per-category rules |
| `docs/CALIBRATION-2026-08-23.md` | What Yish's 69-listing audit corrected |
| `docs/VERDICT-SCHEMA.md` | Output contract |
| `docs/AUDIT-FINDINGS-2026-08-24.md` | Codex's technical audit |
| `docs/ECOSYSTEM-EXPANSION-2026-08-24.md` | Product/ecosystem ideas |
| `docs/sessions/` | Session logs with rejected directions and why |

---

## 17. Frontend deep-dive audit (2026-08-30)

The implementation-ready report is
`docs/FRONTEND-UI-UX-MASTER-AUDIT-2026-08-30.md`. It was a report-only pass.

**ALL SIX COMMITS ARE NOW SHIPPED** — see 17a for 1 and 2, 17e for 3 to 6, and
17f for the baselines they leave behind. The findings below are kept as the
record of what was wrong, not as an open list.

The highest-severity live findings are:

1. **The Deals segment says 21 but reaches only 13.** It filters the first 60
   client-side and hides Show more outside All.
2. **Browser Back from `/c/:id` changes the URL but leaves the detail visible.**
   Primary tabs are not routes, and the PWA `/?tab=check` shortcut opens Deals.
3. **Willing to drive, Hide gone, and Reduce motion do not control the behavior
   their settings copy promises.** Reduce motion was enabled during the audit
   while detail entry animation still computed to 0.32 seconds.
4. **“Deals” includes VERIFY and RISK.** Fix the information promise before a
   cosmetic redesign.

The production frontend build passed. The existing verdict palette, numeric
hierarchy, two-up mobile cards, and inline icon family should be preserved.

### 17a. Implementation — commits 1 and 2 SHIPPED, measured

Working through the audit in its recommended order: trust and functionality
first, visual redesign after. Commits 3–6 (accessibility/feedback, the
responsive shell, marketplace depth, and splitting App.tsx) are still open.

**Commit 1 `31710e8` — discovery and navigation tell the truth.**

- The segment is a SERVER query (`/v1/feed?quality=`), not a client `.filter()`
  over the first 60 rows. Count, page and pagination now come from one filter
  model, so they cannot disagree.
- **RISK is its own segment and is never counted as a deal.** `ready` is BUY
  only. `INSUFFICIENT_DATA` is reachable ONLY under `all` — it is the largest
  bucket and the one that can never be acted on.
- `screenOf(pathname)` is the single derivation of the screen. Back from a
  detail now tears the detail DOWN rather than only changing the URL.

**Commit `dfbf52c` — the bottom bar had never blurred in Chrome.**

⚠ **Chrome does not support `-webkit-backdrop-filter` at all.** Measured
against real Chrome: a rule declaring only the alias computes to
`backdrop-filter: none`.

`styles.css` declared both, standard property FIRST and the alias SECOND. The
CSS minifier reads that as one property declared twice and keeps the LAST, so
`.tabbar` and `.gsave` shipped with only the alias. The bottom bar was an
86%-opacity wash with nothing behind it: at 375px, listing titles and prices
read straight through the Deals / Check / Saved labels.

**It survived review because the SOURCE was correct the whole time.** Confirm
this class of bug in the BUILD, never in `styles.css`:

    grep -oE '(^|[;{])(-webkit-)?backdrop-filter:[^;}]*' web/dist/assets/*.css

Every rule must appear with the unprefixed property. **Never hand-write a
`-webkit-` prefix** — Vite emits them itself, and a hand-written one can only
reintroduce this.

**Commit 2 `aeacc99` — settings that do nothing are worse than no settings.**

Three controls wrote to `localStorage` and nothing read them. All three are
wired and each was verified against the running app:

| Control | Mechanism | Measured |
|---|---|---|
| Willing to drive | `/v1/checks/:id?drive=N` → `checkStored` | listing 407: 5m → $100 floor · 15m → $135.42 · 25m → $177.08 · 90m → $447.92 |
| Hide sold/removed | inverted onto the existing `?gone=1` | 387 hidden → 395 shown (8 delisted rows) |
| Reduce motion | `.no-motion` on the document element | class applied, animation → `1e-06s` |

⚠ **Drive time is a per-REQUEST override, not a stored one.** One verdict row
per listing cannot hold per-user answers, so writing it back would make the
feed's precomputed rows wrong for everyone. `checkStored` recomputes from text
already in the database in about a millisecond, which is what makes the detail
screen able to honour it at all. Out of range is REJECTED, not clamped
(`parseDrive`), so a malformed request gets the stored verdict rather than a
quietly different one — the client clamps to the same 5..90 window.

Information architecture:

- **Alerts moved to Saved**, behind `role="tablist"` Listings/Alerts sub-tabs. A
  saved search is discovery, not configuration; it was below Billing and Feed
  settings.
- **Billing renders nothing while billing is disabled.** The card explaining
  that paid plans may come later pushed every control that DOES something below
  the fold.
- Saved renders its H1 in the empty state too (it used to return early with a
  bare `<b>`, so the screen had no heading at all), and the empty state has a
  Browse deals button instead of being a dead end.
- Future-tense copy is gone. Present tense or nothing.

Fixed while extracting: the detail effect re-matched `/^\/c\/(\d+)$/` — no
trailing slash — while `screenOf` accepts one, so a PWA deep link to `/c/123/`
rendered the detail shell and never fetched anything. A blank screen with no
error.

### 17b. Where the shell's logic lives now, and why

- **`web/src/nav.ts`** — `screenOf`/`tabOf`, settings parsing, `feedQuery`,
  `checkQuery`, drive clamping. ⚠ **Nothing in it may touch `window`,
  `document` or `localStorage`**; the moment it does it stops being testable
  under `bun test`, which is the whole reason it was split out of `App.tsx`.
- **`src/api/query.ts`** — the segment vocabulary, with the invariant that
  broke the feed stated as a function:

      segmentCounts(rows)[q] === applyQuality(rows, q).length

  The route derives the counts and the served rows from ONE `priceScoped`
  population. When those were two separate expressions the control said 20 and
  the view dead-ended at 13.

### 17c. `bun test` and `ui-verify.mjs` — both are baselines

    bun test                                   90 pass / 0 fail   (was 61)
    node src/browser/ui-verify.mjs <label>     47 pass / 0 fail

**`ui-verify.mjs` clicks the running app and asserts MEASUREMENTS.** Both bugs
it was written for are invisible in a screenshot: the hero rendered unstyled for
a week because a class was renamed on the JSX side only and the inner elements
still matched, and a count that does not match what is reachable is not
something a single frame can show. **Trust the selector and the measurement.**

It runs under NODE — Playwright hangs under Bun on this machine (see
`src/browser/launch.mjs`) — so the split holds: Bun proves the functions, Node
proves the running app. Point it at a server started with `FILTRSOFT_CRAWL=off`,
because a crawl mid-run changes the counts underneath the assertions.

    FILTRSOFT_CRAWL=off bun run src/api/index.ts &
    node src/browser/ui-verify.mjs commit2

⚠ **A stale API server on an older engine will overwrite a manual re-score.**
Seen live: 0.3.23 rows replaced by 0.3.21 thirteen seconds later. Stop the
server before re-scoring by hand.

What it asserts, at 375 / 768 / 1024 / 1440:

- Back returns to `/`, TEARS THE DETAIL DOWN, and re-lights Deals.
- A refresh on `/check`, `/saved`, `/settings` stays there and lights the right
  tab. A detail lights NO tab.
- **Every segment chip's number equals the rows reachable by pressing Show
  more**: 3/3, 6/6, 4/4, 387/387. (Count `.grid .gcard` AND `.dealhero` — the
  top listing is promoted out of the grid, so a grid-only count is short by one
  and reads as a real failure.)
- Settings reach the SERVER, not just storage: the feed request carries
  `gone=1` only when the switch is off, and the detail request carries
  `drive=90`.
- The tab bar is `position: fixed` and on screen, and its `backdrop-filter`
  computes to something other than `none`.
- No horizontal overflow at any width.

Screenshots land in `docs/ui/<label>/` and are **gitignored** — ~7.6 MB a run,
and six audit phases would put 45 MB of near-identical PNGs in history forever.
The assertions are the durable artefact.

### 17d. Baseline measured at 1440px — commit 4's actual job

Desktop today is the phone column stretched: a ~740px content column centred in
1440 with empty gutters either side, the two-up mobile grid at desktop width,
and the phone bottom tab bar spanning the full window. Nothing is broken and
nothing overflows; it is simply a phone layout on a desktop. That is what the
audit's responsive-shell commit exists to fix, and the screenshots in
`docs/ui/commit2/` are the before.

### 17e. Commits 3–6 SHIPPED — the audit is complete

`4ac8cae` accessibility · `6017540` desktop shell · `9bf9a5a` engine copy ·
`6a735de` discovery · `6b4938b` archaeology. Measurements below are off the
running app, not intent.

**Commit 3 `4ac8cae` — accessibility and feedback.**

`--ink-3` was `#6e6a7c`: 3.59:1 on a card, 3.84:1 on the page, and it was the
colour of every 11–12px label. Now `#858092`. Measured after:

| Selector | Before | After | Size |
|---|---|---|---|
| `.gloc` | 3.59:1 | **4.92:1** | 11px |
| `.dloc` | 3.59:1 | **4.92:1** | 12px (was 11.5) |
| `.sect span` | — | **5.26:1** | 11.5px |
| `.tab .tl` | — | **8.9:1** | 11.5px (was 10.5) |

⚠ **Do not put `opacity` on top of `--ink-3`.** An `opacity: .65` lands the
result back under 3:1 and undoes the token. Four such multipliers were removed;
pick a lighter token instead.

⚠ **`--ink-1` was used in SEVEN declarations and defined NOWHERE.** Every one
was invalid and silently inherited the parent colour, including
`.chsw button.on`, where it was the entire selected state of the local/eBay
switch. It is an alias of `--ink` now.

Targets measured after: `.gsave` 44x44, `.seg button` 44x44 (was 38), `.tab`
125x58, `.brand` 55x44. **The bookmark keeps a 30px visible circle inside a
44px button** — growing the circle would put a dinner plate over the photo.

`aria-label="Open {title}"` on a card REPLACED its contents as the accessible
name, so price, verdict, profit and location were never announced. They are an
`aria-describedby` description now. Every screen has exactly one H1; Check had
none at all.

The photo dialog claimed `aria-modal` and had no trap. It focuses Close on
open, traps Tab both ways, restores focus to the triggering photo, pages with
arrow keys, and names itself "Photo 2 of 10".

**FOUND WHILE FIXING THE RADIOGROUP, and bigger than the reported bug:**
switching segments set `items` to null and the component returned the skeleton
from ABOVE `<Segmented>`, so **the control you had just pressed unmounted for
the length of the fetch**. Visibly the chips blink out; invisibly, keyboard
focus died with the unmount, which is why a roving-tabindex fix alone did
nothing — the element being focused no longer existed a tick later.

**Commit 4 `6017540` — the desktop shell. ⚠ SUPERSEDED 2026-08-31, SEE 17h.**
From 1024px it made the shell 1180px, gutters 24 (32 at 1280+), header 64px, a
four-column grid, nav in the header, and a 56/44 detail with the decision column
sticky. Yish used it and called it goofy; above 1024px the app is now a 360x780
phone in a frame instead. Kept here as the record of what was built and why, not
as a description of what ships.

⚠ **Both navs render and CSS picks one.** They are two elements because the
bottom bar is a fixed overlay with a safe-area inset and the header row is in
normal flow. The list and the icons come from ONE `NAV` constant, so a fourth
destination cannot appear in one and not the other.

⚠ **`align-items: start` on `.dtop` is load-bearing.** A stretched grid item is
as tall as its row, and `position: sticky` inside a full-height box never moves
— which looks identical to working until you scroll.

Three bugs the audit did not name, all found by measuring:

- **The `.hnav` base rule was written BELOW the media query that turns it on.**
  Same specificity, so source order decided: `display: none` won at every width
  and the desktop nav was invisible on a desktop while every other rule in the
  same block applied normally. That reads as "the component did not mount".
- **The hero is `aspect-ratio: 16/10`, so at 1116px wide it was 700px TALL** —
  one listing, no feed. It turns SIDEWAYS on desktop (7fr photo, 5fr decision,
  no DOM change) rather than being height-capped, which would just crop a
  portrait photo into a letterbox.
- **The segment indicator only re-measured on `[value, options.length]`.** Fine
  while every chip was `flex: 1`; content-sized chips exposed it, and the
  counts arriving after the first fetch ("All" → "All 387") moved the buttons
  without changing either dependency. The orange pill sat under a chip that was
  not selected. It observes the group now.

**`9bf9a5a` — the engine writes in Yish's voice.** Three corrections, all about
one headline: `$625 net on facebook — clears your $135 floor.`

⚠ **`best.channel` IS AN INTERNAL ID AND MUST NEVER BE PRINTED.** Yish:
*"it will say $625 net on facebook ... because I don't just buy or sell from
facebook."* The `facebook` channel means A LOCAL CASH SALE — equally
Craigslist, OfferUp, or a parking lot. `CHANNEL_NAME` maps it to "locally".
eBay keeps its name; the fee arithmetic behind that channel really is eBay's.

⚠ **THE HEADLINE STATES THE DEAL, NOT THE SETTING.** *"I don't like how it
relates things to my $ floor."* The floor still decides the call, is still in
the reasoning, and is still its own row in The Numbers. It does not get the
headline. BUY now reads `Worth $2,125, so you make $625 locally.`

⚠ **NO EM DASHES IN ANYTHING A PERSON READS** — headlines, reasoning, seller
questions, signal evidence, risk-gate reasons, dead-market explanations, push
bodies. Console logging keeps them; that is for the log. Two tests assert this
on the ASSEMBLED output, not the source, because these strings are built from
templates and a grep cannot see what a template produces. Not theoretical: the
test failed on its first run and found one in `product-type.ts` that four
manual passes had missed.

ENGINE_VERSION **0.3.24 → 0.3.25**, load-bearing: `reverdictStale` selects on
it, so without the bump every stored verdict serves the old wording forever.
1,200 re-scored locally.

**Commit 5 `6a735de` — discovery.** Search (every word, not any), category,
source, price ceiling, sort. Category is derived at feed time by the SAME
`detectCategory` the engine classifies with, so a filter cannot disagree with
the verdict it filtered to.

⚠ **THE FILTER STATE LIVES IN THE URL.** In component state it is lost on every
refresh and every trip into a listing and back. Applying pushes a history
entry, so Back undoes a search. Defaults are omitted from the query string.

⚠ **THE SEGMENT COUNTS ARE COMPUTED OVER THE DISCOVERY-FILTERED SET.** Search
"rtx" and the chips say how many BUYs there are AMONG RTX cards.

Also: source labels on cards (as muted text, never as colour — the verdict
stays the only colour that means anything), a hero bookmark (a SIBLING of the
open button; a button inside a button is invalid HTML), "Alert me about this
search" (permission requested on the TAP, never on load), the 12 most recent
comps behind a disclosure, and an offer slider.

⚠ **NO DISTANCE FILTER, DELIBERATELY.** `listings.location` is free text with
no coordinates and nothing geocodes at ingest, so a radius control would be a
string match wearing a mileage label. The audit asks for one; it needs
geocoding first.

The slider derived its floor from the economics and produced min $1,720 against
max $1,500 on the RTX 4090 — an **inverted range**. A range input whose min
exceeds its max does not error, it pins and never moves, so the control
rendered perfectly and did nothing. It is 0 to the asking price now.

**Commit 6 `6b4938b` — the archaeology.**

`bun run typecheck` exists and passes. First run: **165 errors**, 146 of them
from ONE omission — `SeedSku.liquidity` was declared required and 29 CPU
entries lacked it, which widened the array union and failed every element. It
is optional now; only `liquidity === "dead"` vetoes a BUY, so absent already
behaved as saleable.

⚠ **`VerdictPayload` had `[key: string]: unknown` to mean "and anything else".**
An interface with declared properties has no implicit index signature, so
`VerdictResult` — the only thing anyone passes — was incompatible with the type
written to satisfy it.

Deleted: `src/scripts/derive-catalog.ts` (imported two functions that do not
exist in `derive.ts`; it could not run), 31 dead CSS rules across 12 classes,
and 4.5 MB of stale committed screenshots.

`App.tsx` **2,802 → 425 lines** plus `types.ts`, `lib.tsx`, `feed.tsx`,
`detail.tsx`, `screens.tsx`. `styles.css` **1,793 lines → an index of 11
numbered partials**.

⚠ **THE IMPORT ORDER IN `styles.css` IS THE CASCADE.** The numbers exist so
reordering has to be deliberate. New partials go at the END unless they are
tokens.

The CSS split has the strongest proof available: **the built stylesheet is
BYTE-IDENTICAL before and after, 42,853 bytes both times.**

### 17f. Baselines after the audit

    bun test                                   115 pass / 0 fail   (was 61)
    bun run typecheck                            0 errors          (was none run; 165 on first run)
    node src/browser/ui-verify.mjs <label>     166 pass / 0 fail   (was none)

⚠ The browser suite drives REAL DEVICE PROFILES, not hand-picked widths — see
17g for why that distinction cost a shipped bug.

Run the browser suite against a server started with `FILTRSOFT_CRAWL=off`; a crawl
mid-run changes the counts underneath the assertions.

    FILTRSOFT_CRAWL=off bun run src/api/index.ts &
    node src/browser/ui-verify.mjs <label>

**Nine assertions failed across the five commits and eight of them were real
bugs.** The one that was not — a contrast reading of 1.99:1 — was the checker
treating a translucent ancestor background as opaque white; it composites the
layers now, because a checker that cries wolf makes the next real miss read as
another false alarm.

### 17g. ⚠ TEST REAL PHONES, NOT CHROME RESIZED INTO A PHONE SHAPE

Yish, 2026-08-31, on the shipped app: *"the ready, verify, risky, all filters
are squished together."* He was right, and he named the cause: the suite drove
a desktop browser in a narrow window at widths nobody's phone has.

**`isMobile: true` IS NOT A PHONE.** It sets touch handling and viewport-meta
behaviour. It does NOT set the user agent or the device pixel ratio. The old
harness also used `[375, 390, 768, 1024, 1440]` — numbers chosen by hand, not
measured from any device. His **Galaxy S24 is 360 CSS px at 3x**, narrower than
anything that was ever under test.

Measured on real Playwright device descriptors, before any change:

| Device | Width | "All 387" chip |
|---|---|---|
| iPhone SE | 320 | clipped **62px** past the edge |
| **Galaxy S24** | **360** | clipped **22px** |
| iPhone 14 | 390 | **clipped nothing** |
| Pixel 7 | 412 | clipped 13px (the Filters label appears above 400px) |

**The iPhone 14 row is the whole lesson.** 390 was one of the two widths under
test and it is the one width in that range where the bug does not appear.

#### Why five commits of assertions could not see it

- The only overflow assertion was `document.documentElement.scrollWidth`. That
  is a **PAGE-level** measure and read zero on every device, because the
  overflow was contained inside `.seg` and the document never scrolled.
- **`scrollWidth` on the control itself would not have worked either.**
  `.seg button` is `flex: 1`, so the chips stretch to whatever box they are
  given and `scrollWidth` tracks the container — it reads "fits" at every width
  while the labels are visibly cut off.
- ⚠ **The honest measure is each child's right edge against its container's.**
  That is what `clippedBy()` in `ui-verify.mjs` does.

#### The fix is structural, not a metric tweak

Tightening the padding bought **2px** of headroom at 360px, which is a
coincidence rather than a fit: the counts are DATA, and 387 becomes 1,204.

- **The Filters button moved to the TOP BAR**, beside Settings, freeing the
  whole row for the four chips. `.filtbtn`, rendered by `App` and shown only on
  Deals.
- Chip padding 8 → 6, gap 6 → 5, badge tightened. **Measured, not chosen. Do
  not loosen these without re-running the device sweep.**
- ⚠ **`.seg` SCROLLS RATHER THAN CLIPS.** A 320px screen genuinely cannot fit
  four labelled chips with four-digit counts at any padding, and the correct
  behaviour is that everything stays REACHABLE, not that the last one silently
  disappears. `Segmented` scrolls the selected chip into view, or the one piece
  of state the control exists to show ends up off-screen.

Splitting one control across two components needs a wire: `lib.tsx` grows the
same module-level pattern `toast` already uses — the bar publishes "open", the
feed publishes the active count. Chosen over lifting filter state into `App`
because the filters already live in the URL and the FEED is the only thing that
knows the facet counts the sheet renders.

#### The harness now

    const PHONES = ["iPhone SE", "Galaxy S24", "iPhone 14", "Pixel 7"];
    const DESKTOPS = [768, 1024, 1440];
    const PHONE = "Galaxy S24";   // every functional block runs on his phone

Playwright's descriptors carry viewport, DPR, UA, touch and mobile together.
Two new assertions: **no control may clip its own children**, and **four-digit
counts must stay reachable** (fits outright, or overflows into something
scrollable).

⚠ **`clippedBy` must skip zero-size and absolutely-positioned children.** A
`display: none` child reports a rect of all zeros, so a container that does not
start at x=0 reads as clipping it by exactly its own left offset — a perfectly
fine 768px top bar reported "104px past the edge" because the hidden desktop
nav sat at 0 while the centred shell started at 104.

**166 pass / 0 fail** (was 126 on hand-picked widths).

### 17h. On a desktop, Filtrsoft is a phone on a desk — and the wide shell is gone

Yish, 2026-08-31, after using the live site: *"on desktop when I go to
filtrsoft.com it looks goofy because it's meant for mobile ... have an outline of a
phone and then filtrsoft inside with the exact dimensions of the real app so they
both reflect the same thing."*

⚠ **THIS REPLACED THE WIDE DESKTOP SHELL. DO NOT REINSTATE IT.** The 1180px
shell with header navigation, a four-column grid and a two-column detail was
commit `6017540`, built for the audit, and is superseded by his call after
seeing it running. Both cannot exist: one of them has to decide what 1440px
means. `HeaderNav` and its CSS are **deleted**, not dormant — a component that
can never render is archaeology. That commit is the whole of it if it is ever
wanted back.

**360 × 780 CSS px, which is his Galaxy S24, deliberately.** "The exact
dimensions of the real app" means the desktop view is a true preview of the
device he carries: same width so the same things wrap in the same places, same
height so the same amount is above the fold. A generic 393×852 would be a
different phone and would disagree with his in exactly the way this exists to
remove.

#### Why this is not the fake phone frame that was deleted

There WAS a device mock here, and it shipped to real phones — gated at
**≥ 880px**, which a tablet and a large phone in landscape both clear, so the
app arrived on his phone as a desktop site pretending to be mobile: two-finger
scroll, pinch zoom, tiny text. Three things stop that repeating:

- **1024px, not 880.** No phone reaches it in either orientation.
- **Every rule is additive and scoped to the media query.** Measured on a real
  Galaxy S24 after the change: `transform: none`, `border: 0px`, `radius: 0px`,
  the document still scrolls natively. The phone layout is untouched.
- ⚠ **THE FRAME IS THE CONTAINING BLOCK FOR `position: fixed`, VIA A
  TRANSFORM.** Without it the tab bar, the filter sheet, the toasts and the
  lightbox resolve against the VIEWPORT and span the whole desktop window while
  the phone sits in the middle of them. It is the single most likely way to get
  this wrong and it looks broken rather than subtly off. `ui-verify` asserts the
  transform exists and that the tab bar and toasts are inside the frame's box.

#### ⚠ Viewport media queries misfire inside the frame

A media query asks the **WINDOW** (1440px), while the app lives in a 360px box.
Every `min-width` rule written for a wide screen therefore fires inside a phone:
three feed columns squeezed into 360px, a filter sheet centred as a desktop
dialog instead of rising from the bottom edge. Both are undone at the end of
`10-desktop.css`.

**ANY NEW `@media (min-width: …)` RULE ABOVE 360px NEEDS A COUNTERPART THERE**,
or it renders inside the phone and only on a desktop, which is the hardest kind
of bug to notice.

#### Scaling, not resizing

A 780px phone plus bezel and padding needs ~850px of window; laptops routinely
have less. The frame scales — 0.92 / 0.85 / 0.78 / 0.71 by viewport height — and
**stays exactly 360 × 780 CSS px at every step**, so the layout is identical to
his phone and the preview stays honest. Resizing the frame would reflow it into
a layout no device has.

#### Two pre-existing bugs the new assertions caught, neither desktop-only

- **The lightbox focus trap counted buttons the browser will not focus.**
  `button:not(:disabled)` matches `display: none` elements, and the prev/next
  controls are hidden below 560px — so on a **phone** the list was
  `[close, hidden-next]`, the wrap condition could never fire, and Tab walked
  out of the dialog into the page behind. Filter on
  `getClientRects().length > 0`; `offsetParent` is fooled by the dialog's own
  `position: fixed` ancestor.
- **The photo index was never clamped** and reached "Photo 14 of 10".

**164 pass / 0 fail.**

---

## 18. The 2026-08-31 pass — ten things Yish listed in one message

Nine of them shipped; the tenth is a diagnosis at the bottom that nobody has
acted on yet. Baselines after: **`bun test` 126 pass**, **`bun run typecheck`
clean**, **`ui-verify` 170 pass / 0 fail**.

### 18a. `.b-*` was emitted by four components and defined by nobody

*"The overlayed tags should not all be black, they should correspond with the
tag — if it's a buy it's green, verify is yellow, pass is black still, and risky
is red."*

`Gcard`, the feed hero, the Check history and the Saved grid have all rendered
``className={`gcall b-${call}`}`` since the feed was built and **there was never
a `.b-*` rule anywhere in the stylesheet**. Every one of those classes was
inert, so all seven verdicts drew the same dark chip with the same inherited
white ink. He was reading a control that had silently lost its only variable.

**BUY, VERIFY and RISK carry the colour as a FILL; PASS, FAIR and Can't tell
keep the dark chip with the hue as ink.** That is his traffic light, and it is
also what keeps every combination above 4.5:1 — a filled `--fair` purple
measures 4.29:1 against dark ink and 4.27:1 against white, failing BOTH
directions with no ink choice that rescues it.

**⚠ `--verify` IS AMBER NOW, NOT THE DEMO'S CYAN.** Cyan is `--brand`: the
wordmark, the segment indicator, the CTA and the focus ring. The one palette
entry carrying a JUDGEMENT was rendering in the same colour as ordinary chrome.
`docs/VAULTX-DESIGN-SYSTEM.md` records this as the single value in the system
that is deliberately not the demo's.

The dark chip went from `.82` to `.92` alpha because these sit on an arbitrary
photo and **the worst case is a white one**.

### 18b. Back, and it puts you where you were

*"The only back button that works is when I click the filtrsoft logo, but that
always brings me back to the top of the homepage."*

- **Back is on the photo** (`.dback`), where he asked for it. A listing with no
  photos gets the same control in flow above the title — `Gallery` returns null
  on an empty `photoUrls`, so hanging it only there would lose it on exactly the
  listings ZERO_PHOTOS fires on. Settings gets one in the top bar.
- **It calls `history.back()`, not `go("/")`.** Pushing `/` is a NEW entry, so
  the feed mounts as a forward navigation and lands at the top — which is what
  the wordmark already did. `depth` tracks how far into our own stack we are,
  because a shared link opens onto `/c/842` with nothing behind it and
  `history.length` cannot tell you that.

**⚠ THE BROWSER'S OWN `scrollRestoration` CANNOT DO THIS.** It restores when the
document is restored, which here is a mount with `items === null` and a feed 0px
tall; the attempt clamps to 0 and by the time 60 cards exist it has finished.
Restoration has to happen when the ROWS land, which only the feed knows.

**⚠ AND THE OFFSET ALONE IS NOT ENOUGH.** Press "Show more" twice, scroll to row
150, open a listing: a fresh mount fetches 60 rows and a saved offset of
14,000px clamps to the bottom of them. You land somewhere you have never been,
on a screen that looks like the restore worked. `restoreLimit` sends the row
count with the offset. Measured on a Galaxy S24: 119 rows, y=7405 → back → 119
rows, y=7405, **drift 0**. Same inside the desktop frame, where the scroller is
`.scroll` rather than the document — which is why `scrollHost()` READS the
overflow instead of assuming.

The spot is recorded in `go()`, not on the card: a card is one of several ways
out of the feed and any of them can be followed by Back.

**Recently viewed:** `pushHist` was called in exactly one place, the check
stream's `done` handler. A listing you PASTED was remembered and a listing you
TAPPED was not — and tapping is how the app is used, so the list was always
empty. ⚠ Side effect worth knowing: `OutcomePrompt` now has real history to draw
on, so "what happened with this one?" will appear far more often than it used
to. The Settings toggle turns it off.

### 18c. Two off-centre icons and a label 1px from its border

*"The saved tab has some buttons that are bugged like the browse deals and the
saved icon are not centered or cut off."*

Both from one character. **`.empty svg` is a DESCENDANT selector**, so its 12px
bottom margin landed on every icon anywhere inside an empty state. A margin
inside a `place-items: center` box shifts the item up by half of it: measured,
the saved bookmark sat 8px from the top of its 54px tile and 20px from the
bottom, and the icon in "Browse deals" 9px down in a 44px button with 21px
below. `> svg` fixes both.

**`.btn2` had ZERO horizontal padding.** Survivable in `.actions` and
`.sheetfoot` where a grid stretches it; fatal anywhere it sizes to its own
content. `.empty .btn2` is `inline-flex`, so "Browse deals" rendered 114px wide
with its icon 1px from the left border.

**`src/browser/button-audit.mjs` is the durable half**, and it is part of
`ui-verify` (section 13): 359 buttons across Deals, Check, Saved, Settings, a
listing, the filter sheet and the lightbox. Four checks — 44px target, children
inside the box, ink off a visible edge, content vertically centred — and each is
a bug that shipped past a screenshot review.

**⚠ TWO QUALIFICATIONS KEEP IT FROM CRYING WOLF, AND WITHOUT THEM IT IS
USELESS.** The ink rule applies only to buttons with a VISIBLE edge, and not
when a child is deliberately full-bleed. Without those it fired on all 60 feed
cards and the wordmark — 65 findings, none real, which is how the actual 1px
case would have stayed buried.

### 18d. The top of every screen, cut roughly in half

Measured on his Galaxy S24:

|          | head | first content |
|---|---|---|
| Deals    | 158 → **107** | 291 → **240**px of 780 (37% → 31%) |
| Check    | 158 → **107** | 223 → **172** (29% → 22%) |
| Saved    | 158 → **107** | 255 → **172** (33% → 22%) |
| Settings | 117 → **89**  | 214 → **154** (27% → 20%) |

The demo's rhythm is intact — badge, headline with one gradient accent word,
muted subtitle. It was the SCALE. A 32px headline is a landing-page headline and
this is a screen inside an app you have already opened.

**⚠ THE SUBTITLE IS ONE LINE AND THE COPY IS WHAT CHANGED, NOT THE MAX-WIDTH.**
A second line costs 18px on every screen forever. Verified unclipped down to
iPhone SE's 288px.

Saved and Settings were 32px worse than Deals for a reason neither chose: both
wrapped in `.sec`, which carries `margin-top: var(--s6)` for the DETAIL screen's
stacked sections. `.settings` went with it, having never been defined anywhere.

**"Ready" is "Buy it".** The card on a BUY listing has said "BUY IT" since the
feed existed, so the segment collecting them was the one place calling that
verdict something else. **The id stays `ready`** — it is a URL and a server
query. That rename is why segment padding went 6px → 5px: one extra character
put iPhone SE 3px into overflow, which `.seg` absorbs by SCROLLING rather than
clipping and so would have gone unnoticed.

### 18e. The detail screen's sections, in the demo's card language

All eight headers were `.sec h4`: 11px, uppercase, `.14em` tracked, muted grey.
Eight down a column read as one undifferentiated list of captions. `SecHead` is
an accent icon tile, a bold white title and one muted line — the demo's feature
card.

**⚠ THE ACCENT DESCRIBES WHAT THE SECTION IS, AND HERE THAT INCLUDES VERDICT
HUES.** Green for the money, cyan for evidence, purple for retail and flags,
amber for pickup checks, red for what the seller disclosed is wrong. The
SCREEN-level badges deliberately avoid verdict colours (`.eyebrow`) because an
amber badge reads as a judgement about the whole screen; a list of disclosed
defects painted green to satisfy a cycling rule would be a rule outranking a
meaning.

**Two cascade bugs surfaced by doing it, and both are the same shape:**

- **`.sec h4` was declared in THREE blocks across two files** with the
  properties split between them, so `.dhead h4` (0,2,0) simply lost to whichever
  `.sec h4` (0,2,0) came last — the new headers rendered as the exact thing they
  replace, which looks like the component was never applied. `.sec > h4` makes
  them describe different elements instead of competing.
- **`.t-*` set `background` directly.** Fine while a 7px dot was the only
  consumer, useless the moment the icon tile needed the same hue as a colour, a
  12% fill, a 26% hairline and a glow. It names a `--tone` now.

`--dur-exit` was used in 04-feed.css and **defined nowhere**, which invalidated
`.dealhero`'s whole `transition` declaration — the feed hero has had no
transitions at all. Same shape as the `--ink-1` bug; found the same way, by
sweeping for `var(--x)` with no matching `--x:`.

### 18f. ⚠ OFFERUP'S CARD IS NOT THE LISTING, AND FACEBOOK'S URLS DIE IN 2 DAYS

Two separate image bugs, both measured before either was touched.

**OfferUp.** *"OfferUp listings only show 1 photo in worse resolution than the
original, when the original listing has like 4 photos."* He is describing the
search CARD, which is all we ever read: one signed 250x250, and **OfferUp signs
per size**, so rewriting the dimensions returns 400. The detail page hands over
every slide at full size — measured on a real listing, **9 `<img>` tags carrying
4 DISTINCT photos, largest 1442x1922**, each with its own valid signature.

⚠ **THE SAME PHOTO APPEARS THREE OR FOUR TIMES PER PAGE WITH DIFFERENT
SIGNATURES**, so the FILENAME is the only stable identity. Deduping on the url
gives nine photos where there are four.

    bun run ou:photos [--limit 40] [--all] [--headless] [--dry]

149 listings, **596 full-size photos**, ~4 each against 1 tiny one.

⚠ **THE 640px FLOOR IS A CONTAMINATION GUARD, NOT A QUALITY PREFERENCE.** A
detail page also renders "similar items" as `images.offerup.com` thumbnails;
letting those through gives a listing ANOTHER listing's photos, and vision then
reads specs off the wrong machine — a confident wrong verdict, the worst failure
available here. Gallery slides are served at 720+, carousel thumbnails at 250.
The "for sale in" title check is the second half: OfferUp answers a dead item by
BOUNCING you to search rather than 404ing.

It is a separate pass on purpose — one browser visit per listing, against a
crawl that gets ~25 per page load.

**Facebook.** Every failing image on the live feed carried an `oe=` expiry in
the PAST and every working one about 40 hours ahead:

    403   oe -> 2026-08-30T11:34     (checked 2026-08-31T18:21)
    200   oe -> 2026-09-01T14:46 … 17:39

**The feed keeps a listing for 28 days, so from about day two every Facebook
card is guaranteed to render a broken image.** No proxy helps — the token is
dead, so the server 403s exactly as the browser does. Production cannot
re-crawl Facebook either; that needs his signed-in browser.

⚠ **`listing_thumbs` IS NOT THE RETENTION THAT FILLED THE VOLUME IN 2026-08.**
That was 316 MB of full-resolution photos for 654 listings, ~480 KB each,
unbounded, on the disk holding the database — 13 hours of crawler downtime while
the feed looked healthy. Every property that made it dangerous is inverted:

- ONE image per listing, enforced by a primary key
- 480px WebP q72 — **measured at 15–16 KB across 189 real listings**, not 480 KB
- a hard `MAX_BYTES` refusal, so a pathological encode is dropped
- pruned on the same 28-day window the feed uses, **with a test asserting the
  two numbers still agree**
- in the database, so a crash cannot leave an orphan directory
- `FILTRSOFT_NO_THUMB_CACHE=1` turns it off
- **`/v1/health` reports its size**, because last time every surface said
  healthy while the disk filled

Three capture points, **none of which adds a request**: the crawler reuses the
bytes `persistPhotos` already downloads for the perceptual hash; a push caches
at ingest, minutes after the crawl and the only moment production can fetch a
Facebook url at all; and the crawl tick backfills 25 a tick, **newest first**,
because the salvageable rows are the recent ones and an oldest-first backlog
spends every run on tokens that died days ago.

    bun run thumbs [--limit 200] [--prune] [--stats] [--refresh]

**⚠ THE BACKFILL ORDERS BY `listing_photos.captured_at`, NOT BY LISTING ID.**
The first version used `l.id DESC`, which is a proxy for how recently the
LISTING was created — a different quantity. Watched running against production:
188 thumbnails cached and **none of them Facebook**, the one source whose urls
expire, because those rows were pushed earlier while the container keeps minting
fresh Craigslist ids. It was working hardest on the source that needed it least.
Only visible by watching the counter; both orderings drain the same backlog and
only one wins the race it exists to win.

**⚠ AND A FAILED FETCH IS RECORDED, OR THE BACKFILL RETRIES IT FOREVER.**
`cacheThumb` writes nothing on failure, so a row that cannot succeed stayed
eligible and came back three minutes later, and again, for the 28 days the
listing lives. As the fetchable rows drain the queue converges on exactly the
rows that can never succeed, and the loop settles into 25 pointless requests
every three minutes against three CDNs — ~12,000 a day, growing with the feed.
`listing_thumb_misses` gives each url a **budget of 3**, and a re-crawl that
re-signs the url resets it.

**It is a budget rather than a tombstone because most failures were OURS.**
Measured: the tick cached ~5 of 25 attempted while only **10% of the remaining
urls were actually dead**, and the same urls fetched **40/40 from a laptop**. A
small container running this alongside crawling, scoring and vision was timing
itself out. So the tick backfill went 6 workers / 8s to **3 workers / 20s** —
trading wall-clock, which a 3-minute tick has, for yield, which a 48-hour
expiry does not. And the tick logs MISSES as well as hits; logging only
successes is what made a 20% yield look like "there were only five to do".

### 18h. ⚠ A SPEC SCREEN IS EVIDENCE *FOR* THE SELLER — engine 0.3.26

Yish, 2026-08-31, on the RTX 5090 listing in §2: *"the image itself is a photo
of the computer's specs verified on the monitor of the PC, making this extra
trustworthy, not a red flag ... a lot of the time there is a screenshot or an
image of proof of specs which usually states the model or type of ram, cpu,
gpu."*

**The engine was disagreeing with itself.** The vision prompt calls a spec
readout *"the highest-value image in any listing"*, and `photos/index.ts`
records the Phase 0 miss where an entire spec sheet sat in photo 3 — while
`screenshotArtifacts` asked for *"any UI chrome proving the photo was
screenshotted from another app"*, which a photo of Task Manager is covered in.
The two fields OVERLAPPED and the overlap was scored as fraud, at HIGH severity,
on exactly the listings a diligent seller produces.

⚠ **THE DISCRIMINATOR IS WHAT THE CHROME IS WRAPPED AROUND.** A photo of the
ITEM inside another app's UI means the seller may not own it — a SAVE icon is
the strongest form, because you only save a photo somebody sent you. A SPEC
READOUT on the item's own display means he does own it and is showing you.
`PROMPT_VERSION` 2026-08-31.1 states that exclusion in capitals.

The bug had four layers and all four are fixed:

- `visionSignals` emits **`SPEC_SCREEN_PROOF`** — positive, `info` severity.
- **Vision signals carry their own polarity.** `engine/index.ts` pushed every
  one of them with a hardcoded `polarity: "negative"`, so a positive finding
  from a photo was *structurally impossible to express*.
- `SCREENSHOT_ARTIFACTS` drops to `medium` when the listing also shows a spec
  screen. ⚠ **That guard is for the CACHE, not the model** — vision results are
  keyed on photo CONTENT, so every stored row came from the old prompt and keeps
  serving until re-analysed. A downgrade rather than a suppression, because a
  seller can post a genuine spec screen AND a lifted product photo.
- **A positive signal no longer generates a question.** Asking *"could you send
  photos you've taken yourself"* of someone who already posted a spec readout is
  the app telling him his proof does not count.

Verified against the 66 stored vision results mentioning the field. **Listing
#624 is the case exactly**: artifacts read *"Ubuntu system screen with
orange-bordered boxes containing spec information"* — a spec screen, reported as
fraud. It now reads `[info/positive] SPEC_SCREEN_PROOF` plus a demoted note.
Eleven more listings gain a positive signal they never had.

⚠ `checkStored` calls `loadVision(listingId)` with **no prompt-version filter**,
which is what makes the ENGINE_VERSION bump enough: production re-scores with
the new handling immediately instead of waiting on paid re-analysis. The
PROMPT_VERSION bump only affects newly analysed listings.

### 18i. Known nuance: the detail screen mixes a STORED verdict with LIVE signals

`/v1/checks/:id` returns the **stored** verdict payload but recomputes signals
through `checkStored` on every request, and only swaps in the fresh verdict when
the caller passes `?drive=`. Both halves are deliberate — the feed and the detail
must agree on the call, and "what's flagged" has to be current — but it means
the flags on screen can disagree with the questions beside them when a listing's
text has changed since it was last scored.

Measured 2026-08-31 across 40 listings: **39 identical, 1 different**, and the
next re-score fixes it. Rare and self-correcting, so it is written down rather
than fixed. Do not spend an afternoon on "why do the flags not match the
questions" without checking this first.

### 18j. ⚠ WHY "CAN'T TELL" IS 77%, MEASURED PROPERLY THIS TIME

Yish, 2026-08-31: *"I NEED YOU TO CHANGE ALMOST ALL OF THE CANT TELL LISTINGS TO
EITHER PASS, FAIR, RISKY, VERIFY, or BUY ... this was a cant tell listing and it
was hidden from me and its a pretty good deal."*

⚠ **IT CANNOT BE DONE BY LOOSENING A GATE, AND §1 IS THE REASON.** *"Missing a
deal costs nothing. Sending someone 45 minutes to a scam ends the brand."*
Converting an unpriced listing to a call it cannot support is a confident wrong
answer, which is the one failure this product is built to avoid. What follows is
where the 489 actually come from and which ones are genuinely recoverable.

Measured over every live listing inside the 28-day window:

| | reason | what it needs |
|---|---|---|
| **287** | "Can't be valued: `<spec>` not stated" | the seller never said |
| **136** | "Couldn't identify the exact model" | the long tail — see §7 |
| **48** | "No recent sold comps for this model" | **`bun run ebay:comps`** |
| 9 | Custom build, too few component comps | comps |
| 8 | "Specs are known, market prices aren't" | comps |

Of 111 builds where the engine DID resolve a parts list, only **13 CPUs and 12
GPUs** failed to price. The parts pipeline is working; the catalog is what is
thin.

#### The two real bugs behind his listing, both fixed

**The truncated title won.** Title `"… RTX 5080 / Ryzen 7 9800X"`, description
`"AMD Ryzen 7 9800X3D"`. `.match()` returns the FIRST hit and the title comes
first, so the engine recorded a chip that does not exist, found no SKU, and the
build fell to 0.42 coverage — under the 0.55 gate. **86 of 600 live listings had
their CPU or GPU corrected** by taking the fullest spelling instead. It also
closes the attribute half of §5's `RTX 3080 Ti` limitation.

**OfferUp and Mercari had 0% description coverage — 161 listings with nothing
but a title**, against 1% empty for Craigslist and 0% for Facebook. A search
CARD has no description and nothing ever opened the item page for text. That is
a third of everything unpriced, and `ou:photos` was already visiting every one
of those pages for the gallery.

#### ⚠ GATE 4b IS CORRECT. DO NOT REMOVE IT.

`verdict/index.ts` refuses a parts valuation below **0.55 coverage**. On his
listing that meant discarding a computed median of $2,233.72.

That looks wrong and is not. `ROLE_VALUE_WEIGHT` puts the GPU at 0.42, so a
GPU-only valuation extrapolates a whole machine from ONE component using a fixed
weight — and this build has an X870E board, a 1000W PSU, an O11 Vision case, a
360 AIO and six wireless RGB fans, so its non-GPU share is far above typical.
Calling it "overpriced at $2,600" off the card alone would be exactly the
confident wrong answer the gate exists to stop.

⚠ **`PRICEABLE_ROLES` IS ONLY gpu/cpu/ram/storage, so maximum achievable
coverage is 0.82.** The gate needs GPU + CPU (0.64) at minimum. That is
reachable — it just needs the CPU to price, which is why the truncation bug
mattered so much and why the missing `Ryzen 7 9800X3D` SKU is the remaining
blocker on that specific listing.

#### What actually moves the number, in order

1. **`bun run ebay:comps`** — 48 listings are matched and waiting on comps, and
   every part the catalog gains lifts builds over the coverage gate. Needs his
   eBay login. **This is the single highest-value thing left in the product.**
2. **OfferUp descriptions** — shipped; run `bun run ou:photos --all`.
3. **The scope gate** — junk still reaches a verdict (§18g): PS2 games, a phone
   case, a CRT TV, a Cisco PSU. Cheapest win, needs an `ENGINE_VERSION` bump.
4. **NOT a looser matcher.** §7: 39 hand-written laptop SKUs moved the unmatched
   count 125 → 132.

### 18g. OPEN, NOT ACTED ON: 77% of the feed cannot be priced

*"There's only 1 buy out of 578 listings."* Measured across all 708 production
listings on 2026-08-31:

| | | |
|---|---|---|
| **545** | INSUFFICIENT_DATA | **77.0%** |
| 108 | PASS | 15.3% |
| 25 | RISK | 3.5% |
| 15 | VERIFY | 2.1% |
| 13 | FAIR | 1.8% |
| **2** | **BUY** | **0.3%** |

**The BUY count is not the engine being strict — it is that three quarters of
the feed never gets priced at all.** Of the 163 listings that CAN be priced,
only 12 clear the profit floor, and 9 of those are held at VERIFY by an
unresolved risk, which is `riskGate` doing exactly its job.

The 545, by the reason the verdict itself gives:

| | |
|---|---|
| 318 | "Can't be valued: `<spec>` not stated" |
| 158 | "Couldn't identify the exact model" |
| **51** | **"No recent sold comps for this model"** |
| 9 | Custom build, not enough component comps |
| 9 | Specs known, market prices aren't |

⚠ **THE BREAKDOWN ABOVE WAS A FIRST PASS. §18j MEASURES IT PROPERLY** — by the
reason each verdict gives, with the two bugs behind it found and fixed. Read
that one; this section is kept for the headline number and the argument.

Two things stand out and neither has been done:

1. **A lot of it is out of scope entirely** and should never have reached a
   verdict: *"20 PlayStation 2 Games"*, *"PS5 video game Warhammer 40,000"*,
   *"Vintage Symphonic 9-inch CRT TV/VHS"*, *"Astec Cisco System Power Supply"*,
   *"Otterbox Defender Phone Case"*. Those are media and accessories — already
   out of scope per section 1 — and they are padding the "Couldn't price these"
   bucket he has said twice he does not want. Tightening the grammar gate is the
   cheapest win here, and it needs an `ENGINE_VERSION` bump so production
   re-scores.
2. **51 listings matched a SKU and have no comps.** That is `bun run ebay:comps`
   on his machine, and it is the only one of these that is purely a data pull.

⚠ **DO NOT "FIX" THIS BY LOOSENING THE MATCHER.** The 158 unidentified include
real gaps (*"HP Victus RTX 4050 Laptop"*) and genuinely unidentifiable listings
(*"Gaming pc"*, *"Pc whole setup"*). Section 7 already records that
hand-enumerating the catalog does not work — 39 hand-written laptop SKUs moved
the unmatched count 125 to 132.
