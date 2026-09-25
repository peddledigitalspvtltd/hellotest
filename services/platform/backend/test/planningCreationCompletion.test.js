const { dependencyName } = require("./helpers/sourceFile");
const { sourceFile } = require("./helpers/sourceFile");
const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const fixture = () => {
  const state = {
    stories: new Map([
      ['open-story', { id: 'open-story', project_id: 'project', title: 'Unfinished checkout', status: 'in_progress', iteration_id: 'sprint' }],
      ['done-story', { id: 'done-story', project_id: 'project', title: 'Completed checkout', status: 'qa_done', iteration_id: null }],
      ['aliased-done-story', { id: 'aliased-done-story', project_id: 'project', title: 'Completed alias checkout', status: ' QA--Done ', iteration_id: null }],
      ['resolved-story', { id: 'resolved-story', project_id: 'project', title: 'Resolved checkout', status: 'Resolved', iteration_id: null }]
    ]), writes: [], depth: 0, sprints: new Map([['sprint', { id: 'sprint', project_id: 'project' }]]), releases: new Map()
  };
  const complete = ['qa_done', 'qa done', 'done', 'closed', 'resolved', 'accepted', 'complete', 'completed'];
  const db = {
    transaction: callback => async () => { state.depth++; try { return await callback(); } finally { state.depth--; } },
    prepare: statement => {
      const sql = statement.replace(/\s+/g, ' ').trim();
      const check = args => assert.equal((sql.match(/\?/g) || []).length, args.length, sql);
      return {
        get: async (...args) => {
          check(args);
          if (/FROM projects WHERE id/.test(sql)) return args[0] === 'project' ? { id: 'project' } : null;
          if (/FROM requirements WHERE id/.test(sql)) return state.stories.get(args[0]);
          if (/FROM requirement_iterations WHERE id/.test(sql)) return state.sprints.get(args[0]);
          if (/FROM requirement_(iterations|releases) WHERE project_id/.test(sql)) return null;
          throw new Error(`Unexpected get: ${sql}`);
        },
        all: async (...args) => {
          check(args);
          if (/SELECT id, project_id FROM requirements WHERE id IN/.test(sql)) {
            assert.match(sql, /jsonb_array_elements_text\(\?::jsonb\)/);
            return JSON.parse(args[0]).map(id => state.stories.get(id)).filter(Boolean);
          }
          if (/SELECT id, project_id FROM requirement_iterations WHERE id IN/.test(sql)) {
            assert.match(sql, /jsonb_array_elements_text\(\?::jsonb\)/);
            return JSON.parse(args[0]).map(id => state.sprints.get(id)).filter(Boolean);
          }
          if (/FROM requirements WHERE.*AND.*NOT IN/.test(sql)) {
            assert.ok(state.depth > 0, 'creation validates completion within its transaction');
            assert.match(sql, /LOWER\(REGEXP_REPLACE\(TRIM\(COALESCE\(status, ''\)\), '\[ _-\]\+', '_', 'g'\)\)/, 'Sprint completion normalizes whitespace and hyphen aliases like its metrics');
            return args.flatMap(id => state.stories.has(id) && !complete.includes(state.stories.get(id).status.toLowerCase().trim().replace(/[ _-]+/g, '_')) ? [{ ...state.stories.get(id) }] : []);
          }
          if (/SELECT id, display_id, title, status FROM requirements/.test(sql)) {
            assert.ok(state.depth > 0, 'release creation validates completion within its transaction');
            return args.map(id => state.stories.get(id)).filter(Boolean);
          }
          if (/SELECT id, iteration_id FROM requirements WHERE project_id/.test(sql)) return [...state.stories.values()].filter(story => story.project_id === args[0] && JSON.parse(args[1]).includes(story.iteration_id));
          if (/SELECT DISTINCT iteration_id/.test(sql)) return [];
          if (/SELECT requirement_id FROM requirement_release_items/.test(sql)) return [];
          if (/SELECT id, display_id FROM requirements WHERE iteration_id/.test(sql)) return [...state.stories.values()].filter(story => story.iteration_id === args[0]);
          throw new Error(`Unexpected all: ${sql}`);
        },
        run: async (...args) => {
          check(args); assert.ok(state.depth > 0); state.writes.push(sql);
          if (/^INSERT INTO requirement_iterations/.test(sql)) state.sprints.set(args[0], { id: args[0], state: args[8], project_id: args[2], name: args[3] });
          if (/^INSERT INTO requirement_releases/.test(sql)) state.releases.set(args[0], { id: args[0], state: args[10], project_id: args[2], name: args[3] });
          if (/^UPDATE requirements SET iteration_id/.test(sql)) state.stories.get(args[2]).iteration_id = args[0];
        }
      };
    }
  };
  const load = name => {
    const service = {};
    vm.runInNewContext(readFileSync(sourceFile(`${name}.service.js`, "services"), 'utf8'), {
      exports: service,
      require: dependency => dependencyName(dependency) === "db" ? db : dependency === 'crypto' ? require('node:crypto') : dependencyName(dependency) === "displayId.service" ? { createDisplayId: async () => 'DLV-1' } : { syncSprintMembership: async () => {} }
    });
    return service;
  };
  const sprint = load('requirementIteration');
  const release = load('requirementRelease');
  sprint.getIteration = async id => state.sprints.get(id);
  release.getRelease = async id => state.releases.get(id);
  return { sprint, release, state };
};

const sprintInput = { project_id: 'project', name: 'Checkout readiness', created_by: 'owner' };
const releaseInput = { ...sprintInput, fix_version: '2026.10' };

test('creating a closed Sprint rejects unfinished Stories before persisting or moving scope', async () => {
  const { sprint, state } = fixture();
  await assert.rejects(sprint.createIteration({ ...sprintInput, state: 'closed', requirement_ids: ['open-story'] }), { statusCode: 409, code: 'DELIVERY_STORIES_INCOMPLETE' });
  assert.deepEqual(state.writes, []);
  assert.equal(state.stories.get('open-story').iteration_id, 'sprint');
});

for (const scope of [{ requirement_ids: ['open-story'] }, { sprint_ids: ['sprint'] }]) {
  test(`creating a released Release checks ${Object.keys(scope)[0]} before writing`, async () => {
    const { release, state } = fixture();
    await assert.rejects(release.createRelease({ ...releaseInput, state: 'released', ...scope }), { statusCode: 409, code: 'DELIVERY_STORIES_INCOMPLETE' });
    assert.deepEqual(state.writes, []);
  });
}

test('closed Sprint and released Release creation accepts the existing completed-story vocabulary', async () => {
  const { sprint, release } = fixture();
  const requirement_ids = ['done-story', 'resolved-story', 'aliased-done-story'];
  assert.equal((await sprint.createIteration({ ...sprintInput, state: 'closed', requirement_ids })).sprint.state, 'closed');
  assert.equal((await release.createRelease({ ...releaseInput, state: 'released', requirement_ids })).release.state, 'released');
});

test('normal planned delivery creation can include unfinished Stories', async () => {
  const { sprint, release } = fixture();
  const requirement_ids = ['open-story'];
  assert.equal((await sprint.createIteration({ ...sprintInput, requirement_ids })).sprint.state, 'future');
  assert.equal((await release.createRelease({ ...releaseInput, requirement_ids })).release.state, 'planned');
});

test('empty-scope terminal creation retains the existing update policy', async () => {
  const { sprint, release } = fixture();
  assert.equal((await sprint.createIteration({ ...sprintInput, state: 'closed' })).sprint.state, 'closed');
  assert.equal((await release.createRelease({ ...releaseInput, state: 'released' })).release.state, 'released');
});
