import React from "react";
import ReactDOM from "react-dom/client";

// Bundled brand fonts (variable). Fallback chain lives in tokens.css.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";

import "./styles/tokens.css";
import "./styles/base.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
