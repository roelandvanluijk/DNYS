import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { ArrowLeft, Package, Trash2, Edit2, Check, X, Loader2, Search } from "lucide-react";
import dnysLogo from "@/assets/dnys-logo.svg";
import type { ProductSettings } from "@shared/schema";

const CATEGORIES = [
  { name: "Online/Livestream", btwRate: 0.09, twinfield: "8200" },
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

export default function ProductsPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<ProductSettings>>({});

  const { data: products = [], isLoading } = useQuery<ProductSettings[]>({
    queryKey: ["/api/products"],
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: Partial<ProductSettings> }) => {
      return await apiRequest("PUT", `/api/products/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setEditingId(null);
      toast({
        title: "Product bijgewerkt",
        description: "De wijzigingen zijn opgeslagen.",
      });
    },
    onError: () => {
      toast({
        title: "Fout",
        description: "Kon product niet bijwerken.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/products/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({
        title: "Product verwijderd",
        description: "Het product is verwijderd uit de database.",
      });
    },
    onError: () => {
      toast({
        title: "Fout",
        description: "Kon product niet verwijderen.",
        variant: "destructive",
      });
    },
  });

  const filteredProducts = products.filter(p =>
    p.itemName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const startEdit = (product: ProductSettings) => {
    setEditingId(product.id);
    setEditForm({
      category: product.category,
      btwRate: product.btwRate,
      twinfieldAccount: product.twinfieldAccount,
      hasAccrual: product.hasAccrual,
      accrualMonths: product.accrualMonths,
      hasSpread: product.hasSpread,
      spreadMonths: product.spreadMonths,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const saveEdit = (id: number) => {
    updateMutation.mutate({ id, updates: editForm });
  };

  const handleCategoryChange = (categoryName: string) => {
    const categoryConfig = CATEGORIES.find(c => c.name === categoryName);
    if (categoryConfig) {
      setEditForm(prev => ({
        ...prev,
        category: categoryName,
        btwRate: categoryConfig.btwRate,
        twinfieldAccount: categoryConfig.twinfield,
        hasAccrual: categoryName === "Opleidingen" ? prev.hasAccrual : false,
        hasSpread: categoryName === "Jaarabonnementen" ? prev.hasSpread : false,
      }));
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
                Product Database
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
        <div className="max-w-5xl mx-auto">
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg">Bekende Producten</CardTitle>
              <CardDescription>
                Alle producten die ooit zijn verwerkt en hun categorisatie-instellingen.
                {products.length > 0 && ` (${products.length} producten)`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Zoek op productnaam of categorie..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                  data-testid="input-search"
                />
              </div>
            </CardContent>
          </Card>

          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredProducts.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Package className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  {searchTerm ? "Geen producten gevonden" : "Nog geen producten in de database"}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredProducts.map((product) => (
                <Card key={product.id} className="shadow-sm">
                  <CardContent className="py-4">
                    {editingId === product.id ? (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="font-medium">{product.itemName}</h3>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={cancelEdit}
                              disabled={updateMutation.isPending}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => saveEdit(product.id)}
                              disabled={updateMutation.isPending}
                            >
                              {updateMutation.isPending ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Check className="w-4 h-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <Label className="text-sm">Categorie</Label>
                            <Select
                              value={editForm.category || ""}
                              onValueChange={handleCategoryChange}
                            >
                              <SelectTrigger className="mt-1.5">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {CATEGORIES.map((cat) => (
                                  <SelectItem key={cat.name} value={cat.name}>
                                    {cat.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-sm">BTW Tarief</Label>
                            <Input
                              value={`${Math.round((editForm.btwRate || 0) * 100)}%`}
                              disabled
                              className="mt-1.5 bg-muted"
                            />
                          </div>
                          <div>
                            <Label className="text-sm">Twinfield Code</Label>
                            <Input
                              value={editForm.twinfieldAccount || ""}
                              onChange={(e) => setEditForm(prev => ({ ...prev, twinfieldAccount: e.target.value }))}
                              className="mt-1.5"
                            />
                          </div>
                        </div>

                        {editForm.category === "Opleidingen" && (
                          <div className="p-3 rounded bg-accent/30 space-y-2">
                            <div className="flex items-center gap-2">
                              <Checkbox
                                checked={editForm.hasAccrual || false}
                                onCheckedChange={(checked) => setEditForm(prev => ({ ...prev, hasAccrual: checked === true }))}
                              />
                              <Label className="text-sm">Accrual inschakelen</Label>
                            </div>
                            {editForm.hasAccrual && (
                              <div className="ml-6">
                                <Label className="text-sm">Aantal maanden</Label>
                                <Input
                                  type="number"
                                  min={1}
                                  max={36}
                                  value={editForm.accrualMonths || 14}
                                  onChange={(e) => setEditForm(prev => ({ ...prev, accrualMonths: parseInt(e.target.value) || 14 }))}
                                  className="mt-1 w-24"
                                />
                              </div>
                            )}
                          </div>
                        )}

                        {editForm.category === "Jaarabonnementen" && (
                          <div className="p-3 rounded bg-accent/30">
                            <div className="flex items-center gap-2">
                              <Checkbox
                                checked={editForm.hasSpread || false}
                                onCheckedChange={(checked) => setEditForm(prev => ({ ...prev, hasSpread: checked === true }))}
                              />
                              <Label className="text-sm">Spreid over 12 maanden</Label>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-medium truncate">{product.itemName}</h3>
                            <Badge variant="secondary" className="shrink-0">
                              {product.category}
                            </Badge>
                            <span className="text-sm text-muted-foreground shrink-0">
                              {Math.round(product.btwRate * 100)}% BTW
                            </span>
                            <span className="text-sm text-muted-foreground shrink-0">
                              #{product.twinfieldAccount}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                            {product.hasAccrual && (
                              <span>Accrual: {product.accrualMonths} maanden</span>
                            )}
                            {product.hasSpread && (
                              <span>Gespreid over 12 maanden</span>
                            )}
                            <span>{product.transactionCount || 0} transacties</span>
                          </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => startEdit(product)}
                            data-testid={`button-edit-${product.id}`}
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              if (confirm("Weet je zeker dat je dit product wilt verwijderen?")) {
                                deleteMutation.mutate(product.id);
                              }
                            }}
                            disabled={deleteMutation.isPending}
                            data-testid={`button-delete-${product.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
