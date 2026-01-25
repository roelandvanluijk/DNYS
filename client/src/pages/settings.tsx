import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { 
  ArrowLeft, 
  Save,
  Settings,
  RotateCcw
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

export default function SettingsPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editedCategories, setEditedCategories] = useState<CategoryConfig[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  const { data: categories, isLoading } = useQuery<CategoryConfig[]>({
    queryKey: ["/api/settings/categories"],
  });

  useEffect(() => {
    if (categories) {
      setEditedCategories(categories);
    }
  }, [categories]);

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
