// switch: owns operation-specific validation and transformation.
const { RESERVED, fail, object, checkSize, clone, json, choose, flag, comparisons } = require('../shared/dataValues');

function compile(data, helpers, config) {
  config.routes = json(data.dataRoutes, 'Routes', 'array');
    if (!config.routes.length || config.routes.length > 10) throw fail('Choose 1–10 routes.');
    const ids = new Set();
  config.routes = config.routes.map(route => {
      if (!object(route) || typeof route.id !== 'string' || !/^[a-zA-Z][\w-]{0,63}$/.test(route.id) || RESERVED.has(route.id) || route.id === 'fallback' || ids.has(route.id)) throw fail('Use unique route IDs starting with a letter; fallback is reserved.');
      ids.add(route.id);
      return { id: route.id, ...comparisons(route.conditions, route.conditionCombinator, helpers) };
    });
  config.all = flag(data.dataRouteAll, false, 'Send to all matching routes');
  config.fallback = choose(data.dataFallback, ['none', 'fallback', 'first'], 'Fallback route');
}

function execute({ config, input, context, helpers, output, source_items, push, perItem, abort }) {
    const routes = Object.fromEntries(config.routes.map(route => [route.id, []]));
    if (config.fallback === 'fallback') routes.fallback = [];
    const route_items = Object.fromEntries(Object.keys(routes).map(id => [id, []]));
    input.forEach((item, index) => {
      abort();
      // Evaluate every rule before selecting first/all so invalid comparisons
      // cannot be hidden by a prior match.
      const matched = config.routes.filter(route => helpers.condition(route, perItem(item, index)));
      let ids = (config.all ? matched : matched.slice(0, 1)).map(route => route.id);
      if (!ids.length && config.fallback !== 'none') ids = [config.fallback === 'first' ? config.routes[0].id : 'fallback'];
      if (ids.length) push(item, [index]);
      for (const id of ids) { route_items[id].push(index); routes[id].push(clone(item)); }
    });
    const result = { data: output, operation: config.operation, input_count: input.length, item_count: output.length, routed_count: Object.values(routes).reduce((sum, items) => sum + items.length, 0), source_items, routes, route_items };
    checkSize(result, 'Output data');
    return result;
}

module.exports = { compile, execute };
