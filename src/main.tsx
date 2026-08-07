import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { handleContextMenu } from "./contextMenu";
import "./styles.css";

// Keep the application chrome free of a browser menu while preserving the
// native edit menu for text. On mobile this exposes long-press copy for todo
// previews and long-press paste for fields such as the WebDAV password.
document.addEventListener("contextmenu", handleContextMenu);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
