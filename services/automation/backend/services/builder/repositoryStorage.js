// repositoryStorage: cohesive builder implementation; dependencies are explicit lazy ports.
function createRepositoryStorage(ports) {
const exports = ports.exports;
const require = ports.require;


const upsertLearningCacheRecord = ports.obsDb.prepare(`
  INSERT INTO automation_learning_cache (
    id,
    project_id,
    app_type_id,
    test_case_id,
    page_url,
    page_key,
    locator_intent,
    locator,
    locator_kind,
    confidence,
    source,
    metadata,
    hit_count
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  ON CONFLICT (app_type_id, page_key, locator_intent, locator)
  DO UPDATE SET
    project_id = COALESCE(EXCLUDED.project_id, automation_learning_cache.project_id),
    test_case_id = COALESCE(EXCLUDED.test_case_id, automation_learning_cache.test_case_id),
    page_url = COALESCE(EXCLUDED.page_url, automation_learning_cache.page_url),
    locator_kind = COALESCE(EXCLUDED.locator_kind, automation_learning_cache.locator_kind),
    confidence = GREATEST(automation_learning_cache.confidence, EXCLUDED.confidence),
    source = EXCLUDED.source,
    metadata = EXCLUDED.metadata,
    hit_count = automation_learning_cache.hit_count + 1,
    updated_at = CURRENT_TIMESTAMP
`);

const upsertLearningCache={run:(...args)=>persistCanonicalRepositoryRow(args)};


const selectLearningCacheEntry = ports.obsDb.prepare(`
  SELECT *
  FROM automation_learning_cache
  WHERE id = ?
`);


const selectLearningCacheScreenEntries = ports.obsDb.prepare(`
  SELECT *
  FROM automation_learning_cache
  WHERE app_type_id IS NOT DISTINCT FROM ?
    AND COALESCE(metadata->>'screen_name', page_key, page_url, '') = ?
    AND (?::text IS NULL OR project_id IS NOT DISTINCT FROM ?)
  ORDER BY hit_count DESC, updated_at DESC
`);


const updateLearningCacheEntry = ports.obsDb.prepare(`
  UPDATE automation_learning_cache
  SET page_url = ?,
      page_key = ?,
      locator_intent = ?,
      locator = ?,
      locator_kind = ?,
      confidence = ?,
      source = ?,
      metadata = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);


const deleteLearningCacheEntry = ports.obsDb.prepare(`
  DELETE FROM automation_learning_cache
  WHERE id = ?
`);


const deleteLearningCacheScreen = ports.obsDb.prepare(`
  DELETE FROM automation_learning_cache
  WHERE app_type_id IS NOT DISTINCT FROM ?
    AND COALESCE(metadata->>'screen_name', page_key, page_url, '') = ?
`);


const renameLearningCacheScreen = ports.obsDb.prepare(`
  UPDATE automation_learning_cache
  SET page_key = CASE WHEN page_key = ? THEN ? ELSE page_key END,
      metadata = COALESCE(metadata, '{}'::jsonb) || ?::jsonb,
      updated_at = CURRENT_TIMESTAMP
  WHERE app_type_id IS NOT DISTINCT FROM ?
    AND COALESCE(metadata->>'screen_name', page_key, page_url, '') = ?
`);


const replaceTestStepRepositoryReference = ports.db.prepare(`
  UPDATE test_steps
  SET action = CASE WHEN action IS NULL THEN NULL ELSE REPLACE(action, ?, ?) END,
      automation_code = CASE WHEN automation_code IS NULL THEN NULL ELSE REPLACE(automation_code, ?, ?) END
  WHERE test_case_id IN (
    SELECT id FROM test_cases WHERE app_type_id IS NOT DISTINCT FROM ?
  )
    AND (
      COALESCE(action, '') LIKE ?
      OR COALESCE(automation_code, '') LIKE ?
    )
`);


const inferLocatorStrategy = (locator, fallback) => {
  const value = String(locator || "");
  if (/data-testid/i.test(value)) return "data-testid";
  if (/aria-label/i.test(value)) return "aria-label";
  if (/getbyrole|role=/i.test(value)) return "role + name";
  if (/^#|\bid=/i.test(value)) return "stable id";
  if (/\bname=/i.test(value)) return "name attribute";
  if (/placeholder/i.test(value)) return "placeholder";
  if (/^text=|getbytext/i.test(value)) return "text";
  if (/xpath|^\/\//i.test(value)) return "xpath";
  return fallback || "css";
};


const normalizeLearningCacheRow = (row) => row
  ? {
      ...row,
      confidence: ports.clampNumber(row.confidence, 0),
      metadata: ports.safeJson(row.metadata, {})
    }
  : null;


const listLearningCacheRows = async ({ projectId, appTypeId, limit = ports.MAX_CACHE_ROWS, offset = 0 } = {}) => {
  let query = `
    SELECT *
    FROM automation_learning_cache
    WHERE 1 = 1
  `;
  const params = [];

  if (projectId) {
    const projectApps = await ports.db.prepare(`SELECT id FROM app_types WHERE project_id = ?`).all(projectId);
    const appIds = projectApps.map((app) => app.id);
    query += appIds.length
      ? ` AND (project_id = ? OR (project_id IS NULL AND app_type_id IN (${appIds.map(() => "?").join(", ")})))`
      : ` AND project_id = ?`;
    params.push(projectId);
    params.push(...appIds);
  }

  if (appTypeId) {
    query += ` AND app_type_id = ?`;
    params.push(appTypeId);
  }

  query += ` ORDER BY hit_count DESC, updated_at DESC, id ASC`;

  const rows = await ports.obsDb.prepare(query).all(...params);
  const canonical=await canonicalRepositoryProjection(rows);
  const start=Math.max(0,Number(offset)||0);
  return canonical.rows.slice(start,start+Math.max(1,Math.min(200,Number(limit)||ports.MAX_CACHE_ROWS)));
};


const canonicalRepositoryProjection=async rows=>{
  const normalized=rows.map(normalizeLearningCacheRow).filter(Boolean);
  const projects=new Map();
  for(const row of normalized)if(!row.project_id&&row.app_type_id){if(!projects.has(row.app_type_id))projects.set(row.app_type_id,(await ports.db.prepare('SELECT id, project_id FROM app_types WHERE id = ?').get(row.app_type_id))?.project_id||null);row.project_id=projects.get(row.app_type_id);}
  return ports.canonicalizeRepositoryRows(normalized);
};

const readRepositoryScope=async({appTypeId,projectId})=>(await ports.obsDb.prepare(`/* repository canonical scope */ SELECT * FROM automation_learning_cache WHERE app_type_id IS NOT DISTINCT FROM ? AND (project_id IS NOT DISTINCT FROM ? OR (?::text IS NOT NULL AND project_id IS NULL)) ORDER BY created_at, id`).all(appTypeId||null,projectId||null,appTypeId||null)).map(normalizeLearningCacheRow);

const lockRepositoryScope=({appTypeId,projectId})=>ports.obsDb.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get('repository-screen:'+JSON.stringify([projectId||null,appTypeId||null]));

const saveRepositoryProjection=async projection=>{
  for(const row of projection.all)if(!row._pending)await ports.obsDb.prepare('UPDATE automation_learning_cache SET metadata = ? WHERE id = ? AND metadata IS DISTINCT FROM ?::jsonb').run(row.metadata,row.id,row.metadata);
};

const reconcileRepositoryScope=async scope=>{const projection=await canonicalRepositoryProjection(await readRepositoryScope(scope));await saveRepositoryProjection(projection);return projection;};

const persistCanonicalRepositoryRow=args=>ports.obsDb.transaction(async()=>{
  const [id,projectId,appTypeId,testCaseId,pageUrl,pageKey,intent,locator,kind,confidence,source,metadata]=args;
  const scope={appTypeId,projectId};await lockRepositoryScope(scope);
  const rows=await readRepositoryScope(scope);
  const candidate={id,project_id:projectId,app_type_id:appTypeId,test_case_id:testCaseId,page_url:pageUrl,page_key:pageKey,locator_intent:intent,locator,locator_kind:kind,confidence,source,metadata:ports.repositoryInputMetadata(metadata),_pending:true};
  const projection=await canonicalRepositoryProjection([...rows,candidate]);
  const proposed=projection.byId.get(id),target=projection.byId.get(proposed.metadata.merged_into_entry_id)||proposed;
  if(target!==proposed){for(const [key,value]of Object.entries(candidate.metadata))if(value!==null&&value!==undefined&&target.metadata[key]===undefined)target.metadata[key]=value;}
  await saveRepositoryProjection(projection);
  if(target===proposed)await upsertLearningCacheRecord.run(id,projectId,appTypeId,testCaseId,pageUrl,target.metadata.screen_name||pageKey,intent,locator,kind,confidence,source,target.metadata);
  return {id:target.id,changes:1};
})();


const listLearningCacheScreenRows = async ({ appTypeId, projectId, screenName } = {}) => {
  const rows=(await canonicalRepositoryProjection(await readRepositoryScope({appTypeId:ports.normalizeText(appTypeId),projectId:ports.normalizeText(projectId)||(appTypeId?(await ports.db.prepare('SELECT id, project_id FROM app_types WHERE id = ?').get(appTypeId))?.project_id:null)}))).rows;
  const exact=rows.filter(row=>(row.metadata.screen_name||row.page_key)===ports.normalizeText(screenName));
  return exact.length?exact:rows.filter(row=>row.metadata.screen_aliases?.includes(ports.normalizeText(screenName)));
};


const listAllLearningCacheRows = async ({ appTypeId } = {}) => {
  const appType = ports.normalizeText(appTypeId);

  if (!appType) {
    throw new Error("App type scope is required");
  }

  const rows = await ports.obsDb.prepare(`
    SELECT *
    FROM automation_learning_cache
    WHERE app_type_id = ?
    ORDER BY COALESCE(metadata->>'screen_name', page_key, page_url, ''), locator_intent, updated_at DESC
  `).all(appType);

  return (await canonicalRepositoryProjection(rows)).rows;
};


const normalizeRepositoryPatch = (existing, patch = {}) => {
  const existingMetadata = ports.normalizeObject(ports.safeJson(existing.metadata, {}));
  const nextMetadata = {
    ...existingMetadata,
    ...ports.normalizeObject(patch.metadata)
  };
  const metadataFieldMap = {
    screen_name: "screen_name",
    object_name: "object_name",
    object_role: "object_role",
    target_criteria: "target_criteria",
    dom_structure: "dom_structure",
    dom_path: "dom_path",
    screenshot_url: "screenshot_url",
    screenshot_path: "screenshot_path",
    fallback_strategy: "fallback_strategy",
    platform: "platform",
    url_pattern_type: "url_pattern_type",
    url_pattern_value: "url_pattern_value",
    screen_fingerprint: "screen_fingerprint",
    screen_dom_compressed: "screen_dom_compressed",
    screen_screenshot_url: "screen_screenshot_url",
    accessibility_tree: "accessibility_tree",
    fallback_locators: "fallback_locators",
    description: "description",
    business_meaning: "business_meaning",
    usage_keywords: "usage_keywords",
    stability_score: "stability_score",
    last_validated_at: "last_validated_at",
    validation_history: "validation_history",
    ancestor_dom: "ancestor_dom",
    ancestor_screenshot_url: "ancestor_screenshot_url",
    element_screenshot_url: "element_screenshot_url"
  };

  Object.entries(metadataFieldMap).forEach(([inputKey, metadataKey]) => {
    if (patch[inputKey] !== undefined) {
      nextMetadata[metadataKey] = patch[inputKey];
    }
  });

  const nextLocator = ports.normalizeText(patch.locator) || existing.locator;
  if (existing.locator && nextLocator !== existing.locator) {
    nextMetadata.previous_locators = [
      ...new Set([
        ...(Array.isArray(nextMetadata.previous_locators) ? nextMetadata.previous_locators : []),
        existing.locator
      ].filter(Boolean))
    ];
  }

  nextMetadata.repository_version = Number(nextMetadata.repository_version || 0) + 1;
  nextMetadata.last_curated_at = new Date().toISOString();

  return {
    page_url: patch.page_url !== undefined ? ports.normalizeText(patch.page_url) : existing.page_url,
    page_key: ports.normalizeText(patch.page_key) || existing.page_key,
    locator_intent: ports.normalizeText(patch.locator_intent || patch.intent) || existing.locator_intent,
    locator: nextLocator,
    locator_kind: patch.locator_kind !== undefined ? ports.normalizeText(patch.locator_kind) : existing.locator_kind,
    confidence: Math.max(0, Math.min(1, ports.clampNumber(patch.confidence, ports.clampNumber(existing.confidence, 0)))),
    source: ports.normalizeText(patch.source) || "curated_repository",
    metadata: nextMetadata
  };
};


const persistLearning = async ({
  testCase,
  learnedLocators = [],
  capturedActions = [],
  capturedNetwork = [],
  transactionId,
  repositoryModel = null,
  integrationId = null
}) => {
  let persisted = 0;
  const recorderRepositoryModel = repositoryModel
    || (capturedActions?.length
      ? await ports.buildRecorderRepositoryModel({
        testCase,
        capturedActions,
        integrationId,
        transactionId
      })
      : null);

  if (recorderRepositoryModel) {
    for (const screen of recorderRepositoryModel.screens.values()) {
      await upsertLearningCache.run(
        ports.uuid(),
        testCase.project_id || null,
        testCase.app_type_id || null,
        testCase.id,
        screen.page_url || null,
        screen.screen_name,
        "__screen__",
        "__screen__",
        "screen",
        1,
        ports.platformSource(screen.platform, "recorder_screen"),
        {
          record_kind: "screen",
          screen_name: screen.screen_name,
          object_name: "__screen__",
          object_role: "screen",
          platform: screen.platform || "web",
          page_identity: screen.page_identity || null,
          page_title: screen.page_title || null,
          url_pattern_type: screen.url_pattern_type || "contains",
          url_pattern_value: screen.url_pattern_value || screen.page_identity || screen.page_url || null,
          learned_from: "recorder",
          test_case_title: testCase.title,
          last_recorded_at: new Date().toISOString()
        }
      );
      persisted += 1;
    }

    for (const field of recorderRepositoryModel.fields.values()) {
      await upsertLearningCache.run(
        ports.uuid(),
        testCase.project_id || null,
        testCase.app_type_id || null,
        testCase.id,
        field.page_url || null,
        field.screen_name,
        field.field_name,
        field.locator,
        field.locator_kind || inferLocatorStrategy(field.locator, "recorder"),
        0.88,
        ports.platformSource(field.platform, "object_repository_recorder"),
        {
          record_kind: "field",
          screen_name: field.screen_name,
          object_name: field.field_name,
          object_role: field.object_role || "field",
          object_label: field.object_label || null,
          keyword: field.keyword || null,
          parameter_hint: field.parameter_hint || null,
          page_identity: field.page_identity || null,
          page_title: field.page_title || null,
          source_action_indexes: field.source_action_indexes || [],
          value_captured: Boolean(field.action?.value),
          platform: field.platform || "web",
          usage_keywords: [field.keyword].filter(Boolean),
          target_criteria: [
            field.object_label ? `Recorded label: ${field.object_label}` : null,
            field.keyword ? `Recorded keyword: ${field.keyword}` : null,
            field.locator ? `Primary locator: ${field.locator}` : null
          ].filter(Boolean),
          test_case_title: testCase.title,
          last_recorded_at: new Date().toISOString()
        }
      );
      persisted += 1;
    }
  }

  for (const locator of learnedLocators) {
    await upsertLearningCache.run(
      ports.uuid(),
      testCase.project_id || null,
      testCase.app_type_id || null,
      testCase.id,
      locator.page_url,
      locator.page_key,
      locator.locator_intent,
      locator.locator,
      locator.locator_kind,
      locator.confidence,
      "ai_builder",
      {
        ...locator.metadata,
        test_case_title: testCase.title
      }
    );
    persisted += 1;
  }

  if (capturedNetwork.length) {
    await ports.appendEvent(transactionId, {
      phase: "recorder.network.learned",
      message: `Recorder retained ${capturedNetwork.length} API interaction${capturedNetwork.length === 1 ? "" : "s"} as flow evidence without creating a companion case.`,
      details: {
        captured_network_count: capturedNetwork.length,
        companion_case_created: false,
        sample: capturedNetwork.slice(0, 5)
      }
    });
  }

  return persisted;
};


exports.listLearningCache = async ({ project_id, app_type_id, limit, offset } = {}) => {
  const boundedLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const rows = await listLearningCacheRows({
    projectId: ports.normalizeText(project_id),
    appTypeId: ports.normalizeText(app_type_id),
    limit: boundedLimit,
    offset: Math.max(0, Number(offset) || 0)
  });

  return rows.map(normalizeLearningCacheRow);
};


exports.exportRepositoryContext = async ({ project_id, app_type_id, limit } = {}) => {
  const entries = await exports.listLearningCache({ project_id, app_type_id, limit: limit || 200 });
  const screens = new Map();

  entries.forEach((entry) => {
    const metadata = ports.normalizeObject(entry.metadata);
    const screenName = ports.normalizeText(metadata.screen_name) || entry.page_key || "Unassigned screen";
    const isScreenRecord = metadata.record_kind === "screen" || entry.locator_intent === "__screen__";
    const existingScreen = screens.get(screenName);
    const screen = existingScreen || {
      screen: screenName,
      appType: ports.normalizeText(metadata.platform) || null,
      urlPattern: {
        type: ports.normalizeText(metadata.url_pattern_type) || "contains",
        value: ports.normalizeText(metadata.url_pattern_value) || entry.page_url || entry.page_key
      },
      fingerprint: ports.normalizeText(metadata.screen_fingerprint) || null,
      fields: []
    };

    if (isScreenRecord && existingScreen) {
      screen.appType = ports.normalizeText(metadata.platform) || screen.appType;
      screen.urlPattern = {
        type: ports.normalizeText(metadata.url_pattern_type) || screen.urlPattern.type,
        value: ports.normalizeText(metadata.url_pattern_value) || entry.page_url || screen.urlPattern.value
      };
      screen.fingerprint = ports.normalizeText(metadata.screen_fingerprint) || screen.fingerprint;
    }

    const fallbackLocators = Array.isArray(metadata.fallback_locators)
      ? metadata.fallback_locators
      : [];

    if (!isScreenRecord) {
      screen.fields.push({
        name: ports.normalizeText(metadata.object_name) || entry.locator_intent,
        type: ports.normalizeText(metadata.object_role) || entry.locator_kind || "field",
        primaryLocator: entry.locator,
        primaryStrategy: inferLocatorStrategy(entry.locator, entry.locator_kind),
        confidenceScore: ports.clampNumber(entry.confidence, 0),
        fallbackLocators,
        description: ports.normalizeText(metadata.description) || null,
        businessMeaning: ports.normalizeText(metadata.business_meaning) || null,
        usageKeywords: Array.isArray(metadata.usage_keywords) ? metadata.usage_keywords : [],
        stabilityScore: ports.clampNumber(metadata.stability_score, 0),
        lastValidatedDate: ports.normalizeText(metadata.last_validated_at) || null
      });
    }
    screens.set(screenName, screen);
  });

  return {
    repositoryType: "ui_intelligence_repository",
    generatedAt: new Date().toISOString(),
    screens: Array.from(screens.values())
  };
};


const csvValue = (value) => `"${String(value ?? "").replace(/"/g, "\"\"")}"`;


exports.exportLearningCacheCsv = async ({ app_type_id } = {}) => {
  const entries = await listAllLearningCacheRows({ appTypeId: app_type_id });
  const headers = [
    "screen_name",
    "record_type",
    "page_url",
    "url_pattern_type",
    "url_pattern_value",
    "object_name",
    "object_role",
    "locator",
    "locator_kind",
    "confidence",
    "source",
    "description",
    "business_meaning",
    "target_criteria",
    "fallback_locators",
    "usage_keywords",
    "stability_score",
    "dom_structure",
    "screenshot_url",
    "metadata_json"
  ];
  const rows = entries.map((entry) => {
    const metadata = ports.normalizeObject(entry.metadata);
    const screenName = ports.normalizeText(metadata.screen_name) || entry.page_key || entry.page_url || "Screen";
    const screenRecord = isRepositoryScreenRecord(entry);

    return [
      screenName,
      screenRecord ? "screen" : "field",
      entry.page_url,
      metadata.url_pattern_type,
      metadata.url_pattern_value,
      screenRecord ? "__screen__" : ports.normalizeText(metadata.object_name) || entry.locator_intent,
      screenRecord ? "screen" : metadata.object_role,
      screenRecord ? "__screen__" : entry.locator,
      screenRecord ? "screen" : entry.locator_kind,
      entry.confidence,
      entry.source,
      metadata.description,
      metadata.business_meaning,
      JSON.stringify(Array.isArray(metadata.target_criteria) ? metadata.target_criteria : []),
      JSON.stringify(Array.isArray(metadata.fallback_locators) ? metadata.fallback_locators : []),
      JSON.stringify(Array.isArray(metadata.usage_keywords) ? metadata.usage_keywords : []),
      metadata.stability_score,
      metadata.dom_structure,
      metadata.screenshot_url,
      JSON.stringify(metadata)
    ].map(csvValue).join(",");
  });

  return [headers.map(csvValue).join(","), ...rows].join("\n");
};


exports.getLearningCacheEntry = async (id) => {
  let entry = normalizeLearningCacheRow(await selectLearningCacheEntry.get(ports.normalizeText(id)));

  if (!entry) {
    throw new Error("Object repository entry not found");
  }

  const projectId=entry.project_id||(entry.app_type_id?(await ports.db.prepare('SELECT id, project_id FROM app_types WHERE id = ?').get(entry.app_type_id))?.project_id:null);
  const projection=await canonicalRepositoryProjection(await readRepositoryScope({appTypeId:entry.app_type_id,projectId}));
  entry=projection.byId.get(entry.id)||entry;
  const seen=new Set();
  while(entry.metadata?.merged_into_entry_id){if(seen.has(entry.id))throw new Error('Repository redirect is invalid.');seen.add(entry.id);const target=projection.byId.get(entry.metadata.merged_into_entry_id);if(!target)throw new Error('Repository redirect target is unavailable.');entry=target;}
  return entry;
};


const getRepositoryObjectName = (entry, screenName = ports.normalizeText(entry?.metadata?.screen_name || entry?.page_key || entry?.page_url)) => {
  const objectName = ports.normalizeText(entry?.metadata?.object_name || entry?.locator_intent);
  const screenPrefix = screenName ? `${screenName}.` : "";
  return screenPrefix && objectName?.startsWith(screenPrefix) ? objectName.slice(screenPrefix.length) : objectName;
};


const isRepositoryScreenRecord = (entry) =>
  entry?.locator_intent === "__screen__"
  || entry?.metadata?.record_kind === "screen"
  || entry?.source === "manual_screen";


const getRepositoryMemberReference = (entry) => {
  const screenName = ports.normalizeText(entry?.metadata?.screen_name || entry?.page_key || entry?.page_url);
  const objectName = getRepositoryObjectName(entry, screenName);
  return screenName && objectName ? `${screenName}.${objectName}` : null;
};


const migrateRepositoryMemberReference = async ({ appTypeId, from, to } = {}) => {
  if (!from || !to || from === to) {
    return 0;
  }

  const pattern = `%${from}%`;
  const result = await replaceTestStepRepositoryReference.run(
    from,
    to,
    from,
    to,
    ports.normalizeText(appTypeId) || null,
    pattern,
    pattern
  );
  return result.changes || 0;
};


exports.updateLearningCacheEntry = async (id, patch = {}, internal = {}) => {
  return ports.obsDb.transaction(async()=>{
  let existing = await exports.getLearningCacheEntry(id);
  const scope={appTypeId:existing.app_type_id,projectId:existing.project_id};await lockRepositoryScope(scope);
  existing=await exports.getLearningCacheEntry(id);
  patch = await resolveRepositoryScreenBinding({
    ...patch,
    metadata: { ...ports.normalizeObject(existing.metadata), ...ports.repositoryInputMetadata(patch.metadata), ...Object.fromEntries(Object.entries(internal.identityMetadata||{}).filter(([,value])=>value!==undefined)) }
  }, existing);
  const next = normalizeRepositoryPatch(existing, patch);
  // Capture the projected family before writing. Legacy rows may still carry
  // an old screen name and no parent ID until this first authorized write.
  const screenFamilyIds=isRepositoryScreenRecord(existing)&&next.page_url!==existing.page_url
    ?(await canonicalRepositoryProjection(await readRepositoryScope(scope))).all.filter(row=>(row.metadata.screen_name||row.page_key)===(existing.metadata.screen_name||existing.page_key)).map(row=>row.id)
    :[];
  // Physical legacy keys stay stable; canonical names and historical bindings
  // live in metadata, avoiding unique-key collisions with retained redirects.
  next.page_key=existing.page_key;
  const previousReference=getRepositoryMemberReference(existing);
  if(previousReference&&!isRepositoryScreenRecord(existing))next.metadata.reference_aliases=[...new Set([...(existing.metadata.reference_aliases||[]),previousReference,...(next.metadata.reference_aliases||[])])];
  const duplicate = await exports.findDuplicateLearningCacheEntry({
    app_type_id: existing.app_type_id,
    project_id: existing.project_id,
    screen_name: next.metadata?.screen_name || next.page_key || next.page_url,
    locator: next.locator,
    exclude_id: existing.id
  });

  if (duplicate && !ports.canonicalPageUrl(next.page_url)) {
    throw new Error("Another object repository field on this screen already uses the same locator.");
  }
  if(duplicate&&!isRepositoryScreenRecord(existing)&&ports.canonicalPageUrl(next.page_url)===ports.canonicalPageUrl(duplicate.page_url)){
    const metadata={...next.metadata,merged_into_entry_id:duplicate.id};
    await ports.obsDb.prepare('UPDATE automation_learning_cache SET metadata = ? WHERE id = ? AND metadata IS DISTINCT FROM ?::jsonb').run(metadata,existing.id,metadata);
    await reconcileRepositoryScope(scope);
    return {...await exports.getLearningCacheEntry(existing.id),updated_step_references:0};
  }

  await updateLearningCacheEntry.run(
    next.page_url,
    next.page_key,
    next.locator_intent,
    next.locator,
    next.locator_kind,
    next.confidence,
    next.source,
    next.metadata,
    existing.id
  );
  for(const memberId of screenFamilyIds)if(memberId!==existing.id)await ports.obsDb.prepare('UPDATE automation_learning_cache SET page_url = ? WHERE id = ?').run(next.page_url,memberId);
  await reconcileRepositoryScope(scope);
  const updated = await exports.getLearningCacheEntry(existing.id);

  return {
    ...updated,
    updated_step_references: 0
  };
  })();
};


exports.renameLearningCacheScreen = async ({ app_type_id, project_id, screen_name, new_name } = {}) => ports.obsDb.transaction(async()=>{
  const appTypeId=ports.normalizeText(app_type_id),screenName=ports.normalizeText(screen_name),newName=ports.normalizeText(new_name);
  if(!screenName||!newName)throw new Error("Current and new screen names are required");
  const projectId=ports.normalizeText(project_id)||(appTypeId?(await ports.db.prepare('SELECT id, project_id FROM app_types WHERE id = ?').get(appTypeId))?.project_id:null);
  const scope={appTypeId,projectId};await lockRepositoryScope(scope);
  const projection=await canonicalRepositoryProjection(await readRepositoryScope(scope));
  const selected=projection.all.filter(row=>(row.metadata.screen_name||row.page_key)===screenName);
  if(!selected.length)throw new Error("Object repository screen not found");
  for(const row of selected){const reference=getRepositoryMemberReference(row);row.metadata={...row.metadata,screen_name:newName,screen_aliases:[...new Set([...(row.metadata.screen_aliases||[]),screenName,newName])],...(!isRepositoryScreenRecord(row)&&reference?{reference_aliases:[...new Set([...(row.metadata.reference_aliases||[]),reference])]}:{}),last_curated_at:new Date().toISOString()};}
  await saveRepositoryProjection(projection);
  await reconcileRepositoryScope(scope);
  return {renamed:true,screen_name:newName,updated_fields:selected.length,updated_step_references:0};
})();


// A selected field belongs to the screen confirmed by the save operation.
// Browser navigation and stale client metadata must not silently move it to a
// different screen or application. The reference lives in existing metadata.
const resolveRepositoryScreenBinding = async (input, existing = null) => {
  const metadata = ports.normalizeObject(input.metadata);
  const screenId = ports.normalizeText(metadata.screen_entry_id);
  if (!screenId) return input;
  let screen;try{screen=await exports.getLearningCacheEntry(screenId);}catch{screen=null;}
  if (!screen || !isRepositoryScreenRecord(screen)) {
    throw new Error("The selected repository screen no longer exists. Reopen the screen before saving its fields.");
  }
  if (isRepositoryScreenRecord({ ...existing, ...input, metadata })) {
    throw new Error("Only repository fields can be linked to a parent screen.");
  }
  const requestedApp = ports.normalizeText(input.app_type_id) || ports.normalizeText(existing?.app_type_id);
  const requestedProject = ports.normalizeText(input.project_id) || ports.normalizeText(existing?.project_id);
  if ((requestedApp && requestedApp !== screen.app_type_id)
    || (requestedProject && screen.project_id && requestedProject !== screen.project_id)
    || (existing && (existing.app_type_id || null) !== (screen.app_type_id || null))) {
    throw new Error("The selected repository screen and field must belong to the same project and app type.");
  }
  const screenName = ports.normalizeText(screen.metadata?.screen_name) || ports.normalizeText(screen.page_key);
  return {
    ...input,
    project_id: screen.project_id || requestedProject || null,
    app_type_id: screen.app_type_id || null,
    page_key: screenName,
    page_url: screen.page_url || input.page_url || null,
    screen_name: screenName,
    metadata: { ...metadata, screen_entry_id: screen.id, screen_name: screenName, record_kind: "field" }
  };
};


exports.createLearningCacheEntry = async (input = {}) => {
  input = await resolveRepositoryScreenBinding(input);
  const appTypeId = ports.normalizeText(input.app_type_id);
  let projectId = ports.normalizeText(input.project_id);
  if (appTypeId) {
    const appType = await ports.db.prepare(`SELECT id, project_id FROM app_types WHERE id = ?`).get(appTypeId);
    if (!appType) throw new Error("App type not found");
    if (projectId && projectId !== appType.project_id) throw new Error("Object repository project scope must match the selected app type");
    projectId = appType.project_id;
  }
  const metadata = ports.normalizeObject(input.metadata);
  const pageKey = ports.normalizeText(input.page_key) || ports.normalizeText(input.screen_name) || ports.normalizeUrlKey(input.page_url) || "unknown-page";
  const locator = ports.normalizeText(input.locator);
  const screenName = ports.normalizeText(input.screen_name) || pageKey;

  if (!locator) {
    throw new Error("Locator is required");
  }

  const duplicate = await exports.findDuplicateLearningCacheEntry({
    app_type_id: appTypeId,
    project_id: projectId,
    screen_name: screenName,
    locator
  });

  if (duplicate) {
    // Inspect can retry after a partial save or a stale repository reload.
    // The confirmed parent and locator identify the same field durably.
    if (metadata.screen_entry_id && !isRepositoryScreenRecord(duplicate)) {
      return exports.updateLearningCacheEntry(duplicate.id, {...input,locator:duplicate.locator});
    }
    if(!ports.canonicalPageUrl(input.page_url))throw new Error("Another object repository field on this screen already uses the same locator.");
  }

  const persisted=await upsertLearningCache.run(
    ports.uuid(),
    projectId,
    appTypeId,
    ports.normalizeText(input.test_case_id),
    ports.normalizeText(input.page_url),
    pageKey,
    ports.normalizeText(input.locator_intent || input.object_name) || "field",
    locator,
    ports.normalizeText(input.locator_kind) || "css",
    ports.clampNumber(input.confidence, 0.8),
    ports.normalizeText(input.source) || "object_repository",
    {
      ...metadata,
      screen_name: screenName,
      object_name: ports.normalizeText(input.object_name) || ports.normalizeText(input.locator_intent) || "field",
      object_role: ports.normalizeText(input.object_role) || "field",
      target_criteria: input.target_criteria !== undefined ? input.target_criteria : Array.isArray(metadata.target_criteria) ? metadata.target_criteria : [],
      dom_structure: ports.normalizeText(input.dom_structure !== undefined ? input.dom_structure : metadata.dom_structure),
      screenshot_url: ports.normalizeText(input.screenshot_url !== undefined ? input.screenshot_url : metadata.screenshot_url),
      fallback_strategy: ports.normalizeText(input.fallback_strategy !== undefined ? input.fallback_strategy : metadata.fallback_strategy),
      screen_dom_compressed: ports.normalizeText(input.screen_dom_compressed !== undefined ? input.screen_dom_compressed : metadata.screen_dom_compressed),
      screen_screenshot_url: ports.normalizeText(input.screen_screenshot_url !== undefined ? input.screen_screenshot_url : metadata.screen_screenshot_url)
    }
  );

  return exports.getLearningCacheEntry(persisted.id);
};


exports.findDuplicateLearningCacheEntry = async ({ app_type_id, project_id, screen_name, locator, exclude_id } = {}) => {
  const normalizedScreen = ports.normalizeText(screen_name);
  const normalizedLocator = ports.normalizeText(locator);

  if (!normalizedScreen || !normalizedLocator) {
    return null;
  }

  const rows = await listLearningCacheScreenRows({ appTypeId: ports.normalizeText(app_type_id), projectId: ports.normalizeText(project_id), screenName: normalizedScreen });
  return rows.find((entry) =>
    entry.id !== exclude_id
    && ((entry.metadata?.platform||'web')==='web'?ports.sameRecordedLocator(ports.normalizeText(entry.locator),normalizedLocator):ports.normalizeText(entry.locator)===normalizedLocator)
    && ports.normalizeText(entry.metadata?.screen_name || entry.page_key || entry.page_url) === normalizedScreen
  ) || null;
};


exports.importLearningCacheEntries = async ({ project_id, app_type_id, entries, import_source } = {}) => {
  const appTypeId = ports.normalizeText(app_type_id);
  const projectId = ports.normalizeText(project_id);
  const rows = Array.isArray(entries) ? entries : [];

  if (!appTypeId) {
    throw new Error("App type scope is required");
  }
  if (!rows.length) {
    throw new Error("Provide at least one object repository entry to import");
  }
  if (rows.length > 200) {
    throw new Error("Import batches cannot exceed 200 repository entries");
  }

  const result = { created: 0, updated: 0, failed: 0, errors: [] };

  for (let index = 0; index < rows.length; index += 1) {
    const raw = ports.normalizeObject(rows[index]);
    const rawMetadata = ports.normalizeObject(raw.metadata);
    const screenName = ports.normalizeText(raw.screen_name || rawMetadata.screen_name || raw.page_key);
    const screenRecord = raw.record_type === "screen"
      || raw.locator_intent === "__screen__"
      || rawMetadata.record_kind === "screen";
    const objectName = screenRecord ? "__screen__" : ports.normalizeText(raw.object_name || rawMetadata.object_name || raw.locator_intent);
    const locator = screenRecord ? "__screen__" : ports.normalizeText(raw.locator);

    try {
      if (!screenName) {
        throw new Error("Screen name is required");
      }
      if (!screenRecord && (!objectName || !locator)) {
        throw new Error("Fields require an object name and locator");
      }

      const metadata = {
        ...rawMetadata,
        screen_name: screenName,
        object_name: objectName,
        object_role: screenRecord ? "screen" : ports.normalizeText(raw.object_role || rawMetadata.object_role) || "field",
        ...(screenRecord ? { record_kind: "screen" } : {}),
        import_source: ports.normalizeText(import_source) || "object_repository_import",
        imported_at: new Date().toISOString()
      };
      const input = {
        project_id: projectId,
        app_type_id: appTypeId,
        page_url: ports.normalizeText(raw.page_url),
        page_key: screenName,
        screen_name: screenName,
        locator_intent: objectName,
        object_name: objectName,
        object_role: metadata.object_role,
        locator,
        locator_kind: screenRecord ? "screen" : ports.normalizeText(raw.locator_kind) || inferLocatorStrategy(locator, "css"),
        confidence: Math.max(0, Math.min(1, ports.clampNumber(raw.confidence, screenRecord ? 1 : 0.8))),
        source: ports.normalizeText(raw.source) || (screenRecord ? "imported_screen" : "imported_repository"),
        target_criteria: Array.isArray(raw.target_criteria) ? raw.target_criteria : rawMetadata.target_criteria,
        dom_structure: ports.normalizeText(raw.dom_structure || rawMetadata.dom_structure),
        screenshot_url: ports.normalizeText(raw.screenshot_url || rawMetadata.screenshot_url),
        fallback_strategy: ports.normalizeText(raw.fallback_strategy || rawMetadata.fallback_strategy),
        screen_dom_compressed: ports.normalizeText(raw.screen_dom_compressed || rawMetadata.screen_dom_compressed),
        screen_screenshot_url: ports.normalizeText(raw.screen_screenshot_url || rawMetadata.screen_screenshot_url),
        metadata
      };
      let screenRows = await listLearningCacheScreenRows({ appTypeId, projectId,screenName });
      if(ports.canonicalPageUrl(input.page_url))screenRows=screenRows.filter(entry=>ports.canonicalPageUrl(entry.page_url)===ports.canonicalPageUrl(input.page_url));
      const normalizedObjectName = String(objectName).toLowerCase();
      const existing = screenRecord
        ? screenRows.find(isRepositoryScreenRecord)
        : screenRows.find((entry) => !isRepositoryScreenRecord(entry)
            && String(getRepositoryObjectName(entry, screenName) || "").toLowerCase() === normalizedObjectName)
          || screenRows.find((entry) => !isRepositoryScreenRecord(entry) && ports.normalizeText(entry.locator) === locator);

      if (existing) {
        if(ports.canonicalPageUrl(input.page_url)&&ports.canonicalPageUrl(input.page_url)===ports.canonicalPageUrl(existing.page_url)){
          input.metadata.screen_aliases=[...new Set([...(existing.metadata.screen_aliases||[]),screenName])];
          if(!screenRecord)input.metadata.reference_aliases=[...new Set([...(existing.metadata.reference_aliases||[]),`${screenName}.${objectName}`])];
          input.screen_name=existing.metadata.screen_name||existing.page_key;input.page_key=existing.page_key;input.metadata.screen_name=input.screen_name;
          if(!screenRecord){input.object_name=getRepositoryObjectName(existing);input.locator_intent=existing.locator_intent;input.metadata.object_name=input.object_name;}
        }
        await exports.updateLearningCacheEntry(existing.id, input,{identityMetadata:{screen_aliases:input.metadata.screen_aliases,reference_aliases:input.metadata.reference_aliases}});
        result.updated += 1;
      } else {
        await exports.createLearningCacheEntry(input);
        result.created += 1;
      }
    } catch (error) {
      result.failed += 1;
      result.errors.push({
        index,
        screen_name: screenName,
        object_name: objectName,
        message: error instanceof Error ? error.message : "Unable to import repository entry"
      });
    }
  }

  return result;
};


const buildRepositoryUsageNeedles = (entry) => {
  if (isRepositoryScreenRecord(entry)) {
    return [];
  }

  const screenName = ports.normalizeText(entry.metadata?.screen_name || entry.page_key);
  const objectName = getRepositoryObjectName(entry, screenName);
  return [
    entry.locator,
    objectName,
    screenName && objectName ? `${screenName}.${objectName}` : null,
    entry.locator_intent
    ,...(Array.isArray(entry.metadata?.reference_aliases)?entry.metadata.reference_aliases:[])
  ].map(ports.normalizeText).filter(Boolean);
};


exports.findLearningCacheUsage = async (entryOrEntries) => {
  const entries = (Array.isArray(entryOrEntries) ? entryOrEntries : [entryOrEntries]).filter(Boolean);
  const needles = [...new Set(entries.flatMap(buildRepositoryUsageNeedles))];

  if (!needles.length) {
    return [];
  }

  const scopedAppTypeIds = [...new Set(entries.map((entry) => ports.normalizeText(entry.app_type_id)).filter(Boolean))];
  let query = `
    SELECT DISTINCT test_cases.id, test_cases.display_id, test_cases.title, test_cases.automated
    FROM test_steps
    JOIN test_cases ON test_cases.id = test_steps.test_case_id
    WHERE 1 = 1
  `;
  const params = [];

  if (scopedAppTypeIds.length === 1) {
    query += ` AND test_cases.app_type_id = ?`;
    params.push(scopedAppTypeIds[0]);
  }

  const likeClauses = needles.flatMap(() => [
    `LOWER(COALESCE(test_steps.action, '')) LIKE ?`,
    `LOWER(COALESCE(test_steps.expected_result, '')) LIKE ?`,
    `LOWER(COALESCE(test_steps.automation_code, '')) LIKE ?`
  ]);
  query += ` AND (${likeClauses.join(" OR ")}) ORDER BY test_cases.title`;
  needles.forEach((needle) => {
    const pattern = `%${needle.toLowerCase()}%`;
    params.push(pattern, pattern, pattern);
  });

  return ports.obsDb.prepare(query).all(...params);
};


exports.findLearningCacheScreenUsage = async ({ app_type_id, project_id, screen_name } = {}) => {
  const screenName = ports.normalizeText(screen_name);
  const appTypeId = ports.normalizeText(app_type_id);

  if (!screenName) {
    throw new Error("Screen name is required");
  }

  const rows = await listLearningCacheScreenRows({ appTypeId, projectId:ports.normalizeText(project_id), screenName });

  return exports.findLearningCacheUsage(rows);
};


const invalidateRepositoryUsage = async (usage = []) => {
  const affected = [];

  for (const testCase of usage) {
    if (testCase.automated !== "yes") {
      continue;
    }

    const result = await ports.markTestCaseAutomationIncomplete.run(testCase.id);
    if (result.changes) {
      affected.push(testCase);
    }
  }

  return affected;
};


exports.deleteLearningCacheEntry = async (id, { confirmed = false } = {}) => ports.obsDb.transaction(async()=>{
  let existing = await exports.getLearningCacheEntry(id);
  const scope={appTypeId:existing.app_type_id,projectId:existing.project_id};await lockRepositoryScope(scope);
  existing=await exports.getLearningCacheEntry(id);
  const usage = await exports.findLearningCacheUsage(existing);

  if (usage.length && !confirmed) {
    return { deleted: false, requires_confirmation: true, usage, invalidated_cases: [] };
  }

  const projection=await canonicalRepositoryProjection(await readRepositoryScope(scope));
  for(const row of projection.all)if(row.id===existing.id||row.metadata.merged_into_entry_id===existing.id)await deleteLearningCacheEntry.run(row.id);
  const invalidatedCases = await invalidateRepositoryUsage(usage);
  return { deleted: true, requires_confirmation: false, usage, invalidated_cases: invalidatedCases };
})();


exports.deleteLearningCacheScreen = async ({ app_type_id, project_id, screen_name, confirmed = false } = {}) => ports.obsDb.transaction(async()=>{
  const screenName = ports.normalizeText(screen_name);
  const appTypeId = ports.normalizeText(app_type_id);

  if (!screenName) {
    throw new Error("Screen name is required");
  }

  const projectId=ports.normalizeText(project_id)||(appTypeId?(await ports.db.prepare('SELECT id, project_id FROM app_types WHERE id = ?').get(appTypeId))?.project_id:null);
  const scope={appTypeId,projectId};await lockRepositoryScope(scope);
  const rows = await listLearningCacheScreenRows({ appTypeId, projectId, screenName });
  const usage = await exports.findLearningCacheUsage(rows);

  if (usage.length && !confirmed) {
    return { deleted: false, requires_confirmation: true, usage, invalidated_cases: [] };
  }

  const names=new Set(rows.map(row=>row.metadata.screen_name||row.page_key));
  const projection=await canonicalRepositoryProjection(await readRepositoryScope(scope));
  for(const row of projection.all)if(names.has(row.metadata.screen_name||row.page_key))await deleteLearningCacheEntry.run(row.id);
  const invalidatedCases = await invalidateRepositoryUsage(usage);
  return { deleted: true, requires_confirmation: false, usage, invalidated_cases: invalidatedCases };
})();


exports.improveLearningCacheEntry = async ({ id, integration_id, user_id, guidance } = {}) => {
  const existing = await exports.getLearningCacheEntry(id);
  let suggestion;
  let integration = null;

  try {
    integration = await ports.resolveLlmIntegration(integration_id, {
      userId: user_id,
      projectId: existing.project_id,
      usageKey: "ai.automation.locator_repair"
    });
  } catch {
    integration = null;
  }

  if (integration) {
    try {
      const content = await ports.requestChatCompletion({
        integration,
        featureKey: "ai.automation.locator_repair",
        prompt: ports.buildRepositoryImprovePrompt({ entry: existing, guidance: ports.normalizeText(guidance) })
      });
      suggestion = ports.extractJsonPayload(content);
    } catch (error) {
      suggestion = {
        ...ports.buildDeterministicRepositorySuggestion(existing, ports.normalizeText(guidance)),
        fallback_reason: error instanceof Error ? error.message : "LLM repository improvement failed"
      };
    }
  } else {
    suggestion = ports.buildDeterministicRepositorySuggestion(existing, ports.normalizeText(guidance));
  }

  const locator = ports.normalizeText(suggestion?.locator);
  const strategy = ports.normalizeText(suggestion?.strategy || suggestion?.locator_kind || suggestion?.kind);
  if (!locator || !strategy) {
    suggestion = { ...ports.buildDeterministicRepositorySuggestion(existing, ports.normalizeText(guidance)), fallback_reason: "The model did not return a usable locator and strategy." };
  }
  const fallback = Boolean(suggestion.fallback_used);
  return {
    entry: existing,
    suggestion: {
      locator: ports.normalizeText(suggestion.locator),
      strategy: ports.normalizeText(suggestion.strategy || suggestion.locator_kind || suggestion.kind) || existing.locator_kind || "css",
      confidence: ports.clampNumber(suggestion.confidence, existing.confidence),
      reason: ports.normalizeText(suggestion.reason || suggestion.fallback_strategy) || "Review this locator against the captured evidence before applying."
    },
    fallback_used: fallback,
    fallback_reason: suggestion.fallback_reason || null,
    generation_mode: fallback ? "deterministic" : "llm",
    generated_at: new Date().toISOString(),
    request_id: ports.uuid(),
    requires_human_review: true,
    provenance: { provider: fallback ? "HelloTest deterministic rules" : integration?.name || integration?.type || "Configured AI provider", model: fallback ? null : integration?.config?.model || null }
  };
};


exports.applyLearningCacheImprovement = async ({ id, confirmed, locator, strategy, confidence, expected_locator, request_id, user_id } = {}) => {
  const invalid = message => Object.assign(new Error(message), { statusCode: 400 });
  if (confirmed !== true) throw invalid("Review and confirm the proposed locator before applying it.");
  locator = ports.normalizeText(locator);
  strategy = ports.normalizeText(strategy);
  if (!locator || !strategy || locator.length > 8192 || strategy.length > 100) throw invalid("A valid locator and strategy are required.");
  if (confidence !== undefined && (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)) throw invalid("Confidence must be between 0 and 1.");
  return ports.obsDb.transaction(async () => {
    let existing = await exports.getLearningCacheEntry(id);
    await lockRepositoryScope({appTypeId:existing.app_type_id,projectId:existing.project_id});
    await ports.obsDb.prepare("SELECT id FROM automation_learning_cache WHERE id = ? FOR UPDATE").get(existing.id);
    existing = await exports.getLearningCacheEntry(id);
    if (isRepositoryScreenRecord(existing)) throw invalid("Select a repository field to improve.");
    if (typeof expected_locator !== "string" || existing.locator !== expected_locator) {
      throw Object.assign(new Error("This field changed since the proposal was generated. Refresh and generate a new proposal."), { statusCode: 409 });
    }
    const reviewedAt = new Date().toISOString();
    const changed = existing.locator !== locator || existing.locator_kind !== strategy;
    const fallbacks = Array.isArray(existing.metadata?.fallback_locators) ? existing.metadata.fallback_locators : [];
    const previous = { locator: existing.locator, strategy: existing.locator_kind || "css", confidenceScore: existing.confidence, isPrimary: false };
    const entry = await exports.updateLearningCacheEntry(id, {
      locator, locator_kind: strategy, confidence: confidence ?? existing.confidence,
      source: "reviewed_locator_improvement",
      metadata: {
        ...existing.metadata,
        fallback_locators: [ ...(changed ? [previous] : []), ...fallbacks ].filter((item, index, all) => item.locator !== locator && all.findIndex(other => other.locator === item.locator) === index),
        ...(changed ? { last_validated_at: null, last_validated_status: "not_validated" } : {}),
        locator_review_history: [...(Array.isArray(existing.metadata?.locator_review_history) ? existing.metadata.locator_review_history : []), {
          before: { locator: existing.locator, strategy: existing.locator_kind }, after: { locator, strategy },
          reviewed_by: user_id, reviewed_at: reviewedAt, request_id: request_id || null
        }].slice(-50)
      }
    });
    return { entry, applied: true };
  })();
};


exports.extractRepositoryFields = async ({
  screen_name,
  page_url,
  dom_structure,
  screenshot_url,
  business_meaning,
  candidate_fields,
  integration_id,
  user_id,
  project_id
} = {}) => {
  const screenName = ports.normalizeText(screen_name) || "Screen";
  const pageUrl = ports.normalizeText(page_url);
  const domStructure = ports.normalizeText(dom_structure);
  const screenshotUrl = ports.normalizeText(screenshot_url);
  const candidateFields = Array.isArray(candidate_fields) ? candidate_fields : [];

  if (!domStructure && !screenshotUrl) {
    throw new Error("Provide captured DOM or a screenshot before extracting fields.");
  }

  let integration = null;
  try {
    integration = await ports.resolveLlmIntegration(integration_id, {
      userId: user_id,
      projectId: project_id,
      usageKey: "ai.automation.dom_extraction"
    });
  } catch {
    integration = null;
  }

  if (!integration) {
    return {
      ...ports.normalizeRepositoryExtractFields({}, candidateFields),
      ai_used: false,
      fallback_used: true,
      fallback_reason: "No active LLM integration is configured; extracted deterministic DOM candidates."
    };
  }

  const prompt = ports.buildRepositoryExtractPrompt({
    screenName,
    pageUrl,
    domStructure,
    businessMeaning: ports.normalizeText(business_meaning),
    candidateFields
  });

  try {
    const content = screenshotUrl
      ? [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: screenshotUrl } }
      ]
      : prompt;
    const response = await ports.requestChatCompletion({ integration, prompt, content, featureKey: "ai.automation.dom_extraction" });
    const payload = ports.extractJsonPayload(response);
    const hasAiFields = Array.isArray(payload?.fields) && payload.fields.length > 0;
    return {
      ...ports.normalizeRepositoryExtractFields(payload, candidateFields),
      ai_used: hasAiFields,
      fallback_used: !hasAiFields,
      fallback_reason: hasAiFields ? null : "AI returned no usable fields; extracted deterministic DOM candidates."
    };
  } catch (error) {
    return {
      ...ports.normalizeRepositoryExtractFields({}, candidateFields),
      ai_used: false,
      fallback_used: true,
      fallback_reason: error instanceof Error ? error.message : "AI screen extraction failed; extracted deterministic DOM candidates."
    };
  }
};
return { upsertLearningCacheRecord, upsertLearningCache, selectLearningCacheEntry, selectLearningCacheScreenEntries, updateLearningCacheEntry, deleteLearningCacheEntry, deleteLearningCacheScreen, renameLearningCacheScreen, replaceTestStepRepositoryReference, inferLocatorStrategy, normalizeLearningCacheRow, listLearningCacheRows, canonicalRepositoryProjection, readRepositoryScope, lockRepositoryScope, saveRepositoryProjection, reconcileRepositoryScope, persistCanonicalRepositoryRow, listLearningCacheScreenRows, listAllLearningCacheRows, normalizeRepositoryPatch, persistLearning, csvValue, getRepositoryObjectName, isRepositoryScreenRecord, getRepositoryMemberReference, migrateRepositoryMemberReference, resolveRepositoryScreenBinding, buildRepositoryUsageNeedles, invalidateRepositoryUsage };
}
module.exports = { createRepositoryStorage };
