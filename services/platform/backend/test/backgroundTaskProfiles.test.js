const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { isRouteEnabledFor } = require('../src/runtime/serviceProfile');
const source = fs.readFileSync(require.resolve('../src/plugins/backgroundTasks'), 'utf8');

const expected = {
  platform: ['instanceSetup', 'projectDeletion', 'llmTraceRetention'],
  testing: ['executionSchedule', 'batchProcess'],
  manual: [],
  knowledge: ['knowledgeExecution', 'knowledgeRag'], chatbot: [],
  automation: ['aiAutomationBuilder'],
  agentic: ['repositoryAgents', 'qualityAgents'],
  dashboard: [], ai: ['aiTestCaseGeneration', 'requirementWorkspace', 'qualityGraphChanges'], trace: [], integration: ['projectSync']
};

for (const profile of [...Object.keys(expected), 'all']) {
  test(`${profile} starts and closes only its owned background services`, async () => {
    let declaredTaskCount=0;
    const loaded = [], called = [], timers = new Set(), hooks = { onReady: [], onClose: [] };
    const module = { exports: {} };
    vm.runInNewContext(source, {
      module, exports: module.exports, Promise,
      setInterval(run) { timers.add(run); return run; },
      clearInterval(timer) { timers.delete(timer); },
      require: function mockRequire(path) {
        if (path.startsWith('node:')) return require(path);
        if (path === '../runtime/serviceProfile') return { routeEnabled: route => isRouteEnabledFor(profile, route) };
        if (path.endsWith('/workers')) {
          const workerModule = { exports: {} };
          vm.runInNewContext(fs.readFileSync(require.resolve(path.replace('../../../../services/', '../../../')), 'utf8'), { module: workerModule, require: mockRequire, Promise, process, AbortController, console: {info(){}} });
          return (...args)=>{const worker=workerModule.exports(...args);declaredTaskCount+=worker.tasks.length;return worker;};
        }
        const name = path.split('/').pop().replace('.service', '');
        loaded.push(name);
        return new Proxy({}, { get: (_target, method) => async () => { called.push(`${name}.${method}`); return []; } });
      }
    });
    const owners = profile === 'all' ? Object.values(expected).flat() : expected[profile];
    await module.exports({ addHook(name, run) { hooks[name].push(run); }, log: { error(error) { throw error; } } });
    assert.deepEqual(loaded.sort(), [...owners].sort(), 'Do not import other services merely to register timers');
    for (const run of hooks.onReady) await run();
    assert.equal(timers.size, declaredTaskCount, "Every declared native worker task gets one guarded timer.");
    const captured = [...timers];
    for (const run of captured) await run();

    for (const name of owners) assert.ok(called.some(call => call.startsWith(`${name}.`)), `${name} must execute`);
    for (const run of hooks.onClose) await run();
    assert.equal(timers.size, 0);
    const callCount = called.length;
    for (const run of captured) await run();
    assert.equal(called.length, callCount, 'No queued callback may start work after shutdown');
    const ownedLazy = [...(profile==='knowledge'||profile==='all'?['knowledgeMaintenance','knowledgeVectorIndex','knowledgeContextGraph','knowledgeSourceLifecycle','knowledgeGraph','knowledgeVectorProjection']:[]),...(profile==='agentic'||profile==='all'?['workflowTriggers','agentActivity']:[])];
    assert.ok(called.every(call => [...owners,...ownedLazy].includes(call.split('.')[0])));
  });
}
