const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function repositoryFixture() {
  const state = {
    entries: [],
    apps: new Map([
      ["app-a", { id: "app-a", project_id: "project-a" }],
      ["app-b", { id: "app-b", project_id: "project-b" }]
    ])
  };
  const scopeDb = {
    prepare: () => ({
      get: async (id) => state.apps.get(id),
      all: async (projectId) => [...state.apps.values()].filter((app) => app.project_id === projectId),
      run: async () => ({ changes: 0 })
    }),
    transaction: (callback) => callback
  };
  const obsDb = {
    transaction: callback => callback,
    prepare: (statement) => {
      const sql = statement.replace(/\s+/g, " ").trim();
      return {
        get: async (id) => state.entries.find((entry) => entry.id === id),
        all: async (...args) => {
          let rows = [...state.entries];
          if(sql.includes('repository canonical scope')) {
            rows=rows.filter(entry=>(entry.app_type_id||null)===(args[0]||null)&&((entry.project_id||null)===(args[1]||null)||args[2]&&!entry.project_id));
          } else if (/app_type_id IS NOT DISTINCT FROM/.test(sql)) {
            rows = rows.filter((entry) => entry.app_type_id === args[0] && (entry.metadata.screen_name || entry.page_key) === args[1] && (!args[2] || entry.project_id === args[2]));
          } else if (/WHERE 1 = 1/.test(sql)) {
            let parameter = 0;
            if (/project_id = \?/.test(sql)) {
              const projectId = args[parameter++];
              const legacyScopeCount = (sql.match(/app_type_id IN \(([^)]+)\)/)?.[1].match(/\?/g) || []).length;
              const legacyApps = args.slice(parameter, parameter + legacyScopeCount);
              parameter += legacyScopeCount;
              rows = rows.filter((entry) => entry.project_id === projectId || (!entry.project_id && legacyApps.includes(entry.app_type_id)));
            }
            if (/AND app_type_id = \?/.test(sql)) {
              const appTypeId = args[parameter++];
              rows = rows.filter((entry) => entry.app_type_id === appTypeId);
            }
            if(/LIMIT \?/.test(sql))rows = rows.slice(args[parameter + 1], args[parameter + 1] + args[parameter]);
          }
          return rows.map((entry) => ({ ...entry }));
        },
        run: async (...args) => {
          if (/^INSERT INTO automation_learning_cache/.test(sql)) {
            const columns = sql.match(/\(([^)]+)\) VALUES/)[1].split(",").map((column) => column.trim());
            const entry = Object.fromEntries(columns.slice(0, args.length).map((column, index) => [column, args[index]]));
            const existing = entry.app_type_id ? state.entries.find((candidate) => candidate.app_type_id === entry.app_type_id && candidate.page_key === entry.page_key && candidate.locator_intent === entry.locator_intent && candidate.locator === entry.locator) : null;
            if (existing) Object.assign(existing, entry, { id: existing.id });
            else state.entries.push({ ...entry, hit_count: 1 });
            return { changes: 1 };
          }
          if (/^UPDATE automation_learning_cache SET metadata/.test(sql)) {
            const entry=state.entries.find(row=>row.id===args[1]);if(entry)entry.metadata=args[0];
          } else if (/^UPDATE automation_learning_cache SET page_url/.test(sql)) {
            const columns = sql.match(/ SET (.+) WHERE id = \?/)[1].split(",").filter((assignment) => assignment.includes("?")).map((assignment) => assignment.split("=")[0].trim());
            const entry = state.entries.find((candidate) => candidate.id === args[args.length - 1]);
            columns.forEach((column, index) => { entry[column] = args[index]; });
          }
          return { changes: 1 };
        }
      };
    }
  };
  const service = {};
  const requireFixture = (dependency) => {
    if (dependency === "@hellotest/platform/backend/src/db") return scopeDb;
    if (dependency === "@hellotest/platform/backend/src/obsDb") return obsDb;
    if (dependency === "crypto") return require("node:crypto");
    if (dependency === "@hellotest/platform/backend/src/utils/testStepAutomation") return require("../../../platform/backend/src/utils/testStepAutomation");
    if(dependency==="../lib/repositoryScreenIdentity")return require('../../backend/lib/repositoryScreenIdentity');
    if(dependency==="../lib/automationLocatorIdentity")return require('../../backend/lib/automationLocatorIdentity');
    return {};
  };
  const source = readFileSync(path.join(__dirname, "../../backend/services/aiAutomationBuilder.service.js"), "utf8");
  new Function("require", "exports", "module", source+'\nexports.persistLearningForTest=persistLearning;')(requireFixture, service, { exports: service });
  return { state, service, obsDb };
}

test("saved screens and selected fields survive an asynchronous database reload with their evidence", async () => {
  const { service } = repositoryFixture();
  const screen = await service.createLearningCacheEntry({
    app_type_id: "app-a", screen_name: "Login", locator: "__screen__", locator_intent: "__screen__", object_name: "__screen__", source: "manual_screen",
    metadata: { record_kind: "screen", screen_dom_compressed: "<form>Login</form>", screen_screenshot_url: "data:image/png;base64,screen" }
  });
  const field = await service.createLearningCacheEntry({
    app_type_id: "app-a", screen_name: "Login", locator: "#email", object_name: "email",
    metadata: { target_criteria: ["Email address"], screen_dom_compressed: "<form>Login</form>", screen_screenshot_url: "data:image/png;base64,screen", dom_structure: '<input id="email">', screenshot_url: "data:image/png;base64,field" }
  });
  const otherScreen = await service.createLearningCacheEntry({ app_type_id: "app-a", screen_name: "Checkout", locator: "__screen__", locator_intent: "__screen__", source: "manual_screen" });
  const refreshed = await service.listLearningCache({ app_type_id: "app-a", limit: 200 });
  assert.deepEqual(new Set(refreshed.map((entry) => entry.id)), new Set([screen.id, field.id, otherScreen.id]));
  assert.equal(refreshed.every((entry) => entry.project_id === "project-a"), true);
  assert.equal(refreshed.find((entry) => entry.id === field.id).metadata.screen_dom_compressed, "<form>Login</form>");
  assert.deepEqual(refreshed.find((entry) => entry.id === field.id).metadata.target_criteria, ["Email address"]);
  assert.equal(refreshed.find((entry) => entry.id === field.id).metadata.screenshot_url, "data:image/png;base64,field");
  await service.updateLearningCacheEntry(field.id, { description: "Email field", screen_dom_compressed: "<form>Updated</form>" });
  const updated = await service.getLearningCacheEntry(field.id);
  assert.equal(updated.metadata.screen_dom_compressed, "<form>Updated</form>");
  assert.equal(updated.metadata.screen_screenshot_url, "data:image/png;base64,screen");
});

test('equivalent closed locator syntax reuses one persisted field and its original selector spelling',async()=>{
 const {service,state}=repositoryFixture();
 const screen=await service.createLearningCacheEntry({app_type_id:'app-a',screen_name:'Login',page_url:'https://app.test/login',locator:'__screen__',locator_intent:'__screen__',metadata:{record_kind:'screen'}});
 const original=await service.createLearningCacheEntry({app_type_id:'app-a',screen_name:'Login',page_url:'https://app.test/login',locator:'#email',object_name:'Email',metadata:{screen_entry_id:screen.id}});
 const retried=await service.createLearningCacheEntry({app_type_id:'app-a',screen_name:'Login',page_url:'https://app.test/login',locator:'locator("#email")',object_name:'Email',metadata:{screen_entry_id:screen.id}});
 assert.equal(retried.id,original.id);assert.equal(retried.locator,'#email');
 assert.equal(state.entries.filter(row=>row.locator_intent!=='__screen__'&&!row.metadata.merged_into_entry_id).length,1);
 const semantic=await service.createLearningCacheEntry({app_type_id:'app-a',screen_name:'Login',page_url:'https://app.test/login',locator:'getByLabel("Email")',object_name:'Email by label',metadata:{screen_entry_id:screen.id}});
 assert.notEqual(semantic.id,original.id,'a label and CSS ID are not assumed to select the same control');
});

test("repository listing remains scoped and paginated, including historical app-owned rows without project IDs", async () => {
  const { service, state } = repositoryFixture();
  for (const [app, screen] of [["app-a", "A"], ["app-a", "B"], ["app-b", "Other project"]]) {
    await service.createLearningCacheEntry({ app_type_id: app, screen_name: screen, locator: "__screen__", locator_intent: "__screen__" });
  }
  state.entries[0].project_id = null;
  const projectRows = await service.listLearningCache({ project_id: "project-a", limit: 200 });
  assert.deepEqual(projectRows.map((entry) => entry.metadata.screen_name), ["A", "B"]);
  assert.equal((await service.listLearningCache({ app_type_id: "app-a", limit: 1, offset: 1 }))[0].metadata.screen_name, "B");
  await assert.rejects(service.createLearningCacheEntry({ app_type_id: "app-a", project_id: "project-b", screen_name: "Wrong", locator: "#wrong" }), /scope must match/);
});

test("identical project-level screen names stay isolated and cannot overwrite one another", async () => {
  const { service } = repositoryFixture();
  const first = await service.createLearningCacheEntry({ project_id: "project-a", screen_name: "Login", locator: "#email", object_name: "email" });
  const second = await service.createLearningCacheEntry({ project_id: "project-b", screen_name: "Login", locator: "#email", object_name: "email" });
  assert.notEqual(first.id, second.id);
  assert.equal((await service.listLearningCache({ project_id: "project-a" })).length, 1);
  await assert.rejects(service.createLearningCacheEntry({ project_id: "project-a", screen_name: "Login", locator: "#email", object_name: "email" }), /same locator/);
});

test("selected fields retain the confirmed screen identity after stale drafts, refresh and retry", async () => {
  const { service } = repositoryFixture();
  const screen = await service.createLearningCacheEntry({
    app_type_id: "app-a", screen_name: "Login", page_url: "https://app.test/login",
    locator: "__screen__", locator_intent: "__screen__", source: "manual_screen"
  });
  const unrelated = await service.createLearningCacheEntry({
    app_type_id: "app-a", screen_name: "Checkout", locator: "#email", object_name: "Email"
  });
  const capture = {
    app_type_id: "app-a", project_id: "project-a", screen_name: "Stale name", page_key: "Stale name",
    locator: "#email", object_name: "Email", source: "live_inspect",
    metadata: {
      screen_entry_id: screen.id, screen_name: "Older metadata name", last_validated_status: "missing",
      dom_structure: '<input id="email">', screen_screenshot_url: "data:image/png;base64,captured"
    }
  };
  const field = await service.createLearningCacheEntry(capture);
  assert.equal(field.page_key, "Login");
  assert.equal(field.metadata.screen_name, "Login");
  assert.equal(field.metadata.screen_entry_id, screen.id);
  assert.equal(field.metadata.last_validated_status, "missing", "saving a capture must not claim it was live-validated");
  const retried = await service.createLearningCacheEntry({ ...capture, dom_structure: '<input id="email" type="email">' });
  assert.equal(retried.id, field.id, "a partial-save retry updates the same parent/locator instead of creating or rejecting a duplicate");
  const reopened = await service.listLearningCache({ app_type_id: "app-a", limit: 200 });
  assert.equal(reopened.length, 3);
  const savedField = reopened.find((entry) => entry.id === field.id);
  assert.equal(savedField.metadata.dom_structure, '<input id="email" type="email">');
  assert.equal(savedField.metadata.screen_screenshot_url, "data:image/png;base64,captured");
  assert.equal(reopened.find((entry) => entry.id === unrelated.id).metadata.screen_name, "Checkout");
  await service.updateLearningCacheEntry(field.id, { page_key: "Wrong page", screen_name: "Wrong name", description: "Curated" });
  assert.equal((await service.getLearningCacheEntry(field.id)).metadata.screen_name, "Login");
});

test("field parent references cannot cross project/app scope or refer to a missing screen or another field", async () => {
  const { service, state } = repositoryFixture();
  const screen = await service.createLearningCacheEntry({
    app_type_id: "app-a", screen_name: "Login", locator: "__screen__", locator_intent: "__screen__", source: "manual_screen"
  });
  const field = await service.createLearningCacheEntry({ app_type_id: "app-a", screen_name: "Login", locator: "#email" });
  const initialCount = state.entries.length;
  const input = { app_type_id: "app-b", project_id: "project-b", locator: "#foreign", metadata: { screen_entry_id: screen.id } };
  await assert.rejects(service.createLearningCacheEntry(input), /same project and app type/);
  await assert.rejects(service.createLearningCacheEntry({ ...input, app_type_id: "app-a", project_id: "project-a", metadata: { screen_entry_id: "missing" } }), /no longer exists/);
  await assert.rejects(service.createLearningCacheEntry({ ...input, app_type_id: "app-a", project_id: "project-a", metadata: { screen_entry_id: field.id } }), /no longer exists/);
  assert.equal(state.entries.length, initialCount, "invalid parent bindings fail before writes");
});


test("locator proposals are read-only and reviewed apply persists the locator, fallback and actor", async () => {
  const { service } = repositoryFixture();
  const field = await service.createLearningCacheEntry({ app_type_id: "app-a", screen_name: "Login", locator: "#email", locator_kind: "css", object_name: "Email", confidence: 0.4 });
  const before = await service.getLearningCacheEntry(field.id);
  const preview = await service.improveLearningCacheEntry({ id: field.id, user_id: "reviewer" });
  assert.deepEqual(await service.getLearningCacheEntry(field.id), before);
  assert.equal(preview.suggestion.strategy, "css");
  assert.equal(preview.requires_human_review, true);
  assert.equal(preview.generation_mode, "deterministic");
  assert.equal(preview.suggestion.confidence, before.confidence, "No invented confidence increase without validation");
  await assert.rejects(service.applyLearningCacheImprovement({ id: field.id, locator: "#email-new", strategy: "css" }), { statusCode: 400 });
  const applied = await service.applyLearningCacheImprovement({ id: field.id, confirmed: true, locator: "#email-new", strategy: "css", expected_locator: "#email", request_id: preview.request_id, user_id: "reviewer" });
  assert.equal(applied.entry.locator, "#email-new");
  assert.equal(applied.entry.metadata.object_name, "Email");
  assert.equal(applied.entry.metadata.fallback_locators[0].locator, "#email");
  assert.equal(applied.entry.metadata.last_validated_status, "not_validated");
  assert.equal(applied.entry.metadata.locator_review_history[0].reviewed_by, "reviewer");
  await assert.rejects(service.applyLearningCacheImprovement({ id: field.id, confirmed: true, locator: "#stale", strategy: "css", expected_locator: "#email" }), { statusCode: 409 });
  assert.equal((await service.getLearningCacheEntry(field.id)).locator, "#email-new");
});

test("recorder and AI learned fields reuse the scoped Page URL screen and preserve source ownership", async () => {
  const {service}=repositoryFixture();
  const page_url='https://app.test/login';
  const screen=await service.createLearningCacheEntry({app_type_id:'app-a',screen_name:'Login',page_url,locator:'__screen__',locator_intent:'__screen__',source:'manual_screen'});
  const email=await service.createLearningCacheEntry({app_type_id:'app-a',screen_name:'Login',page_url,locator:'#email',object_name:'Email'});
  await service.persistLearningForTest({testCase:{id:'recorded-case',app_type_id:'app-a',project_id:'project-a',title:'Sign in'},repositoryModel:{screens:new Map([['screen',{screen_name:'Recorded sign in',page_url,platform:'web'}]]),fields:new Map([['email',{screen_name:'Recorded sign in',field_name:'Recorded email',page_url,locator:'#email',platform:'web'}]])},learnedLocators:[{page_url,page_key:'Learned login',locator_intent:'Learned email',locator:'#email',locator_kind:'css',confidence:.8,metadata:{}}]});
  const rows=await service.listLearningCache({app_type_id:'app-a',limit:200});
  assert.deepEqual(new Set(rows.map(row=>row.id)),new Set([screen.id,email.id]));
  const field=await service.getLearningCacheEntry(email.id);
  assert.equal(field.metadata.screen_name,'Login');
  assert.ok(field.metadata.reference_aliases.includes('Recorded sign in.Recorded email'));
  assert.ok(field.metadata.reference_aliases.includes('Learned login.Learned email'));
  assert.ok(field.metadata.source_owners.some(owner=>owner.test_case_id==='recorded-case'&&owner.source==='object_repository_recorder'));
  assert.ok(field.metadata.source_owners.some(owner=>owner.test_case_id==='recorded-case'&&owner.source==='ai_builder'));
});

test('a host-confirmed saved Plan synchronizes only its used field through the real repository domain APIs',async()=>{
 const {service:repository,state,obsDb:repositoryDb}=repositoryFixture();
 const {createUsedObjectService,MIME}=require('../../backend/services/automationUsedObjects.service');
 const {recordBrowserOperation}=require('../../backend/lib/automationBrowserRecording');
 const {projectModelSnapshot}=require('../../backend/lib/automationBrowserModelTargets');
 const {createRecordedSectionContract}=require('../../backend/lib/automationRecordedContract');
 const {compileRecordedProgram}=require('../../backend/lib/automationRecordedProgram');
 const testCase={id:'built-case',app_type_id:'app-a',project_id:'project-a'};
 const step={id:'built-section',test_case_id:testCase.id,action:'Enter email',expected_result:'Email value is retained'};
 const result=value=>({content:[{type:'text',text:JSON.stringify({source:'playwright',...value})}]});
 const snapshot={tool:'browser_snapshot',result:result({observation_id:'actual-capture',url:'https://app.test/login',elements:[{tag:'input',accessible_name:'Email',accessible_role:'textbox',locators_validated:true,locator_candidates:['getByLabel("Email")']},{tag:'button',accessible_name:'Unused button',accessible_role:'button',locators_validated:true,locator_candidates:['#unused']}]})};
 projectModelSnapshot(snapshot);
 const requests=[{name:'browser_fill',arguments:{locator:'getByLabel("Email")',value:'@r.email'}},{name:'browser_assert',arguments:{locator:'getByLabel("Email")',assertion:'value',value:'@r.email'}}];
 const browserObservations=requests.map((request,index)=>{const row={tool:request.name,execution_step_id:step.id,result:result(index?{assertion_outcome:'satisfied'}:{action_outcome:'completed'})};recordBrowserOperation(row,request,{snapshot});return row;});
 const source=compileRecordedProgram(requests).source;
 const seal=createRecordedSectionContract({execution:{required:true,step_id:step.id,action:step.action,expected_result:step.expected_result},requests,source,mappings:[{id:step.id,action_operations:[1],assertion_operations:[2]}]});
 const activity={id:'activity',project_id:'project-a',app_type_id:'app-a',category:'automation_build',created_by:'user'},artifacts=[];
 const transactions={getTransaction:async()=>activity,listTransactionArtifacts:async()=>artifacts,getTransactionArtifact:async id=>artifacts.find(row=>row.id===id),createTransactionArtifact:async(id,input)=>{const row={...input,id:'binding-intent',transaction_id:id};artifacts.push(row);return row;}};
 const obsDb={transaction:repositoryDb.transaction,prepare:sql=>sql.startsWith('UPDATE workspace_transaction_artifacts')?{run:async(content,id)=>{artifacts.find(row=>row.id===id).content=content;}}:repositoryDb.prepare(sql)};
 const db={transaction:callback=>callback,prepare:sql=>({get:async()=>sql.includes('FROM test_cases')?testCase:{...step,automation_code:source}})};
 const service=createUsedObjectService({db,obsDb,transactions,repository,getAccess:async()=>({'automation.repository.manage':true})});
 const savedScreen=await repository.createLearningCacheEntry({app_type_id:'app-a',screen_name:'Curated Login',page_url:'https://app.test/login',locator:'__screen__',source:'manual_screen',metadata:{record_kind:'screen'}});
 const savedField=await repository.createLearningCacheEntry({app_type_id:'app-a',screen_name:'Curated Login',page_url:'https://app.test/login',locator:'getByLabel("Email")',object_name:'CustomerEmail',metadata:{screen_entry_id:savedScreen.id,description:'Curated email binding'}});
 const input={testCase,step,source,seal,browserObservations,transactionId:'activity',userId:'user'};
 const pending=await service.stage(input),synced=await service.sync({...input,artifactId:pending.artifact_id});
 assert.equal(artifacts[0].mime_type,MIME);assert.equal(synced.status,'synced');assert.equal(synced.object_count,1);
 assert.equal(synced.bindings[0].entry_id,savedField.id);assert.equal(synced.bindings[0].reference,'Curated Login.CustomerEmail');
 const rows=await repository.listLearningCache({app_type_id:'app-a',limit:200});
 assert.equal(rows.length,2);assert.deepEqual(new Set(rows.map(row=>row.id)),new Set([savedScreen.id,savedField.id]));
 const field=await repository.getLearningCacheEntry(savedField.id);
 assert.equal(field.metadata.description,'Curated email binding');assert.equal(field.metadata.instruction_usages[0].test_case_id,testCase.id);
 assert.deepEqual(field.metadata.instruction_usages[0].operation_indexes,[1,2]);
 assert.equal(state.entries.some(row=>row.locator==='#unused'),false);
});

test('observed route digests isolate same-locator SPA fields through the real repository domain APIs',async()=>{
 const {service}=repositoryFixture(),url='https://app.test/app';
 const genericScreen=await service.createLearningCacheEntry({app_type_id:'app-a',screen_name:'Curated app',page_url:url,locator:'__screen__',metadata:{record_kind:'screen'}});
 const generic=await service.createLearningCacheEntry({app_type_id:'app-a',screen_name:'Curated app',page_url:url,locator:'#email',object_name:'CuratedEmail',metadata:{screen_entry_id:genericScreen.id}});
 const fields=[];
 for(const digest of ['a'.repeat(64),'b'.repeat(64)]){
  const metadata={observed_route_sha256:digest};
  const screen=await service.createLearningCacheEntry({app_type_id:'app-a',screen_name:'app '+digest.slice(0,12),page_url:url,locator:'__screen__',metadata:{...metadata,record_kind:'screen'}});
  const field=await service.createLearningCacheEntry({app_type_id:'app-a',page_url:url,locator:'#email',object_name:'Email',metadata:{...metadata,screen_entry_id:screen.id}});
  fields.push(field);
  assert.equal(field.metadata.screen_entry_id,screen.id);assert.equal(field.metadata.observed_route_sha256,digest);
 }
 assert.notEqual(fields[0].id,fields[1].id);assert.notEqual(fields[0].id,generic.id);
 const rows=await service.listLearningCache({app_type_id:'app-a',limit:200});assert.equal(rows.length,6);
 assert.equal(rows.find(row=>row.id===generic.id).metadata.object_name,'CuratedEmail');
 assert.equal(rows.filter(row=>row.locator==='#email').length,3);
});
