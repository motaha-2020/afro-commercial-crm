# ACMS Agent — نسخة العمل (staging)

نسخة معزولة تمامًا من ACMS للتجربة والتطوير. **لا تمس** النسخة الأصلية في
`~mohamed.taha/acms` (compose project `acms`).

## الفروق عن الأصلية

| | الأصلية `acms` | النسخة `acms-agent` |
|---|---|---|
| المجلد | `~mohamed.taha/acms` | `~mohamed.adel/acms-agent` |
| Compose project | `acms` | `acms-agent` |
| الواجهة | `http://100.122.6.64:3100` | `http://100.122.6.64:3110` |
| الـAPI | `http://100.122.6.64:4000` | `http://100.122.6.64:4010` |
| Volumes | `acms_postgres_data`, `acms_minio_data` | `acms-agent_postgres_data`, `acms-agent_minio_data` |
| الأسرار | `.env` الخاص بها | `.env` بأسرار مولّدة جديدة |
| Overlay | `docker/docker-compose.prod.yml` | `docker/docker-compose.agent.yml` |

Postgres وMinIO غير منشورين على المضيف في الاثنين — كل واحد داخل شبكته الخاصة.

## البيانات

نسخة من قاعدة الأصلية وقت الإنشاء (2026-08-09) عبر `pg_dump` (قراءة فقط)، ومعها
محتويات bucket `acms-documents` من MinIO. الأصلية لم تتأثر.

**كلمات المرور في هذه النسخة فقط:** `admin@afro.example` و`ceo@afro.example`
كلمة مرورهما `AgentDev#2026` (أُعيد ضبطها هنا فقط لأن كلمات المرور الحقيقية
مجهولة). باقي الحسابات بكلمات مرور الأصلية.

## إعادة النشر بعد أي تعديل

```bash
cd ~/acms-agent && bash docker/deploy-agent.sh
```

هذه النسخة ليست git clone، فالسكربت لا يعمل `git pull` — ارفع تعديلات الكود
أولًا (scp/rsync من جهاز التطوير) ثم شغّله.

## أوامر سريعة

```bash
cd ~/acms-agent/docker
C="docker compose -f docker-compose.yml -f docker-compose.agent.yml --env-file ../.env"
$C ps                 # الحالة
$C logs -f api        # اللوجات
$C restart api
$C down               # إيقاف (الـvolumes تبقى)
$C down -v            # مسح كامل بما فيه البيانات
```

## إعادة تحميل البيانات من الأصلية (متى ما احتجت)

```bash
docker exec acms-postgres-1 pg_dump -U acms -d acms --no-owner --no-privileges > /tmp/acms-live.sql
cd ~/acms-agent/docker && $C stop api web
docker exec acms-agent-postgres-1 psql -U acms -d postgres -c "DROP DATABASE acms;" -c "CREATE DATABASE acms OWNER acms;"
docker exec -i acms-agent-postgres-1 psql -U acms -d acms -v ON_ERROR_STOP=1 < /tmp/acms-live.sql
$C start api web
```

## التحقق

```bash
curl http://100.122.6.64:4010/api/health/live
curl http://100.122.6.64:4010/api/health/ready
curl -o /dev/null -w "%{http_code}\n" http://100.122.6.64:3110/ar/login
```
