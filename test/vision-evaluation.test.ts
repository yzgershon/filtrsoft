import {test,expect} from 'bun:test';import {evaluateFacts} from '../src/vision/evaluation.ts';import {reconcileReads} from '../src/vision/local-lab.ts';
test('evaluation separates placeholders and misplaced facts without crediting them or hiding failures',()=>{
 const r=reconcileReads([{fields:[{field:'model',value:'Unknown',quote:'Unknown'},{field:'model',value:'G.SKILL',quote:'G.SKILL'},{field:'gpu',value:'32GB',quote:'32GB'},{field:'ram',value:'32 GB',quote:'32 GB'},{field:'ram',value:'32GB',quote:'32GB'},{field:'model',value:'Flare X6',quote:'Flare X6'}],unreadable:true}]);
 const score=evaluateFacts({model:['G.SKILL Flare X5'],ram:['32GB']},r);
 expect(score.correct).toBe(1);expect(score.missed).toBe(1);expect(score.unsupported).toBe(1);expect(score.duplicates).toBe(1);expect(score.wrong).toBe(3);
 const failed=evaluateFacts({ram:['32GB'],ecc:['ECC']},null);expect(failed.missed).toBe(2);expect(failed.failed).toBe(true);expect(failed.abstained).toBe(false);
});
test('decorated abstentions, equivalent kit notation and visible misfiled labels stay distinct from inventions',()=>{
 const r=reconcileReads([{fields:[{field:'model',value:'unreadable (top row)',quote:'unreadable'},{field:'kitLayout',value:'16GB x 2',quote:'16GB x 2'},{field:'model',value:'Desktop Memory',quote:'Desktop Memory'}],unreadable:true}]);
 const s=evaluateFacts({kitLayout:['2x16GB']},r,['Desktop Memory']);expect(s.correct).toBe(1);expect(s.unsupported).toBe(0);expect(s.wrong).toBe(1);
 expect(evaluateFacts({kitLayout:['2x32GB']},r).missed).toBe(1);
});
