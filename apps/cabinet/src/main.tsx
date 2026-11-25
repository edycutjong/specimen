import { createRoot } from "react-dom/client";
import "@fontsource/grenze-gotisch/900.css";
import "@fontsource/atkinson-hyperlegible-next/400.css";
import "@fontsource/atkinson-hyperlegible-next/700.css";
import "@fontsource/azeret-mono/500.css";
import "@fontsource/azeret-mono/700.css";
import "./styles/tokens.css";
import "./styles/cabinet.css";
import { App } from "./App.js";
// Last, so the phone rules at 480 px and below win over the component stylesheets (QA turn-46, item 5).
import "./styles/phone.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("SPECIMEN JAR cabinet: missing #root element");
}

createRoot(container).render(<App />);
