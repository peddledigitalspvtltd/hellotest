/** Share concurrent optional imports, but allow a failed download to be retried. */
export function createAutomationOptionalModule<T>(load: () => Promise<T>) {
  let loaded: T | undefined;
  let pending: Promise<T> | undefined;
  return {
    current: () => loaded,
    load: (): Promise<T> => {
      if (loaded !== undefined) return Promise.resolve(loaded);
      if (pending) return pending;
      pending = Promise.resolve().then(load).then(module => {
        loaded = module;
        pending = undefined;
        return module;
      }, error => {
        pending = undefined;
        throw error;
      });
      return pending;
    }
  };
}
