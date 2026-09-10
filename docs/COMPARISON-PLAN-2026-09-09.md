# Hardware comparison and competitor research

Yish requested researched marketplace/competitor opportunities, followed by a real CPU/GPU/PC-parts comparison experience with important metrics, transparent scores, a cinematic interaction and seller contact actions. The research recommendations stay report-only until he chooses them. Existing main/Railway authorization remains in effect.

## Plan

1. Research primary competitor sources and usable benchmark datasets in parallel. Root is the sole code editor; supporting agents are read-only. Inspect real stored listing evidence before designing the data contract.
2. Add a bounded authenticated comparison API using recorded listing facts, explicit variant matching, cited benchmark snapshots and deterministic workload-specific relative scores. Keep unknowns, conflicts, sample counts, test context and data freshness visible. No catalog-default specifications, universal guessed performance, re-scoring, paid data, credentials, or duplicate marketplace crawl.
3. Build a dedicated responsive Compare workspace in both themes. Select two actual listings, switch CPU/GPU/memory/storage views, stage a brief optional comparison reveal, inspect measured metrics and differences, and open the real seller listing under each side. Controls remain usable immediately; skip/replay and reduced motion are required.
4. Check real examples and failure cases early. Test exact variants, incompatible benchmark groups, unknown asking prices, partial evidence, account filtering, route/history, motion, responsive layouts and contact links. Complete release checks once; repeat only affected checks after new fixes.
5. Publish the comparison feature and verify served build/CI. Update HANDOFF and deliver a sourced, prioritized feature research report for Yish's next choices.

## Data and contact decisions

- Blender Open Data provides a public-domain workload-specific baseline; it measures rendering rather than gaming. Select a fixed benchmark version and preserve compute backend and sample count.
- Gaming evidence must come from clearly identified original measured test suites. Do not turn cores, GHz, VRAM or theoretical FLOPS into an estimated gaming score. Different GPU memory variants and desktop/laptop parts must not silently inherit each other's score.
- A component benchmark describes the identified model in the cited test context, not a benchmark run of the seller's actual machine. Whole-PC asking prices cannot become standalone CPU/GPU price-performance claims.
- Message seller opens the exact recorded source listing with a clear platform label. Craigslist Reply/contact options and Facebook chat are completed by Yish on the source platform; do not invent seller IDs, expose relay addresses, or auto-send anything.

Status: research complete; comparison API/UI implemented locally, targeted identity/math tests passing, browser review underway. Yish chose gaming performance/value and free-only data. UserBenchmark supports verified outbound references; free native API/republication access remains unverified. A broad native gaming-score layer is therefore unavailable, explicitly, rather than filled with rendering numbers. No new deployment yet.

Release checks complete locally: 296 tests / 880 assertions / no failures on Windows and Linux ARM64, TypeScript, Vite, verification/production images. Six comparison browser groups plus 15 affected detail groups pass. Numeric rendering references are scoped to the pinned cohort and exact model; mixed memory revisions, portable families, multiple models, bundle prices and stale facts decline a winner. Native amd64 CI and deployed build verification are the remaining release checks. The native gaming-score requirement remains a documented source limitation.
