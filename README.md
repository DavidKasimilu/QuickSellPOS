# QuickSell POS | Backoffice Portal

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.0.0-teal.svg)
![Platform](https://img.shields.io/badge/platform-Web%20%7C%20Mobile%20%7C%20Desktop-informational.svg)

**QuickSell POS Backoffice Portal** is a modern, responsive web application designed for point-of-sale management, inventory tracking, multi-branch control, employee monitoring, and real-time transaction analytics. 

Engineered with a streamlined vertical navigation rail and context-sensitive flyout submenus, the backoffice dashboard provides a seamless workflow across mobile (Android/iOS) and desktop browsers.

---

## 📸 Key Features

- **Responsive Vertical Rail & Submenu Navigation:** Modern side-rail navigation with dynamic flyout menus calibrated for desktop monitors and mobile touchscreens.
- **Real-Time Data Synchronization:** Instant updates for stock levels, sales orders, and receipts powered by Supabase WebSockets.
- **Cashier Register (POS):** Fast-checkout cashier portal supporting barcoding, custom discount application, and customer receipt generation.
- **Inventory & Stock Management:** Complete tracking of available inventory, Stock Adjustments (SA), Purchase Orders (PO), and Goods Received Notes (GRN).
- **Analytics & KPI Dashboard:** Visual breakdown of Gross Sales, Net Sales, COGS, Gross Profit, and historical date filters (Today, Yesterday, Last 7 Days).
- **Multi-Role Security:** Granular access permissions for Store Owners, Managers, and Cashiers.
- **Multi-Currency & Regionalization:** Native support for KES, TZS, UGS, USD, localized date/time formatting, and multi-language setups.

---

## 🛠️ Tech Stack

- **Frontend:** HTML5, Modern CSS3 (CSS Variables, Flexbox/Grid), Vanilla JavaScript (ES Modules)
- **Icons:** [Lucide Icons](https://lucide.dev/)
- **Typography:** [Inter (Google Fonts)](https://fonts.google.com/specimen/Inter)
- **Backend & Database:** [Supabase](https://supabase.com/) (PostgreSQL, Realtime WebSockets, Authentication)

---

## 📂 Project Structure

```text
QuickSellPOS/
├── index.html              # Main single-page application entry point
├── css/
│   ├── layout.css          # App structural layouts, side rail, & responsive rules
│   └── components.css      # Custom UI component styles (Buttons, KPI cards, tables)
├── js/
│   ├── app.js              # Application bootstrap & event bindings
│   ├── auth.js             # Authentication engine & Supabase auth sync
│   ├── router.js           # Single Page Application (SPA) hash router
│   ├── state.js            # Global reactive application state
│   ├── supabaseClient.js   # Supabase client setup & configuration
│   ├── components/         # Reusable UI component logic
│   └── views/              # View controllers (Dashboard, POS, Products, etc.)
└── README.md               # Project documentation
```

---

## 🚀 Getting Started

### Prerequisites

- A modern web browser (Chrome, Safari, Brave, Edge, Firefox).
- A local web server environment (e.g., VS Code *Live Server*, `http-server`, or Nginx).

### Installation & Setup

1. **Clone or Download the Repository:**
   ```bash
   git clone https://github.com/davidkasimilu/QuickSellPOS.git
   cd QuickSellPOS
   ```

2. **Configure Supabase Credentials:**
   Ensure your Supabase project URL and API key are configured in `js/supabaseClient.js`:
   ```javascript
   import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

   const SUPABASE_URL = 'YOUR_SUPABASE_PROJECT_URL';
   const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

   export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
   ```

3. **Launch the Portal:**
   Run a local development server or open `index.html` via your local web server.

---

## 📱 Mobile & Desktop Navigation

The interface adapts dynamically across screen widths:
- **Desktop View:** The side navigation rail stays sticky on the left margin, giving maximum horizontal space to data tables and sales analytics.
- **Mobile View ($< 768\text{px}$):** The side navigation adapts cleanly, sliding over smoothly or displaying flyout submenus directly adjacent to the active menu icon without obscuring main content views.

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

## 👨‍💻 Author & Support

Developed and maintained by **David Kasimilu**.

For inquiries, support, or bug reporting, feel free to open an issue or reach out directly.