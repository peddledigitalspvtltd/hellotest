const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'backend/api/src/services/automationGenerator.service.js');
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/const db = require\("\.\.\/db"\);/g, 'const db = require("../db");\nconst obsDb = require("../obsDb");');

code = code.replace(/const selectJob = db\.prepare/g, 'const selectJob = obsDb.prepare');
code = code.replace(/const selectJobByTransaction = db\.prepare/g, 'const selectJobByTransaction = obsDb.prepare');
code = code.replace(/const selectActiveJobForCase = db\.prepare/g, 'const selectActiveJobForCase = obsDb.prepare');
code = code.replace(/const insertJob = db\.prepare/g, 'const insertJob = obsDb.prepare');
code = code.replace(/const updateJobStatus = db\.prepare/g, 'const updateJobStatus = obsDb.prepare');
code = code.replace(/const updateJobRuntimeState = db\.prepare/g, 'const updateJobRuntimeState = obsDb.prepare');
code = code.replace(/const markJobCompleted = db\.prepare/g, 'const markJobCompleted = obsDb.prepare');
code = code.replace(/const markJobFailed = db\.prepare/g, 'const markJobFailed = obsDb.prepare');

fs.writeFileSync(file, code);
