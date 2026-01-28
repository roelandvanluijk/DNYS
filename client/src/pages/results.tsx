import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Download, 
  ArrowLeft, 
  Check, 
  AlertTriangle, 
  X,
  TrendingUp,
  CreditCard,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Users
} from "lucide-react";
import type { ReconciliationResult, CustomerComparison, PaymentMethodSummary, CategoryWithDetails } from "@shared/schema";
import dnysLogo from "@/assets/dnys-logo.svg";

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

interface RevenueCategoryTableProps {
  categories: CategoryWithDetails[];
  title: string;
}

function RevenueCategoryTable({ categories, title }: RevenueCategoryTableProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(new Set());

  if (categories.length === 0) return null;

  const total = categories.reduce((sum, c) => sum + (c.totalAmount ?? 0), 0);
  const totalTax = categories.reduce((sum, c) => sum + ((c.totalAmount ?? 0) * (c.btwRate ?? 0.09)), 0);

  const toggleCategory = (id: number) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="mb-6">
      <h3 className="font-semibold text-sm mb-3 text-muted-foreground uppercase tracking-wide">{title}</h3>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead className="min-w-[180px]">Categorie</TableHead>
              <TableHead className="text-right w-20">Aantal</TableHead>
              <TableHead className="text-right w-28">Bedrag</TableHead>
              <TableHead className="text-right w-20">%</TableHead>
              <TableHead className="text-right w-16">BTW</TableHead>
              <TableHead className="text-right w-28">BTW Bedrag</TableHead>
              <TableHead className="text-right w-20">Twinfield</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((cat) => {
              const btwAmount = (cat.totalAmount ?? 0) * (cat.btwRate ?? 0.09);
              const isExpanded = expandedCategories.has(cat.id);
              const hasItems = cat.items && cat.items.length > 0;
              return (
                <>
                  <TableRow 
                    key={cat.id} 
                    data-testid={`row-category-${cat.id}`}
                    className={hasItems ? "cursor-pointer hover:bg-muted/50" : ""}
                    onClick={() => hasItems && toggleCategory(cat.id)}
                  >
                    <TableCell className="w-8 py-2">
                      {hasItems && (
                        <button
                          type="button"
                          className="p-1 hover:bg-muted rounded"
                          data-testid={`btn-expand-category-${cat.id}`}
                        >
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          )}
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{cat.category}</TableCell>
                    <TableCell className="text-right">{cat.transactionCount}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatCurrency(cat.totalAmount)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatPercentage(cat.percentage)}</TableCell>
                    <TableCell className="text-right">{((cat.btwRate ?? 0.09) * 100).toFixed(0)}%</TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatCurrency(btwAmount)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{cat.twinfieldAccount || '8999'}</TableCell>
                  </TableRow>
                  {isExpanded && hasItems && (
                    <TableRow key={`${cat.id}-details`} className="bg-muted/30">
                      <TableCell colSpan={8} className="py-0">
                        <div className="py-3 px-4 ml-6">
                          <div className="text-xs text-muted-foreground mb-2 font-medium">Opbouw van {cat.category}:</div>
                          <div className="max-h-48 overflow-y-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-xs text-muted-foreground border-b">
                                  <th className="text-left py-1 font-medium">Product</th>
                                  <th className="text-right py-1 font-medium w-16">Aantal</th>
                                  <th className="text-right py-1 font-medium w-24">Bedrag</th>
                                </tr>
                              </thead>
                              <tbody>
                                {cat.items?.map((item, idx) => (
                                  <tr key={idx} className="border-b border-muted/50 last:border-0">
                                    <td className="py-1.5 truncate max-w-[300px]" title={item.item}>{item.item}</td>
                                    <td className="text-right py-1.5 text-muted-foreground">{item.count}</td>
                                    <td className="text-right py-1.5 font-mono">{formatCurrency(item.amount)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              );
            })}
            <TableRow className="bg-muted/50 font-semibold">
              <TableCell></TableCell>
              <TableCell>Subtotaal</TableCell>
              <TableCell className="text-right"></TableCell>
              <TableCell className="text-right font-mono">{formatCurrency(total)}</TableCell>
              <TableCell className="text-right"></TableCell>
              <TableCell className="text-right"></TableCell>
              <TableCell className="text-right font-mono">{formatCurrency(totalTax)}</TableCell>
              <TableCell className="text-right"></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

type ColumnKey = "email" | "items" | "date" | "count" | "momence" | "stripe" | "difference" | "status";

interface ColumnConfig {
  key: ColumnKey;
  label: string;
  defaultVisible: boolean;
}

const CUSTOMER_COLUMNS: ColumnConfig[] = [
  { key: "email", label: "Email", defaultVisible: true },
  { key: "items", label: "Producten", defaultVisible: false },
  { key: "date", label: "Datum", defaultVisible: false },
  { key: "count", label: "Aantal", defaultVisible: false },
  { key: "momence", label: "Momence", defaultVisible: true },
  { key: "stripe", label: "Stripe", defaultVisible: true },
  { key: "difference", label: "Verschil", defaultVisible: true },
  { key: "status", label: "Status", defaultVisible: true },
];

function CustomerTable({ 
  comparisons, 
  filter,
  visibleColumns,
}: { 
  comparisons: CustomerComparison[]; 
  filter: "all" | "matched" | "differences";
  visibleColumns: Set<ColumnKey>;
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
            {visibleColumns.has("email") && <TableHead className="min-w-[200px]">Klant Email</TableHead>}
            {visibleColumns.has("items") && <TableHead className="min-w-[200px]">Producten</TableHead>}
            {visibleColumns.has("date") && <TableHead className="min-w-[120px]">Datum</TableHead>}
            {visibleColumns.has("count") && <TableHead className="text-right">Aantal</TableHead>}
            {visibleColumns.has("momence") && <TableHead className="text-right">Momence</TableHead>}
            {visibleColumns.has("stripe") && <TableHead className="text-right">Stripe</TableHead>}
            {visibleColumns.has("difference") && <TableHead className="text-right">Verschil</TableHead>}
            {visibleColumns.has("status") && <TableHead className="text-right">Status</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((comparison) => (
            <TableRow key={comparison.id} data-testid={`row-customer-${comparison.id}`}>
              {visibleColumns.has("email") && (
                <TableCell className="font-medium truncate max-w-[200px]">
                  {comparison.customerEmail || "—"}
                </TableCell>
              )}
              {visibleColumns.has("items") && (
                <TableCell className="text-sm truncate max-w-[200px]" title={comparison.items || ""}>
                  {comparison.items || "—"}
                </TableCell>
              )}
              {visibleColumns.has("date") && (
                <TableCell className="text-sm">
                  {comparison.transactionDate || "—"}
                </TableCell>
              )}
              {visibleColumns.has("count") && (
                <TableCell className="text-right text-sm">
                  {comparison.transactionCount || 0}
                </TableCell>
              )}
              {visibleColumns.has("momence") && (
                <TableCell className="text-right font-mono text-sm">
                  {formatCurrency(comparison.momenceTotal)}
                </TableCell>
              )}
              {visibleColumns.has("stripe") && (
                <TableCell className="text-right font-mono text-sm">
                  {formatCurrency(comparison.stripeAmount)}
                </TableCell>
              )}
              {visibleColumns.has("difference") && (
                <TableCell className={`text-right font-mono text-sm ${
                  (comparison.difference ?? 0) > 0 ? "text-chart-2" : 
                  (comparison.difference ?? 0) < 0 ? "text-destructive" : ""
                }`}>
                  {formatCurrency(comparison.difference)}
                </TableCell>
              )}
              {visibleColumns.has("status") && (
                <TableCell className="text-right">
                  {getStatusBadge(comparison.matchStatus || "unknown")}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function PaymentMethodTable({ methods }: { methods: PaymentMethodSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[180px]">Betaalmethode</TableHead>
            <TableHead className="text-right w-20">Aantal</TableHead>
            <TableHead className="text-right w-28">Bedrag</TableHead>
            <TableHead className="text-right w-20">%</TableHead>
            <TableHead className="text-right w-24">Via Stripe</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {methods.map((method) => (
            <TableRow key={method.id} data-testid={`row-method-${method.id}`}>
              <TableCell className="font-medium">{method.paymentMethod}</TableCell>
              <TableCell className="text-right">{method.transactionCount}</TableCell>
              <TableCell className="text-right font-mono text-sm">{formatCurrency(method.totalAmount)}</TableCell>
              <TableCell className="text-right text-muted-foreground">{formatPercentage(method.percentage)}</TableCell>
              <TableCell className="text-right">
                {method.goesThruStripe ? (
                  <Check className="w-4 h-4 text-chart-2 inline" />
                ) : (
                  <X className="w-4 h-4 text-muted-foreground inline" />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
  const [showPaymentMethods, setShowPaymentMethods] = useState(false);
  const [showCustomers, setShowCustomers] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(() => {
    const initial = new Set<ColumnKey>();
    CUSTOMER_COLUMNS.forEach(col => {
      if (col.defaultVisible) initial.add(col.key);
    });
    return initial;
  });

  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

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
              Deze sessie kon niet worden geladen.
            </p>
            <Button onClick={() => navigate("/")} data-testid="button-back-home">
              Terug naar home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const yogaCatOrder = ['Opleidingen', 'Jaarabonnementen', 'Online/Livestream', 'Gift Cards', 'Money Credits', 'Workshops & Events', 'Abonnementen', 'Rittenkaarten', 'Single Classes', 'Overig'];
  const yogaCategories = data?.categories
    .filter(c => {
      const yogaCats = ['Opleidingen', 'Jaarabonnementen', 'Online/Livestream', 'Gift Cards', 'Money Credits', 'Gift Cards & Credits', 'Workshops & Events', 'Abonnementen', 'Rittenkaarten', 'Single Classes', 'Overig'];
      return yogaCats.includes(c.category);
    })
    .sort((a, b) => {
      const aIndex = yogaCatOrder.indexOf(a.category);
      const bIndex = yogaCatOrder.indexOf(b.category);
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    }) || [];

  const horecaCategories = data?.categories.filter(c => {
    const horecaCats = ['Omzet Keuken', 'Omzet Drank Laag', 'Omzet Drank Hoog'];
    return horecaCats.includes(c.category);
  }) || [];

  const totalRevenue = data?.categories.reduce((sum, c) => sum + (c.totalAmount ?? 0), 0) ?? 0;
  const totalBtw9 = data?.categories
    .filter(c => (c.btwRate ?? 0.09) === 0.09)
    .reduce((sum, c) => sum + (c.totalAmount ?? 0) * 0.09, 0) ?? 0;
  const totalBtw21 = data?.categories
    .filter(c => (c.btwRate ?? 0) === 0.21)
    .reduce((sum, c) => sum + (c.totalAmount ?? 0) * 0.21, 0) ?? 0;
  const totalBtw0 = data?.categories
    .filter(c => (c.btwRate ?? 0) === 0)
    .reduce((sum, c) => sum + (c.totalAmount ?? 0) * 0, 0) ?? 0;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white sticky top-0 z-10">
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
            <div className="flex items-center gap-4">
              <img 
                src={dnysLogo} 
                alt="De Nieuwe Yogaschool" 
                className="h-10"
              />
              <div className="border-l border-border pl-4">
                <h1 className="font-semibold" style={{ color: '#8B7355' }}>Resultaten</h1>
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
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-xl" style={{ color: '#8B7355' }}>Omzet Categorieën</CardTitle>
              </CardHeader>
              <CardContent>
                <RevenueCategoryTable 
                  categories={yogaCategories} 
                  title="Yoga & Studio Services" 
                />
                <RevenueCategoryTable 
                  categories={horecaCategories} 
                  title="Horeca / Café" 
                />

                <div className="border-t pt-4 mt-4">
                  <div className="flex justify-between items-center py-2 font-semibold text-lg">
                    <span>Totaal Omzet</span>
                    <span className="font-mono">{formatCurrency(totalRevenue)}</span>
                  </div>
                </div>

                <div className="mt-6 p-4 bg-muted/50 rounded-lg">
                  <h4 className="font-semibold mb-3">BTW Samenvatting</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">9% BTW</p>
                      <p className="font-mono font-medium">{formatCurrency(totalBtw9)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">21% BTW</p>
                      <p className="font-mono font-medium">{formatCurrency(totalBtw21)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">0% BTW</p>
                      <p className="font-mono font-medium">{formatCurrency(totalBtw0)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Totaal BTW</p>
                      <p className="font-mono font-semibold">{formatCurrency(totalBtw9 + totalBtw21 + totalBtw0)}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-xl" style={{ color: '#8B7355' }}>Stripe Controle</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="p-4 bg-muted/30 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Momence Totaal</p>
                    <p className="text-xl font-mono font-semibold">{formatCurrency(data.session.momenceTotal)}</p>
                  </div>
                  <div className="p-4 bg-muted/30 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Stripe Gross</p>
                    <p className="text-xl font-mono font-semibold">{formatCurrency(data.session.stripeTotal)}</p>
                  </div>
                  <div className="p-4 bg-muted/30 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Verschil</p>
                    <p className={`text-xl font-mono font-semibold ${
                      Math.abs((data.session.momenceTotal ?? 0) - (data.session.stripeTotal ?? 0)) < 10 
                        ? "text-chart-2" 
                        : "text-destructive"
                    }`}>
                      {formatCurrency((data.session.momenceTotal ?? 0) - (data.session.stripeTotal ?? 0))}
                    </p>
                  </div>
                  <div className="p-4 bg-muted/30 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Status</p>
                    <p className="text-xl font-semibold">
                      {Math.abs((data.session.momenceTotal ?? 0) - (data.session.stripeTotal ?? 0)) < 10 ? (
                        <span className="text-chart-2 flex items-center gap-1">
                          <Check className="w-5 h-5" /> Match
                        </span>
                      ) : (
                        <span className="text-destructive flex items-center gap-1">
                          <AlertTriangle className="w-5 h-5" /> Verschil
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Stripe Fees</p>
                    <p className="font-mono">{formatCurrency(data.session.stripeFees)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Stripe Net (ontvangen)</p>
                    <p className="font-mono font-semibold">{formatCurrency(data.session.stripeNet)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Klanten Gematcht</p>
                    <p className="font-semibold text-chart-2">{data.session.matchedCount}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Klanten met Verschillen</p>
                    <p className="font-semibold text-chart-3">{data.session.unmatchedCount}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <button
                  onClick={() => setShowPaymentMethods(!showPaymentMethods)}
                  className="flex items-center justify-between w-full text-left"
                  data-testid="toggle-payment-methods"
                >
                  <CardTitle className="text-lg">Betaalmethode Overzicht</CardTitle>
                  {showPaymentMethods ? (
                    <ChevronUp className="w-5 h-5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-muted-foreground" />
                  )}
                </button>
              </CardHeader>
              {showPaymentMethods && (
                <CardContent className="pt-4">
                  <PaymentMethodTable methods={data.paymentMethods} />
                </CardContent>
              )}
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <button
                  onClick={() => setShowCustomers(!showCustomers)}
                  className="flex items-center justify-between w-full text-left"
                  data-testid="toggle-customers"
                >
                  <CardTitle className="text-lg">Klant Vergelijking</CardTitle>
                  {showCustomers ? (
                    <ChevronUp className="w-5 h-5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-muted-foreground" />
                  )}
                </button>
              </CardHeader>
              {showCustomers && (
                <CardContent className="pt-4">
                  <div className="mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
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
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-muted-foreground mr-1">Kolommen:</span>
                      {CUSTOMER_COLUMNS.map(col => (
                        <label
                          key={col.key}
                          className="flex items-center gap-1.5 text-sm cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={visibleColumns.has(col.key)}
                            onChange={() => toggleColumn(col.key)}
                            className="rounded border-border"
                            data-testid={`checkbox-column-${col.key}`}
                          />
                          <span>{col.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <CustomerTable comparisons={data.comparisons} filter={filter} visibleColumns={visibleColumns} />
                </CardContent>
              )}
            </Card>
          </div>
        ) : null}
      </main>

      <footer className="border-t py-4 text-center text-sm text-muted-foreground">
        <p>De Nieuwe Yogaschool — Reconciliatie Tool</p>
      </footer>
    </div>
  );
}
