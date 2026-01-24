import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  FileSpreadsheet, 
  ArrowLeft, 
  Calendar, 
  Check, 
  AlertTriangle,
  Download,
  Eye,
  FolderOpen
} from "lucide-react";
import type { ReconciliationSession } from "@shared/schema";
import dnysLogo from "@/assets/dnys-logo.svg";

function formatDate(date: Date | string | null): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function SessionCard({ session }: { session: ReconciliationSession }) {
  const [, navigate] = useLocation();

  return (
    <Card className="hover-elevate" data-testid={`card-session-${session.id}`}>
      <CardContent className="pt-5 pb-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
              <h3 className="font-semibold text-lg">Periode: {session.period}</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              {formatDate(session.createdAt)}
            </p>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5">
                <Check className="w-4 h-4 text-chart-2" />
                <span className="text-muted-foreground">
                  <strong className="text-foreground">{session.matchedCount ?? 0}</strong> gematcht
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-chart-3" />
                <span className="text-muted-foreground">
                  <strong className="text-foreground">{session.unmatchedCount ?? 0}</strong> verschillen
                </span>
              </div>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              variant="outline"
              onClick={() => navigate(`/results/${session.id}`)}
              data-testid={`button-view-${session.id}`}
            >
              <Eye className="w-4 h-4 mr-2" />
              Bekijk
            </Button>
            <Button
              variant="ghost"
              onClick={() => window.open(`/api/sessions/${session.id}/download`, "_blank")}
              data-testid={`button-download-${session.id}`}
            >
              <Download className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {[...Array(3)].map((_, i) => (
        <Card key={i}>
          <CardContent className="pt-5 pb-4">
            <Skeleton className="h-6 w-48 mb-2" />
            <Skeleton className="h-4 w-32 mb-3" />
            <div className="flex gap-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-24" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EmptyState() {
  const [, navigate] = useLocation();

  return (
    <Card>
      <CardContent className="py-16 text-center">
        <FolderOpen className="w-16 h-16 mx-auto text-muted-foreground/40 mb-4" />
        <h3 className="text-lg font-semibold mb-2">Nog geen reconciliaties</h3>
        <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
          Start je eerste reconciliatie door Momence en Stripe CSV bestanden te uploaden.
        </p>
        <Button onClick={() => navigate("/")} data-testid="button-start-first">
          Start eerste reconciliatie
        </Button>
      </CardContent>
    </Card>
  );
}

export default function SessionsPage() {
  const [, navigate] = useLocation();

  const { data: sessions, isLoading } = useQuery<ReconciliationSession[]>({
    queryKey: ["/api/sessions"],
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center gap-3">
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
              <h1 className="font-semibold" style={{ color: '#8B7355' }}>Eerdere Sessies</h1>
              <p className="text-xs text-muted-foreground">Bekijk en download vorige sessies</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6 md:py-8 max-w-3xl">
        {isLoading ? (
          <LoadingSkeleton />
        ) : sessions && sessions.length > 0 ? (
          <div className="space-y-4">
            {sessions.map((session) => (
              <SessionCard key={session.id} session={session} />
            ))}
          </div>
        ) : (
          <EmptyState />
        )}
      </main>

      <footer className="border-t py-4 text-center text-sm text-muted-foreground">
        <p>De Nieuwe Yogaschool — Reconciliatie Tool</p>
      </footer>
    </div>
  );
}
