import { WORKSPACE_SHELL_MESSAGES_ES } from "./workspaceShellMessages";
import { SWITCHER_MESSAGES_ES } from "./switcherMessages";
import { READINESS_MESSAGES_ES } from "@hellotest/dashboard/frontend/lib/releaseReadinessMessages";
import { ANALYTICS_MESSAGES_ES } from "@hellotest/dashboard/frontend/lib/qualityAnalyticsMessages";
import type { LocalizationStrings } from "./localization";
export const SPANISH_STRINGS: LocalizationStrings = {
  "nav.section.main": "Espacio de trabajo", "nav.section.administration": "Administración", "nav.section.settings": "Preferencias",
  "nav.dashboard": "Inicio", "nav.projects": "Proyectos", "nav.testAuthoring": "Biblioteca", "nav.testRuns": "Ejecuciones",
  "nav.product": "Gestión del producto", "nav.automation": "Automatización", "nav.testops": "Operaciones de pruebas",
  "nav.agenticWorkflows": "Agentes y flujos", "nav.testEnvironment": "Entornos", "nav.knowledge": "Conocimiento",
  "nav.adminSpace": "Administración", "nav.users": "Usuarios", "nav.integrations": "Integraciones", "nav.support": "Ayuda",
  "nav.notifications": "Notificaciones", "nav.settings": "Preferencias", "nav.reportIssue": "Defectos", "nav.feedback": "Defectos",
  "workspace.requirements": "Historias", "workspace.stories": "Historias", "workspace.backlog": "Trabajo pendiente",
  "workspace.sprints": "Sprints", "workspace.releases": "Versiones", "workspace.testCases": "Casos de prueba",
  "workspace.sharedSteps": "Grupos de pasos", "workspace.testSuites": "Conjuntos de pruebas", "workspace.executions": "Ejecuciones",
  "workspace.automationCases": "Automatización", "workspace.objectRepository": "Repositorio de objetos", "workspace.batchProcess": "Trabajos",
  "workspace.opsTelemetry": "Telemetría", "workspace.traces": "Trazas", "workspace.environments": "Entornos", "workspace.testData": "Datos de prueba",
  "workspace.configurations": "Configuraciones", "workspace.qualityAnalytics": "Análisis de calidad", "workspace.releaseReadiness": "Preparación de la versión",
  "workspace.customDashboards": "Paneles personalizados", "workspace.aiAgents": "Agentes de IA", "workspace.workflows": "Flujos de trabajo",
  "workspace.workflowRuns": "Ejecuciones de flujos", "workspace.suiteRuns": "Ejecuciones de conjuntos", "workspace.localRuns": "Ejecuciones locales",
  "workspace.scheduledRuns": "Ejecuciones programadas",
  "common.save": "Guardar", "common.cancel": "Cancelar", "common.close": "Cerrar", "common.retry": "Reintentar", "common.reset": "Restablecer",
  "common.download": "Descargar", "common.upload": "Subir", "common.import": "Importar", "common.export": "Exportar",
  "common.savePreferences": "Guardar preferencias", "catalog.view.tile": "Vista de tarjetas", "catalog.view.list": "Vista de lista", "catalog.copyId": "Copiar ID",
  "shell.find": "Buscar una función", "shell.preferences": "Idioma y región", "shell.skip": "Ir al contenido", "shell.signOut": "Cerrar sesión", "shell.navigation": "Navegación",
  "navigator.title": "¿Qué quieres hacer?", "navigator.description": "Busca una función y continúa en tu proyecto actual.",
  "navigator.search": "Buscar pruebas, agentes, evidencias…", "navigator.all": "Todo", "navigator.plan": "Planificar", "navigator.design": "Diseñar",
  "navigator.automate": "Automatizar", "navigator.execute": "Ejecutar", "navigator.investigate": "Investigar", "navigator.manage": "Administrar",
  "navigator.empty": "No hay funciones que coincidan", "navigator.emptyHelp": "Prueba otro término o borra los filtros.", "navigator.availableOnly": "Solo disponibles",
  "navigator.restricted": "Permiso necesario", "navigator.disabled": "Función desactivada", "navigator.project": "Selecciona un proyecto", "navigator.unavailable": "Disponibilidad sin verificar",
  "regional.title": "Idioma y región", "regional.description": "Preferencias personales para este navegador. Se aplican al guardar.",
  "regional.language": "Idioma de la interfaz", "regional.workspace": "Etiquetas del espacio de trabajo", "regional.locale": "Formato regional", "regional.zone": "Zona horaria",
  "regional.browser": "Usar la configuración del navegador", "regional.clock": "Formato de hora", "regional.preview": "Vista previa", "regional.date": "Fecha y hora", "regional.number": "Número",
  "regional.scope": "El idioma se aplica a la navegación y los controles compartidos. Los editores especializados y el contenido conservan su idioma original.",
  "access.refreshHelp": "No se pudo actualizar la disponibilidad. Tu trabajo actual se conserva.",
  "access.errorTitle": "No se pudo verificar la disponibilidad", "access.errorHelp": "No pudimos cargar las funciones del espacio de trabajo. Reintenta la conexión para continuar.",
  "access.disabledTitle": "Esta función está desactivada", "access.disabledHelp": "Un administrador puede activar esta función. Puedes continuar en otra área disponible.",
  "access.deniedTitle": "Necesitas acceso a esta área", "access.deniedHelp": "Pide a un administrador que revise los permisos de tu proyecto o elige otra función.",
  "status.pending": "Sin ejecutar", "status.skipped": "No aplica", "status.paused": "En pausa", "status.passed": "Aprobado", "status.failed": "Fallido",
  "status.running": "En ejecución", "status.in_progress": "En curso", "status.completed": "Completado", "status.blocked": "Bloqueado", "status.aborted": "Abortado",
  "status.cancelled": "Cancelado", "status.needs_review": "Requiere revisión", "status.unknown": "Desconocido"
};
const capabilities: Record<string, [string, string]> = {
  analytics: ["Análisis de calidad", "Consulta la cobertura, las tendencias de ejecución y las señales de calidad."],
  readiness: ["Preparación de la versión", "Evalúa las evidencias y los riesgos pendientes antes de publicar."],
  dashboards: ["Paneles personalizados", "Crea vistas para dirección, producto y QA con widgets reutilizables."],
  stories: ["Historias", "Relaciona los criterios de aceptación con la cobertura de pruebas."],
  backlog: ["Trabajo pendiente", "Prioriza el próximo trabajo del producto."],
  sprints: ["Sprints", "Organiza la entrega y sigue el progreso de cada iteración."],
  releases: ["Versiones", "Planifica los hitos de entrega y sus historias."],
  cases: ["Casos de prueba", "Crea escenarios estructurados o Gherkin con sus parámetros."],
  groups: ["Grupos de pasos", "Reutiliza acciones comunes en varios casos de prueba."],
  suites: ["Conjuntos de pruebas", "Agrupa los casos en planes de ejecución reutilizables."],
  automation: ["Casos automatizados", "Crea y mantén pasos de prueba ejecutables."],
  objects: ["Repositorio de objetos", "Revisa y reutiliza localizadores en las pruebas automatizadas."],
  agents: ["Agentes de IA", "Genera objetos, pruebas de API y conocimiento a partir del código; revisa las evidencias del proyecto."],
  workflows: ["Flujos de agentes", "Conecta especialistas y ejecuta revisiones acotadas con resultados registrados."],
  "workflow-history": ["Historial de flujos", "Revisa cada intento y los resultados de sus pasos."],
  runs: ["Ejecuciones de conjuntos", "Ejecuta casos, captura evidencias e investiga defectos."],
  "local-runs": ["Ejecuciones locales", "Revisa las ejecuciones de Playwright registradas localmente."],
  "scheduled-runs": ["Ejecuciones programadas", "Planifica ejecuciones periódicas y futuras."],
  jobs: ["Trabajos en segundo plano", "Supervisa importaciones, compilaciones y procesos asíncronos."],
  environments: ["Entornos", "Define los destinos de la aplicación y sus variables."],
  data: ["Datos de prueba", "Prepara valores de parámetros y filas de datos para ejecutar las pruebas."],
  configurations: ["Configuraciones", "Elige navegadores, plataformas y variables de ejecución."],
  bugs: ["Defectos", "Clasifica los defectos, revisa su historial y convierte las carencias en pruebas."],
  knowledge: ["Repositorio de conocimiento", "Organiza las fuentes que usan Ask AI y los especialistas de calidad."],
  telemetry: ["Telemetría", "Consulta el estado operativo y las señales del procesamiento."],
  traces: ["Trazas distribuidas", "Sigue las operaciones entre servicios."],
  projects: ["Proyectos", "Crea proyectos y configura sus aplicaciones y miembros."],
  integrations: ["Integraciones", "Conecta proveedores y verifica la conexión."],
  people: ["Personas y roles", "Gestiona los miembros del espacio de trabajo y sus permisos."],
  settings: ["Preferencias del espacio", "Ajusta las preferencias, la automatización y los paquetes de idioma."],
  notifications: ["Notificaciones", "Revisa la actividad y las novedades relevantes para tu trabajo."],
  support: ["Ayuda", "Obtén ayuda para usar el espacio de trabajo."]
};
for (const [id, [name, description]] of Object.entries(capabilities)) {
  SPANISH_STRINGS[`capability.${id}.name`] = name;
  SPANISH_STRINGS[`capability.${id}.description`] = description;
}
Object.assign(SPANISH_STRINGS, {
  "navigator.capabilities": "funciones", "navigator.filter": "Filtrar por actividad", "navigator.keyboard": "Tab para elegir · Intro para abrir · Esc para cerrar",
  "page.overview": "Inicio", "page.projects": "Proyectos", "page.adminSpace": "Administración", "page.requirements": "Historias", "page.testCases": "Casos de prueba",
  "page.sharedSteps": "Grupos de pasos", "page.design": "Conjuntos de pruebas", "page.executions": "Ejecuciones", "page.agenticWorkflows": "Agentes y flujos",
  "page.testEnvironments": "Entornos de prueba", "page.testData": "Datos de prueba", "page.testConfigurations": "Configuraciones de prueba", "page.people": "Usuarios",
  "page.integrations": "Integraciones", "page.knowledgeRepo": "Repositorio de conocimiento", "page.support": "Ayuda", "page.notifications": "Notificaciones", "page.settings": "Preferencias", "page.issues": "Defectos", "page.feedback": "Defectos"
});

Object.assign(SPANISH_STRINGS, ANALYTICS_MESSAGES_ES);

Object.assign(SPANISH_STRINGS, READINESS_MESSAGES_ES);

Object.assign(SPANISH_STRINGS, SWITCHER_MESSAGES_ES);

Object.assign(SPANISH_STRINGS, WORKSPACE_SHELL_MESSAGES_ES);
