for (let i = 0; i < 18; i++) {
  try {
    const j = await (await fetch("https://assyze.com/v1/health")).json();
    const f = await (await fetch("https://assyze.com/v1/feed?limit=1")).json();
    const mins = f.lastCrawl?.started_at ? Math.round((Date.now() - Date.parse(f.lastCrawl.started_at)) / 60000) : null;
    console.log(`db ${j.comps}/${j.skus} · archive ${j.archive?.comps ?? "?"}/${j.archive?.skus ?? "?"} · lastCrawl ${mins}m ago`);
    if (j.comps >= 15294) { console.log("\n>>> ARCHIVE IMPORTED"); process.exit(0); }
  } catch { console.log("  …"); }
  await new Promise((r) => setTimeout(r, 30000));
}
