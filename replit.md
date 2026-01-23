# DNYS Reconciliatie Tool

## Overview
A web application for reconciling Momence (yoga booking system) payments with Stripe payment data for De Nieuwe Yogaschool (Amsterdam yoga studio).

## What the Tool Does
1. User uploads 2 CSV files: Momence export and Stripe export
2. Tool aggregates transactions by customer email
3. Compares totals between systems
4. Identifies matches and discrepancies
5. Generates Excel report with results

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
      results.tsx       # Results display with summary cards and tables
      sessions.tsx      # Previous reconciliation sessions list
    components/ui/      # Shadcn UI components
    App.tsx            # Main app with routing

server/
  routes.ts           # API endpoints for reconciliation
  storage.ts          # In-memory storage for sessions

shared/
  schema.ts           # Data models and TypeScript types
```

## Business Logic

### Payment Methods that go through Stripe:
- Card, iDEAL, SEPA Direct Debit, Card reader

### Payment Methods that DON'T go through Stripe:
- Class Pass, urban-sports-club, Gift card

### Reconciliation Method:
**Aggregate by customer email, NOT line-by-line matching**

1. **Momence side:**
   - Filter only Stripe payment methods
   - Group by "Customer email"
   - Sum "Sale value" per customer

2. **Stripe side:**
   - Filter only Status = "Paid"
   - Convert Fee from cents to euros (divide by 100)
   - Calculate Net = Amount - Fee
   - Group by "Customer Email"
   - Sum Amount and Fee per customer

3. **Comparison:**
   - Match customers by email
   - Calculate difference = Momence total - Stripe amount
   - Categorize:
     - "match" if difference < €1
     - "small_diff" if difference €1-5
     - "large_diff" if difference > €5
     - "only_in_momence" if customer not in Stripe
     - "only_in_stripe" if customer not in Momence

## API Endpoints
- `POST /api/reconcile` - Upload CSVs and process reconciliation
- `GET /api/sessions` - List all reconciliation sessions
- `GET /api/sessions/:id` - Get full results for a session
- `GET /api/sessions/:id/download` - Download Excel report

## Design System
Based on De Nieuwe Yogaschool branding:
- Primary beige backgrounds
- Warm brown text
- Terracotta accent colors
- Success green for matches
- Warning orange for small differences
- Clean, minimalist with warm earth tones

## Recent Changes
- Initial implementation: January 2026
- Upload page with drag-drop file zones
- Results page with summary cards and customer comparison table
- Sessions history page
- Excel report generation with 4 sheets
