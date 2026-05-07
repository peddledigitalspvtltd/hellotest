const fs = require('fs');
const file = 'src/pages/TestCasesPage.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/const nextParams = new URLSearchParams\(searchParams\);\s*nextParams\.delete\("project"\);\s*setSearchParams\(nextParams, \{ replace: true \}\);/g, 
  'setSearchParams(prev => {\n      prev.delete("project");\n      return prev;\n    }, { replace: true });');

content = content.replace(/const nextParams = new URLSearchParams\(searchParams\);\s*nextParams\.delete\("appType"\);\s*setSearchParams\(nextParams, \{ replace: true \}\);/g, 
  'setSearchParams(prev => {\n      prev.delete("appType");\n      return prev;\n    }, { replace: true });');

fs.writeFileSync(file, content);
console.log("Updated!");
