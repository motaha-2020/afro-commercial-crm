-- Seed the reference lists with exactly the values the system shipped with.
-- Generated from the translation files so nothing on screen changes: the values
-- move from code into rows, they do not change. Every row is marked isSystem,
-- which is what stops an administrator removing a value the code still names.

INSERT INTO "RefList" ("key","labelEn","labelAr","labelFr","allowsNewItems","lockedReason","updatedAt") VALUES ('INDUSTRY','Industries','القطاعات','Secteurs',true,NULL,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'INDUSTRY','FTTH','FTTH — fibre to the home','ألياف حتى المنزل (FTTH)','FTTH — fibre jusqu''au domicile',0,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'INDUSTRY','FTTS','FTTS — fibre to the site','ألياف حتى الموقع (FTTS)','FTTS — fibre jusqu''au site',10,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'INDUSTRY','WIRELESS','Wireless networks','شبكات لاسلكية','Réseaux sans fil',20,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'INDUSTRY','FIXED','Fixed networks','شبكات ثابتة','Réseaux fixes',30,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'INDUSTRY','SUBMARINE','Submarine cable','كابلات بحرية','Câble sous-marin',40,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'INDUSTRY','MEP','MEP — mechanical, electrical, plumbing','أعمال ميكانيكا وكهرباء وصحي (MEP)','MEP — mécanique, électricité, plomberie',50,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'INDUSTRY','ELV','ELV — extra low voltage','التيار الخفيف (ELV)','ELV — courants faibles',60,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'INDUSTRY','CORE_NETWORK','Core network','الشبكة الأساسية','Réseau cœur',70,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'INDUSTRY','IT','IT','تقنية المعلومات','Informatique',80,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'INDUSTRY','SUPPLY','Supply','توريدات','Fournitures',90,true,NOW());

INSERT INTO "RefList" ("key","labelEn","labelAr","labelFr","allowsNewItems","lockedReason","updatedAt") VALUES ('ACCOUNT_TYPE','Customer types','أنواع العملاء','Types de client',true,NULL,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'ACCOUNT_TYPE','OPERATOR','Operator','مشغّل اتصالات','Opérateur',0,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'ACCOUNT_TYPE','CONTRACTOR','Contractor','مقاول','Entrepreneur',10,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'ACCOUNT_TYPE','GOVERNMENT','Government','جهة حكومية','Administration publique',20,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'ACCOUNT_TYPE','ENTERPRISE','Enterprise','شركة','Entreprise',30,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'ACCOUNT_TYPE','DEVELOPER','Developer','مطوّر عقاري','Promoteur immobilier',40,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'ACCOUNT_TYPE','VENDOR','Vendor','مورّد','Fournisseur',50,true,NOW());

INSERT INTO "RefList" ("key","labelEn","labelAr","labelFr","allowsNewItems","lockedReason","updatedAt") VALUES ('LEAD_SOURCE','Lead sources','مصادر العملاء المحتملين','Sources de prospects',true,NULL,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'LEAD_SOURCE','TENDER_PORTAL','Tender portal','بوابة مناقصات','Portail d''appels d''offres',0,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'LEAD_SOURCE','DIRECT_INVITATION','Direct invitation','دعوة مباشرة','Invitation directe',10,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'LEAD_SOURCE','REFERRAL','Referral','ترشيح','Recommandation',20,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'LEAD_SOURCE','EXISTING_CLIENT','Existing client','عميل حالي','Client existant',30,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'LEAD_SOURCE','MARKETING','Marketing','تسويق','Marketing',40,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'LEAD_SOURCE','PARTNER','Partner','شريك','Partenaire',50,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'LEAD_SOURCE','OTHER','Other','أخرى','Autre',60,true,NOW());

INSERT INTO "RefList" ("key","labelEn","labelAr","labelFr","allowsNewItems","lockedReason","updatedAt") VALUES ('ACTIVITY_TYPE','Activity types','أنواع الأنشطة','Types d''activité',true,NULL,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'ACTIVITY_TYPE','CALL','Call','مكالمة','Appel',0,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'ACTIVITY_TYPE','MEETING','Meeting','اجتماع','Réunion',10,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'ACTIVITY_TYPE','EMAIL','Email','بريد إلكتروني','E-mail',20,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'ACTIVITY_TYPE','SITE_VISIT','Site visit','زيارة موقع','Visite de site',30,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'ACTIVITY_TYPE','NOTE','Note','ملاحظة','Note',40,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'ACTIVITY_TYPE','TASK','Task','مهمة','Tâche',50,true,NOW());

INSERT INTO "RefList" ("key","labelEn","labelAr","labelFr","allowsNewItems","lockedReason","updatedAt") VALUES ('PARTNER_TYPE','Partner types','أنواع الشركاء','Types de partenaire',true,NULL,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'PARTNER_TYPE','SUPPLIER','Supplier','مورّد','Fournisseur',0,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'PARTNER_TYPE','SUBCONTRACTOR','Subcontractor','مقاول باطن','Sous-traitant',10,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'PARTNER_TYPE','CONSULTANT','Consultant','استشاري','Consultant',20,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'PARTNER_TYPE','LOCAL_PARTNER','Local partner','شريك محلي','Partenaire local',30,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'PARTNER_TYPE','LOGISTICS_PROVIDER','Logistics','خدمات لوجستية','Logistique',40,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'PARTNER_TYPE','EQUIPMENT_RENTAL','Equipment rental','تأجير معدات','Location d''équipement',50,true,NOW());

INSERT INTO "RefList" ("key","labelEn","labelAr","labelFr","allowsNewItems","lockedReason","updatedAt") VALUES ('CONTACT_ROLE','Contact roles','أدوار جهات الاتصال','Rôles de contact',true,NULL,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'CONTACT_ROLE','DECISION_MAKER','Decision maker','صاحب القرار','Décideur',0,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'CONTACT_ROLE','TECHNICAL_EVALUATOR','Technical evaluator','المقيّم الفني','Évaluateur technique',10,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'CONTACT_ROLE','COMMERCIAL_EVALUATOR','Commercial evaluator','المقيّم التجاري','Évaluateur commercial',20,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'CONTACT_ROLE','PROCUREMENT','Procurement','المشتريات','Achats',30,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'CONTACT_ROLE','FINANCE','Finance','المالية','Finance',40,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'CONTACT_ROLE','END_USER','End user','المستخدم النهائي','Utilisateur final',50,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'CONTACT_ROLE','GATEKEEPER','Gatekeeper','حارس البوابة','Filtre d''accès',60,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'CONTACT_ROLE','CHAMPION','Champion','المساند','Soutien interne',70,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'CONTACT_ROLE','BLOCKER','Blocker','المعارض','Opposant',80,true,NOW());

INSERT INTO "RefList" ("key","labelEn","labelAr","labelFr","allowsNewItems","lockedReason","updatedAt") VALUES ('COUNTRY','Countries','الدول','Pays',true,NULL,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'COUNTRY','EG','Egypt','مصر','Égypte',0,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'COUNTRY','MG','Madagascar','مدغشقر','Madagascar',10,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'COUNTRY','KM','Comoros','جزر القمر','Comores',20,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'COUNTRY','KE','Kenya','كينيا','Kenya',30,true,NOW());

INSERT INTO "RefList" ("key","labelEn","labelAr","labelFr","allowsNewItems","lockedReason","updatedAt") VALUES ('CURRENCY','Currencies','العملات','Devises',true,NULL,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'CURRENCY','USD','USD','USD','USD',0,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'CURRENCY','EGP','EGP','EGP','EGP',10,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'CURRENCY','EUR','EUR','EUR','EUR',20,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'CURRENCY','MGA','MGA','MGA','MGA',30,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'CURRENCY','KES','KES','KES','KES',40,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'CURRENCY','KMF','KMF','KMF','KMF',50,true,NOW());

INSERT INTO "RefList" ("key","labelEn","labelAr","labelFr","allowsNewItems","lockedReason","updatedAt") VALUES ('CREDIT_STATUS','Credit standing','الحالة الائتمانية','Statut de crédit',false,'Credit standing gates quotation selection in code',NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'CREDIT_STATUS','GOOD','Good standing','منتظم','En règle',0,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'CREDIT_STATUS','WATCH','Watch','تحت المراقبة','À surveiller',10,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'CREDIT_STATUS','HOLD','On hold','موقوف','Suspendu',20,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'CREDIT_STATUS','BLOCKED','Blocked','محظور','Bloqué',30,true,NOW());

INSERT INTO "RefList" ("key","labelEn","labelAr","labelFr","allowsNewItems","lockedReason","updatedAt") VALUES ('OPPORTUNITY_STAGE','Opportunity stages','مراحل الفرصة','Étapes',false,'Stages carry order, transitions, required fields and metric definitions',NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'OPPORTUNITY_STAGE','LEAD_INTAKE','Lead Intake','تسجيل الفرصة','Saisie du prospect',0,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'OPPORTUNITY_STAGE','LEAD_QUALIFICATION','Lead Qualification','تأهيل العميل المحتمل','Qualification du prospect',10,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'OPPORTUNITY_STAGE','OPPORTUNITY_QUALIFICATION','Opportunity Qualification','تأهيل الفرصة','Qualification de l''opportunité',20,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'OPPORTUNITY_STAGE','SCOPE_DISCOVERY','Scope Discovery','دراسة النطاق','Découverte du périmètre',30,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'OPPORTUNITY_STAGE','BID_STRATEGY_SOLUTION','Bid Strategy & Solution','استراتيجية العطاء والحل','Stratégie d''offre et solution',40,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'OPPORTUNITY_STAGE','COSTING_SOURCING','Costing & Sourcing','التكلفة والتوريد','Chiffrage et approvisionnement',50,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'OPPORTUNITY_STAGE','OPERATIONAL_FINANCIAL_REVIEW','Operational & Financial Review','المراجعة التشغيلية والمالية','Revue opérationnelle et financière',60,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'OPPORTUNITY_STAGE','MANAGEMENT_APPROVAL','Management Approval','موافقة الإدارة','Approbation de la direction',70,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'OPPORTUNITY_STAGE','PROPOSAL_SUBMISSION','Proposal Submission','تقديم العرض','Soumission de l''offre',80,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'OPPORTUNITY_STAGE','CLARIFICATIONS_NEGOTIATION','Clarifications & Negotiation','الاستيضاحات والتفاوض','Clarifications et négociation',90,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'OPPORTUNITY_STAGE','AWARD_CONTRACTING','Award & Contracting','الترسية والتعاقد','Attribution et contractualisation',100,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'OPPORTUNITY_STAGE','PROJECT_HANDOVER','Project Handover','تسليم المشروع','Transfert du projet',110,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'OPPORTUNITY_STAGE','ACTUAL_PERFORMANCE_FEEDBACK','Actual Performance Feedback','الأداء الفعلي','Performance réelle',120,true,NOW());

INSERT INTO "RefList" ("key","labelEn","labelAr","labelFr","allowsNewItems","lockedReason","updatedAt") VALUES ('OPPORTUNITY_STATUS','Opportunity status','حالة الفرصة','Statut',false,'Status drives pipeline and win-rate maths',NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'OPPORTUNITY_STATUS','ACTIVE','Active','نشطة','Active',0,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'OPPORTUNITY_STATUS','ON_HOLD','On Hold','معلّقة','En attente',10,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'OPPORTUNITY_STATUS','CANCELLED','Cancelled','ملغاة','Annulée',20,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'OPPORTUNITY_STATUS','LOST','Lost','خسارة','Perdue',30,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'OPPORTUNITY_STATUS','CLOSED','Closed','مغلقة','Clôturée',40,true,NOW());

INSERT INTO "RefList" ("key","labelEn","labelAr","labelFr","allowsNewItems","lockedReason","updatedAt") VALUES ('FORECAST_CATEGORY','Forecast categories','فئات التنبؤ','Catégories de prévision',false,'Forecast weighting is defined per category in code',NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'FORECAST_CATEGORY','PIPELINE','Pipeline','خط الأنابيب','Pipeline',0,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'FORECAST_CATEGORY','UPSIDE','Upside','محتملة','Potentielle',10,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'FORECAST_CATEGORY','BEST_CASE','Best Case','أفضل الحالات','Meilleur cas',20,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'FORECAST_CATEGORY','COMMIT','Commit','ملتزم بها','Engagée',30,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'FORECAST_CATEGORY','CLOSED_WON','Closed Won','فوز مؤكد','Gagnée',40,true,NOW());

INSERT INTO "RefList" ("key","labelEn","labelAr","labelFr","allowsNewItems","lockedReason","updatedAt") VALUES ('HEALTH_STATE','Health','الصحة','Santé',false,'Health drives the at-risk metric and row colouring',NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'HEALTH_STATE','GREEN','Healthy','سليمة','Saine',0,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'HEALTH_STATE','AMBER','Needs Attention','تحتاج متابعة','À surveiller',10,true,NOW());
INSERT INTO "RefListItem" ("id","listKey","code","labelEn","labelAr","labelFr","sortOrder","isSystem","updatedAt") VALUES (gen_random_uuid(),'HEALTH_STATE','RED','At Risk','متعثرة','À risque',20,true,NOW());
