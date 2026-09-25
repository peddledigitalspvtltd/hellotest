#!/usr/bin/env node
const { writeFileSync } = require("fs");
const { evaluateKnowledgeFixtures } = require("@hellotest/knowledge/backend/services/knowledgeEvaluation.service");
const report = evaluateKnowledgeFixtures();
const output = process.argv[2];
if (output)
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.status !== "passed")
  process.exitCode = 1;
