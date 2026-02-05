# DNYS Reconciliatie Tool

## Overview
A comprehensive revenue management tool for De Nieuwe Yogaschool (Amsterdam yoga studio) with:

**PRIMARY FEATURES:**
1. **Automatic revenue categorization** into 12 accounting categories
2. **Product database with memory** - remembers all products and their settings
3. **New product detection** with user review workflow
4. **Accrual management** for Opleidingen (training programs)
5. **Revenue spreading** for Jaarabonnementen (yearly memberships)
6. **Stripe reconciliation** with detailed transaction drill-down

**SECONDARY:** Verify Stripe payments match Momence totals

## What the Tool Does
1. User uploads 2 CSV files: Momence export and Stripe export
2. Tool checks for new products not in the database
3. If new products found, user reviews and confirms categorization
4. Products are saved to PostgreSQL database for future recognition
5. Categorizes revenue by item type into 12 categories with BTW and Twinfield codes
6. Applies accrual/spread logic for Opleidingen and Jaarabonnementen
7. Compares totals between systems (aggregated by customer email)
8. Identifies matches and discrepancies
9. Generates Excel report with 5 sheets including BTW summary

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

### Revenue Categories (12 total, priority order)

| # | Category | BTW | Twinfield | Special Handling |
|---|----------|-----|-----------|------------------|
| 1 | **Online/Livestream** | 21% | 8200 | Priority rule (overrides others) |
| 2 | **Opleidingen** | 21% | 8300 | Accrual over multiple months |
| 3 | **Jaarabonnementen** | 9% | 8101 | Spread over 12 months |
| 4 | **Gift Cards** | 0% | 8900 | Separate from credits |
| 5 | **Money Credits** | 0% | 8901 | Separate from cards |
| 6 | **Workshops & Events** | 9% | 8150 | Regular |
| 7 | **Abonnementen** | 9% | 8100 | Monthly memberships |
| 8 | **Rittenkaarten** | 9% | 8110 | Class cards |
| 9 | **Omzet Keuken** | 9% | 8001 | Food items |
| 10 | **Omzet Drank Laag** | 9% | 8002 | Non-alcoholic drinks |
| 11 | **Omzet Drank Hoog** | 21% | 8003 | Alcoholic drinks |
| 12 | **Single Classes** | 9% | 8120 | Drop-in yoga classes |
| 13 | **Overig** | 9% | 8999 | Catch-all |

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

**January 2026: Product Database & Advanced Features**
- Added PostgreSQL database for product_settings table (product memory)
- Updated to 12 revenue categories (split Gift Cards and Money Credits)
- New product detection workflow - alerts user to new products before processing
- Review Products page (/review-products) for confirming new product categorization
- Product Management page (/products) for viewing/editing all stored products
- Accrual support for Opleidingen with date-based calculation (startDate, endDate)
- Revenue spreading for Jaarabonnementen with date-based calculation
- Products remembered for future reconciliations - automatic recognition

**January 2026: Date-Based Accrual System**
- Changed accrual system from months to dates (accrualStartDate, accrualEndDate)
- Changed spread system from months to dates (spreadStartDate, spreadEndDate)
- Opleidingen category now displayed FIRST in results, followed by other categories
- Category order in results: Opleidingen, Jaarabonnementen, Online/Livestream, then others
- Date inputs in review-products and products pages for configuring accrual periods

**February 2026: Code Refactoring & Accrual Implementation**
- Removed dead code (tempSessions Map replaced by database-backed pending_reconciliations)
- Extracted shared processReconciliation() function to eliminate code duplication
- Revenue categorization now applies to ALL transactions, not just Stripe payments
- Added accrual_schedule database table to track revenue spreading
- Accrual/spread entries generated during reconciliation with date-based or month-based calculation
- Added /api/sessions/:sessionId/accruals endpoint for accrual data
- Excel export now includes "Accrual Schema" sheet showing monthly revenue distribution
- Added missing category keywords: Tai Chi (Single Classes), kidsyoga/mentorship (Opleidingen)
- Gift card code detection now case-insensitive
- Persistent pending reconciliations survive server restarts
- Two save options on review page: "Alleen Opslaan" vs "Opslaan & Doorgaan"
- Clear all products feature for testing/reset
