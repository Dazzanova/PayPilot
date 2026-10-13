# PayPilot HRMS & Payroll SaaS

A modern, multi-tenant Human Resource Management System (HRMS) and Payroll platform foundation engineered with React, Express, TypeScript, Tailwind CSS, and Supabase PostgreSQL via Prisma ORM.

---

## 1. Project Overview

**PayPilot** provides growing and enterprise organizations with a unified interface for workforce administration:
- **Workforce & Department Directory:** Centralized employee records, job profiles, and structural hierarchy.
- **Attendance & Time Logs:** Daily check-in tracking, on-site vs. remote workforce indicators, and shift durations.
- **Leave Request Management:** Time-off workflows with manager reviews and category balances.
- **Payroll Cycles & Payslips:** Batch period runs, gross-to-net salary reconciliations, and payslip distribution.
- **Multi-Tenant Foundation:** Built-in organization scoping and role-based access levels (`SUPER_ADMIN`, `ADMIN`, `HR_MANAGER`, `MANAGER`, `EMPLOYEE`).

> **Current Phase Status (Foundational Architecture):**  
> This version establishes the monorepo architecture, user interface shells, typed domain models, backend service endpoints, and a validated Supabase-compatible relational database schema. Business data modifications are scoped to sandbox demo states.

---

## 2. Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | React 18, Vite, TypeScript, Tailwind CSS, React Router 6, Lucide React, Recharts |
| **Backend** | Node.js, Express, TypeScript, Zod, Dotenv |
| **Database & ORM** | Supabase PostgreSQL, Prisma ORM (v5.x) |
| **Workspace & Tooling** | `npm` Workspaces, TypeScript (strict mode) |

---

## 3. Repository Architecture

```text
paypilot/
├── apps/
│   ├── web/                          # Frontend React SPA
│   │   ├── src/
│   │   │   ├── app/                  # App entry & React Router setup
│   │   │   ├── components/
│   │   │   │   ├── layout/           # AppLayout, TopNav, Sidebar
│   │   │   │   └── ui/               # Button, Card, Badge, Table, StatCard, etc.
│   │   │   ├── pages/                # Navigable views (Dashboard, Employees, etc.)
│   │   │   ├── data/                 # Centralized typed mock data
│   │   │   ├── lib/                  # Utilities (formatCurrency, formatDate, cn)
│   │   │   ├── types/                # Domain TypeScript models
│   │   │   ├── index.css             # Tailwind design tokens
│   │   │   └── main.tsx              # DOM root mount
│   │   ├── package.json
│   │   └── vite.config.ts            # Vite proxy to backend (/api -> :4000)
│   │
│   └── api/                          # Backend Express Service
│       ├── src/
│       │   ├── config/               # Zod-validated environment config
│       │   ├── lib/                  # Prisma singleton & logging utility
│       │   ├── middleware/           # Request logger & central error handler
│       │   ├── routes/               # API router & health endpoints
│       │   └── server.ts             # Express bootstrap & graceful shutdown
│       └── package.json
│
├── prisma/
│   └── schema.prisma                 # Canonical Supabase PostgreSQL schema
├── docs/
│   └── architecture.md               # Architecture & entity-relationship spec
├── .env.example                      # Environment configuration template
├── .gitignore                        # Git exclusion rules
├── package.json                      # Root workspace scripts
└── README.md                         # This file
```

---

## 4. Prerequisites

- **Node.js:** v18.0.0 or later (tested on Node.js v24)
- **npm:** v9.0.0 or later (tested on npm v12)
- **Supabase Account / PostgreSQL instance:** (Optional for initial UI & API exploration, required for live DB migrations)

---

## 5. Installation & Setup

### 5.1 Clone & Install Dependencies

From the repository root:

```bash
# Install dependencies across all monorepo workspaces
npm install
```

### 5.2 Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Review and adjust variables in `.env`:

```ini
# Backend API Port & Environment
NODE_ENV=development
PORT=4000
CORS_ORIGIN=http://localhost:5173

# Database Connection (Supabase PostgreSQL)
# DATABASE_URL: Transaction pooler URL (for app queries)
DATABASE_URL="postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true"

# DIRECT_URL: Direct session URL (for migrations and introspection)
DIRECT_URL="postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres"

# Frontend API Target
VITE_API_URL=http://localhost:4000/api
```

---

## 6. Running the Applications

### 6.1 Run Concurrently (Recommended)

To start both the Express API (:4000) and the Vite frontend (:5173) in parallel:

```bash
npm run dev
```

### 6.2 Run Separately

**Frontend only:**
```bash
npm run dev:web
# Launches on http://localhost:5173
```

**Backend API only:**
```bash
npm run dev:api
# Launches on http://localhost:4000
```

---

## 7. Database & Prisma Operations

The Prisma schema is located at `./prisma/schema.prisma`.

### 7.1 Validate Schema

Verify syntactic correctness and relational referential integrity:

```bash
npm run prisma:validate
```

### 7.2 Generate Prisma Client

Generate the type-safe `@prisma/client` bindings:

```bash
npm run prisma:generate
```

### 7.3 Apply Migrations to Supabase

Once you have set valid Supabase connection strings in `.env`:

```bash
npx prisma migrate dev --name init_schema
```

---

## 8. API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Returns API service status, uptime, and memory usage. |
| `GET` | `/api/health/db` | Performs a live `SELECT 1` query via Prisma to check DB health. |
| `GET` | `/api/` | API version metadata banner. |

Example `/api/health` response:
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "service": "paypilot-api",
    "uptimeSeconds": 142,
    "timestamp": "2026-10-14T01:30:00.000Z",
    "environment": "development",
    "memoryUsageMb": 38
  }
}
```

---

## 9. Next Implementation Milestones

1. **Authentication & Session Management:** Supabase Auth integration with secure JWT verification and refresh token flows.
2. **Organization-Scoped Middleware:** Middleware to automatically extract `organizationId` from session claims.
3. **Employee Directory CRUD:** Form validation schemas with Zod, profile avatars, and pagination.
4. **Attendance System:** Geo/device-aware clock-in punch engine and timesheet export.
5. **Leave Approval Engine:** Tiered manager approval workflows and holiday calendar calculations.
6. **Payroll Calculation Engine:** Localized tax brackets, statutory deductions, and automated PDF payslip generation.
