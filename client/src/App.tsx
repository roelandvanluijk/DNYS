import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import UploadPage from "@/pages/upload";
import ResultsPage from "@/pages/results";
import SessionsPage from "@/pages/sessions";
import SettingsPage from "@/pages/settings";
import ReviewProductsPage from "@/pages/review-products";
import ProductsPage from "@/pages/products";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={UploadPage} />
      <Route path="/results/:sessionId" component={ResultsPage} />
      <Route path="/sessions" component={SessionsPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/review-products" component={ReviewProductsPage} />
      <Route path="/products" component={ProductsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
