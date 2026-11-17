const test=require('node:test'),assert=require('node:assert/strict');
const {reportText}=require('../../backend/services/reportText');
test('rich text paragraphs and lists become inert Unicode text',()=>{
 assert.equal(reportText('<p>Status — 200 &amp; expected ≥ 1</p><ol><li>First</li><li>Second</li></ol>'),'Status — 200 & expected ≥ 1\n\n• First\n\n• Second');
 assert.equal(reportText('<script>steal()</script><p onclick="steal()">Safe &lt;img src=x&gt;</p>'),'Safe <img src=x>');
});
