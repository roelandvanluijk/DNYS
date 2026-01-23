import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  FileSpreadsheet, 
  Download, 
  ArrowLeft, 
  Check, 
  AlertTriangle, 
  X,
  TrendingUp,
  CreditCard,
  Users,
  AlertCircle,
  LayoutGrid
} from "lucide-react";
import type { ReconciliationResult, CustomerComparison, PaymentMethodSummary, CategorySummary } from "@shared/schema";

function formatCurrency(value: number | null | undefined): string {
  const num = value ?? 0;
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(num);
}

function formatPercentage(value: number | null | undefined): string {
  const num = value ?? 0;
  return `${num.toFixed(1)}%`;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "match":
      return (
        <Badge variant="outline" className="bg-chart-2/10 text-chart-2 border-chart-2/30">
          <Check className="w-3 h-3 mr-1" />
          Match
        </Badge>
      );
    case "small_diff":
      return (
        <Badge variant="outline" className="bg-chart-3/10 text-chart-3 border-chart-3/30">
          <AlertTriangle className="w-3 h-3 mr-1" />
          Klein verschil
        </Badge>
      );
    case "large_diff":
      return (
        <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
          <AlertCircle className="w-3 h-3 mr-1" />
          Groot verschil
        </Badge>
      );
    case "only_in_momence":
      return (
        <Badge variant="outline" className="bg-chart-3/10 text-chart-3 border-chart-3/30">
          <AlertTriangle className="w-3 h-3 mr-1" />
          Alleen Momence
        </Badge>
      );
    case "only_in_stripe":
      return (
        <Badge variant="outline" className="bg-chart-3/10 text-chart-3 border-chart-3/30">
          <AlertTriangle className="w-3 h-3 mr-1" />
          Alleen Stripe
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function SummaryCard({ 
  title, 
  value, 
  subtitle,
  icon: Icon,
  variant = "default"
}: { 
  title: string; 
  value: string; 
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  variant?: "default" | "success" | "warning";
}) {
  const iconClasses = {
    default: "text-primary",
    success: "text-chart-2",
    warning: "text-chart-3",
  };

  return (
    <Card className="hover-elevate">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground truncate">{title}</p>
            <p className="text-xl md:text-2xl font-semibold mt-1 truncate">{value}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
            )}
          </div>
          <div className={`p-2.5 rounded-lg bg-muted shrink-0`}>
            <Icon className={`w-5 h-5 ${iconClasses[variant]}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CustomerTable({ 
  comparisons, 
  filter 
}: { 
  comparisons: CustomerComparison[]; 
  filter: "all" | "matched" | "differences";
}) {
  const filtered = comparisons.filter((c) => {
    if (filter === "all") return true;
    if (filter === "matched") return c.matchStatus === "match";
    return c.matchStatus !== "match";
  });

  if (filtered.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <Users className="w-12 h-12 mx-auto mb-3 opacity-40" />
        <p>Geen klanten gevonden voor dit filter</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[200px]">Klant Email</TableHead>
            <TableHead className="text-right">Momence</TableHead>
            <TableHead className="text-right">Stripe</TableHead>
            <TableHead className="text-right">Verschil</TableHead>
            <TableHead className="text-right">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((comparison) => (
            <TableRow key={comparison.id} data-testid={`row-customer-${comparison.id}`}>
              <TableCell className="font-medium truncate max-w-[200px]">
                {comparison.customerEmail || "—"}
              </TableCell>
              <TableCell className="text-right font-mono text-sm">
                {formatCurrency(comparison.momenceTotal)}
              </TableCell>
              <TableCell className="text-right font-mono text-sm">
                {formatCurrency(comparison.stripeAmount)}
              </TableCell>
              <TableCell className={`text-right font-mono text-sm ${
                (comparison.difference ?? 0) > 0 ? "text-chart-2" : 
                (comparison.difference ?? 0) < 0 ? "text-destructive" : ""
              }`}>
                {formatCurrency(comparison.difference)}
              </TableCell>
              <TableCell className="text-right">
                {getStatusBadge(comparison.matchStatus || "unknown")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function PaymentMethodTable({ methods }: { methods: PaymentMethodSummary[] }) {
  const maxAmount = Math.max(...methods.map((m) => m.totalAmount ?? 0), 1);

  return (
    <div className="space-y-3">
      {methods.map((method) => (
        <div key={method.id} className="flex items-center gap-4" data-testid={`row-method-${method.id}`}>
          <div className="w-32 md:w-40 shrink-0">
            <p className="font-medium text-sm truncate">{method.paymentMethod}</p>
            <p className="text-xs text-muted-foreground">{method.transactionCount} transacties</p>
          </div>
          <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${((method.totalAmount ?? 0) / maxAmount) * 100}%` }}
            />
          </div>
          <div className="w-28 text-right shrink-0">
            <p className="font-mono text-sm font-medium">{formatCurrency(method.totalAmount)}</p>
            <p className="text-xs text-muted-foreground">{formatPercentage(method.percentage)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function CategoryTable({ categories }: { categories: CategorySummary[] }) {
  const maxAmount = Math.max(...categories.map((c) => c.totalAmount ?? 0), 1);

  if (categories.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        <LayoutGrid className="w-10 h-10 mx-auto mb-2 opacity-40" />
        <p>Geen categorieën beschikbaar</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {categories.map((cat) => (
        <div key={cat.id} className="flex items-center gap-4" data-testid={`row-category-${cat.id}`}>
          <div className="w-40 md:w-48 shrink-0">
            <p className="font-medium text-sm truncate">{cat.category}</p>
            <p className="text-xs text-muted-foreground">{cat.transactionCount} transacties</p>
          </div>
          <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-chart-3 rounded-full transition-all duration-500"
              style={{ width: `${((cat.totalAmount ?? 0) / maxAmount) * 100}%` }}
            />
          </div>
          <div className="w-28 text-right shrink-0">
            <p className="font-mono text-sm font-medium">{formatCurrency(cat.totalAmount)}</p>
            <p className="text-xs text-muted-foreground">{formatPercentage(cat.percentage)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-5 pb-4">
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-8 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="pt-6">
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

export default function ResultsPage() {
  const params = useParams<{ sessionId: string }>();
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<"all" | "matched" | "differences">("all");

  const { data, isLoading, error } = useQuery<ReconciliationResult>({
    queryKey: ["/api/sessions", params.sessionId],
  });

  const handleDownload = () => {
    window.open(`/api/sessions/${params.sessionId}/download`, "_blank");
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <X className="w-12 h-12 mx-auto text-destructive mb-4" />
            <h2 className="text-lg font-semibold mb-2">Sessie niet gevonden</h2>
            <p className="text-muted-foreground mb-4">
              Deze reconciliatie sessie kon niet worden geladen.
            </p>
            <Button onClick={() => navigate("/")} data-testid="button-back-home">
              Terug naar home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => navigate("/")}
              data-testid="button-back"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <FileSpreadsheet className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="font-semibold text-lg">Reconciliatie Resultaten</h1>
                {data?.session && (
                  <p className="text-xs text-muted-foreground">Periode: {data.session.period}</p>
                )}
              </div>
            </div>
          </div>
          <Button onClick={handleDownload} disabled={isLoading} data-testid="button-download">
            <Download className="w-4 h-4 mr-2" />
            Download Excel
          </Button>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6 md:py-8">
        {isLoading ? (
          <LoadingSkeleton />
        ) : data ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <SummaryCard
                title="Momence Totaal"
                value={formatCurrency(data.session.momenceTotal)}
                subtitle="Alle Stripe betalingen"
                icon={TrendingUp}
              />
              <SummaryCard
                title="Stripe Totaal"
                value={formatCurrency(data.session.stripeTotal)}
                subtitle={`Kosten: ${formatCurrency(data.session.stripeFees)}`}
                icon={CreditCard}
              />
              <SummaryCard
                title="Gematcht"
                value={String(data.session.matchedCount ?? 0)}
                subtitle="Klanten"
                icon={Check}
                variant="success"
              />
              <SummaryCard
                title="Verschillen"
                value={String(data.session.unmatchedCount ?? 0)}
                subtitle="Klanten"
                icon={AlertTriangle}
                variant={data.session.unmatchedCount && data.session.unmatchedCount > 0 ? "warning" : "default"}
              />
            </div>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <CardTitle className="text-lg">Klant Vergelijking</CardTitle>
                  <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
                    <TabsList>
                      <TabsTrigger value="all" data-testid="tab-all">
                        Alles ({data.comparisons.length})
                      </TabsTrigger>
                      <TabsTrigger value="matched" data-testid="tab-matched">
                        Gematcht ({data.comparisons.filter(c => c.matchStatus === "match").length})
                      </TabsTrigger>
                      <TabsTrigger value="differences" data-testid="tab-differences">
                        Verschillen ({data.comparisons.filter(c => c.matchStatus !== "match").length})
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <CustomerTable comparisons={data.comparisons} filter={filter} />
              </CardContent>
            </Card>

            {data.categories && data.categories.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Omzet per Categorie</CardTitle>
                </CardHeader>
                <CardContent>
                  <CategoryTable categories={data.categories} />
                </CardContent>
              </Card>
            )}

            {data.paymentMethods.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Betaalmethode Overzicht</CardTitle>
                </CardHeader>
                <CardContent>
                  <PaymentMethodTable methods={data.paymentMethods} />
                </CardContent>
              </Card>
            )}
          </div>
        ) : null}
      </main>

      <footer className="border-t py-4 text-center text-sm text-muted-foreground">
        <p>De Nieuwe Yogaschool — Reconciliatie Tool</p>
      </footer>
    </div>
  );
}
