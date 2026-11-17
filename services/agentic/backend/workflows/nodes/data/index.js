// Literal strategy table: each action owns its validation and execution.
module.exports = Object.freeze({
  editFields: require('./editFields'),
  splitOut: require('./splitOut'),
  aggregate: require('./aggregate'),
  limit: require('./limit'),
  sort: require('./sort'),
  removeDuplicates: require('./removeDuplicates'),
  filter: require('./filter'),
  switch: require('./switch')
});
