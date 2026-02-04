import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import { useCleanStart } from "./hooks/useCleanStart";
import { useSyncStationsFromDb } from "./hooks/useSyncStationsFromDb";
import { useDailyReset } from "./hooks/useDailyReset";
import { useInitializeStationFolders } from "./hooks/useInitializeStationFolders";
import { GlobalServicesProvider } from "./contexts/GlobalServicesContext";

const queryClient = new QueryClient();

// Component that runs initialization hooks - RUNS ONCE AT APP LEVEL
function AppInitializer({ children }: { children: React.ReactNode }) {
  useCleanStart();
  useSyncStationsFromDb(); // Syncs stations from Supabase DB
  useInitializeStationFolders(); // Creates download folders for ALL enabled stations (runs after sync)
  useDailyReset(); // Reset automático às 20:00
  // GlobalServicesProvider now handles ALL background services:
  // - Auto-download queue
  // - Auto-scraping
  // - Auto grade builder
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <TooltipProvider>
        <GlobalServicesProvider>
          <AppInitializer>
            <Toaster />
            <Sonner />
            <HashRouter>
              <Routes>
                <Route path="/" element={<Index />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </HashRouter>
          </AppInitializer>
        </GlobalServicesProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
