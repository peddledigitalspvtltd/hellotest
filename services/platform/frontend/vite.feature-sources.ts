// The shell owns dependency versions; feature source roots must use the same
// React instance. Only UI roots are exposed to the development file server.
import manifest from "./package.json";
import catalog from "../../catalog.json";

const directory = (path: string) => decodeURIComponent(new URL(path, import.meta.url).pathname);
const uiRoots = catalog.services.flatMap(service => service.frontend_source ? [service.frontend_source] : []);

export const featureSourceConfig = {
  resolve: {
    dedupe: Object.keys(manifest.dependencies),
    alias: uiRoots.map(source => ({ find: `/${source}`, replacement: directory(`../../../${source}`) }))
  },
  fs: {
    allow: [directory("."), ...uiRoots.map(source => directory(`../../../${source}`))]
  }
};
