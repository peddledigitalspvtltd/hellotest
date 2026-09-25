import * as react from "react";
import * as jsx from "react/jsx-runtime";
import * as reactDom from "react-dom";
import * as reactDomClient from "react-dom/client";
import * as router from "react-router-dom";
import * as query from "@tanstack/react-query";
import * as auth from "../../auth/AuthContext";
import * as localization from "../../context/LocalizationContext";
import * as http from "../../lib/httpClient";
import * as aiHttp from "../../lib/aiHttpClient";
import * as dialogFocus from "../../shared/hooks/useDialogFocus";
import * as loading from "../../shared/components/LoadingState";
import * as capabilityLoader from "./loadCapability";

// Capability bundles use these exact provider instances. A second React,
// router, auth context or query cache would break embedded panels and drafts.
export const capabilityHost = {
  protocol: 1,
  modules: { react, "react/jsx-runtime": jsx, "react-dom": reactDom, "react-dom/client": reactDomClient,
    "react-router-dom": router, "@tanstack/react-query": query,
    auth, localization, http, aiHttp, dialogFocus, loading, capabilityLoader }
};

declare global {
  interface Window { __HELLOTEST_UI_HOST__?: typeof capabilityHost }
}

export function installCapabilityHost() {
  window.__HELLOTEST_UI_HOST__ = capabilityHost;
}
