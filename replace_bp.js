const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'backend/api/src/services/batchProcess.service.js');
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/const db = require\("\.\.\/db"\);/g, 'const db = require("../db");\nconst obsDb = require("../obsDb");');

code = code.replace(/const insertJob = db\.prepare/g, 'const insertJob = obsDb.prepare');
code = code.replace(/const selectQueuedJobs = db\.prepare/g, 'const selectQueuedJobs = obsDb.prepare');
code = code.replace(/const markJobRunning = db\.prepare/g, 'const markJobRunning = obsDb.prepare');
code = code.replace(/const markJobCompleted = db\.prepare/g, 'const markJobCompleted = obsDb.prepare');
code = code.replace(/const markJobFailed = db\.prepare/g, 'const markJobFailed = obsDb.prepare');

fs.writeFileSync(file, code);
