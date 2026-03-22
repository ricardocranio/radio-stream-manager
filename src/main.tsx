import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { isLanMode, createLanElectronAPI, checkLanHealth } from "./lib/lanBridge";

// Fallback seguro: garante que window.electronAPI existe mesmo fora do Electron
// Evita erros de "Cannot read properties of undefined" no preview web
if (typeof window !== 'undefined' && !window.electronAPI) {
  if (isLanMode()) {
    // LAN mode: create HTTP bridge to Electron backend
    (window as any).electronAPI = createLanElectronAPI();
    console.log('[LAN] 🌐 Modo LAN ativo - conectando ao servidor Electron via HTTP');
    checkLanHealth().then(ok => {
      console.log(`[LAN] ${ok ? '✓ Servidor acessível' : '✗ Servidor não encontrado'}`);
    });
  } else {
    (window as any).electronAPI = { isElectron: false };
  }
}

createRoot(document.getElementById("root")!).render(<App />);

