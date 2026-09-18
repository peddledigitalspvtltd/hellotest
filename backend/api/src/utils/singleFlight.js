/** Share overlapping reads only; completed values and failures are never cached. */
const singleFlight = (read) => {
  let pending = null;
  return () => {
    if (!pending) {
      pending = Promise.resolve().then(read).finally(() => { pending = null; });
    }
    return pending;
  };
};

module.exports = { singleFlight };
