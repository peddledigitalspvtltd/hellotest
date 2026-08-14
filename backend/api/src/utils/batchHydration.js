const uniqueIds = (rows, key = "id") => [
  ...new Set((rows || []).map((row) => row?.[key]).filter(Boolean))
];

const placeholdersFor = (values) => values.map(() => "?").join(", ");

const groupRows = (rows, key) => {
  const grouped = new Map();

  for (const row of rows || []) {
    const groupKey = row?.[key];
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, []);
    }
    grouped.get(groupKey).push(row);
  }

  return grouped;
};

module.exports = {
  groupRows,
  placeholdersFor,
  uniqueIds
};
