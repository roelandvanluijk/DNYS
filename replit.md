# DNYS Reconciliatie Tool

## Overview
A web application for reconciling Momence (yoga booking system) payments with Stripe payment data for De Nieuwe Yogaschool (Amsterdam yoga studio).

**PRIMARY GOAL (80%)**: Automatically categorize revenue into 11 accounting categories with BTW rates and Twinfield codes
**SECONDARY GOAL (20%)**: Verify Stripe payments match Momence totals

## What the Tool Does
1. User uploads 2 CSV files: Momence export and Stripe export
2. Tool aggregates transactions by customer email
3. Categorizes revenue by item type into 11 categories with BTW and Twinfield codes
4. Compares totals between systems
5. Identifies matches and discrepancies
6. Generates Excel report with 5 sheets including BTW summary

## Technical Stack
- Frontend: React with TypeScript, TanStack Query, Wouter routing
- Backend: Express.js with TypeScript
- CSV Parsing: PapaParse
- Excel Generation: ExcelJS
- Styling: Tailwind CSS with DNYS warm yoga-inspired design

## Project Structure
```
client/
  src/
    pages/
      upload.tsx        # Main upload page with drag-drop zones
      results.tsx       # Results with revenue categories PRIMARY, Stripe control SECONDARY
      sessions.tsx      # Previous reconciliation sessions list
    components/ui/      # Shadcn UI components
    App.tsx            # Main app with routing

server/
  routes.ts           # API endpoints with categorization logic
  storage.ts          # In-memory storage for sessions

shared/
  schema.ts           # Data models, types, category configs with BTW/Twinfield
```

## Design System - DNYS Branding
Logo: https://denieuweyogaschool.nl/wp-content/uploads/2024/05/DNYS_Main.svg

Colors:
- Primary beige: #F5F1E8 (light background)
- Primary brown: #8B7355 (headers, branding)
- Accent terracotta: #D4916C (buttons, highlights)
- Success green: #7FA650 (matches)
- Warning orange: #E8A87C (differences)
- Error red: #C85C5C (errors)

## Business Logic

### Payment Methods that go through Stripe:
- Card, iDEAL, SEPA Direct Debit, Card reader

### Payment Methods that DON'T go through Stripe:
- Class Pass, urban-sports-club, Gift card

### Stripe CSV Column Names:
New format: `gross`, `fee`, `customer_email`, `reporting_category`
Old format: `Amount`, `Fee`, `Customer Email`, `Status`
- Fees are ALREADY in euros (NOT cents - do NOT divide by 100)

### Momence CSV Column Names:
- "Sale value", "Customer email", "Payment method", "Item", "Tax"

### Revenue Categories (11 total, with priority order)

**Yoga & Studio Services:**
1. **Opleidingen** - 21% BTW, Twinfield 8300 (teacher training, opleiding, 200 uur)
2. **Online/Livestream** - 9% BTW, Twinfield 8200 (livestream, online)
3. **Gift Cards & Credits** - 0% BTW, Twinfield 8900 (gift card, money credit)
4. **Workshops & Events** - 9% BTW, Twinfield 8150 (workshop, ceremony, retreat)
5. **Abonnementen** - 9% BTW, Twinfield 8100 (membership, unlimited)
6. **Rittenkaarten** - 9% BTW, Twinfield 8110 (class card, rittenkaart)
7. **Single Classes** - 9% BTW, Twinfield 8120 (yoga, flow, yin, meditation)

**Horeca / Café:**
8. **Omzet Keuken** - 9% BTW, Twinfield 8001 (brownie, bananenbrood, quiche)
9. **Omzet Drank Laag** - 9% BTW, Twinfield 8002 (coffee, tea, smoothie)
10. **Omzet Drank Hoog** - 21% BTW, Twinfield 8003 (beer, wine, alcohol)
11. **Overig** - 9% BTW, Twinfield 8999 (catch-all)

### Reconciliation Method:
**Aggregate by customer email, NOT line-by-line matching**

1. **Momence side:**
   - Filter only Stripe payment methods
   - Normalize email (lowercase, trim)
   - Group by "Customer email"
   - Sum "Sale value" per customer
   - Categorize items for Stripe transactions only

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

## API Endpoints
- `POST /api/reconcile` - Upload CSVs and process reconciliation
- `GET /api/sessions` - List all reconciliation sessions
- `GET /api/sessions/:id` - Get full results for a session
- `GET /api/sessions/:id/download` - Download Excel report (5 sheets)

## Excel Report Sheets
1. **Omzet Categorieën** (PRIMARY) - Revenue by category with BTW/Twinfield
2. **Stripe Controle** - Summary comparison between systems
3. **Betaalmethoden** - Payment methods breakdown with Via Stripe indicator
4. **Verschillen** - Differences only (customers with mismatches)
5. **Alle Klanten** - Full customer comparison table

## UI Layout
- Header: DNYS logo with "Reconciliatie Tool" divider
- Results page: Categories PRIMARY (top), Stripe control SECONDARY
- Collapsible sections for Payment Methods and Customer Comparison
- BTW Summary section with 9%/21%/0% breakdown

## Recent Changes
- January 2026: Major update
- Added 11 revenue categories with BTW rates and Twinfield codes
- Implemented priority-based categorization (Opleidingen first = 21% BTW)
- Added DNYS logo to all page headers
- Redesigned results page with categories as PRIMARY feature
- Added BTW summary to results page and Excel export
- Excel export now includes separate Yoga and Horeca sections
- Added "Via Stripe" indicator to payment methods
- Added expandable dropdowns to revenue categories to show item breakdown
- Created Settings page (/settings) to customize Twinfield codes, BTW rates, and keywords
- Excluded info@denieuweyogaschool.nl from customer comparisons (studio's own email)
- Added column chooser to customer comparison table (Email, Producten, Datum, Aantal, Momence, Stripe, Verschil, Status)
