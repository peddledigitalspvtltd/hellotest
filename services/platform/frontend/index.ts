import type { ServiceDefinition } from "./src/services/shared";

export const platformService: ServiceDefinition = {
  id: "platform",
  envKey: "VITE_PLATFORM_SERVICE_URL",
  matches: (pathname) => /^\/(?:metadata|permissions|auth|admin|admin-ui|admin-portal|users|roles|projects|project-members|app-types|settings|feature-flags|notifications|attachments|comments|workspace-transactions|domain-metadata)(?:\/|$)/.test(pathname)
};
