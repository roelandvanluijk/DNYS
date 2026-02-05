import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Check, Loader2, Package, ArrowLeft } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import dnysLogo from "@/assets/dnys-logo.svg";

interface NewProductSuggestion {
  itemName: string;
  suggestedCategory: string;
  btwRate: number;
  twinfieldAccount: string;
  specialHandling: 'accrual' | 'spread_12' | null;
  transactionCount: number;
  totalAmount: number;
}

interface ProductEdit extends NewProductSuggestion {
  category: string;
  hasAccrual: boolean;
  accrualMonths: number;
  accrualStartDate: string;
  accrualEndDate: string;
  hasSpread: boolean;
  spreadMonths: number;
  spreadStartDate: string;
  spreadEndDate: string;
}

interface ContinueResponse {
  success: boolean;
  sessionId?: string;
  error?: string;
}

const CATEGORIES = [
  { name: "Online/Livestream", btwRate: 0.21, twinfield: "8200" },
  { name: "Opleidingen", btwRate: 0.21, twinfield: "8300" },
  { name: "Jaarabonnementen", btwRate: 0.09, twinfield: "8101" },
  { name: "Gift Cards", btwRate: 0.00, twinfield: "8900" },
  { name: "Money Credits", btwRate: 0.00, twinfield: "8901" },
  { name: "Workshops & Events", btwRate: 0.09, twinfield: "8150" },
  { name: "Abonnementen", btwRate: 0.09, twinfield: "8100" },
  { name: "Rittenkaarten", btwRate: 0.09, twinfield: "8110" },
  { name: "Omzet Keuken", btwRate: 0.09, twinfield: "8001" },
  { name: "Omzet Drank Laag", btwRate: 0.09, twinfield: "8002" },
  { name: "Omzet Drank Hoog", btwRate: 0.21, twinfield: "8003" },
  { name: "Single Classes", btwRate: 0.09, twinfield: "8120" },
  { name: "Overig", btwRate: 0.09, twinfield: "8999" },
];

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

export default function ReviewProductsPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [tempSessionId, setTempSessionId] = useState<string>("");
  const [period, setPeriod] = useState<string>("");
  const [products, setProducts] = useState<ProductEdit[]>([]);

  useEffect(() => {
    const data = sessionStorage.getItem("newProductsData");
    if (!data) {
      toast({
        title: "Geen data gevonden",
        description: "Ga terug naar de upload pagina en probeer opnieuw.",
        variant: "destructive",
      });
      navigate("/");
      return;
    }

    try {
      const parsed = JSON.parse(data);
      setTempSessionId(parsed.tempSessionId);
      setPeriod(parsed.period);
      
      const editableProducts: ProductEdit[] = parsed.newProducts.map((p: NewProductSuggestion) => ({
        ...p,
        category: p.suggestedCategory,
        hasAccrual: p.specialHandling === 'accrual',
        accrualMonths: p.specialHandling === 'accrual' ? 14 : 0,
        accrualStartDate: "",
        accrualEndDate: "",
        hasSpread: p.specialHandling === 'spread_12',
        spreadMonths: 12,
        spreadStartDate: "",
        spreadEndDate: "",
      }));
      
      setProducts(editableProducts);
    } catch (e) {
      toast({
        title: "Fout bij laden",
        description: "Kon product data niet laden.",
        variant: "destructive",
      });
      navigate("/");
    }
  }, [navigate, toast]);

  const updateProduct = (index: number, updates: Partial<ProductEdit>) => {
    setProducts(prev => {
      const newProducts = [...prev];
      newProducts[index] = { ...newProducts[index], ...updates };
      return newProducts;
    });
  };

  const handleCategoryChange = (index: number, categoryName: string) => {
    const categoryConfig = CATEGORIES.find(c => c.name === categoryName);
    if (categoryConfig) {
      updateProduct(index, {
        category: categoryName,
        btwRate: categoryConfig.btwRate,
        twinfieldAccount: categoryConfig.twinfield,
        hasAccrual: categoryName === "Opleidingen",
        hasSpread: categoryName === "Jaarabonnementen",
      });
    }
  };

  const handleSubmit = async () => {
    setIsLoading(true);
    console.log("Starting handleSubmit, tempSessionId:", tempSessionId);

    try {
      const productData = products.map(p => ({
        itemName: p.itemName,
        category: p.category,
        btwRate: p.btwRate,
        twinfieldAccount: p.twinfieldAccount,
        hasAccrual: p.hasAccrual,
        accrualMonths: p.hasAccrual ? p.accrualMonths : null,
        accrualStartOffset: 0,
        accrualStartDate: p.hasAccrual && p.accrualStartDate ? p.accrualStartDate : null,
        accrualEndDate: p.hasAccrual && p.accrualEndDate ? p.accrualEndDate : null,
        hasSpread: p.hasSpread,
        spreadMonths: p.hasSpread ? p.spreadMonths : 12,
        spreadStartDate: p.hasSpread && p.spreadStartDate ? p.spreadStartDate : null,
        spreadEndDate: p.hasSpread && p.spreadEndDate ? p.spreadEndDate : null,
        transactionCount: p.transactionCount,
      }));

      console.log("Saving products batch:", productData.length, "products");
      const batchResponse = await apiRequest("POST", "/api/products/batch", productData);
      console.log("Batch save response:", batchResponse);

      toast({
        title: "Producten opgeslagen",
        description: "Nu wordt de reconciliatie voortgezet...",
      });

      console.log("Calling continue endpoint with tempSessionId:", tempSessionId);
      const continueResponse = await apiRequest("POST", `/api/reconcile/continue/${tempSessionId}`) as unknown as ContinueResponse;
      console.log("Continue response:", continueResponse);
      
      sessionStorage.removeItem("newProductsData");
      
      if (continueResponse.success && continueResponse.sessionId) {
        toast({
          title: "Verwerking voltooid",
          description: "Je resultaten zijn klaar om te bekijken.",
        });
        navigate(`/results/${continueResponse.sessionId}`);
      } else {
        const errorMsg = continueResponse.error || "Kon reconciliatie niet voltooien";
        console.error("Continue failed:", errorMsg);
        throw new Error(errorMsg);
      }
    } catch (error) {
      console.error("handleSubmit error:", error);
      let errorMessage = "Er is een fout opgetreden";
      
      if (error instanceof Error) {
        errorMessage = error.message;
        if (error.message.includes("niet gevonden") || error.message.includes("404")) {
          errorMessage = "De sessie is verlopen. Upload de bestanden opnieuw.";
        }
      }
      
      toast({
        title: "Fout bij opslaan",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
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
                Nieuwe Producten Controleren
              </h1>
            </div>
          </div>
          <Button 
            variant="ghost" 
            onClick={() => navigate("/")}
            data-testid="link-back"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Terug
          </Button>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <Card className="mb-6 border-warning bg-warning/10">
            <CardContent className="pt-5">
              <div className="flex gap-3">
                <AlertTriangle className="w-5 h-5 text-warning-foreground shrink-0 mt-0.5" style={{ color: '#E8A87C' }} />
                <div>
                  <h4 className="font-medium mb-1" style={{ color: '#8B7355' }}>
                    {products.length} nieuwe producten gevonden
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    Controleer de categorisering en instellingen voor deze producten. 
                    Na goedkeuring worden ze opgeslagen en bij toekomstige uploads automatisch herkend.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            {products.map((product, index) => (
              <Card key={product.itemName} className="shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <Package className="w-5 h-5 text-muted-foreground shrink-0 mt-1" />
                      <div>
                        <CardTitle className="text-base font-medium">
                          {product.itemName}
                        </CardTitle>
                        <CardDescription className="mt-1">
                          {product.transactionCount} transacties • {formatCurrency(product.totalAmount)} totaal
                        </CardDescription>
                      </div>
                    </div>
                    {product.category !== product.suggestedCategory && (
                      <span className="text-xs px-2 py-1 rounded bg-accent text-accent-foreground">
                        Gewijzigd
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <Label className="text-sm">Categorie</Label>
                      <Select
                        value={product.category}
                        onValueChange={(value) => handleCategoryChange(index, value)}
                      >
                        <SelectTrigger className="mt-1.5" data-testid={`select-category-${index}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.map((cat) => (
                            <SelectItem key={cat.name} value={cat.name}>
                              {cat.name} ({Math.round(cat.btwRate * 100)}% BTW)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-sm">BTW Tarief</Label>
                      <Input
                        value={`${Math.round(product.btwRate * 100)}%`}
                        disabled
                        className="mt-1.5 bg-muted"
                      />
                    </div>
                    <div>
                      <Label className="text-sm">Twinfield Code</Label>
                      <Input
                        value={product.twinfieldAccount}
                        onChange={(e) => updateProduct(index, { twinfieldAccount: e.target.value })}
                        className="mt-1.5"
                        data-testid={`input-twinfield-${index}`}
                      />
                    </div>
                  </div>

                  {product.category === "Opleidingen" && (
                    <div className="p-4 rounded-lg bg-accent/30 space-y-3">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`accrual-${index}`}
                          checked={product.hasAccrual}
                          onCheckedChange={(checked) => updateProduct(index, { hasAccrual: checked === true })}
                          data-testid={`checkbox-accrual-${index}`}
                        />
                        <Label htmlFor={`accrual-${index}`} className="text-sm font-medium">
                          Dit is een opleiding met accruals
                        </Label>
                      </div>
                      {product.hasAccrual && (
                        <div className="ml-6 space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Label className="text-sm">Startdatum</Label>
                              <Input
                                type="date"
                                value={product.accrualStartDate}
                                onChange={(e) => updateProduct(index, { accrualStartDate: e.target.value })}
                                className="mt-1.5"
                                data-testid={`input-accrual-start-${index}`}
                              />
                            </div>
                            <div>
                              <Label className="text-sm">Einddatum</Label>
                              <Input
                                type="date"
                                value={product.accrualEndDate}
                                onChange={(e) => updateProduct(index, { accrualEndDate: e.target.value })}
                                className="mt-1.5"
                                data-testid={`input-accrual-end-${index}`}
                              />
                            </div>
                          </div>
                          {product.accrualStartDate && product.accrualEndDate && (
                            <p className="text-xs text-muted-foreground">
                              Omzet wordt verdeeld over de opgegeven periode
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {product.category === "Jaarabonnementen" && (
                    <div className="p-4 rounded-lg bg-accent/30 space-y-3">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`spread-${index}`}
                          checked={product.hasSpread}
                          onCheckedChange={(checked) => updateProduct(index, { hasSpread: checked === true })}
                          data-testid={`checkbox-spread-${index}`}
                        />
                        <Label htmlFor={`spread-${index}`} className="text-sm font-medium">
                          Spreiding over periode
                        </Label>
                      </div>
                      {product.hasSpread && (
                        <div className="ml-6 space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Label className="text-sm">Startdatum</Label>
                              <Input
                                type="date"
                                value={product.spreadStartDate}
                                onChange={(e) => updateProduct(index, { spreadStartDate: e.target.value })}
                                className="mt-1.5"
                                data-testid={`input-spread-start-${index}`}
                              />
                            </div>
                            <div>
                              <Label className="text-sm">Einddatum</Label>
                              <Input
                                type="date"
                                value={product.spreadEndDate}
                                onChange={(e) => updateProduct(index, { spreadEndDate: e.target.value })}
                                className="mt-1.5"
                                data-testid={`input-spread-end-${index}`}
                              />
                            </div>
                          </div>
                          {product.spreadStartDate && product.spreadEndDate && (
                            <p className="text-xs text-muted-foreground">
                              Omzet wordt verdeeld over de opgegeven periode
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-8 flex justify-end gap-4">
            <Button
              variant="outline"
              onClick={() => navigate("/")}
              disabled={isLoading}
              data-testid="button-cancel"
            >
              Annuleren
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isLoading}
              size="lg"
              data-testid="button-save"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Opslaan...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Alles Opslaan & Doorgaan
                </>
              )}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
