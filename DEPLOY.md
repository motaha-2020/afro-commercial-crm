# النشر — Afro Server

النظام منشور على السيرفر المشترك (Ubuntu، عبر Tailscale) في مجلد معزول `~/acms`،
بمشروع Docker Compose اسمه `acms` لوحده. لا يمس أي خدمة أخرى على السيرفر.

## المنافذ

| الخدمة | المنفذ | الوصول |
|---|---|---|
| الواجهة (web) | `3100` | `http://100.122.6.64:3100` عبر Tailscale |
| الـAPI | `4000` | `http://100.122.6.64:4000` عبر Tailscale |
| PostgreSQL | — | داخلي فقط (شبكة `acms` الخاصة) |
| MinIO | — | داخلي فقط |

قاعدة البيانات وMinIO **غير منشورين** على السيرفر إطلاقًا، فلا تعارض مع أي Postgres آخر.

## أول نشر (مرة واحدة)

```bash
# على السيرفر
git clone git@github-acms:motaha-2020/afro-commercial-crm.git ~/acms
cd ~/acms
# أنشئ .env بأسرار جديدة ومنافذ السيرفر (BIND_IP=100.122.6.64, WEB_PORT=3100, API_PORT=4000)
docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml --env-file .env up -d --build
# املأ بيانات تجريبية (مرة واحدة)
docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml --env-file .env \
  exec -T -e SEED_PASSWORD='ChangeMe#2026' api node prisma/seed.mjs
```

## إعادة النشر (بعد أي تحديث)

```bash
cd ~/acms && bash docker/deploy.sh
```

السكربت يسحب أحدث كود، يعيد البناء، يعيد إنشاء الحاويات (الـmigrations تُطبَّق تلقائيًا عند
إقلاع الـAPI)، ثم يطبع الحالة الصحية.

## حسابات الدخول التجريبية

كلمة المرور: `ChangeMe#2026` (غيّرها فورًا في أي استخدام حقيقي)

| الحساب | الدور | نطاق الرؤية |
|---|---|---|
| `ceo@afro.example` | CEO | كل المجموعة |
| `sales.director@afro.example` | مدير مبيعات | وحدة الأعمال |
| `am@afro.example` | مدير حساب | سجلاته فقط |
| `admin@afro.example` | مدير النظام | كل المجموعة |

## ملاحظات إنتاجية مهمة

- **TLS:** النظام يُخدَم حاليًا عبر HTTP على الشبكة الخاصة. عند إضافة reverse proxy بـTLS،
  اضبط `COOKIE_SECURE=true` في `.env` ليصبح الكوكيز آمنًا.
- **الأسرار:** كل الأسرار في `~/acms/.env` (chmod 600، خارج Git). لا تضعها في المستودع.
- **النسخ الاحتياطي:** بيانات PostgreSQL في volume باسم `acms_postgres_data`، وMinIO في `acms_minio_data`.

## التحقق السريع

```bash
curl http://100.122.6.64:4000/api/health        # {"status":"ok","database":"up"}
curl http://100.122.6.64:3100/ar/login          # HTTP 200
```
