// A bounded lexical vocabulary makes product names and native route names
// discoverable through the same catalog. It never selects an executable route
// or alters the authorization decision made by catalog().
const aliases = new Map([
  ...['get', 'list', 'show', 'find', 'search', 'view', 'reads'].map(word => [word, ['read']]),
  ...['add', 'post', 'creates'].map(word => [word, ['create']]),
  ...['put', 'patch', 'edit', 'modify', 'changes', 'updates'].map(word => [word, ['update']]),
  ...['remove', 'deletes'].map(word => [word, ['delete']]),
  ...['stories', 'requirement', 'requirements'].map(word => [word, ['story']]),
  ...['bug', 'bugs', 'issue', 'issues', 'feedback', 'defects'].map(word => [word, ['defect']]),
  ...['execution', 'executions', 'runs'].map(word => [word, ['run']]),
  ...['iteration', 'iterations', 'sprints'].map(word => [word, ['sprint']]),
  ...['testcase', 'testcases'].map(word => [word, ['test', 'case']]),
  ['tests', ['test']], ['cases', ['case']], ['suites', ['suite']],
  ['datasets', ['data', 'set']], ['dataset', ['data', 'set']],
  ['applications', ['application']], ['releases', ['release']], ['workflows', ['workflow']],
]);
const filler = new Set(['a', 'an', 'the', 'and', 'or', 'for', 'of', 'to', 'in', 'on', 'with', 'my', 'this', 'these', 'me', 'please', 'available', 'which', 'what', 'are', 'is', 'can', 'i']);
const terms = value => String(value || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).flatMap(word => aliases.get(word) || [word]);

function matchesCapability(operation, query) {
  const raw = String(query || '').trim().toLowerCase();
  if (!raw) return true;
  const text = `${operation.id || ''} ${operation.method} ${operation.path} ${operation.permission} ${operation.family || ''} ${operation.label || ''} ${operation.summary || ''}`.toLowerCase();
  if (text.includes(raw)) return true;
  const wanted = terms(raw).filter(term => !filler.has(term));
  if (!wanted.length) return false;
  const effect = {GET:'read',POST:'create',PUT:'update',PATCH:'update',DELETE:'delete'}[operation.method];
  if (wanted.some(term => ['read','create','update','delete'].includes(term) && term !== effect)) return false;
  const available = new Set(terms(text));
  return wanted.every(term => available.has(term));
}

module.exports = { matchesCapability };
