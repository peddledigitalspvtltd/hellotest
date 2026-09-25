import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/hanken-grotesk/500.css";
import "@fontsource/hanken-grotesk/600.css";
import "@fontsource/hanken-grotesk/700.css";
import { AdminApp } from "./AdminApp";
import "./admin.css";

ReactDOM.createRoot(document.getElementById("admin-root")!).render(
  <React.StrictMode><AdminApp /></React.StrictMode>
);

