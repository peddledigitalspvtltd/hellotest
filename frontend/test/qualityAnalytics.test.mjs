import assert from 'node:assert/strict';
import test from 'node:test';
import {analyticsWindow,normalizeAnalyticsLayout,qualityRatio,groupAnalyticsTrend,analyticsCsv} from '../src/lib/qualityAnalytics.ts';
test('analytics distinguishes unavailable and empty evidence from a zero rate',()=>{
 for(const values of [[null,10],[0,null],[0,0],[3,2],[NaN,4],[-1,4]])assert.equal(qualityRatio(...values),null);
 assert.equal(qualityRatio(0,4),0);assert.equal(qualityRatio(3,4),.75);
});
test('period and stored layout recover from corrupt values without duplicates or an empty view',()=>{
 assert.equal(analyticsWindow('90'),90);assert.equal(analyticsWindow('14'),14);assert.equal(analyticsWindow('365'),30);
 const normalized=normalizeAnalyticsLayout({order:['runs','runs','obsolete'],hidden:['activity','attention','runs','inventory']});
 assert.deepEqual(normalized,{order:['runs','activity','attention','inventory'],hidden:[]});assert.equal(normalizeAnalyticsLayout(null).order.length,4);
});
test('90-day grouping preserves every day and all result counts including final partial week',()=>{
 const rows=Array.from({length:90},(_,i)=>({date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),runs:1,passed:i,failed:i%3,blocked:i%2}));
 const groups=groupAnalyticsTrend(rows,90);assert.equal(groups.length,13);assert.equal(groups[12].end,rows[89].date);
 for(const key of ['runs','passed','failed','blocked'])assert.equal(groups.reduce((sum,r)=>sum+r[key],0),rows.reduce((sum,r)=>sum+r[key],0));
 assert.equal(groupAnalyticsTrend(rows.slice(0,14),14).length,14);
});
test('CSV snapshot preserves unavailable evidence and neutralizes user-entered spreadsheet formulas',()=>{
 const csv=analyticsCsv({project:{name:' =HYPERLINK("bad")'},evaluated_at:'2026-09-10',window:{from:'2026-09-01',to:'2026-09-10'},inventory:{stories:null,cases:0},execution:{passed:0},trend:[],methodology:{execution:'Latest run/case/data row'}});
 assert.match(csv,/"' =HYPERLINK\(""bad""\)"/);assert.match(csv,/"stories","Unavailable"/);assert.match(csv,/"cases","0"/);assert.match(csv,/Latest run\/case\/data row/);
});
