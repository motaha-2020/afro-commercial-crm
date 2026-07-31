# Afro Commercial Management System (ACMS)

منظومة تجارية متكاملة لمجموعة **Afro Group** (مقاولات واتصالات — مصر، مدغشقر، جزر القمر، كينيا).

النظام ليس CRM تقليديًا. النطاق الكامل:

```
CRM + Bid Management + CPQ & Costing + Supplier/Subcontractor Management
+ Approval Workflow + Contracts + Project Handover + BI + AI Assistant
```

أغلب أنظمة CRM تتوقف عند "الفوز بالفرصة". القيمة الحقيقية هنا هي إغلاق الحلقة:
**هل حققت الفرصة الربح الذي سُعِّرت عليه فعلًا؟**

## المعمارية

| الطبقة | التقنية |
|---|---|
| Backend | NestJS + TypeScript (Modular Monolith) |
| Frontend | Next.js + React + TypeScript |
| Database | PostgreSQL + Prisma |
| Object Storage | MinIO (S3-compatible) |
| Deployment | Docker Compose |

اللغات المدعومة: العربية (RTL) والإنجليزية والفرنسية. القيم تُخزَّن كـ **codes** والترجمة تحدث في طبقة العرض فقط.

## الهيكل

```
apps/api        — NestJS API
apps/web        — Next.js UI
packages/shared — codes وأنواع مشتركة بين الطرفين
prisma/         — مخطط قاعدة البيانات والـmigrations
docker/         — Docker Compose
```

## التشغيل محليًا

```bash
cp .env.example .env      # ثم عدّل القيم
npm install
npx prisma generate
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml --env-file .env up -d postgres
npx prisma migrate dev
npm run dev
```

## التشغيل الكامل بـDocker (تطوير محلي)

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml --env-file .env up -d --build
```

## النشر على السيرفر

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml --env-file .env up -d --build
```

الملف الأساسي لا ينشر أي بورت؛ التطوير المحلي يضيف بورتات `localhost` عبر `docker-compose.dev.yml`، والسيرفر يضيف بورتات web/api على IP الخاص عبر `docker-compose.prod.yml` بينما تبقى قاعدة البيانات وMinIO داخليين.

## قواعد حوكمة مطبَّقة من البداية

- **Soft delete فقط** — لا حذف نهائي لأي سجل تجاري.
- **AuditLog** يسجّل كل عملية تغيير حالة.
- **الفصل الرباعي للفرصة**: `stage` ≠ `status` ≠ `forecastCategory` ≠ `health`.
- **Progressive Data Capture** — الحقول الإلزامية تتراكم مع تقدّم المرحلة، ولا تُطلب كلها عند التسجيل.
- **Margin ≠ Markup** — الهامش يُحسب على سعر البيع لا على التكلفة.

## خارطة الإصدارات

| # | Release |
|---|---|
| 1 | Platform Foundation |
| 2 | CRM and Account Management |
| 3 | Bids and Scope |
| 4 | Costing and Pricing |
| 5 | Partners and Quotations |
| 6 | Approvals and Proposals |
| 7 | Contracts and Handover |
| 8 | Nama ERP Integration |
| 9 | Operations Integration |
| 10 | Project Commercial Control |
| 11 | AI and Knowledge Platform |
| 12 | Advanced Analytics and Portals |
