const fs = require('node:fs');
function connectionOptions() {
  const options = { address: process.env.TEMPORAL_ADDRESS || '127.0.0.1:7233' };
  if (process.env.TEMPORAL_TLS === 'true') {
    options.tls = {};
    if (process.env.TEMPORAL_TLS_CA) options.tls.serverRootCACertificate = fs.readFileSync(process.env.TEMPORAL_TLS_CA);
    if (process.env.TEMPORAL_TLS_SERVER_NAME) options.tls.serverNameOverride = process.env.TEMPORAL_TLS_SERVER_NAME;
    if (process.env.TEMPORAL_TLS_CERT || process.env.TEMPORAL_TLS_KEY) options.tls.clientCertPair = {
      crt: fs.readFileSync(process.env.TEMPORAL_TLS_CERT), key: fs.readFileSync(process.env.TEMPORAL_TLS_KEY)
    };
  }
  if (process.env.TEMPORAL_API_KEY) {
    if (!options.tls) throw new Error('Temporal API keys require TEMPORAL_TLS=true.');
    options.apiKey = process.env.TEMPORAL_API_KEY;
  }
  return options;
}
module.exports = { connectionOptions };
