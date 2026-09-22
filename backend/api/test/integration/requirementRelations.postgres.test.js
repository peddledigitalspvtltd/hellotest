const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Related Story replacement respects both link directions and project boundaries in PostgreSQL', {
  skip: process.env.REQUIREMENT_RELATIONS_POSTGRES !== '1', timeout: 120_000
}, async t => {
  const url = new URL(process.env.DATABASE_URL);
  assert.match(url.pathname, /^\/agent_verify_requirement_relations_[a-z0-9_]+$/);
  process.env.POSTGRES_URL = process.env.OBS_DATABASE_URL = process.env.OBS_POSTGRES_URL = url.toString();
  const db = require('../../src/db');
  const obsDb = require('../../src/obsDb');
  const stories = require('../../src/services/requirement.service');
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS name").get()).name, null,
      'This regression requires an empty disposable PostgreSQL database');
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../../db/schema.sql'), 'utf8'));
    await require('../../src/db/bootstrap').ensureRuntimeSchema();
    await db.query(`
      INSERT INTO users(id,email,password_hash,name) VALUES ('owner','owner@example.test','not-a-login','Sam Example');
      INSERT INTO projects(id,name) VALUES ('project','Related Stories'),('foreign','Restricted project');
      INSERT INTO requirements(id,project_id,title,description,sprint,additional_fields) VALUES
        ('a','project','Story A','Origin story','Sprint 1','{}'),
        ('b','project','Story B','Related description','Sprint 2','{"assignee_id":"owner"}'),
        ('c','project','Story C','Outgoing story','Sprint 3','{}'),
        ('d','project','Story D','New relation',NULL,'{}'),
        ('foreign','foreign','Private title','Private description',NULL,'{}');
      INSERT INTO requirement_relations(requirement_id,related_requirement_id,relation) VALUES
        ('b','a','blocks'),('a','c','relates to'),('c','d','depends on'),('foreign','a','relates to');
    `);
    const links = () => db.prepare(`SELECT requirement_id, related_requirement_id, relation
      FROM requirement_relations ORDER BY requirement_id, related_requirement_id`).all();

    await t.test('batched hydration exposes related details from either direction without foreign-project details', async () => {
      const list = await stories.getRequirements({ project_id: 'project', ids: ['a', 'b'] });
      const origin = list.find(story => story.id === 'a');
      assert.deepEqual(origin.related_items.map(item => item.id), ['b', 'c']);
      const incoming = origin.related_items[0];
      assert.equal(incoming.direction, 'inward');
      assert.equal(incoming.relation, 'blocks');
      assert.equal(incoming.description, 'Related description');
      assert.equal(incoming.sprint, 'Sprint 2');
      assert.equal(incoming.assignee_id, 'owner');
      assert.equal(incoming.assignee_name, 'Sam Example');
      const outward = list.find(story => story.id === 'b').related_items[0];
      assert.equal(outward.id, 'a');
      assert.equal(outward.direction, 'outward');
      assert.equal(outward.assignee_name, null);
    });

    await t.test('retained incoming links keep their type and direction while omitted outgoing links are removed', async () => {
      const result = await stories.replaceRelatedRequirements('a', ['a', 'b', 'd', 'd']);
      assert.deepEqual(result, { updated: true, related_requirement_ids: ['b', 'd'] });
      assert.deepEqual(await links(), [
        { requirement_id: 'a', related_requirement_id: 'd', relation: 'relates to' },
        { requirement_id: 'b', related_requirement_id: 'a', relation: 'blocks' },
        { requirement_id: 'c', related_requirement_id: 'd', relation: 'depends on' },
        { requirement_id: 'foreign', related_requirement_id: 'a', relation: 'relates to' }
      ]);
      const beforeRepeat = await links();
      await stories.replaceRelatedRequirements('a', ['b', 'd']);
      assert.deepEqual(await links(), beforeRepeat, 'Saving retained links must not create a reversed duplicate');
      assert.deepEqual((await stories.getRequirement('a')).related_items.map(item => item.id), ['b', 'd']);
    });

    await t.test('invalid or cross-project selections fail before changing any existing links', async () => {
      const before = await links();
      await assert.rejects(stories.replaceRelatedRequirements('a', ['foreign']), /same project/);
      await assert.rejects(stories.replaceRelatedRequirements('a', ['missing']), /Story not found/);
      assert.deepEqual(await links(), before);
    });

    await t.test('unlinking incoming and outgoing Stories preserves unrelated and hidden project edges', async () => {
      await stories.replaceRelatedRequirements('a', []);
      assert.deepEqual((await stories.getRequirement('a')).related_items, []);
      assert.deepEqual(await links(), [
        { requirement_id: 'c', related_requirement_id: 'd', relation: 'depends on' },
        { requirement_id: 'foreign', related_requirement_id: 'a', relation: 'relates to' }
      ]);
      assert.deepEqual((await stories.getRequirement('b')).related_items, []);
    });
  } finally {
    await Promise.all([db.close(), obsDb.close()]);
  }
});
