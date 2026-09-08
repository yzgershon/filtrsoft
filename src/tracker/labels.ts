import {db,now} from "../db/index.ts";
import {runPipeline,ENGINE_VERSION} from "../engine/index.ts";

/** Current account labels, with their own historical view. Clearing a label
 * removes it from evaluation without deleting the append-only judgment history.
 */
export function evaluateLabels(replay=false,userId?:number) {
  const rows=db().query(`SELECT * FROM (SELECT a.user_id,o.listing_id,o.call human,o.created_at labeledAt,o.decision_json,
    ROW_NUMBER() OVER(PARTITION BY a.user_id,o.listing_id ORDER BY o.created_at DESC,o.device_ref) rn
    FROM verdict_overrides o JOIN account_devices a ON a.device_ref=o.device_ref
    WHERE (? IS NULL OR a.user_id=?)) WHERE rn=1`).all(userId??null,userId??null) as any[];
  const cases=rows.map(r=>{
    const prior=r.decision_json?JSON.parse(r.decision_json):null,p=prior?.provenance;
    let result:any=null,error:string|null=null;
    if(replay && p?.facts && 'visionEvidence' in p) {
      try {result=runPipeline({...p.facts,raw:{}},p.visionEvidence,{econ:p.economics.values,driveMinutes:p.economics.driveMinutes}).verdict;}
      catch(e){error=(e as Error).message;}
    } else if(!replay) {
      const v=db().query('SELECT payload FROM verdicts WHERE listing_id=? ORDER BY id DESC LIMIT 1').get(r.listing_id) as {payload:string}|null;
      result=v?JSON.parse(v.payload):null;
    } else error='No frozen facts/vision/economics available for this legacy label';
    const engine=result?.call??null,match=engine===r.human;
    return {userId:r.user_id,listingId:r.listing_id,human:r.human,labeledAt:r.labeledAt,engine,engineAtLabel:prior?.call??null,
      decisionAtLabel:prior,error,weightedLoss:engine==null?null:match?0:engine==='BUY' && ['PASS','RISK'].includes(r.human)?5:1};
  });
  const evaluated=cases.filter(r=>r.weightedLoss!=null);
  return {measuredAt:now(),engine:ENGINE_VERSION,mode:replay?'replay_frozen_inputs':'latest_stored_decisions',cases,
    summary:{activeLabels:cases.length,evaluated:evaluated.length,unavailable:cases.length-evaluated.length,
      exact:evaluated.filter(r=>r.engine===r.human).length,falseBuys:evaluated.filter(r=>r.weightedLoss===5).length,
      weightedLoss:evaluated.reduce((n,r)=>n+r.weightedLoss!,0)},
    limits:'Human labels are judgments, not completed sales. Historical prices and sparse sample sizes do not calibrate market premiums automatically.'};
}
