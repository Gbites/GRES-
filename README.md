# GRES — Restaurant Management System

**Tagline:** *Run Your Restaurant Smarter.*

GRES is a self-hosted, multi-tenant, real-time restaurant management and Point of Sale (POS) web application built with Node.js, built-in `node:sqlite`, Express, WebSockets, PDFKit, and a responsive glassmorphic frontend. Every workspace starts completely empty—ready for real restaurant operations through an interactive 8-step **Restaurant Setup** wizard and an 11-module **Customization Studio**.

---

## Key Features

- **Multi-Tenant Architecture & Auth**
  - Strict workspace isolation across restaurants (`restaurant_id`) and branches (`branch_id`), including WebSocket event scoping.
  - Scrypt-hashed password + 4–6 digit terminal PIN authentication with HMAC-signed HTTP-only session cookies.
- **8-Step First-Time Onboarding Wizard (*Restaurant Setup*)**
  - Database-persisted step progress with Back / Continue / Skip / Resume across browser sessions:
    1. Restaurant Identity (name, logo upload/URL, type, description, tagline, monogram)
    2. Location & Contact (country, state, city, address, postal code, optional GPS pin, phone, email)
    3. Business Configuration (currency, timezone, date format, weekly opening hours, holidays)
    4. Tax & Billing (GST toggle, GSTIN, CGST/SGST/IGST, service charge, invoice prefix/numbering, footer)
    5. Floors, Sections & Visual Drag-and-Drop Table Layout
    6. Menu Categories, Dishes, Photos, Prices, Variants & Extras
    7. Staff Invitations, Roles & Granular Permissions
    8. Review & Complete Setup
- **POS Terminal & Kitchen Display System (KDS)**
  - Dine-In, Takeaway, and Delivery workflows with live KOT firing, dish variants, add-on extras, kitchen notes, item voiding, hold/resume, cancellation reason tracking, and configurable keyboard shortcuts.
  - Real-time KDS ticket queue with prep stations (`Queued → Preparing → Ready → Served`) and configurable SLA warnings.
- **Architectural Floor Plan**
  - Drag-and-drop canvas with floors, sections/zones, table shapes (`square`, `round`, `rect`), custom colors, size scaling, table transfers, and multi-table merging/unmerging.
- **Server-Side Billing, GST & Printing**
  - Deterministic calculation engine ([src/billing.js](src/billing.js)) supporting **Exclusive**, **Inclusive**, and **Composition** GST modes, CGST/SGST or IGST, discounts (with max discount cap), service charges, takeaway/delivery packaging fees, round-off, and Cash / UPI / Card / Split / custom payment methods.
  - Instant **PDFKit** invoice generation (`A4`, `A5`, `58mm`, `80mm`), thermal browser receipts, and Web Serial ESC/POS `.bin` output.
- **Inventory, Recipes & Analytics**
  - Raw ingredient tracking, reorder par alerts, stock movement ledger, Recipe BOM auto-deduction on invoice settlement, multi-branch roll-ups, and CSV invoice export.
- **11-Module Customization Studio (`Customization`)**
  - Live-previewed customization with **Save Changes**, **Reset to Default**, and unsaved-change protection across:
    1. Appearance (Light/Dark/System theme, colors, fonts, spacing, card/button/sidebar styles)
    2. Branding (logo, cover, favicon, login/dashboard/receipt branding)
    3. Dashboard (drag-and-drop widget ordering, visibility, sizing, selectable KPIs)
    4. POS (grid/list layouts, columns, card/button sizes, quick actions, shortcuts)
    5. Tables (status colors, snap grid, floors/sections, table visual overrides)
    6. Billing (invoice templates, paper sizes, header/footer, tax visibility, payment instructions)
    7. Menu (subcategories, custom dish labels, Happy Hour rules, packaging charge)
    8. Notifications (chimes, volume, In-App/Browser/KDS channels, delayed-order alerts)
    9. Staff & Custom Roles (reusable custom role templates with 20 granular permissions)
    10. Business Rules (hours, holidays, tax rules, cancellation limits, payment modes)
    11. Advanced (locale, timezone, date format, printer mode, phone masking, idle timeout, JSON backup export/import, multi-branch outlets)

---

## Requirements

- **Node.js `>= 22.5.0`** (uses Node's built-in `node:sqlite` module; verified on Node `v24.12.0`).

---

## Quick Start

```bash
git clone <your-repo-url>
cd <repo-folder>
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser and use the **New Restaurant** tab to register your workspace and complete **Restaurant Setup**.

### Optional Environment Variables

Copy [.env.example](.env.example) to `.env` if you wish to customize:

- `PORT` — Server port (default: `3000`)
- `SESSION_SECRET` — Optional `32+` char HMAC secret (auto-generated and stored locally in SQLite `app_secrets` when omitted)

---

## Testing & Verification

Run syntax checks and the isolated end-to-end test suite (creates a temporary SQLite database in `os.tmpdir()` and cleans up automatically):

```bash
npm test
```

---

## Project Structure

```text
├── server.js                  # Express HTTP & authenticated WebSocket server
├── package.json               # Dependencies and scripts
├── .env.example               # Optional environment variables template
├── src/
│   ├── auth.js                # Scrypt hashing, HMAC sessions & granular RBAC
│   ├── billing.js             # Deterministic server-side GST & bill calculator
│   ├── customization.js       # 11-module defaults & deep-merge hydration
│   ├── db.js                  # SQLite schema & non-destructive migrations
│   ├── pdf.js                 # PDFKit GST invoice generator (A4/A5/58mm/80mm)
│   └── routes.js              # Multi-tenant REST API router
├── public/
│   ├── index.html             # App shell, boot screen, auth & onboarding mount
│   ├── styles.css             # Responsive glassmorphic design system
│   └── js/
│       ├── api.js             # Fetch helpers, locale/date formatters, notifications
│       ├── app.js             # Router, theme/branding runtime, WS sync & guards
│       ├── charts.js          # SVG bar & donut analytics charts
│       ├── thermal.js         # Thermal print templates & ESC/POS byte builder
│       └── views/
│           ├── onboarding.js      # 8-step Restaurant Setup wizard
│           ├── customization.js   # 11-module Customization Studio UI
│           ├── admin_views.js     # Dashboard, Orders, Menu, Inventory, Analytics, Staff
│           └── pos_floor_kds.js   # POS Terminal, Floor Plan & KDS views
└── tests/
    └── e2e.js                 # Automated HTTP, WebSocket, RBAC & billing E2E suite
```

---

## License

Licensed under the [MIT License](LICENSE).
