import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { expect } from "bun:test";

/** db() is a singleton: use a fresh process, never the developer's database. */
export function isolated(code: string) {
  const directory = mkdtempSync(join(tmpdir(), "filtrsoft-regression-"));
  const root = new URL("../", import.meta.url).href;
  const script = `import assert from 'node:assert/strict';\n` + code.replace(/from '@\/(.*?)'/g, (_, p) => `from ${JSON.stringify(root + p)}`);
  try {
    const result = Bun.spawnSync({cmd:[process.execPath,"--eval",script],cwd:directory,
      env:{...process.env,FILTRSOFT_DB:join(directory,"fixture.db"),FILTRSOFT_AGENT_STATE:join(directory,'runner-state'),FILTRSOFT_AGENT_LOCK_DIR:join(directory,"runner-locks"),FILTRSOFT_PHOTOS:join(directory,"photos"),FILTRSOFT_VISION:"0"},stdout:"pipe",stderr:"pipe"});
    expect({exit:result.exitCode,error:new TextDecoder().decode(result.stderr)}).toEqual({exit:0,error:""});
  } finally {
    // Verify the generated target stays directly under the temporary directory.
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !directory.includes("filtrsoft-regression-")) throw new Error("Unexpected fixture path");
    rmSync(directory,{recursive:true,force:true});
  }
}
