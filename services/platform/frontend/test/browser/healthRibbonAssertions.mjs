import assert from 'node:assert/strict';

export async function assertHealthAtRibbonEnd(trigger) {
  await trigger.waitFor({state:'visible'});
  const layout = await trigger.evaluate(button => {
    const header = button.closest('.entity-health-hierarchy-header');
    const ribbon = button.closest('.entity-health-ribbon');
    const rect = button.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const style = getComputedStyle(header);
    const contentRight = headerRect.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
    const checkbox = header.querySelector(":scope > .checkbox-field input");
    const arrow = header.querySelector(":scope > .module-toggle-button");
    const checkboxRect = checkbox?.getBoundingClientRect();
    const arrowRect = arrow?.getBoundingClientRect();
    return {
      selectionCenterGap: checkboxRect && arrowRect ? Math.abs(checkboxRect.y + checkboxRect.height/2 - arrowRect.y - arrowRect.height/2) : null,
      edgeGap: Math.abs(contentRight - rect.right),
      height: rect.height,
      width: rect.width,
      overflow: header.scrollWidth > header.clientWidth + 1,
      lastControl: ribbon.lastElementChild === button,
      controlsAfter: [...header.querySelectorAll('button, a')].filter(node => node !== button && node.getBoundingClientRect().right > rect.right + 1).length
    };
  });
  if(layout.selectionCenterGap!==null)assert.ok(layout.selectionCenterGap<1,"Checkbox and expansion arrow share exactly one center line: "+JSON.stringify(layout));
  assert.ok(layout.edgeGap <= 2, `Health sits at the ribbon's right content edge: ${JSON.stringify(layout)}`);
  assert.equal(layout.height, 32, 'Health matches the compact ribbon control height');
  assert.ok(layout.width >= 90 && layout.width <= 155, 'Health uses a natural icon-and-label width');
  assert.equal(layout.overflow, false, 'Health does not cause horizontal ribbon overflow');
  assert.equal(layout.lastControl, true, 'Health follows all ribbon metrics and actions');
  assert.equal(layout.controlsAfter, 0, 'No action is positioned to the right of Health');
}
