# Filtrsoft: full project audit, implementation, AI strategy and operating workflow
Prepared September 22, 2026 for Claude Code using Opus 5.5.

I am Yish (Yishai Gershon), Filtrsoft's owner and actual user. Take engineering ownership for this implementation pass. Understand the entire project, find its real weaknesses, fix everything you can substantiate and safely complete, and settle the architecture and daily workflow that will make this an exceptionally useful personal tool.

This is implementation plus verification, not an audit that ends with a list of suggestions. Build a structured plan, investigate and implement iteratively, review your changes, ship the tested result, and leave clear operating instructions. Spend the time needed for substantial improvements. Do not equate a large diff, more features, more crawls or passing tests with a better product.

## 1. The outcome I care about

Filtrsoft scans used consumer technology around Greater Boston and helps me decide what is worth pursuing before I drive. Its advantage should be fast discovery, accurate specifications and sold-price evidence, realistic profit calculations, and detection of hidden problems.

I want a small stream of genuinely worthwhile, currently available opportunities on my phone. I need to understand the item, its asking price, the evidence for its value, the risks, the missing information, and the next useful action without constantly leaving the app. Notifications should be timely and worth opening. The system should run reliably on my OMEN without continual babysitting from either computer.

Optimize for my personal buying/reselling workflow. Do not turn this into a generic public SaaS or change registration, repository visibility, billing or access policies as an unsolicited product decision. Existing account creation, Google sign-in and account sync must keep working.

Reliability over coverage remains the central rule. An unsupported BUY wastes my time and money. INSUFFICIENT_DATA is correct when decisive evidence really is missing. Your job is to obtain, interpret and connect the evidence, and to remove unnecessary technical blockers to a supported decision. Do not lower accuracy or matching standards to make the counters look better.

My market knowledge matters. Verify hardware and prices against current sources and stored evidence, not your training memory. Do not dismiss a product or my experience because you do not recognize it.

## 2. Start from actual state and preserve the running system

This is an existing project, not a rebuild. Read applicable AGENTS.md/CLAUDE.md instructions, HANDOFF.md section 0, relevant docs and recent Git history. Identify the actual host, repository, installed collector, development checkout, production release and other active sessions. Inspect before editing.

The private repository is https://github.com/yzgershon/filtrsoft.git. Common paths are C:\Dev\filtrsoft, C:\Dev\filtrsoft-backend and installed OMEN runtime C:\Dev\filtrsoft-agent; use the runner's actual configured paths. Preserve desktop-specific commits and dirty work. Do not reset, overwrite Dev, reinstall the collector, replace its database/archive or stop unrelated processes.

The OMEN is primary and the laptop stays paused. Preserve the original node/sync identities, outbox, browser profiles, startup, pause/fallback policy, user labels and overrides. Use isolated development. Update the installed runtime only through its own safe maintenance procedure with a consistent, restore-verified SQLite backup and owned-process shutdown. Keep one active owner per browser profile. Continue useful collection while developing, with bounded maintenance at deployment.

Architecture: Bun + TypeScript + SQLite backend; Node .mjs Playwright workers; React/Vite frontend; Railway production deployed from main. Browser work runs under Node because Playwright under Bun has hung here. Worker extraction emits evidence; source interpretation remains testable TypeScript. SQLite uses WAL and busy_timeout. Bump ENGINE_VERSION when verdict behavior changes. Collector/server/archive populations and local/live results are distinct.

### Newer checkpoint that supersedes older prompts

The laptop fetched main b8fa54c on September 22. Its committed September 17/18 final checkpoint records:
- Functional 3367d18, engine 0.3.47, installed OMEN merge e73d18795a256878fb96160cb5cea1f358e1e538.
- The original frozen 250: 6 PASS, 4 FAIR, 5 RISK, 15 unavailable, 220 insufficient; zero BUY/VERIFY.
- 229 complete reads, 15 unavailable and six deferred. The old 59-complete-read finding is superseded.
- A real leased identity resolver and catalog synchronization were implemented. The old finding that comp_identity_demand had no consumer is superseded; inspect the implemented resolver and its remaining gaps.
- Overlapping remaining blockers included 157 exact identities, 45 exact-configuration sales and 33 recent-comp gaps. Counts overlap; do not sum them.
- An off-host production backup was streamed to the OMEN and restore-verified. The old claim that no production backup succeeded is superseded, although production physical space remained very low.
- Both scheduled and interactive paid Claude reads were explicitly approved paused and verified off; applicable cached facts were preserved.
- Qwen3.5-9B and Qwen3-VL 4B/8B failed the prior factual gates, and the local fact writer remained disabled at that checkpoint.
- Four catalog synchronization deferrals and source retry state remained; an empty listing outbox did not mean every kind of work was complete.

Read docs/EVIDENCE-RECOVERY-FOLLOWUP-2026-09-17.md and docs/LOCAL-VISION-FOLLOWUP-2026-09-17.md. Original cohort, production restore and evaluation artifacts were kept privately under C:\Dev\filtrsoft-recovery-data, outside Git.

Those are historical receipts, not today's measurements or reset targets. I now refer to a local model as "Gemma 31B"; identify its exact installed model tag, version/digest, quantization, configuration, integration and results on this machine. It may be newer local work absent from main. Do not silently substitute another Gemma or assume it passed evaluation.

## 3. Audit the complete path and act on the findings

Map the flow from search query to source card, full listing, availability, facts, identity, sold comps, valuation, feed, notification and my final outcome. For each stage establish input, output, owner, durable state, failure behavior and measurable success. Find dropped work, incorrect terminal states, stale facts, missing consumers and differences between local and production behavior.

Audit these connected areas, not only the recently edited code:
- Discovery relevance and coverage across Craigslist, Facebook Marketplace, OfferUp and Mercari; geographic relevance, time windows, duplicate/reposted ads, misleading search hits and query starvation.
- Full text and all-photo acquisition, expanded descriptions, image failures, changed seller facts, stale photos, source identity, sold/unavailable checks and challenge/login handling.
- Parsing and classification across PCs, laptops, phones and individual parts; inventories, bundles, placeholder prices, price tiers, desired trades, accessories, compatibility mentions and historical/removed components.
- Catalog coverage, aliases, manufacturer identifiers, variants, identity conflicts, exact demanded comp queries, query backoff, acceptance/rejection explanations and freshness.
- Valuation, fees, shipping, travel/time and profit requirements; uncertainty, condition, damaged hardware, carrier/activation/MDM locks and other hidden problems.
- SQLite growth, WAL/checkpoints, migrations, retention, restore testing, job leases, source fairness, backpressure, retries, acknowledgements, deduplication, ingestion clocks and collector maintenance.
- API responsiveness, startup/deployment behavior, authentication, authorization, input validation, account isolation, preferences/sync, offline behavior and secrets handling.
- The entire phone and desktop experience, accessibility, loading/error states, navigation, detail tabs, specifications, evidence links, photos, search/filter state, labels and recovery from failures.
- Alert matching, opt-ins, freshness, duplicate suppression, cooldowns, relevance, saved searches, price changes and actual end-to-end delivery.
- Deployment, CI, browser/runtime dependencies, diagnostics, supportability and instructions for continuing work across my laptop and OMEN.

Build a prioritized backlog with evidence, user impact and acceptance criteria. Fix the high-impact problems as you find them. Include justified structural improvements when they remove repeated failures. Avoid unrelated redesigns, speculative rewrites and arbitrary complexity.

Keep exact quantities, kit layouts, ECC, GPU suffixes/AIB variants, phone storage, laptop configurations, whole-machine identity and condition distinctions intact. A single stick is not a kit; a component sum is not automatically whole-PC resale value. Crypto as an optional payment method is not equivalent to crypto-only payment. Unseen ports are not proof of absent ports. Negations and seller uncertainty must survive parsing.

Consoles remain outside my chosen scope. Preserve manual judgments without pretending they are independent engine recommendations. Keep unknown facts and source disagreements visible.

## 4. Decide and implement the right AI strategy, explicitly evaluating GPT-6 Luna

I want GPT-6 Luna seriously evaluated as the main inexpensive vision and structured-extraction model, and for other specific tasks where AI provides measured value. Compare it with the actual installed Gemma baseline. Do not automatically choose the local model because it has no API fee or choose Luna because it is new.

Official documentation checked September 22:
- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/pricing
- https://developers.openai.com/api/docs/guides/images-vision

The model card supports image input and structured outputs. Standard short-context rates are $0.10 per million input tokens, $0.01 cached input and $0.50 output; other processing/context/cache/tool charges can differ. Verify the current exact model ID, availability, account access, image accounting and rates before implementation. Cheap does not mean free. No paid inference has been authorized merely by this prompt's price estimate.

Inventory every existing AI call, prompt, schema, provider/model gate, cache key, cost ledger and production consumer. Separate the coding assistant from models used inside the deployed app.

Produce a workload-by-workload decision table covering:
- Deterministic extraction that should remain ordinary code.
- Image transcription and specification extraction.
- Seller-text interpretation and ambiguous inventory/bundle descriptions.
- Evidence-grounded identity candidate generation and resolution.
- Condition/risk evidence extraction.
- Duplicate detection, query assistance, summaries or other AI uses only where demonstrated useful.
For each choose code, local model, Luna or an explicitly justified alternative; document quality, latency, cost, uncertainty and fallback. The evidence engine must validate model suggestions. Do not let free-form model opinion supply current market prices, invent hardware specs, bypass sold-comp matching or decide arithmetic/access control.

### Evaluation and factual acceptance

Inspect the previous harness, ground truth and failures before reusing it. Preserve original photos and raw responses, model/prompt/schema versions, input hashes, reasoning settings, stop reasons, truncation, token usage and hardware observations. Check scoring normalization, wrong field placement, placeholders, duplicates, image-to-case mapping and GPU-deferred failures. Distinguish scoring errors from real fabricated facts.

Use representative real listings and manually pixel-grounded annotations, including held-out examples not used for prompt tuning. Include exact CPU/GPU suffixes, kits/individual sticks, ECC, storage, confusing product labels, unreadable images, contradictory photos, screen damage, negative examples and multi-item ads. Every photo matters; do not silently skip a photo containing the spec sheet.

Compare actual Gemma and Luna on the same relevant cases. Measure per-field precision/recall, unsupported critical facts, false risk claims, abstention, task completion, latency, retries and cost per successfully validated listing. Test source text and image-only reading separately so text leakage does not masquerade as visual accuracy. Never use another model's unsupported judgment as ground truth.

Keep the existing factual gates. Narrow supported scopes must be declared and tested before deployment; do not quietly lower the gates after failure. If evidence is unclear, abstain. No finite test set proves perfection.

### Cost and deployment controls

Calculate cost using observed image/text tokens, outputs including billable reasoning where applicable, retries, cache behavior and actual daily unique work. Report per 1,000 listings and daily/monthly scenarios with explicit assumptions; include local latency, memory, energy/resource use where measured and gaming contention. Do not invent wattage or savings.

Prefer targeted inference after full text, cache unchanged evidence, and prioritize fresh opportunities. Use asynchronous inference where appropriate; ordinary feed requests must not wait on slow model calls. Model outages, exhausted budgets or an offline OMEN should produce queued/explicitly unresolved work, not dropped listings or silent expensive fallback.

Prepare a provider adapter, testable schemas, true provenance, versioned cache compatibility, concurrency-safe hard spend caps, retry limits and feature flags. Keep applicable historical evidence usable without labelling local results as Claude or Luna. Validate synchronization and downstream consumption, not just a standalone demo.

Use existing session approvals. If API access or a paid benchmark budget is missing, prepare everything independent first and give me one concrete request naming the proposed maximum benchmark spend. I handle any secret entry myself. Do not buy credits, add subscriptions, increase budgets, automatically resume paused Claude calls or assume my coding subscription pays for app API usage. Missing approval blocks paid calls, not the rest of this task.

If Luna wins and its operating budget is approved, ship it through a bounded shadow evaluation and controlled rollout with rollback. If another arrangement performs better, explain and implement the supported choice within existing approvals. Preserve Gemma and its state until replacement is verified.

## 5. Define the product and daily workflow I should actually use

Write and implement a clear workflow across Railway, OMEN, laptop and phone:
- What runs where, when it runs, and how updates reach the actual installed collector.
- What happens when I game, sleep the PC, lose network, hit a source challenge or run out of an inference budget.
- What the app should show me first each day and what is worth a push notification.
- How I inspect specifications, value and concerns, open the original listing, save or dismiss it, record a purchase/pass, and review what happened later.
- How account preferences, labels and outcomes sync across devices.
- How the system exposes stuck work and actionable recovery without making me operate a database console.

Identify high-leverage improvements such as watched exact hardware, meaningful price drops, restock/repost handling, deduplicated opportunities, justified negotiation ranges, pre-purchase checklists and outcome learning. Rank them by actual usefulness, data feasibility and maintenance cost. Implement the justified priority improvements that fit the architecture; do not stop at a feature wish list or clutter the app with unsupported numbers.

Preserve the app's established useful patterns: compact mobile experience, full desktop layout, organized detail tabs, trustworthy specifications, swipeable photos, linked original titles and sold examples, light/dark modes, account sync and relevant follow-ups tied to actual interest. Inspect the current UI before changing it. Use relevant installed design skills for substantial visual work, and verify rendered mobile/desktop output and built CSS.

I want a reliable advantage in my market. Do not promise a fixed number of BUY recommendations or relabel overpriced listings to make the feed exciting. Measure false recommendations, missed opportunities in audited samples, freshness and time saved as well as coverage. A review batch can be small while the full underlying feed remains available.

## 6. Measure results, verify the release and finish the work

Keep the original 250-ID cohort reproducible, including its known scope error. Take a fresh baseline before this pass, and add a separate representative fresh-listing cohort so success is not overfitting an old sample. Record every blocker and whether it can be resolved automatically or needs seller information. Retire unavailable rows recoverably and count them separately from newly valued listings.

Manually audit recovered BUY/VERIFY recommendations, changed risk calls and representative remaining unknowns. Report new exact facts, identities resolved, comp queries that actually enabled valuations, newly priced rows, correct risks, unavailable retirements and still-unsupported rows separately. Maintain distinct original-to-now and this-pass comparisons. Zero recommendations does not establish a zero false-positive rate.

Write failing-before regressions for meaningful defects and integration tests that follow real evidence through uploads, identity, comps, scoring and alerts. Run relevant tests, full suite, typecheck, build, CI/container checks and browser checks appropriate to changes. Use isolated databases for tests and avoid paid calls in the test suite. Verify labels/auth/sync cannot leak across accounts.

I authorize ordinary reversible implementation, refactoring, tests, recoverable listing retirement, commits, pushes to main and the resulting Railway production deployment. Preserve remote changes; never force-push or publish private configuration. Do not override Git authorship or add AI co-author attribution. Ask before spending money, unapproved installations, release publication/tags, destructive deletion, seller messaging or unrelated infrastructure/security changes. Reuse approvals already given in the current session.

Deploy compatible server changes before collector protocol changes require them. Verify CI, production source/engine/assets, relevant live behavior, installed runtime revision and identities, actual acknowledgements/cursors, scoring completion, API responsiveness, backup recovery and resumed collection. A source commit is not an installed runtime, an empty queue is not a caught-up cursor, and a push-service acceptance is not physical notification display. Do not send fake deals or seller messages to manufacture proof.

Keep a durable plan and findings ledger, update HANDOFF.md at every meaningful checkpoint, and save evidence-backed architecture/AI/workflow decisions. Continue until prioritized work is implemented and verified or genuinely blocked by unavailable evidence, access or approval. Do not stop merely after orientation, the first patch or a proposed plan. Do not burn time generating arbitrary features to claim "everything" is done.

Finish with:
1. What changed and why it improves my actual workflow.
2. Measured before/after outcomes, remaining blockers and representative corrected cases.
3. The chosen AI routing, model comparison, supported scope and realistic operating cost.
4. Exact release/runtime receipts and verification limits.
5. A concise daily operating guide for me and the few remaining decisions that truly need my input.

Be ambitious, direct and skeptical of your own results. The goal is a system I can trust and use every day.
