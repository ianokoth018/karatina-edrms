# EDRMS — Local Deployment Guide

## Prerequisites

- **Node.js** 20+ (`node -v`)
- **PostgreSQL** 14+ running locally
- **npm** 9+
- **Git**

## 1. Clone & Install

```bash
git clone https://github.com/ianokoth018/karatina-edrms.git
cd karatina-edrms
npm install --legacy-peer-deps
```

## 2. Database Setup

Create a PostgreSQL database:

```bash
psql -U postgres -c "CREATE DATABASE karatina_edrms;"
```

## 3. Environment Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your local values:

```env
# Database
DATABASE_URL="postgresql://postgres:yourpassword@localhost:5432/karatina_edrms"
DIRECT_URL="postgresql://postgres:yourpassword@localhost:5432/karatina_edrms"

# NextAuth
NEXTAUTH_SECRET="generate-with: openssl rand -base64 32"
NEXTAUTH_URL="http://localhost:3000"

# Encryption
ENCRYPTION_KEY="generate-with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""

# Email (Gmail SMTP)
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_SECURE="false"
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-app-password"
SMTP_FROM="your-email@gmail.com"

# Student Portal Integration (optional)
STUDENT_PORTAL_API_KEY="a-shared-secret-key"
```

## 4. Generate Prisma Client & Push Schema

```bash
npx prisma generate
npx prisma db push
```

## 5. Seed the Database

This creates the admin user, roles, classification tree, and workflow templates:

```bash
npx tsx prisma/seed.ts
```

**Default admin credentials:**
- Email: `admin@karu.ac.ke`
- Password: `Admin@2026`

## 6. Start the Development Server

```bash
npm run dev
```

Open http://localhost:3000 in your browser.

## 7. Verify

1. Navigate to http://localhost:3000/login
2. Login with `admin@karu.ac.ke` / `Admin@2026`
3. You should see the EDRMS dashboard

## Seed Data Created

| Category | Items |
|----------|-------|
| **Roles** | ADMIN (30 perms), REGISTRY_OFFICER (10), RECORDS_MANAGER (16), APPROVER (4), DEPARTMENT_HEAD (11), VIEWER (5) |
| **Classification** | ADM (Administration), FIN (Finance), STU (Student Records), HR (Human Resources) — 3 levels each |
| **Retention** | ADM: 2+5yr → Destroy, FIN: 5+5yr → Destroy, STU: 5+25yr → Archive Permanent, HR: 0+10yr → Review |
| **Workflows** | Internal Memo Approval (3 steps), Document Review (2 steps) |

## File Storage

Uploaded documents are stored locally at `uploads/edrms/`. This directory is created automatically on first upload. Add it to `.gitignore`:

```
uploads/
```

## Prisma Studio (Database Browser)

```bash
npx prisma studio
```

Opens a visual database browser at http://localhost:5555.

## Troubleshooting

### "PrismaClient needs to be constructed with non-empty options"
- Ensure `.env` exists with `DATABASE_URL` set
- Run `npx prisma generate`

### "Cannot find module '@prisma/client'"
- Run `npx prisma generate`

### Database connection refused
- Ensure PostgreSQL is running: `sudo systemctl start postgresql`
- Verify credentials in `.env`

### Port 3000 already in use
- Kill the existing process: `kill $(lsof -t -i:3000)`
- Or use a different port: `PORT=3001 npm run dev`
