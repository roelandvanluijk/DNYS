import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Upload, ArrowRight, Info, Loader2 } from "lucide-react";
import dnysLogo from "@/assets/dnys-logo.svg";

export default function UploadPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [momenceFile, setMomenceFile] = useState<File | null>(null);
  const [stripeFile, setStripeFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [dragOverMomence, setDragOverMomence] = useState(false);
  const [dragOverStripe, setDragOverStripe] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent, type: "momence" | "stripe") => {
    e.preventDefault();
    if (type === "momence") setDragOverMomence(false);
    else setDragOverStripe(false);

    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith(".csv")) {
      if (type === "momence") setMomenceFile(file);
      else setStripeFile(file);
    } else {
      toast({
        title: "Ongeldig bestand",
        description: "Upload alsjeblieft een CSV bestand.",
        variant: "destructive",
      });
    }
  }, [toast]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: "momence" | "stripe") => {
    const file = e.target.files?.[0];
    if (file) {
      if (type === "momence") setMomenceFile(file);
      else setStripeFile(file);
    }
  };

  const handleSubmit = async () => {
    if (!momenceFile || !stripeFile) {
      toast({
        title: "Bestanden ontbreken",
        description: "Upload beide CSV bestanden om door te gaan.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append("period", period);
      formData.append("momence", momenceFile);
      formData.append("stripe", stripeFile);

      const response = await fetch("/api/reconcile", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (data.success && data.needsReview) {
        toast({
          title: "Nieuwe producten gevonden",
          description: `${data.newProductCount} nieuwe producten moeten worden beoordeeld.`,
        });
        sessionStorage.setItem("newProductsData", JSON.stringify({
          tempSessionId: data.tempSessionId,
          newProducts: data.newProducts,
          period,
          momenceFileName: momenceFile.name,
          stripeFileName: stripeFile.name,
        }));
        navigate("/review-products");
      } else if (data.success && data.sessionId) {
        toast({
          title: "Verwerking voltooid",
          description: "Je resultaten zijn klaar om te bekijken.",
        });
        navigate(`/results/${data.sessionId}`);
      } else {
        // Combine error and details for better feedback
        const errorMessage = data.error || "Er is iets misgegaan";
        const errorDetails = data.details ? `\n${data.details}` : "";
        throw new Error(errorMessage + errorDetails);
      }
    } catch (error) {
      let errorDescription = "Er is een fout opgetreden";
      
      if (error instanceof Error) {
        errorDescription = error.message;
      } else if (typeof error === 'object' && error !== null) {
        errorDescription = JSON.stringify(error);
      }
      
      toast({
        title: "Fout bij verwerking",
        description: errorDescription,
        variant: "destructive",
      });
      
      // Also log to console for debugging
      console.error("Upload error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <img 
              src={dnysLogo} 
              alt="De Nieuwe Yogaschool" 
              className="h-10 md:h-12"
              data-testid="img-logo"
            />
            <div className="border-l border-border pl-4">
              <h1 className="font-semibold text-lg" style={{ color: '#8B7355' }}>
                Reconciliatie Tool
              </h1>
            </div>
          </div>
          <div className="flex gap-2">
            <Button 
              variant="ghost" 
              onClick={() => navigate("/sessions")}
              data-testid="link-sessions"
            >
              Eerdere sessies
            </Button>
            <Button 
              variant="ghost" 
              onClick={() => navigate("/products")}
              data-testid="link-products"
            >
              Producten
            </Button>
            <Button 
              variant="ghost" 
              onClick={() => navigate("/settings")}
              data-testid="link-settings"
            >
              Instellingen
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-8 md:py-12">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-2xl md:text-3xl font-serif font-semibold text-foreground mb-2">
              Momence-Stripe Reconciliatie
            </h2>
            <p className="text-muted-foreground">
              Automatische omzetcategorisatie en betalingsafstemming
            </p>
          </div>

          <Card className="shadow-lg">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Periode selecteren</CardTitle>
              <CardDescription>Voer de maand in waarvoor je wilt verwerken</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label htmlFor="period" className="text-sm font-medium">Periode (JJJJ-MM)</Label>
                <Input
                  id="period"
                  type="month"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  className="mt-1.5"
                  data-testid="input-period"
                />
              </div>

              <div className="space-y-4">
                <div>
                  <Label className="text-sm font-medium mb-1.5 block">Momence CSV</Label>
                  <div
                    className={`border-2 border-dashed rounded-lg p-6 text-center transition-all duration-200 cursor-pointer hover-elevate ${
                      dragOverMomence
                        ? "border-primary bg-primary/5"
                        : momenceFile
                        ? "border-chart-2 bg-chart-2/5"
                        : "border-border hover:border-primary/50"
                    }`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverMomence(true);
                    }}
                    onDragLeave={() => setDragOverMomence(false)}
                    onDrop={(e) => handleDrop(e, "momence")}
                    onClick={() => document.getElementById("momence-input")?.click()}
                    data-testid="dropzone-momence"
                  >
                    <input
                      id="momence-input"
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={(e) => handleFileChange(e, "momence")}
                      data-testid="input-momence"
                    />
                    <Upload className={`w-8 h-8 mx-auto mb-2 ${momenceFile ? "text-chart-2" : "text-muted-foreground"}`} />
                    {momenceFile ? (
                      <p className="font-medium text-chart-2">{momenceFile.name}</p>
                    ) : (
                      <>
                        <p className="font-medium text-foreground">Klik of sleep bestand</p>
                        <p className="text-sm text-muted-foreground mt-1">CSV bestand van Momence</p>
                      </>
                    )}
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-medium mb-1.5 block">Stripe CSV</Label>
                  <div
                    className={`border-2 border-dashed rounded-lg p-6 text-center transition-all duration-200 cursor-pointer hover-elevate ${
                      dragOverStripe
                        ? "border-primary bg-primary/5"
                        : stripeFile
                        ? "border-chart-2 bg-chart-2/5"
                        : "border-border hover:border-primary/50"
                    }`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverStripe(true);
                    }}
                    onDragLeave={() => setDragOverStripe(false)}
                    onDrop={(e) => handleDrop(e, "stripe")}
                    onClick={() => document.getElementById("stripe-input")?.click()}
                    data-testid="dropzone-stripe"
                  >
                    <input
                      id="stripe-input"
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={(e) => handleFileChange(e, "stripe")}
                      data-testid="input-stripe"
                    />
                    <Upload className={`w-8 h-8 mx-auto mb-2 ${stripeFile ? "text-chart-2" : "text-muted-foreground"}`} />
                    {stripeFile ? (
                      <p className="font-medium text-chart-2">{stripeFile.name}</p>
                    ) : (
                      <>
                        <p className="font-medium text-foreground">Klik of sleep bestand</p>
                        <p className="text-sm text-muted-foreground mt-1">CSV bestand van Stripe</p>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <Button
                onClick={handleSubmit}
                disabled={!momenceFile || !stripeFile || isLoading}
                className="w-full"
                size="lg"
                data-testid="button-submit"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Verwerken...
                  </>
                ) : (
                  <>
                    Start Verwerking
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          <Card className="mt-6 bg-accent/30 border-accent">
            <CardContent className="pt-5">
              <div className="flex gap-3">
                <Info className="w-5 h-5 text-accent-foreground shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-medium text-accent-foreground mb-2">Instructies</h4>
                  <ol className="text-sm text-muted-foreground space-y-1.5 list-decimal list-inside">
                    <li>
                      <strong>Momence:</strong> Analytics → Total Sales → CSV
                    </li>
                    <li>
                      <strong>Stripe:</strong> Payments → Itemized payout → CSV
                    </li>
                    <li>Upload beide bestanden hierboven</li>
                  </ol>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      <footer className="border-t py-4 text-center text-sm text-muted-foreground">
        <p>De Nieuwe Yogaschool — Reconciliatie Tool</p>
      </footer>
    </div>
  );
}
