import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { startLanguageSync } from "./i18n";
import App from "./App";
import OverlayPage from "./pages/OverlayPage";
import "./index.css";

// The overlay is a webview of its own, so both windows run this and follow the same choice.
void startLanguageSync();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<App />} />
      <Route path="/overlay" element={<OverlayPage />} />
    </Routes>
  </BrowserRouter>,
);
