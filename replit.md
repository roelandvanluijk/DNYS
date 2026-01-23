# DNYS Reconciliatie Tool

## Overview
A web application for reconciling Momence (yoga booking system) payments with Stripe payment data for De Nieuwe Yogaschool (Amsterdam yoga studio).

## What the Tool Does
1. User uploads 2 CSV files: Momence export and Stripe export
2. Tool aggregates transactions by customer email
3. Compares totals between systems
4. Identifies matches and discrepancies
5. Categorizes revenue by item type (memberships, class cards, workshops, etc.)
6. Generates Excel report with results

## Technical Stack
- Frontend: React with TypeScript, TanStack Query, Wouter routing
- Backend: Express.js with TypeScript
- CSV Parsing: PapaParse
- Excel Generation: ExcelJS
- Styling: Tailwind CSS with custom warm yoga-inspired design tokens

## Project Structure
```
client/
  src/
    pages/
      upload.tsx        # Main upload page with drag-drop zones
      results.tsx       # Results display with summary cards, tables, and categories
      sessions.tsx      # Previous reconciliation sessions list
    components/ui/      # Shadcn UI components
    App.tsx            # Main app with routing

server/
  routes.ts           # API endpoints for reconciliation
  storage.ts          # In-memory storage for sessions

shared/
  schema.ts           # Data models, types, and category mapping rules
```

## Business Logic

### Payment Methods that go through Stripe:
- Card, iDEAL, SEPA Direct Debit, Card reader

### Payment Methods that DON'T go through Stripe:
- Class Pass, urban-sports-club, Gift card

### Stripe CSV Column Names (IMPORTANT):
- `gross` (amount in euros)
- `fee` (already in euros, NOT cents)
- `customer_email`
- `reporting_category` (filter for 'charge')

### Momence CSV Column Names:
- "Sale value", "Customer email", "Payment method", "Item"

### Reconciliation Method:
**Aggregate by customer email, NOT line-by-line matching**

1. **Momence side:**
   - Filter only Stripe payment methods
   - Normalize email (lowercase, trim)
   - Group by "Customer email"
   - Sum "Sale value" per customer

2. **Stripe side:**
   - Filter only reporting_category = "charge" OR Status = "Paid"
   - Fees are ALREADY in euros (do NOT divide by 100)
   - Calculate Net = gross - fee
   - Normalize email (lowercase, trim)
   - Group by customer_email
   - Sum gross and fee per customer

3. **Comparison:**
   - Match customers by normalized email
   - Calculate difference = Momence total - Stripe amount
   - Categorize:
     - "match" if difference < €1
     - "small_diff" if difference €1-5
     - "large_diff" if difference > €5
     - "only_in_momence" if customer not in Stripe
     - "only_in_stripe" if customer not in Momence

### Revenue Categories:
Items paid via Stripe payment methods are automatically categorized into:
- Abonnementen (memberships, unlimited)
- Rittenkaarten (class cards, packs)
- Single Classes (drop-in, losse les)
- Workshops & Events (workshops, ceremonies, retreats)
- Trainings & Opleidingen (teacher trainings)
- Online (livestream, virtual)
- Horeca - Koffie (coffee drinks)
- Horeca - Thee & Dranken (tea, smoothies)
- Horeca - Food (snacks, brownies)
- Gift Cards (cadeaukaart, voucher)
- Money Credits (credit, tegoed)
- Overig (other/uncategorized)

## API Endpoints
- `POST /api/reconcile` - Upload CSVs and process reconciliation
- `GET /api/sessions` - List all reconciliation sessions
- `GET /api/sessions/:id` - Get full results for a session
- `GET /api/sessions/:id/download` - Download Excel report (5 sheets)

## Excel Report Sheets
1. Samenvatting (Summary)
2. Klant Vergelijking (All customer comparisons)
3. Verschillen (Differences only)
4. Betaalmethoden (Payment methods breakdown)
5. Omzet Categorieën (Revenue by category)

## Design System
Based on De Nieuwe Yogaschool branding:
- Primary beige backgrounds (#F5F1E8)
- Warm brown text (#8B7355)
- Terracotta accent colors (#D4916C)
- Success green for matches (#7FA650)
- Warning orange for small differences (#E8A87C)
- Clean, minimalist with warm earth tones

## Recent Changes
- January 2026: Initial implementation
- Fixed Stripe CSV column names (gross, fee, customer_email, reporting_category)
- Removed fee division by 100 (fees already in euros)
- Added revenue categorization by item type
- Added category summary to results page and Excel export
- Added support for both old and new Stripe export formats
