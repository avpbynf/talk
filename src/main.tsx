import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { startLanguageSync } from "./i18n";
import App from "./App";
import OverlayPage from "./pages/OverlayPage";
import "./index.css";
import { applyCachedTheme } from "./lib/theme-cache";

// The overlay is a webview of its own, so both windows run this and follow the same choice.
void startLanguageSync();

// The overlay keeps its own look. Everything else starts from the last theme applied, so the
// window is not drawn in the default one while its settings are on the way.
if (window.location.pathname !== "/overlay") applyCachedTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<App />} />
      <Route path="/overlay" element={<OverlayPage />} />
    </Routes>
  </BrowserRouter>,
);
