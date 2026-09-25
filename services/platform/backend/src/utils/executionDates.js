const dateError = (message) => Object.assign(new Error(message), { statusCode: 400 });

const normalizeRunDate = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw dateError(`${label} must be a valid date in YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (value.startsWith("0000-") || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw dateError(`${label} must be a valid calendar date.`);
  }
  return value;
};

const normalizeExecutionDates = ({ start_date, end_date } = {}) => {
  const startDate = normalizeRunDate(start_date, "Start date");
  const endDate = normalizeRunDate(end_date, "End date");
  if (startDate && endDate && endDate < startDate) {
    throw dateError("End date must be on or after start date.");
  }
  return { start_date: startDate, end_date: endDate };
};

// PostgreSQL DATE values are parsed at local midnight; preserve that calendar
// date rather than converting it to UTC and potentially changing the day.
const formatStoredRunDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    return `${String(value.getFullYear()).padStart(4, "0")}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  return String(value).slice(0, 10);
};

module.exports = { normalizeExecutionDates, formatStoredRunDate };
