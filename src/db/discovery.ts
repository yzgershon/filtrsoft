import {db,now} from './index.ts';
/** Local collector telemetry. Counts actual persisted new items separately from
 * search cards; this table is not uploaded as server-local crawl statistics. */
export function recordDiscovery(source:string,query:string,counts:{cards:number;known:number;eligible:number;selected:number;saved:number;failed:number}) {
  db().exec('CREATE TABLE IF NOT EXISTS collector_discovery(id INTEGER PRIMARY KEY,source TEXT NOT NULL,query TEXT NOT NULL,observed_at TEXT NOT NULL,cards INTEGER NOT NULL,known INTEGER NOT NULL,eligible INTEGER NOT NULL,selected INTEGER NOT NULL,saved INTEGER NOT NULL,failed INTEGER NOT NULL)');
  db().run('INSERT INTO collector_discovery(source,query,observed_at,cards,known,eligible,selected,saved,failed) VALUES(?,?,?,?,?,?,?,?,?)',[source,query,now(),counts.cards,counts.known,counts.eligible,counts.selected,counts.saved,counts.failed]);
}
