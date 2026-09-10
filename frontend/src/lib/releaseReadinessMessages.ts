export const READINESS_MESSAGES: Record<string, string> = {
  "readiness.title": "Release readiness",
  "readiness.eyebrow": "Release review",
  "readiness.subtitle":
    "Review delivery scope, unresolved risks and the evidence behind your next decision.",
  "readiness.release": "Release / fix version",
  "readiness.sprint": "Sprint",
  "readiness.allReleases": "All releases",
  "readiness.allSprints": "All sprints",
  "readiness.apply": "Apply scope",
  "readiness.changeScope": "Change scope",
  "readiness.refresh": "Refresh evidence",
  "readiness.refreshing": "Refreshing…",
  "readiness.explain": "Explain release",
  "readiness.explainHelp":
    "Read-only explanation for the full selected release. Sprint filtering applies to this dashboard only.",
  "readiness.scopeOverview":
    "Project overview · choose a release or sprint for a focused review",
  "readiness.scopeLocked": "Linked release",
  "readiness.noProject": "Choose a project to review a release.",
  "readiness.contextError":
    "This release could not be loaded in the current project.",
  "readiness.contextHelp":
    "Retry the connection or change scope to review this project’s available evidence.",
  "readiness.retry": "Retry",
  "readiness.loading": "Loading release evidence…",
  "readiness.permissions": "Unavailable sources",
  "readiness.state.attention": "Attention required",
  "readiness.state.review": "Complete the evidence review",
  "readiness.state.insufficient": "Evidence is not yet sufficient",
  "readiness.state.clear": "No review signals found",
  "readiness.summary.attention":
    "The loaded evidence contains failures, blocked work, priority coverage gaps or critical/high defects. Review the items below before deciding.",
  "readiness.summary.review":
    "Check outstanding evidence, source limits and open defects before recording your release decision.",
  "readiness.summary.insufficient":
    "Link release stories to test cases and run that scope to build a useful review.",
  "readiness.summary.clear":
    "The loaded scope has linked stories and assessed test cases with no observed failures or open defects. Final release approval remains with your team.",
  "readiness.partial": "Limited evidence",
  "readiness.complete": "Loaded sources complete",
  "readiness.updated": "Latest activity",
  "readiness.noDate": "No dated result",
  "readiness.cachedError":
    "Some sources could not be refreshed. Available evidence is retained; the review remains provisional.",
  "readiness.flagsError":
    "Source availability could not be checked. Retry to load permitted evidence.",
  "readiness.metric.stories": "Story coverage",
  "readiness.metric.assessed": "Cases assessed",
  "readiness.metric.outcomes": "Passing outcomes",
  "readiness.metric.defects": "Open defects",
  "readiness.storiesDetail": "{covered} of {total} stories have linked tests",
  "readiness.casesDetail":
    "{assessed} of {total} cases have assessed observed rows",
  "readiness.outcomesDetail": "{passed} passed · {failed} failed",
  "readiness.defectsDetail": "{critical} critical · {high} high",
  "readiness.noDenominator": "Not available",
  "readiness.tab.review": "Review",
  "readiness.tab.stories": "Stories",
  "readiness.tab.runs": "Runs",
  "readiness.actions": "Resolve the next evidence gaps",
  "readiness.actionsHelp":
    "Known defects first, then failed or blocked runs and uncovered priority stories.",
  "readiness.noActions": "No actionable signal in the loaded evidence",
  "readiness.noActionsHelp":
    "Review source completeness and remaining cases before recording a decision.",
  "readiness.openDefect": "Review defect",
  "readiness.openRun": "Open run",
  "readiness.openStory": "Open story",
  "readiness.critical": "Critical",
  "readiness.high": "High",
  "readiness.defect": "Defect",
  "readiness.failed": "{count} failed",
  "readiness.blocked": "{count} blocked",
  "readiness.paused": "{count} paused",
  "readiness.remaining": "{count} awaiting assessment",
  "readiness.noTests": "No linked tests",
  "readiness.moreActions": "Show more actions",
  "readiness.actionCount": "{shown} of {total} actions shown",
  "readiness.checks": "Review checks",
  "readiness.checksHelp": "Observed conditions, not configured approval gates.",
  "readiness.check.critical-defects": "Critical defects",
  "readiness.check.failed-outcomes": "Failed test outcomes",
  "readiness.check.priority-coverage": "Uncovered P1 / P2 stories",
  "readiness.check.remaining-evidence": "Cases awaiting assessment",
  "readiness.check.pass": "None observed",
  "readiness.check.warning": "Review",
  "readiness.check.block": "Action needed",
  "readiness.sources": "Evidence boundary",
  "readiness.source.stories": "Stories",
  "readiness.source.cases": "Test cases",
  "readiness.source.bugs": "Bugs",
  "readiness.source.runs": "Runs and outcomes",
  "readiness.source.loaded": "{loaded} / {total} loaded",
  "readiness.source.unavailable": "Unavailable",
  "readiness.source.error": "Connection error",
  "readiness.loadMore": "Load more evidence",
  "readiness.loadingMore": "Loading more…",
  "readiness.bounded":
    "This review uses a bounded evidence window. Older runs or additional records may be outside the loaded sample.",
  "readiness.missingDetails":
    "{count} linked cases have no loaded case details. They remain in the planned scope.",
  "readiness.missingIterations":
    "{count} planned run rows have no result. They remain unassessed.",
  "readiness.scopeNeeded":
    "A project overview cannot establish readiness for a particular release.",
  "readiness.ambiguousSprint":
    "More than one sprint uses this name. Verify the release and story membership.",
  "readiness.stale":
    "Latest result activity is more than 14 days old. Confirm it still applies to the release candidate.",
  "readiness.storyColumn": "Story",
  "readiness.coverageColumn": "Linked tests",
  "readiness.assessedColumn": "Cases assessed",
  "readiness.signalsColumn": "Review signals",
  "readiness.storiesHelp":
    "Case coverage is not scenario completeness. Rows include the loaded release/sprint stories.",
  "readiness.noStories": "No stories in the loaded scope",
  "readiness.noStoriesHelp":
    "Adjust the scope or load more evidence to include additional stories.",
  "readiness.noRuns": "No runs in the loaded scope",
  "readiness.noRunsHelp":
    "Assign the release or sprint to a run and execute its planned cases.",
  "readiness.runsHelp":
    "Each run keeps its own environment and data rows. A newer attempt replaces an older attempt only within the same run, case and row.",
  "readiness.runCount": "{count} observed outcomes",
  "readiness.runName": "Untitled run",
  "readiness.environment": "Environment",
  "readiness.configuration": "Configuration",
  "readiness.notRecorded": "Not recorded",
  "readiness.passed": "{count} passed",
  "readiness.notAssessed": "{count} not assessed",
  "readiness.noSignal": "None observed",
  "readiness.methodology": "How to read this evidence",
  "readiness.methodologyBody":
    "Story coverage counts stories with linked test IDs. Cases assessed counts unique planned cases whose observed rows are all passed or failed and whose declared run rows are present. Planned cases include story links, run snapshots and result IDs, even if case details are unavailable. Passing outcomes is passed ÷ (passed + failed). Pending, running, paused, blocked, aborted and N/A rows are not assessed outcomes. Runs stay separate; older runs in the loaded window remain visible. These observations do not constitute release approval or a confidence score.",
  "readiness.window": "Evidence window",
  "readiness.windowDetail":
    "Up to {runs} recent runs and {results} result attempts. Source pages load on demand.",
  "readiness.aiTitle": "Release evidence explanation",
  "readiness.aiHelp":
    "Read-only explanation of the full release. Verify references and scope before acting.",
  "readiness.aiScope": "AI scope: {release} · all sprints",
  "readiness.aiEmpty":
    "No review signal was returned. This does not establish release readiness.",
  "readiness.aiGrounding": "Source evidence",
};
export const READINESS_MESSAGES_ES: Record<string, string> = {
  "readiness.title": "Preparación del lanzamiento",
  "readiness.eyebrow": "Revisión del lanzamiento",
  "readiness.subtitle":
    "Revise el alcance, los riesgos pendientes y la evidencia para su próxima decisión.",
  "readiness.release": "Versión de lanzamiento",
  "readiness.sprint": "Sprint",
  "readiness.allReleases": "Todas las versiones",
  "readiness.allSprints": "Todos los sprints",
  "readiness.apply": "Aplicar alcance",
  "readiness.changeScope": "Cambiar alcance",
  "readiness.refresh": "Actualizar evidencia",
  "readiness.refreshing": "Actualizando…",
  "readiness.explain": "Explicar lanzamiento",
  "readiness.retry": "Reintentar",
  "readiness.loading": "Cargando evidencia…",
  "readiness.state.attention": "Requiere atención",
  "readiness.state.review": "Complete la revisión de evidencia",
  "readiness.state.insufficient": "La evidencia aún no es suficiente",
  "readiness.state.clear": "No se encontraron señales de revisión",
  "readiness.partial": "Evidencia limitada",
  "readiness.complete": "Fuentes cargadas completas",
  "readiness.updated": "Última actividad",
  "readiness.noDate": "Sin resultado fechado",
  "readiness.metric.stories": "Cobertura de historias",
  "readiness.metric.assessed": "Casos evaluados",
  "readiness.metric.outcomes": "Resultados aprobados",
  "readiness.metric.defects": "Defectos abiertos",
  "readiness.storiesDetail":
    "{covered} de {total} historias tienen pruebas vinculadas",
  "readiness.casesDetail":
    "{assessed} de {total} casos tienen filas observadas evaluadas",
  "readiness.outcomesDetail": "{passed} aprobados · {failed} fallidos",
  "readiness.defectsDetail": "{critical} críticos · {high} altos",
  "readiness.tab.review": "Revisión",
  "readiness.tab.stories": "Historias",
  "readiness.tab.runs": "Ejecuciones",
  "readiness.noDenominator": "No disponible",
  "readiness.actions": "Resuelva las próximas brechas de evidencia",
  "readiness.openDefect": "Revisar defecto",
  "readiness.openRun": "Abrir ejecución",
  "readiness.openStory": "Abrir historia",
  "readiness.critical": "Crítico",
  "readiness.high": "Alto",
  "readiness.defect": "Defecto",
  "readiness.failed": "{count} fallidos",
  "readiness.blocked": "{count} bloqueados",
  "readiness.paused": "{count} pausados",
  "readiness.remaining": "{count} pendientes de evaluación",
  "readiness.noTests": "Sin pruebas vinculadas",
  "readiness.moreActions": "Mostrar más acciones",
  "readiness.actionCount": "{shown} de {total} acciones mostradas",
  "readiness.checks": "Comprobaciones de revisión",
  "readiness.checksHelp":
    "Condiciones observadas, no controles de aprobación configurados.",
  "readiness.check.critical-defects": "Defectos críticos",
  "readiness.check.failed-outcomes": "Resultados fallidos",
  "readiness.check.priority-coverage": "Historias P1 / P2 sin cobertura",
  "readiness.check.remaining-evidence": "Casos pendientes de evaluación",
  "readiness.check.pass": "Ninguno observado",
  "readiness.check.warning": "Revisar",
  "readiness.check.block": "Acción necesaria",
  "readiness.sources": "Límites de la evidencia",
  "readiness.source.stories": "Historias",
  "readiness.source.cases": "Casos de prueba",
  "readiness.source.bugs": "Errores",
  "readiness.source.runs": "Ejecuciones y resultados",
  "readiness.source.loaded": "{loaded} / {total} cargados",
  "readiness.source.unavailable": "No disponible",
  "readiness.source.error": "Error de conexión",
  "readiness.loadMore": "Cargar más evidencia",
  "readiness.loadingMore": "Cargando más…",
  "readiness.storyColumn": "Historia",
  "readiness.coverageColumn": "Pruebas vinculadas",
  "readiness.assessedColumn": "Casos evaluados",
  "readiness.signalsColumn": "Señales de revisión",
  "readiness.noStories": "Sin historias en el alcance cargado",
  "readiness.noRuns": "Sin ejecuciones en el alcance cargado",
  "readiness.runName": "Ejecución sin nombre",
  "readiness.environment": "Entorno",
  "readiness.configuration": "Configuración",
  "readiness.notRecorded": "No registrado",
  "readiness.passed": "{count} aprobados",
  "readiness.notAssessed": "{count} no evaluados",
  "readiness.noSignal": "Ninguna observada",
  "readiness.methodology": "Cómo interpretar esta evidencia",
  "readiness.window": "Ventana de evidencia",
  "readiness.aiTitle": "Explicación de la evidencia del lanzamiento",
  "readiness.aiGrounding": "Evidencia de origen",
};
Object.assign(READINESS_MESSAGES_ES, {
  "readiness.explainHelp":
    "Explicación de solo lectura de toda la versión seleccionada. El filtro de sprint solo se aplica a este panel.",
  "readiness.scopeOverview":
    "Resumen del proyecto · seleccione una versión o sprint para una revisión específica",
  "readiness.scopeLocked": "Versión vinculada",
  "readiness.noProject": "Seleccione un proyecto para revisar un lanzamiento.",
  "readiness.contextError":
    "No se pudo cargar esta versión en el proyecto actual.",
  "readiness.contextHelp":
    "Reintente la conexión o cambie el alcance para revisar la evidencia disponible.",
  "readiness.permissions": "Fuentes no disponibles",
  "readiness.summary.attention":
    "La evidencia cargada contiene fallos, trabajo bloqueado, historias prioritarias sin cobertura o defectos críticos o altos. Revise los elementos antes de decidir.",
  "readiness.summary.review":
    "Compruebe la evidencia pendiente, los límites de las fuentes y los defectos abiertos antes de registrar su decisión.",
  "readiness.summary.insufficient":
    "Vincule las historias de la versión con casos de prueba y ejecute ese alcance para preparar una revisión útil.",
  "readiness.summary.clear":
    "El alcance cargado tiene historias vinculadas y casos evaluados sin fallos ni defectos abiertos observados. La aprobación final corresponde a su equipo.",
  "readiness.cachedError":
    "No se pudieron actualizar algunas fuentes. Se conserva la evidencia disponible y la revisión sigue siendo provisional.",
  "readiness.flagsError":
    "No se pudo comprobar la disponibilidad de las fuentes. Reintente para cargar la evidencia permitida.",
  "readiness.actionsHelp":
    "Primero los defectos conocidos, después las ejecuciones fallidas o bloqueadas y las historias prioritarias sin cobertura.",
  "readiness.noActions":
    "No hay señales que requieran acción en la evidencia cargada",
  "readiness.noActionsHelp":
    "Revise la integridad de las fuentes y los casos pendientes antes de registrar una decisión.",
  "readiness.bounded":
    "Esta revisión usa una ventana de evidencia limitada. Las ejecuciones anteriores u otros registros pueden quedar fuera de la muestra cargada.",
  "readiness.missingDetails":
    "Faltan detalles de {count} casos vinculados. Se mantienen en el alcance planificado.",
  "readiness.missingIterations":
    "{count} filas planificadas no tienen resultado y siguen sin evaluar.",
  "readiness.scopeNeeded":
    "Un resumen del proyecto no permite determinar la preparación de una versión concreta.",
  "readiness.ambiguousSprint":
    "Varios sprints usan este nombre. Verifique la versión y las historias incluidas.",
  "readiness.stale":
    "La última actividad de resultados tiene más de 14 días. Confirme que siga siendo válida para la versión candidata.",
  "readiness.storiesHelp":
    "La cobertura de casos no representa todos los escenarios. Las filas incluyen las historias cargadas de la versión o sprint.",
  "readiness.noStoriesHelp":
    "Ajuste el alcance o cargue más evidencia para incluir otras historias.",
  "readiness.noRunsHelp":
    "Asigne la versión o sprint a una ejecución y ejecute sus casos planificados.",
  "readiness.runsHelp":
    "Cada ejecución conserva su entorno y filas de datos. Un intento nuevo sustituye al anterior solo dentro de la misma ejecución, caso y fila.",
  "readiness.runCount": "{count} resultados observados",
  "readiness.methodologyBody":
    "La cobertura cuenta historias con pruebas vinculadas. Los casos evaluados tienen todas sus filas observadas aprobadas o fallidas y todas sus filas planificadas presentes. El alcance incluye vínculos de historias, capturas de ejecución e identificadores de resultados, aunque falten detalles. El porcentaje aprobado se calcula como aprobados ÷ (aprobados + fallidos). Las filas pendientes, en curso, pausadas, bloqueadas, abortadas o no aplicables no están evaluadas. Las ejecuciones permanecen separadas; las anteriores dentro de la ventana siguen visibles. Estas observaciones no constituyen una aprobación ni una puntuación de confianza.",
  "readiness.windowDetail":
    "Hasta {runs} ejecuciones recientes y {results} intentos de resultado. Las páginas de fuentes se cargan a petición.",
  "readiness.aiHelp":
    "Explicación de solo lectura de toda la versión. Verifique las referencias y el alcance antes de actuar.",
  "readiness.aiScope": "Alcance de IA: {release} · todos los sprints",
  "readiness.aiEmpty":
    "No se devolvieron señales de revisión. Esto no determina la preparación del lanzamiento.",
});
