const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const root = path.resolve(__dirname, '../../../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const yaml = file => YAML.parse(read(file));

test('the ops catalog and deployment have one bounded independent service per responsibility', () => {
  const compose = yaml('docker-compose.ops.yml');
  const catalog = JSON.parse(read('services/catalog.json')).operations;
  assert.deepEqual(Object.keys(compose.services).sort(), catalog.map(service => service.id).sort());
  assert.equal('promtail' in compose.services, false);
  let total = 0;
  for (const item of catalog) {
    const service = compose.services[item.id];
    assert.equal(service.mem_limit, `${item.memory_limit_mib}m`);
    total += item.memory_limit_mib;
    assert.ok(Number(service.cpus) <= 0.5);
    assert.ok(service.pids_limit <= 128);
    assert.equal(service.depends_on, undefined);
    assert.equal(service.logging.options['max-file'], '3');
    assert.equal(service.logging.options['max-size'], '5m');
    assert.ok(service.ports.every(port => port.startsWith('127.0.0.1:')));
    for (const mount of service.volumes) {
      const source = mount.split(':')[0];
      if (source.startsWith('./')) assert.ok(fs.existsSync(path.join(root, source)), source);
    }
  }
  assert.ok(total <= 1800, 'compact stack must stay within its declared aggregate memory budget');
  const platform = yaml('docker-compose.platform.yml');
  assert.equal(platform.services.api.depends_on['otel-collector'], undefined);
  assert.equal(yaml('docker-compose.full.yml').services.testengine.depends_on.jaeger, undefined);
  for (const item of catalog) assert.equal(platform.services[item.id].extends.service, item.id);
});

test('telemetry storage and outage buffers have explicit budgets', () => {
  const collector = yaml('ops/otel-collector/config.yaml');
  assert.equal(collector.extensions.file_storage, undefined);
  for (const exporter of Object.values(collector.exporters).filter(value => value.sending_queue)) {
    assert.equal(exporter.sending_queue.sizer, 'bytes');
    assert.ok(exporter.sending_queue.queue_size <= 4 * 1024 * 1024);
    assert.equal(exporter.retry_on_failure.max_elapsed_time, '30s');
  }
  const jaeger = yaml('ops/jaeger/config.yaml');
  assert.equal(jaeger.extensions.jaeger_storage.backends.primary_store.memory.max_traces, 2000);
  assert.equal(yaml('ops/loki/loki-config.yml').limits_config.retention_period, '24h');
  assert.ok(yaml('docker-compose.ops.yml').services.prometheus.command.includes('--storage.tsdb.retention.size=256MB'));
});
