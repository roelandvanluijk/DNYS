import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Save,
  Settings,
  RotateCcw,
  CreditCard,
  FileCode
} from "lucide-react";
import dnysLogo from "@/assets/dnys-logo.svg";
import { apiRequest } from "@/lib/queryClient";

interface CategoryConfig {
  name: string;
  keywords: string[];
  btwRate: number;
  twinfieldAccount: string;
  group: "yoga" | "horeca";
}

interface GeneralSettingsConfig {
  office: string;
  journalCode: string;
  accrualCrossAccount: string;
  stripeFeeAccount: string;
}

interface PaymentMethodConfig {
  id?: number;
  methodName: string;
  twinfieldAccount: string;
  isStripeMethod: boolean;
}

const DEFAULT_PAYMENT_METHODS: PaymentMethodConfig[] = [
  { methodName: "Card", twinfieldAccount: "", isStripeMethod: true },
  { methodName: "iDEAL", twinfieldAccount: "", isStripeMethod: true },
  { methodName: "SEPA Direct Debit", twinfieldAccount: "", isStripeMethod: true },
  { methodName: "Card reader", twinfieldAccount: "", isStripeMethod: true },
  { methodName: "Class Pass", twinfieldAccount: "", isStripeMethod: false },
  { methodName: "urban-sports-club", twinfieldAccount: "", isStripeMethod: false },
  { methodName: "Gift card", twinfieldAccount: "", isStripeMethod: false },
  { methodName: "Cash", twinfieldAccount: "", isStripeMethod: false },
];

export default function SettingsPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editedCategories, setEditedCategories] = useState<CategoryConfig[]>([]);
  const [editedPaymentMethods, setEditedPaymentMethods] = useState<PaymentMethodConfig[]>([]);
  const [editedGeneral, setEditedGeneral] = useState<GeneralSettingsConfig>({
    office: "",
    journalCode: "MOMENCE",
    accrualCrossAccount: "1809",
    stripeFeeAccount: "4900",
  });
  const [hasChanges, setHasChanges] = useState(false);
  const [hasPaymentChanges, setHasPaymentChanges] = useState(false);
  const [hasGeneralChanges, setHasGeneralChanges] = useState(false);

  const { data: categories, isLoading } = useQuery<CategoryConfig[]>({
    queryKey: ["/api/settings/categories"],
  });

  const { data: paymentMethods, isLoading: isLoadingPayments } = useQuery<PaymentMethodConfig[]>({
    queryKey: ["/api/settings/payment-methods"],
  });

  const { data: generalSettingsData } = useQuery<GeneralSettingsConfig>({
    queryKey: ["/api/settings/general"],
  });

  useEffect(() => {
    if (categories) {
      setEditedCategories(categories);
    }
  }, [categories]);

  useEffect(() => {
    if (paymentMethods && paymentMethods.length > 0) {
      setEditedPaymentMethods(paymentMethods);
    } else {
      setEditedPaymentMethods(DEFAULT_PAYMENT_METHODS);
    }
  }, [paymentMethods]);

  useEffect(() => {
    if (generalSettingsData) {
      setEditedGeneral(generalSettingsData);
    }
  }, [generalSettingsData]);

  const saveMutation = useMutation({
    mutationFn: async (cats: CategoryConfig[]) => {
      return apiRequest("POST", "/api/settings/categories", cats);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/categories"] });
      setHasChanges(false);
      toast({
        title: "Instellingen opgeslagen",
        description: "De categorieën zijn bijgewerkt.",
      });
    },
    onError: () => {
      toast({
        title: "Fout",
        description: "Er is iets misgegaan bij het opslaan.",
        variant: "destructive",
      });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/settings/categories/reset");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/categories"] });
      setHasChanges(false);
      toast({
        title: "Standaardwaarden hersteld",
        description: "De categorieën zijn teruggezet naar de standaardwaarden.",
      });
    },
  });

  const savePaymentMethodsMutation = useMutation({
    mutationFn: async (methods: PaymentMethodConfig[]) => {
      return apiRequest("POST", "/api/settings/payment-methods/batch", { methods });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/payment-methods"] });
      setHasPaymentChanges(false);
      toast({
        title: "Betaalmethoden opgeslagen",
        description: "De Twinfield codes voor betaalmethoden zijn bijgewerkt.",
      });
    },
    onError: () => {
      toast({
        title: "Fout",
        description: "Er is iets misgegaan bij het opslaan van betaalmethoden.",
        variant: "destructive",
      });
    },
  });

  const saveGeneralMutation = useMutation({
    mutationFn: async (cfg: GeneralSettingsConfig) => {
      return apiRequest("POST", "/api/settings/general", cfg);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/general"] });
      setHasGeneralChanges(false);
      toast({ title: "Opgeslagen", description: "Twinfield export instellingen bijgewerkt." });
    },
    onError: () => {
      toast({ title: "Fout", description: "Kon instellingen niet opslaan.", variant: "destructive" });
    },
  });

  const handleGeneralChange = (field: keyof GeneralSettingsConfig, value: string) => {
    setEditedGeneral(prev => ({ ...prev, [field]: value }));
    setHasGeneralChanges(true);
  };

  const handlePaymentMethodTwinfieldChange = (index: number, value: string) => {
    const updated = [...editedPaymentMethods];
    updated[index] = { ...updated[index], twinfieldAccount: value };
    setEditedPaymentMethods(updated);
    setHasPaymentChanges(true);
  };

  const handlePaymentMethodStripeChange = (index: number, checked: boolean) => {
    const updated = [...editedPaymentMethods];
    updated[index] = { ...updated[index], isStripeMethod: checked };
    setEditedPaymentMethods(updated);
    setHasPaymentChanges(true);
  };

  const handleTwinfieldChange = (index: number, value: string) => {
    const updated = [...editedCategories];
    updated[index] = { ...updated[index], twinfieldAccount: value };
    setEditedCategories(updated);
    setHasChanges(true);
  };

  const handleBtwChange = (index: number, value: string) => {
    const updated = [...editedCategories];
    const numValue = parseFloat(value) / 100;
    if (!isNaN(numValue) && numValue >= 0 && numValue <= 1) {
      updated[index] = { ...updated[index], btwRate: numValue };
      setEditedCategories(updated);
      setHasChanges(true);
    }
  };

  const handleKeywordsChange = (index: number, value: string) => {
    const updated = [...editedCategories];
    updated[index] = { ...updated[index], keywords: value.split(",").map(k => k.trim()).filter(k => k) };
    setEditedCategories(updated);
    setHasChanges(true);
  };

  const yogaCategories = editedCategories.filter(c => c.group === "yoga");
  const horecaCategories = editedCategories.filter(c => c.group === "horeca");

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Laden...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <img src={dnysLogo} alt="DNYS Logo" className="h-10 w-10" />
          <div className="h-8 w-px bg-border" />
          <h1 className="text-xl font-semibold">Instellingen</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex items-center justify-between mb-6">
          <Button
            variant="ghost"
            onClick={() => navigate("/")}
            className="gap-2"
            data-testid="btn-back"
          >
            <ArrowLeft className="w-4 h-4" />
            Terug
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.isPending}
              className="gap-2"
              data-testid="btn-reset"
            >
              <RotateCcw className="w-4 h-4" />
              Standaardwaarden
            </Button>
            <Button
              onClick={() => saveMutation.mutate(editedCategories)}
              disabled={!hasChanges || saveMutation.isPending}
              className="gap-2"
              data-testid="btn-save"
            >
              <Save className="w-4 h-4" />
              Opslaan
            </Button>
          </div>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileCode className="w-5 h-5 text-muted-foreground" />
                <CardTitle>Twinfield Export Instellingen</CardTitle>
              </div>
              <Button
                onClick={() => saveGeneralMutation.mutate(editedGeneral)}
                disabled={!hasGeneralChanges || saveGeneralMutation.isPending}
                size="sm"
                className="gap-2"
                data-testid="btn-save-general"
              >
                <Save className="w-4 h-4" />
                Opslaan
              </Button>
            </div>
            <CardDescription>
              Configuratie voor de Twinfield XML export. Pas grootboekrekeningen aan zodat ze
              overeenkomen met de inrichting in Twinfield.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Twinfield kantoorcode</label>
                <Input
                  value={editedGeneral.office}
                  onChange={e => handleGeneralChange("office", e.target.value)}
                  className="font-mono"
                  placeholder="bijv. DNYS"
                  data-testid="input-general-office"
                />
                <p className="text-xs text-muted-foreground">De &lt;office&gt; code in Twinfield (verplicht voor import)</p>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Dagboekcode</label>
                <Input
                  value={editedGeneral.journalCode}
                  onChange={e => handleGeneralChange("journalCode", e.target.value)}
                  className="font-mono"
                  placeholder="bijv. MEMO"
                  data-testid="input-general-journal"
                />
                <p className="text-xs text-muted-foreground">Twinfield transactietype voor memoriaalboekingen</p>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Tussenrekening accruals</label>
                <Input
                  value={editedGeneral.accrualCrossAccount}
                  onChange={e => handleGeneralChange("accrualCrossAccount", e.target.value)}
                  className="font-mono"
                  placeholder="1809"
                  data-testid="input-general-accrual"
                />
                <p className="text-xs text-muted-foreground">Uitgestelde omzet voor Opleidingen en Jaarabonnementen</p>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Stripe kosten rekening</label>
                <Input
                  value={editedGeneral.stripeFeeAccount}
                  onChange={e => handleGeneralChange("stripeFeeAccount", e.target.value)}
                  className="font-mono"
                  placeholder="4900"
                  data-testid="input-general-stripe-fee"
                />
                <p className="text-xs text-muted-foreground">Bankkosten / PSP-kosten voor Stripe transactiekosten</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-muted-foreground" />
              <CardTitle>Twinfield Categorieën</CardTitle>
            </div>
            <CardDescription>
              Pas de Twinfield grootboekrekeningen, BTW tarieven en zoekwoorden aan per categorie.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-8">
              <CategorySection 
                title="Yoga & Studio" 
                categories={yogaCategories}
                allCategories={editedCategories}
                onTwinfieldChange={handleTwinfieldChange}
                onBtwChange={handleBtwChange}
                onKeywordsChange={handleKeywordsChange}
              />
              <CategorySection 
                title="Horeca / Café" 
                categories={horecaCategories}
                allCategories={editedCategories}
                onTwinfieldChange={handleTwinfieldChange}
                onBtwChange={handleBtwChange}
                onKeywordsChange={handleKeywordsChange}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Overig Categorie</CardTitle>
            <CardDescription>
              Items die niet bij een andere categorie passen worden automatisch in "Overig" geplaatst 
              met 9% BTW en Twinfield code 8999.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-muted-foreground" />
                <CardTitle>Betaalmethoden</CardTitle>
              </div>
              <Button
                onClick={() => savePaymentMethodsMutation.mutate(editedPaymentMethods)}
                disabled={!hasPaymentChanges || savePaymentMethodsMutation.isPending}
                size="sm"
                className="gap-2"
                data-testid="btn-save-payments"
              >
                <Save className="w-4 h-4" />
                Opslaan
              </Button>
            </div>
            <CardDescription>
              Twinfield grootboekrekeningen voor betaalmethoden (voor XML export).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[180px]">Betaalmethode</TableHead>
                    <TableHead className="w-24">Twinfield</TableHead>
                    <TableHead className="w-32">Via Stripe</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {editedPaymentMethods.map((method, index) => (
                    <TableRow key={method.methodName} data-testid={`row-payment-${method.methodName}`}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {method.methodName}
                          {method.isStripeMethod && (
                            <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                              Stripe
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Input
                          value={method.twinfieldAccount}
                          onChange={(e) => handlePaymentMethodTwinfieldChange(index, e.target.value)}
                          className="w-20 font-mono text-sm"
                          placeholder="----"
                          data-testid={`input-payment-twinfield-${method.methodName}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Checkbox
                          checked={method.isStripeMethod}
                          onCheckedChange={(checked) => handlePaymentMethodStripeChange(index, checked === true)}
                          data-testid={`checkbox-stripe-${method.methodName}`}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

interface CategorySectionProps {
  title: string;
  categories: CategoryConfig[];
  allCategories: CategoryConfig[];
  onTwinfieldChange: (index: number, value: string) => void;
  onBtwChange: (index: number, value: string) => void;
  onKeywordsChange: (index: number, value: string) => void;
}

function CategorySection({ 
  title, 
  categories, 
  allCategories,
  onTwinfieldChange, 
  onBtwChange, 
  onKeywordsChange 
}: CategorySectionProps) {
  return (
    <div>
      <h3 className="font-semibold text-sm mb-3 text-muted-foreground uppercase tracking-wide">{title}</h3>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[150px]">Categorie</TableHead>
              <TableHead className="w-24">Twinfield</TableHead>
              <TableHead className="w-20">BTW %</TableHead>
              <TableHead className="min-w-[300px]">Zoekwoorden</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((cat) => {
              const globalIndex = allCategories.findIndex(c => c.name === cat.name);
              return (
                <TableRow key={cat.name} data-testid={`row-setting-${cat.name}`}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {cat.name}
                      <Badge variant="outline" className="text-xs">
                        {cat.btwRate === 0 ? "0%" : cat.btwRate === 0.21 ? "21%" : "9%"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Input
                      value={cat.twinfieldAccount}
                      onChange={(e) => onTwinfieldChange(globalIndex, e.target.value)}
                      className="w-20 font-mono text-sm"
                      data-testid={`input-twinfield-${cat.name}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={(cat.btwRate * 100).toFixed(0)}
                      onChange={(e) => onBtwChange(globalIndex, e.target.value)}
                      className="w-16 font-mono text-sm"
                      min="0"
                      max="100"
                      data-testid={`input-btw-${cat.name}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={cat.keywords.join(", ")}
                      onChange={(e) => onKeywordsChange(globalIndex, e.target.value)}
                      className="text-sm"
                      placeholder="zoekwoord1, zoekwoord2, ..."
                      data-testid={`input-keywords-${cat.name}`}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
