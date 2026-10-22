# QuickSell POS

A lightweight, serverless Point of Sale (POS) and backoffice retail management system built as a vanilla JavaScript Single Page Application (SPA). Powered by Supabase PostgreSQL with strict Row Level Security (RLS) and Cloudflare Workers as an edge API proxy. https://davidkasimilu.github.io/QuickSellPOS/

![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL%20%2B%20RLS-3ECF8E?style=flat&logo=supabase&logoColor=white)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Edge%20Worker%20Proxy-F38020?style=flat&logo=cloudflare&logoColor=white)
![JavaScript](https://img.shields.io/badge/ES6-Vanilla%20SPA-F7DF1E?style=flat&logo=javascript&logoColor=black)
![License](https://img.shields.io/badge/License-MIT-blue.svg)

---

## Architecture Overview

[ Browser / Mobile Client ]
│
│ (CORS Preflight, Token Injection, Dynamic Headers)
▼
[ Cloudflare Workers Edge Proxy ]
│
│ (Authenticated REST / PostgREST)
▼
[ Supabase Backend ]
├── PostgreSQL Schema & Automated Triggers
├── Row-Level Security (Multi-Tenant Branch Isolation)
└── Brevo SMTP (Custom 6-Digit Email OTP Delivery)


- **Frontend:** Pure ES6 JavaScript SPA with dynamic hash routing (`#pos`, `#inventory`, `#dashboard`), modular view lifecycles, and a responsive modern CSS interface.
- **Edge Layer:** A Cloudflare Worker proxy handling credential stripping, API key injection, and automated CORS preflight matching for local, staging, and production domains.
- **Database & Auth:** Supabase PostgreSQL leveraging custom schemas, definer triggers for inventory automation, and transactional 6-digit OTP authentication via Brevo SMTP.

---

## Core Features

### 1. Live Cashier Terminal (`#pos`)
- Touch-optimized product grid with instant category filtering.
- Fast hardware barcode scanner support via keyboard return auto-matching.
- Dynamic modifier group popups for customized item variants (sizes, toppings, extras).
- Ticket subtotal, tax calculation, and active discount application.
- Multi-tender split checkouts (Cash, M-PESA, Card) with change calculator.
- Built-in ESC/POS receipt generation with direct print fallbacks.

### 2. Loss Prevention & Suspicious Logs
- **Cart Discard Tracking:** Automatically audits and logs when cashiers remove items from uncommitted tickets or discard counter tickets.
- **Receipt Audits:** Transaction void logs, refund histories, and register discrepancy reconciliations.

### 3. Inventory & Warehouse Management
- **Stock Tracking:** Real-time stock-on-hand tracking with threshold-based low-stock alerts.
- **Physical Stocktakes:** Multi-item count sheets that calculate physical-to-system variances and automatically commit reconciliations.
- **Recipe Assemblies (BOM):** Bill of Materials linking finished products to raw ingredients (automatically decrements raw stock upon sale).
- **Perishable Batches & Expiry:** Shelf-life tracking with color-coded alerts for expiring and expired stock lots.
- **Procurement & Logistics:** Purchase Orders (PO), Goods Received Notes (GRN) with automated stock increment triggers, Purchase Return Notes (PRN), and Inter-branch Transfers (TOG).
- **Valuation Reports:** Total inventory valuation calculated at cost vs. projected retail margin.

### 4. Product Catalog & Hardware Labeling
- Standard catalog master (SKU, barcode, cost price, retail price, tax tier).
- Category and Unit of Measure (UOM) configurations.
- Modifier groups with single-choice or multi-choice price adjustments.
- **Barcode Generator:** Pure SVG Code128 generation and multi-label printable sticker sheet formatting (A4 / sticker roll ready).

### 5. Hardware Connectivity
- Direct raw ESC/POS byte streaming via browser **WebUSB** and **WebBluetooth** protocols.
- Standard cross-browser thermal print dialog fallback (58mm / 80mm roll format).

### 6. Multi-Tenant Branch RLS Security
- Branch-level data segmentation: cashiers and store staff can only view colleagues and records associated with their assigned `shop_id`.
- Automated security-definer triggers guaranteeing admin account provisioning on startup.

---

## Project Structure

├── index.html                   # Master layout shell, navigation & auth overlays
├── css/
│   ├── layout.css               # Core grid, side drawer, bottom mobile nav & breakpoints
│   └── components.css           # UI components, tables, modals, cards, badges & inputs
├── js/
│   ├── app.js                   # Main application orchestrator & profile controller
│   ├── auth.js                  # Brevo OTP, login, signup & recovery workflows
│   ├── router.js                # Hash router with lazy-loading view lifecycles
│   ├── state.js                 # Central reactive state & subscriber management
│   ├── supabaseClient.js        # Supabase client routed through the Worker proxy
│   ├── components/
│   │   ├── BarcodeGenerator.js  # Client-side Code128 barcode generator
│   │   ├── DataTable.js         # Dynamic data table renderer with pagination & actions
│   │   ├── Modal.js             # Reusable accessible modal component
│   │   ├── PrinterDriver.js     # WebUSB, WebBluetooth & ESC/POS byte-buffer driver
│   │   └── Toast.js             # Notification toast alerts
│   └── views/
│       ├── pos.js               # Live Cashier Terminal & checkout cart
│       ├── dashboard.js         # Analytics, KPI metrics & sales performance
│       ├── salesReports.js      # Receipts, shift reports & suspicious discard audits
│       ├── products.js          # Item master, barcode printing & modifier mapping
│       ├── inventory.js         # Stock, BOM recipes, audits, valuation & expiry
│       ├── customers.js         # Customer CRM, debtor accounts & settlements
│       ├── promotions.js        # Discount plans, price tiers & bulk catalog repricing
│       ├── employees.js         # Staff roles, permission matrices & commissions
│       └── settings.js          # Store branches, terminal registers & API webhooks
└── worker/
└── worker.js                # Cloudflare Workers gateway & CORS reverse proxy


---

## Getting Started

### Prerequisites
- Node.js (v18+ recommended) or any static HTTP server (e.g., Python `http.server`, Live Server).
- A [Supabase](https://supabase.com/) project.
- A [Cloudflare](https://dash.cloudflare.com/) account for deploying the proxy worker.
- A verified [Brevo](https://www.brevo.com/) account for SMTP delivery.

---

### Step 1: Database Setup (Supabase)

1. Open your **Supabase Dashboard** -> **SQL Editor**.
2. Run your database migration script to generate all schemas, constraints, automated triggers, and Row Level Security (RLS) policies.
3. Configure **Brevo Custom SMTP**:
   - Navigate to **Project Settings** -> **Authentication** -> **Custom SMTP**.
   - Enable Custom SMTP using your Brevo credentials (`smtp-relay.brevo.com`, port `587`).
   - Ensure the Sender Email matches your verified sender in the Brevo console.

---

### Step 2: Deploy Cloudflare Worker Proxy

1. In the Cloudflare Dashboard, create a new Worker (e.g., `quicksell-gateway`).
2. Add your Worker script (`worker/worker.js`) to handle dynamic CORS header reflections and authentication proxying.
3. Add the following **Environment Variables** in the Worker settings:
   - `SUPABASE_URL`: Your Supabase project URL (`https://your-ref.supabase.co`).
   - `SUPABASE_ANON_KEY`: Your Supabase public anonymous API key.
4. Deploy the Worker and note its public URL:
https://quicksell-gateway..workers.dev


---

### Step 3: Configure Frontend Client

In `js/supabaseClient.js`, point the client to your Cloudflare Worker proxy URL:

```javascript
import { createClient } from '[https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm](https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm)';

// Route all requests through your Cloudflare Edge Proxy
const WORKER_PROXY_URL = 'https://quicksell-gateway.<your-subdomain>.workers.dev';

export const supabase = createClient(WORKER_PROXY_URL, 'public-client-proxy', {
auth: {
 persistSession: true,
 autoRefreshToken: true,
},
});
Step 4: Run Locally
Start a local static development server in the project root:

Bash
# Using Python
python3 -m http.server 8080

# Using Node.js (npx)
npx serve .
Open http://localhost:8080 in your browser.

Deployment (GitHub Pages)
Because QuickSell POS is a dependency-free static SPA:

Push the code to your GitHub repository.

In your repository, go to Settings -> Pages.

Under Build and deployment, select Deploy from a branch.

Set the branch to main (or master) and directory to / (root).

Click Save. GitHub Pages will deploy the project automatically.

Ensure your Cloudflare Worker CORS origin settings allow your GitHub Pages domain:

JavaScript
const isGitHubPages = origin.endsWith(".github.io");
Security Model
No Exposed Database Credentials: The frontend carries no real Supabase secret keys; all requests pass through the Cloudflare Worker where headers are validated and the internal anonymous key is injected server-side.

Row Level Security (RLS): Every PostgreSQL table enforces security-definer rules, ensuring users can only read or write records tied to their store branch or authorized role.

Live Discard Audits: Removing line items from active counter tickets creates unalterable rows in cart_discard_logs for loss prevention audits.

License
This project is licensed under the MIT License. See the LICENSE file for details.
