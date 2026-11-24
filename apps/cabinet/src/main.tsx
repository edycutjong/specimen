import { createRoot } from "react-dom/client";
import "@fontsource/grenze-gotisch/900.css";
import "@fontsource/atkinson-hyperlegible-next/400.css";
import "@fontsource/atkinson-hyperlegible-next/700.css";
import "@fontsource/azeret-mono/500.css";
import "@fontsource/azeret-mono/700.css";
import "./styles/tokens.css";
import "./styles/cabinet.css";
import { App } from "./App.js";

const container = document.getElementById("root");
if (!container) {
  throw new Error("SPECIMEN JAR cabinet: missing #root element");
}

createRoot(container).render(<App />);
