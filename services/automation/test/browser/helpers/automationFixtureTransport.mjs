/** Bridge legacy in-page API fixtures to the activity transport used by the real UI.
 * Only these explicit read contracts are handled; all other unexpected API calls
 * still fail their owning browser test.
 */
export async function fulfillAutomationFixtureRequest(page, route) {
  const url = new URL(route.request().url());
  const authoring = url.pathname.match(/\/test-cases\/([^/]+)\/automation\/authoring-state$/);
  if (authoring && route.request().method() === 'GET') {
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({case_id: decodeURIComponent(authoring[1]), state: 'idle', build: null, recording: null, can_build: true, can_record: true})});
    return true;
  }
  const activity = url.pathname.match(/\/test-cases\/automation\/jobs\/([^/]+)(\/events)?$/);
  if (activity && route.request().method() === 'GET') {
    let record;
    try { record = await page.evaluate(async id => {
      const {api} = await import('/src/lib/api');
      return api.testCases.automationBuildStatus(id);
    }, decodeURIComponent(activity[1])); } catch (error) {
      // A stream read may be cancelled while its fixture navigates or closes.
      if (page.isClosed() || /Target page, context or browser has been closed|Execution context was destroyed/.test(error.message)) {
        await route.abort("aborted").catch(() => undefined);
        return true;
      }
      throw error;
    }
    if (!record || Array.isArray(record)) throw new Error('Missing activity fixture for ' + activity[1]);
    const snapshot = {...record, events: record.events || [], events_next_offset: record.events?.length || 0};
    if (activity[2]) {
      const cursor = Math.max(Number(url.searchParams.get('after') || 0), snapshot.events_next_offset);
      await route.fulfill({contentType: 'text/event-stream', body: 'event: activity\nid: ' + cursor + '\ndata: ' + JSON.stringify(snapshot) + '\n\nevent: complete\ndata: {}\n\n'});
    } else await route.fulfill({contentType: 'application/json', body: JSON.stringify(snapshot)});
    return true;
  }
  return false;
}
