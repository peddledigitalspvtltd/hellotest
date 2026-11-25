// Existing definitions keep their identity and use the same bounded HTTP adapter.
const httpRequest = require('./apiTool');
module.exports = require('./definition')('apiAgent', httpRequest.implementation);
