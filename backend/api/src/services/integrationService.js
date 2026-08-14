/**
 * Integration Service for generating native CI/CD pipelines
 */

/**
 * Generates a GitHub Actions YAML workflow for a specific project/suite.
 * 
 * @param {string} projectId 
 * @param {string} suiteId 
 * @returns {string} YAML content for the GitHub Action
 */
function generateGitHubAction(projectId, suiteId) {
  return `name: HelloTest E2E Tests
on:
  push:
    branches: [ "main" ]
  pull_request:
    branches: [ "main" ]
  workflow_dispatch:

jobs:
  qaira-tests:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger HelloTest Execution
        run: |
          curl -X POST "https://api.qaira.io/v1/executions/trigger" \\
               -H "Authorization: Bearer \${{ secrets.QAIRA_API_KEY }}" \\
               -H "Content-Type: application/json" \\
               -d '{
                 "projectId": "${projectId}",
                 "suiteId": "${suiteId}",
                 "trigger": "ci"
               }'
`;
}

module.exports = {
  generateGitHubAction
};
