for (let i = 0; i < 22; i++) {
  try {
    const j = await (await fetch("https://assyze.com/v1/health")).json();
    const tag = `${j.comps}/${j.skus}`;
    if (j.comps >= 15294) { console.log(`ARCHIVE IMPORTED: ${tag}`); process.exit(0); }
    console.log(`  waiting… prod=${tag}`);
  } catch (e) { console.log("  waiting… (no response)"); }
  await new Promise((r) => setTimeout(r, 25000));
}
console.log("still not imported after ~9 min");
