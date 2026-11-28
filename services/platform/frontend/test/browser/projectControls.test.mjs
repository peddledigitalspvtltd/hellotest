import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = new URL('../../', import.meta.url);
const source = await readFile(new URL('../../../test/browser/projectMetrics.test.mjs', import.meta.url), 'utf8');
const main = await readFile(new URL('src/main.tsx', root), 'utf8');
const appStyles = [...main.matchAll(/^import "\.\/(.+\.css)";$/gm)].map(([, path]) => `import '/src/${path}';`).join('\n');
const baseFixture = source.match(/const fixture = `([\s\S]*?)`;/)[1];
const fixture = baseFixture.replace(/^import '\/src\/styles\.css'.*$/m, appStyles)
  .replace('stub(api);', 'const uploadProjectAttachment = api.attachments.upload;stub(api);')
  .replace('const client=new QueryClient', `
const roles=[{id:'admin-role',name:'admin'},{id:'jira-admin',name:'Jira Administrator'},{id:'qa-member',name:'QA Member'},{id:'owner-role',name:'Product Owner'},{id:'automation-role',name:'Automation Engineer'},{id:'custom-role',name:'Delivery Reviewer'}];
const users=[{id:'reviewer',name:'Reviewer',email:'reviewer@example.test',role:'admin'},{id:'collaborator',name:'Ada Tester',email:'ada@example.test'}];
window.createInputs=[];window.memberUpdates=[];window.projectDetailRequests=[];
const memberships=[{id:'existing-member',project_id:'commerce',user_id:'collaborator',role_id:'qa-member'}];
api.roles.list=async()=>roles;
api.users.list=async()=>users;
api.projectMembers.list=async({project_id})=>memberships.filter(member=>member.project_id===project_id);
api.projectMembers.update=async(id,input)=>{window.memberUpdates.push({id,...input});const member=memberships.find(item=>item.id===id);Object.assign(member,input);return {...member};};
api.projects.get=async(id)=>{window.projectDetailRequests.push(id);return projects.find(p=>p.id===id);};
api.metadata.domain=async()=>({app_types:{default_type:'web',types:[{value:'web',label:'Web'}]}});
api.attachments.meta=async()=>({enabled:true,uploadLimit:1024*1024});
api.attachments.upload=uploadProjectAttachment;
api.projects.create=async(input)=>{window.createInputs.push(input);const created={id:'created-project',name:input.name,description:input.description,visibility:input.visibility,has_access:true,created_by:'reviewer'};projects.push(created);for(const member of input.members)memberships.push({id:'created-'+member.user_id,project_id:created.id,...member});return {...created,members_added:input.members.length+1,app_types_created:input.app_types.length};};
const client=new QueryClient`);

async function assertProjectFormLayout(dialog, { stacked } = {}) {
  const geometry = await dialog.evaluate(node => {
    const body = node.querySelector('.project-create-modal-body');
    const sections = ['.project-create-general-section', '.project-create-attachments-section', '.project-create-app-section', '.project-create-members-section']
      .map(selector => node.querySelector(selector));
    const footer = node.querySelector('.project-create-footer');
    const bounds = element => {
      const { top, bottom, left, right } = element.getBoundingClientRect();
      return { top, bottom, left, right };
    };
    body.scrollTop = 0;
    const start = sections.map(bounds);
    const footerStart = bounds(footer);
    body.scrollTop = 100;
    const delta = body.scrollTop;
    const end = sections.map(bounds);
    const nestedScrollers = [...body.querySelectorAll('*')].filter(element => element.scrollHeight > element.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(element).overflowY));
    body.scrollTop = 0;
    return {
      start, end, delta, footerStart, footerEnd: bounds(footer), nestedScrollers: nestedScrollers.map(element => element.className),
      title: bounds(node.querySelector('#create-project-title')), close: bounds(node.querySelector('.dialog-close-button')),
      bodyBounds: bounds(body), overflowX: body.scrollWidth - body.clientWidth, viewportHeight: innerHeight
    };
  });
  const [details, attachments, apps, members] = geometry.start;
  assert.ok(attachments.bottom <= details.bottom, 'Attachments fit inside Project Details');
  assert.ok(apps.top >= details.bottom + 8, 'Applications sit below the complete details card');
  if (stacked) assert.ok(members.top >= apps.bottom + 8, 'The sections stack in reading order on mobile');
  else assert.ok(apps.right < members.left && Math.abs(apps.top - members.top) < 2, 'Applications and members share a desktop row');
  assert.ok(geometry.delta > 0, 'The form body scrolls');
  geometry.end.forEach((bounds, index) => assert.ok(Math.abs(geometry.start[index].top - bounds.top - geometry.delta) < 2, 'Every section scrolls with the form body'));
  assert.deepEqual(geometry.nestedScrollers, [], 'No form section has an independent scroll area');
  assert.deepEqual(geometry.footerStart, geometry.footerEnd, 'The footer is stationary');
  assert.ok(geometry.footerStart.top >= geometry.bodyBounds.bottom - 1 && geometry.footerStart.bottom <= geometry.viewportHeight + 1, 'Actions stay in view beyond the scroll area');
  assert.ok(geometry.close.left > geometry.title.right && Math.abs(geometry.close.top + geometry.close.bottom - geometry.title.top - geometry.title.bottom) < 3, 'The title and close control sit on one row');
  assert.ok(geometry.overflowX <= 1, 'The form does not overflow horizontally');
}

test('project filters, required fields, available role parity and attention disclosure work together', { timeout: 45000 }, async () => {
  const name = 'project-controls-' + randomUUID();
  let browser;
  try {
    await writeFile(new URL(name + '.tsx', root), fixture);
    await writeFile(new URL(name + '.html', root), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/' + name + '.tsx"></script></body></html>');
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion:'reduce' });
    page.setDefaultTimeout(8000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const uploads = [];
    const storedFiles = new Set();
    await page.route(/\/attachments\?/, async (route) => {
      const request = route.request();
      if (request.method() !== 'POST') return route.fallback();
      const body = await new Response(request.postDataBuffer(), { headers: { 'Content-Type': request.headers()['content-type'] } }).formData();
      const file = body.get('file');
      const upload = { urlScope: new URL(request.url()).searchParams.get('project_id'), bodyScope: body.get('project_id'),
        entityType: body.get('entity_type'), entityId: body.get('entity_id'), checksum: body.get('checksum_sha256'), name: file.name, mime: file.type };
      uploads.push(upload);
      if (upload.urlScope !== 'created-project' || upload.bodyScope !== 'created-project') {
        return route.fulfill({ status: 403, json: { message: 'Upload request used the wrong project scope.' } });
      }
      const receipt = `${upload.name}:${upload.checksum}`;
      const alreadyStored = storedFiles.has(receipt);
      storedFiles.add(receipt);
      if (upload.name === 'brief.pdf' && !alreadyStored) return route.fulfill({ status: 503, json: { message: 'Upload acknowledgement was interrupted.' } });
      return route.fulfill({ json: { id: receipt } });
    });
    await page.goto((process.env.VITE_TEST_URL || 'http://127.0.0.1:5189') + '/' + name + '.html');
    const tile = title => page.locator('article.project-catalog-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    await tile('Commerce platform').waitFor();
    const attentionCard=page.locator('.projects-command-card--evidence');await attentionCard.waitFor();
    const headerBounds=await page.locator('.projects-page-header').boundingBox();const attentionBounds=await attentionCard.boundingBox();assert.ok(attentionBounds.x>=headerBounds.x+headerBounds.width/2,'Attention card stays in the right corner');
    await mkdir('/tmp/qaira-project-controls',{recursive:true});await page.screenshot({path:'/tmp/qaira-project-controls/portfolio-desktop.png'});
    assert.equal(await tile('Private project').count(),0,'locked projects are hidden by default');
    await page.getByRole('button',{name:/^Open filters/}).click();
    const accessibleOnly=page.getByRole('checkbox',{name:'Accessible projects only',exact:true});
    assert.equal(await accessibleOnly.isChecked(),true);
    await accessibleOnly.uncheck();
    await page.keyboard.press('Escape');
    const locked=tile('Private project');
    await locked.waitFor();
    assert.equal(await locked.getAttribute('role'),'article');
    assert.equal(await locked.getAttribute('tabindex'),'-1');
    await locked.click();
    assert.deepEqual(await page.evaluate(()=>window.projectDetailRequests),[],'revealing a locked identity never requests its private details');
    assert.equal(await page.getByRole('tablist',{name:'Project detail sections'}).count(),0);
    assert.equal(await locked.locator('.project-metric-breakdown').count(),0);
    await page.getByRole('button',{name:'List view',exact:true}).click();
    assert.equal(await page.locator('tr.is-locked-row').count(),1,'list view includes the same locked identity');
    await page.getByRole('button',{name:/^Open filters/}).click();
    await accessibleOnly.check();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('tr.is-locked-row').count(),0);
    await page.getByRole('button',{name:'Tile view',exact:true}).click();
    await page.getByRole('button',{name:'Inspect portfolio evidence',exact:true}).click();
    const attention=page.locator('.project-risk-evidence-dialog');
    const method=attention.locator('details.project-risk-method');
    assert.equal(await method.getAttribute('open'),null);
    await method.locator('summary').click();
    assert.equal(await method.evaluate(node=>node.open),true);
    await method.getByText(/Readiness weights Story coverage/).waitFor({state:'visible'});
    await method.locator('summary').press('Enter');
    assert.equal(await method.evaluate(node=>node.open),false,'methodology is keyboard collapsible');
    await page.keyboard.press('Escape');
    await tile('Commerce platform').click();
    await page.getByRole('tab',{name:/Members/}).click();
    const updateRole=page.getByRole('combobox',{name:'HelloTest role for Ada Tester',exact:true});
    await updateRole.waitFor();
    const updateOptions=await updateRole.locator('option').evaluateAll(nodes=>nodes.map(node=>({value:node.value,label:node.textContent})));
    await updateRole.selectOption('automation-role');
    await page.waitForFunction(()=>window.memberUpdates.length===1);
    await page.getByRole('button',{name:'Dismiss message',exact:true}).click();
    await page.getByRole('button',{name:/Back to.*projects/i}).click();
    await page.getByRole('button',{name:'Create New Project',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Create Project',exact:true});
    await dialog.waitFor();
    const sectionHeight=await dialog.locator('.project-app-type-list').count()?await dialog.locator('.project-app-type-list').evaluate(node=>node.offsetHeight):await dialog.evaluate(node=>node.offsetHeight);
    await dialog.getByRole('button',{name:/^Select platform type for application 1:/}).click();
    const platformMenu=page.getByRole('listbox',{name:'Select platform type for application 1',exact:true});await platformMenu.waitFor();
    assert.equal(await platformMenu.evaluate(node=>getComputedStyle(node).position),'fixed');
    const menuBounds=await platformMenu.boundingBox();assert.ok(menuBounds.x>=0&&menuBounds.y>=0&&menuBounds.x+menuBounds.width<=1441&&menuBounds.y+menuBounds.height<=1101,'Platform menu stays in the viewport');
    const openHeight=await dialog.locator('.project-app-type-list').count()?await dialog.locator('.project-app-type-list').evaluate(node=>node.offsetHeight):await dialog.evaluate(node=>node.offsetHeight);assert.equal(openHeight,sectionHeight,'Overlay does not stretch the application section');
    await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),true,'Escape closes the picker before the dialog');
    const appField=dialog.locator('.form-field').filter({has:page.getByText('App Name',{exact:true})});
    const projectField=dialog.locator('.form-field').filter({has:page.getByText('Project name',{exact:true})});
    assert.match(await appField.locator('label').innerText(),/\*/);
    assert.match(await projectField.locator('label').innerText(),/\*/);
    await dialog.getByRole('textbox',{name:'App Name',exact:true}).fill('Checkout Web');
    await dialog.getByRole('textbox',{name:'Project name',exact:true}).fill('Role parity project');
    await dialog.getByRole('combobox',{name:'Project type',exact:true}).selectOption('public');
    const documents = [
      ['brief.pdf', 'application/pdf'],
      ['notes.doc', 'application/msword'],
      ['requirements.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['coverage.xls', 'application/vnd.ms-excel'],
      ['coverage.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
    ];
    const files = [...documents, ...[5, 6, 7].map(index => [`project-reference-${index}.txt`, 'text/plain'])]
      .map(([name, mimeType]) => ({ name, mimeType, buffer: Buffer.from('Project fixture') }));
    await dialog.locator('input[type="file"]').setInputFiles(files);
    await dialog.getByText('8/10 files · PDF, Word, Excel, and other files', { exact: true }).waitFor();
    await assertProjectFormLayout(dialog);
    await page.screenshot({path:'/tmp/qaira-project-controls/create-project-desktop-top.png'});
    await page.setViewportSize({ width: 390, height: 690 });
    await assertProjectFormLayout(dialog, { stacked: true });
    await page.screenshot({path:'/tmp/qaira-project-controls/create-project-mobile.png'});
    await dialog.getByRole('textbox',{name:'Project description',exact:true}).fill('Keep the application and team in scope. '.repeat(40));
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await assertProjectFormLayout(dialog, { stacked: true });
    await page.screenshot({path:'/tmp/qaira-project-controls/create-project-mobile-dark.png'});
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await dialog.getByRole('textbox',{name:'Project description',exact:true}).fill('');
    await dialog.getByRole('button',{name:'Remove project-reference-7.txt',exact:true}).click();
    await dialog.getByText('7/10 files · PDF, Word, Excel, and other files', { exact: true }).waitFor();
    await page.setViewportSize({ width: 1440, height: 900 });
    await dialog.locator('.project-member-option').filter({has:page.getByText('Ada Tester',{exact:true})}).getByRole('checkbox').check();
    const createRole=dialog.getByRole('combobox',{name:'HelloTest role for Ada Tester',exact:true});
    const createOptions=await createRole.locator('option').evaluateAll(nodes=>nodes.filter(node=>node.value).map(node=>({value:node.value,label:node.textContent})));
    assert.deepEqual(createOptions,updateOptions,'creation and update use the complete same assignable-role catalog');
    assert.ok(createOptions.some(option=>option.value==='custom-role'));
    assert.equal(createOptions.some(option=>['admin-role','jira-admin'].includes(option.value)),false);
    await createRole.selectOption('custom-role');
    await mkdir('/tmp/qaira-project-controls',{recursive:true});
    await page.screenshot({path:'/tmp/qaira-project-controls/create-project-desktop.png'});
    assert.equal(await page.evaluate(() => localStorage.getItem('hellotest.current_project_id')), 'commerce');
    await dialog.getByRole('button',{name:'Create Project',exact:true}).click();
    await page.waitForFunction(()=>window.createInputs.length===1);
    const pending = page.getByRole('region', { name: 'Pending project attachments' });
    await pending.getByText('brief.pdf', { exact: true }).waitFor();
    assert.equal(uploads.length, 7);
    for (const [name, mime] of documents) assert.equal(uploads.find(upload => upload.name === name)?.mime, mime);
    await page.evaluate(() => localStorage.setItem('hellotest.current_project_id', 'empty'));
    await pending.getByRole('button', { name: 'Retry file uploads', exact: true }).click();
    await pending.waitFor({ state: 'hidden' });
    assert.equal(uploads.length, 8);
    assert.deepEqual(uploads.at(-1), uploads.find(upload => upload.name === 'brief.pdf'));
    assert.equal(storedFiles.size, 7, 'Retry must keep one receipt for each successful upload.');
    for (const upload of uploads) {
      assert.deepEqual([upload.urlScope, upload.bodyScope, upload.entityType, upload.entityId], ['created-project', 'created-project', 'project', 'created-project']);
      assert.match(upload.checksum, /^[a-f0-9]{64}$/);
    }
    assert.equal(await page.evaluate(() => window.createInputs.length), 1, 'Retry uploads must not create the project again.');
    assert.deepEqual(await page.evaluate(()=>window.createInputs[0].members),[{user_id:'collaborator',role_id:'custom-role'}]);
    await page.getByRole('tab',{name:/Members/}).click();
    assert.equal(await page.getByRole('combobox',{name:'HelloTest role for Ada Tester',exact:true}).inputValue(),'custom-role');
    assert.deepEqual(errors,[]);
  } finally {
    await browser?.close();
    await Promise.all([unlink(new URL(name+'.tsx',root)).catch(()=>{}),unlink(new URL(name+'.html',root)).catch(()=>{})]);
  }
});
