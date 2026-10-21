import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@/styles.css";

const root = document.querySelector("#root");

if (root) {
  createRoot(root).render(
    <StrictMode>
      <main>Capture</main>
    </StrictMode>
  );
}
