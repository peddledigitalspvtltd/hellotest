const db = require('@hellotest/platform/backend/src/db');

/** Resolve relationships only: explicit case mapping wins; otherwise an
 * automation case inherits its primary linked manual case's first mapping.
 * Choose the mapping before validating its resource so an invalid explicit
 * choice cannot silently select a different source. Callers retain their
 * existing case/data permission boundary; this helper grants no access. */
async function loadEffectiveCaseDataSets({ testCaseIds = [], projectId = null, appTypeId = null, includeLinkedManual = true, lock = false, database = db } = {}) {
  const ids = [...new Set(testCaseIds.filter(id => typeof id === 'string' && id.length))];
  if (!ids.length) return [];
  const rows = await database.prepare(`
    SELECT target.id AS test_case_id,
      COALESCE(own_mapping.test_data_set_id, manual_mapping.test_data_set_id) AS test_data_set_id,
      CASE WHEN own_mapping.test_data_set_id IS NOT NULL THEN target.id ELSE manual_mapping.source_test_case_id END AS source_test_case_id,
      CASE WHEN own_mapping.test_data_set_id IS NOT NULL THEN 'test_case' ELSE 'linked_manual' END AS mapping_source,
      data_set.id, data_set.name, data_set.description, data_set.mode, data_set.columns, data_set.rows
    FROM test_cases target
    LEFT JOIN test_suites legacy_suite ON legacy_suite.id = target.suite_id
    JOIN app_types target_app ON target_app.id = COALESCE(target.app_type_id, legacy_suite.app_type_id)
    LEFT JOIN LATERAL (
      SELECT mapping.test_data_set_id FROM test_case_data_sets mapping
      WHERE mapping.test_case_id = target.id
      ORDER BY mapping.sort_order, mapping.test_data_set_id LIMIT 1${lock ? ' FOR SHARE OF mapping' : ''}
    ) own_mapping ON true
    LEFT JOIN LATERAL (
      SELECT mapping.test_data_set_id, source.id AS source_test_case_id
      FROM automation_case_links link
      JOIN test_cases source ON source.id = link.manual_test_case_id
        AND source.app_type_id = target.app_type_id AND COALESCE(source.automated, 'no') = 'no'
      JOIN test_case_data_sets mapping ON mapping.test_case_id = source.id
      WHERE link.automation_test_case_id = target.id AND target.automated = 'yes'
        AND own_mapping.test_data_set_id IS NULL AND ?::boolean
      ORDER BY link.is_primary DESC, source.id, mapping.sort_order, mapping.test_data_set_id
      LIMIT 1${lock ? ' FOR SHARE OF link,source,mapping' : ''}
    ) manual_mapping ON true
    LEFT JOIN test_data_sets data_set
      ON data_set.id = COALESCE(own_mapping.test_data_set_id, manual_mapping.test_data_set_id)
      AND data_set.project_id = target_app.project_id
      AND (data_set.app_type_id IS NULL OR data_set.app_type_id = target_app.id)
    WHERE target.id IN (SELECT jsonb_array_elements_text(?::jsonb))
      AND (?::text IS NULL OR target_app.project_id = ?)
      AND (?::text IS NULL OR target_app.id = ?)
      AND COALESCE(own_mapping.test_data_set_id, manual_mapping.test_data_set_id) IS NOT NULL
    ORDER BY target.id${lock ? ' FOR SHARE OF target,target_app' : ''}
  `).all(includeLinkedManual === true, ids, projectId, projectId, appTypeId, appTypeId);
  if (rows.some(row => !row.id)) throw Object.assign(new Error('A mapped case data set is unavailable in this application. Review its data-set relationship before continuing.'), {
    statusCode: 404, code: 'TEST_CASE_DATA_SET_UNAVAILABLE', nonRetryable: true
  });
  return rows;
}

/** A run's case layer is already materialized. Reapplying run options must not
 * resolve a newer linked mapping or evaluate a generator again. Legacy runs
 * retain their previously frozen case-owned snapshot when present. */
function frozenCaseDataSet(snapshot) {
  let data = snapshot?.test_data_set_snapshot;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { return null; } }
  if (!data || typeof data !== 'object') return null;
  if (!data.parameter_data_layers) return snapshot.data_set_source === 'test_case' ? structuredClone(data) : null;
  const layer = data.parameter_data_layers.case;
  if (!layer) return null;
  return { id: data.id, name: data.name, mode: 'table', columns: [...new Set((layer.rows || []).flatMap(Object.keys))],
    rows: structuredClone(layer.rows || []), sensitive_names: structuredClone(layer.sensitive_names || []) };
}

const caseDataSetResource = row => row ? Object.fromEntries(['id', 'name', 'description', 'mode', 'columns', 'rows'].filter(key => row[key] !== undefined).map(key => [key, structuredClone(row[key])])) : null;

module.exports = { loadEffectiveCaseDataSets, frozenCaseDataSet, caseDataSetResource };
