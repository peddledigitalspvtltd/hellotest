import test from 'node:test';
import assert from 'node:assert/strict';
import { modelCallUsageFacts } from '../../frontend/lib/modelCallUsage.ts';
const values = trace => Object.fromEntries(modelCallUsageFacts(trace).map(fact => [fact.label, fact.value]));

test('call usage shows actual provider measurements and elapsed time without deriving missing totals or costs',()=>{
 const facts=values({usage:{prompt_tokens:12000,completion_tokens:350,total_tokens:12350},duration_ms:1250});
 assert.equal(facts['Input tokens'],(12000).toLocaleString());assert.equal(facts['Output tokens'],'350');
 assert.equal(facts['Total tokens'],(12350).toLocaleString());assert.equal(facts['Call duration'],'1.25 s');
 const partial=values({usage:{input_tokens:80,output_tokens:40},duration_ms:250});
 assert.equal(partial['Input tokens'],'80');assert.equal(partial['Output tokens'],'40');assert.equal(partial['Total tokens'],'Not reported');assert.equal(partial['Call duration'],'250 ms');
 assert.ok(!Object.keys(facts).some(label=>/cost|estimated/i.test(label)));
});

test('unknown, malformed and zero usage remain distinct',()=>{
 const absent=values({usage:null,duration_ms:null});assert.equal(absent['Input tokens'],'Not reported');assert.equal(absent['Total tokens'],'Not reported');assert.equal(absent['Call duration'],'Not recorded');
 const zero=values({usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0},duration_ms:0});assert.equal(zero['Input tokens'],'0');assert.equal(zero['Total tokens'],'0');assert.equal(zero['Call duration'],'0 ms');
 const invalid=values({usage:{prompt_tokens:-1,completion_tokens:Infinity,total_tokens:'500'},duration_ms:NaN});assert.equal(invalid['Input tokens'],'Not reported');assert.equal(invalid['Output tokens'],'Not reported');assert.equal(invalid['Total tokens'],'Not reported');assert.equal(invalid['Call duration'],'Not recorded');
});

test('cached input is a reported subset and never increases the original token totals',()=>{
 for(const detail of [{cached_input_tokens:40},{prompt_tokens_details:{cached_tokens:40}},{input_tokens_details:{cached_tokens:40}}]){
  const facts=values({usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120,...detail},duration_ms:900});
  assert.equal(facts['Cached input (included)'],'40');assert.equal(facts['Input tokens'],'100');assert.equal(facts['Total tokens'],'120');
 }
 assert.equal(values({usage:{prompt_tokens:100,total_tokens:120},duration_ms:900})['Cached input (included)'],undefined);
 assert.equal(values({usage:{prompt_tokens:100,prompt_tokens_details:{cached_tokens:101}},duration_ms:900})['Cached input (included)'],undefined);
});

test('provider cache reads outside the input denominator and cache counts without known input are not labelled included',()=>{
 assert.equal(values({usage:{input_tokens:100,cache_read_input_tokens:40},duration_ms:900})['Cached input (included)'],undefined);
 for(const detail of [{cached_input_tokens:40},{prompt_tokens_details:{cached_tokens:40}},{input_tokens_details:{cached_tokens:40}}]){
  assert.equal(values({usage:{...detail},duration_ms:900})['Cached input (included)'],undefined);
 }
});
