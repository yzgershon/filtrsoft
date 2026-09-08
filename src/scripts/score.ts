/** Current Your call regression set. Replay on a disposable DB snapshot because
 * the normal matcher can derive catalog identities; never write shared verdicts.
 */
import {evaluateLabels} from "../tracker/labels.ts";
import {mkdirSync,writeFileSync} from "node:fs";
import {join} from "node:path";
const replay=process.argv.includes('--replay');
if(replay && !process.env.FILTRSOFT_DB)throw new Error('Replay requires FILTRSOFT_DB pointing to a disposable snapshot');
const result=evaluateLabels(replay);
console.log(JSON.stringify({measuredAt:result.measuredAt,mode:result.mode,summary:result.summary,limits:result.limits},null,2));
if(process.argv.includes('--export')){
  const dir='backups/evaluations';mkdirSync(dir,{recursive:true});
  const path=join(dir,`labels-${Date.now()}.json`);writeFileSync(path,JSON.stringify(result,null,2));console.log(path);
}
