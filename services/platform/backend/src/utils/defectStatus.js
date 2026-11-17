// Historical imports use several resolved-state spellings. All health surfaces
// classify the same stored value without rewriting its authored workflow state.
const CLOSED_DEFECT_STATUSES=Object.freeze(['closed','resolved','done','accepted','complete','completed','fixed','verified','cancelled','canceled']);
const normalizedDefectStatus=value=>String(value??'').trim().toLowerCase().replace(/[ _-]+/g,'_');
const isClosedDefect=value=>CLOSED_DEFECT_STATUSES.includes(normalizedDefectStatus(value));
const closedDefectSql=column=>`LOWER(REGEXP_REPLACE(TRIM(COALESCE(${column}, '')), '[ _-]+', '_', 'g')) IN (${CLOSED_DEFECT_STATUSES.map(value=>`'${value}'`).join(', ')})`;
module.exports={CLOSED_DEFECT_STATUSES,normalizedDefectStatus,isClosedDefect,closedDefectSql};
