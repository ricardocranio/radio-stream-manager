import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Fallback seguro: garante que window.electronAPI existe mesmo fora do Electron
// Evita erros de "Cannot read properties of undefined" no preview web
if (typeof window !== 'undefined' && !window.electronAPI) {
  (window as any).electronAPI = { isElectron: false };
}

createRoot(document.getElementById("root")!).render(<App />);
