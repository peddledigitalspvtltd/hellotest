const db=require('@hellotest/platform/backend/src/db');
async function resolve({appTypeId,moduleIds=[],testCaseIds=[],membership='snapshot'}) {
 if(!['snapshot','live'].includes(membership))throw Object.assign(new Error('Choose snapshot or live module membership.'),{statusCode:422});
 const ids=[...new Set(moduleIds)];
 const modules=ids.length?await db.prepare('SELECT id FROM test_case_modules WHERE app_type_id=? AND id IN (SELECT jsonb_array_elements_text(?::jsonb))').all(appTypeId,ids):[];
 if(modules.length!==ids.length)throw Object.assign(new Error('All selected modules must belong to the suite application.'),{statusCode:403});
 const members=ids.length?await db.prepare(`SELECT member.test_case_id FROM jsonb_array_elements_text(?::jsonb) WITH ORDINALITY selected(id,position)
  JOIN test_case_effective_module_cases member ON member.module_id=selected.id
  JOIN test_cases ON test_cases.id=member.test_case_id AND test_cases.app_type_id=?
  ORDER BY selected.position,member.sort_order,member.test_case_id`).all(ids,appTypeId):[];
 const resolved=[...new Set([...testCaseIds,...members.map(row=>row.test_case_id)])];
 return{module_ids:ids,module_membership:membership,resolved_case_count:resolved.length,test_case_ids:membership==='snapshot'?resolved:testCaseIds};
}
module.exports={resolve};
