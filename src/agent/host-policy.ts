import type {Database} from 'bun:sqlite';
export function readHostPolicy(d:Database) {
  return (d.query('SELECT preferred_node AS preferredNode,fallback_minutes AS fallbackMinutes FROM collector_policy WHERE id=1').get() as {preferredNode:string|null;fallbackMinutes:number})??{preferredNode:null,fallbackMinutes:5};
}
export function eligibleHost(d:Database,nodeId:string|null,at=Date.now()) {
  const policy=readHostPolicy(d);if(!policy.preferredNode||nodeId===policy.preferredNode)return true;
  const preferred=d.query('SELECT seen_at,telemetry FROM collector_nodes WHERE node_id=?').get(policy.preferredNode) as {seen_at:string;telemetry:string}|null;
  if(!preferred)return true;
  // Pause relinquishes preference; silence gets a grace period so brief Wi-Fi
  // interruptions do not bounce work between machines.
  return JSON.parse(preferred.telemetry).status==='paused'||at-Date.parse(preferred.seen_at)>=policy.fallbackMinutes*60_000;
}
