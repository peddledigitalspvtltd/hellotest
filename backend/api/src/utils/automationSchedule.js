const normalizeScheduledAt = (value, now = Date.now()) => {
  if (value === null || value === undefined || value === "") return null;
  const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    const error = new Error("scheduled_at must be a valid date and time with a timezone.");
    error.statusCode = 400;
    throw error;
  }
  const calendarDate = value.slice(0, 10);
  const calendarTimestamp = Date.parse(`${calendarDate}T00:00:00Z`);
  if (!Number.isFinite(calendarTimestamp) || new Date(calendarTimestamp).toISOString().slice(0, 10) !== calendarDate) {
    const error = new Error("scheduled_at must use a valid calendar date.");
    error.statusCode = 400;
    throw error;
  }
  if (timestamp <= now) {
    const error = new Error("Choose a future date and time for the automation build.");
    error.statusCode = 400;
    throw error;
  }
  return new Date(timestamp).toISOString();
};
module.exports = { normalizeScheduledAt };
