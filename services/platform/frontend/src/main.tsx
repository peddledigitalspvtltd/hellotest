import { installCapabilityHost } from "./platform/capabilities/host";
import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/hanken-grotesk/400.css";
import "@fontsource/hanken-grotesk/500.css";
import "@fontsource/hanken-grotesk/600.css";
import "@fontsource/hanken-grotesk/700.css";
import { App } from "./App";
import "./styles.css";
import "./dark-theme.css";
import "./catalog-list.css";
import "./modal-system.css";
import "./execution-run-builder.css";
import "./workspace-layout.css";

installCapabilityHost();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
