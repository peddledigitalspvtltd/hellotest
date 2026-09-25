import assert from 'node:assert/strict';

export async function assertCountSegments(bar, total, expected) {
  await bar.locator('.metric-status-segment').first().waitFor();
  const actual = await bar.locator('.metric-status-segment').evaluateAll(nodes => nodes.map(node => ({
    key: [...node.classList].find(name => name.startsWith('is-'))?.slice(3),
    title: node.title,
    count: node.textContent,
    width: parseFloat(node.style.width),
    color: getComputedStyle(node).backgroundColor
  })));
  assert.equal(actual.length, expected.length);
  expected.forEach(({ key, label, count, color }, index) => {
    assert.equal(actual[index].key, key);
    assert.equal(actual[index].title, `${label}: ${count}`);
    assert.equal(actual[index].count, String(count));
    assert.ok(Math.abs(actual[index].width - count / total * 100) < 0.001, `${label} retains its exact count proportion`);
    if (color) assert.equal(actual[index].color, color);
  });
  assert.equal(await bar.getAttribute('role'), 'progressbar');
}
