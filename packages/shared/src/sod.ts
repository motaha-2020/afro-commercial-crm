/**
 * Segregation of Duties — the eight rules the spec calls "أهم قواعد الحوكمة".
 *
 * They are declared here, once, as data rather than scattered `if` statements,
 * for two reasons: the rules must be quotable to an auditor in the same words
 * the spec uses, and most of them bind to modules that do not exist yet
 * (costing, purchase orders, contract deviations). Declaring all eight now means
 * later releases wire an enforcement point to an existing rule instead of
 * inventing governance as they go.
 *
 * A rule is enforced the moment the two actions it separates both exist in the
 * system. `awaitingRelease` records which release brings the missing half.
 */

export const SOD_RULE_CODES = [
  'SOD_01',
  'SOD_02',
  'SOD_03',
  'SOD_04',
  'SOD_05',
  'SOD_06',
  'SOD_07',
  'SOD_08',
] as const;

export type SodRuleCode = (typeof SOD_RULE_CODES)[number];

export interface SodRule {
  code: SodRuleCode;
  /** The spec's wording, kept verbatim so governance reviews are literal. */
  titleAr: string;
  titleEn: string;
  /** The action that disqualifies an actor from performing `blockedAction`. */
  originatingAction: string;
  blockedAction: string;
  /** Entity types the rule is checked against. Empty until the module lands. */
  entityTypes: string[];
  /** Null once enforced; otherwise the release that supplies the missing side. */
  awaitingRelease: number | null;
}

export const SOD_RULES: readonly SodRule[] = [
  {
    code: 'SOD_01',
    titleAr: 'من ينشئ Costing لا يعتمدها نهائيًا',
    titleEn: 'Whoever creates a costing never gives it final approval',
    originatingAction: 'COSTING_CREATE',
    blockedAction: 'COSTING_FINAL_APPROVE',
    entityTypes: ['CostingVersion'],
    // Enforced from Release 4: CostingService.approveVersion refuses the
    // approval when the actor created the version.
    awaitingRelease: null,
  },
  {
    code: 'SOD_02',
    titleAr: 'من يرفع عرض المورد لا يعدل محتوى الملف الأصلي',
    titleEn:
      'Whoever uploads a supplier quotation may record extracted data but never alters the original file',
    originatingAction: 'DOCUMENT_UPLOAD',
    blockedAction: 'DOCUMENT_VERSION_MUTATE',
    entityTypes: ['Document', 'DocumentVersion'],
    // Enforced structurally: versions are append-only and there is no code path
    // that rewrites stored bytes. See DocumentsService.
    awaitingRelease: null,
  },
  {
    code: 'SOD_03',
    titleAr: 'من يوصي بالمورد لا يعتمد أمر الشراء منفردًا',
    titleEn: 'Whoever recommends a supplier cannot approve the purchase order alone',
    originatingAction: 'SUPPLIER_RECOMMEND',
    blockedAction: 'PURCHASE_ORDER_APPROVE',
    entityTypes: ['PurchaseOrder'],
    awaitingRelease: 5,
  },
  {
    code: 'SOD_04',
    titleAr: 'من يطلب خصمًا لا يعتمد الخصم الخاص به',
    titleEn: 'Whoever requests a discount cannot approve their own discount',
    originatingAction: 'DISCOUNT_REQUEST',
    blockedAction: 'DISCOUNT_APPROVE',
    entityTypes: ['DiscountRequest'],
    awaitingRelease: 6,
  },
  {
    code: 'SOD_05',
    titleAr: 'من ينشئ العميل لا يعتمد Credit Limit',
    titleEn: 'Whoever creates the account cannot approve its credit standing',
    originatingAction: 'ACCOUNT_CREATE',
    blockedAction: 'ACCOUNT_CREDIT_APPROVE',
    entityTypes: ['Account'],
    awaitingRelease: null,
  },
  {
    code: 'SOD_06',
    titleAr: 'من يعد Contract Deviation لا يكون صاحب الاعتماد النهائي لنفس الانحراف',
    titleEn:
      'Whoever prepares a contract deviation is not the final approver of that same deviation',
    originatingAction: 'CONTRACT_DEVIATION_PREPARE',
    blockedAction: 'CONTRACT_DEVIATION_APPROVE',
    entityTypes: ['ContractDeviation'],
    awaitingRelease: 7,
  },
  {
    code: 'SOD_07',
    titleAr: 'المستخدم لا يستطيع اعتماد طلب أنشأه بنفسه، حتى لو كان يمتلك أكثر من Role',
    titleEn:
      'A user cannot approve a request they created themselves, even holding several roles',
    originatingAction: 'CREATE',
    blockedAction: 'APPROVE',
    // The catch-all rule: applies to every entity that can be approved, which is
    // why holding two roles never dissolves the conflict.
    entityTypes: ['*'],
    awaitingRelease: null,
  },
  {
    code: 'SOD_08',
    titleAr:
      'تغيير Margin Threshold أو Approval Limit لا يتم بواسطة الشخص الذي يعتمد الصفقات وفق هذا الحد',
    titleEn:
      'Approval limits and margin thresholds are not changed by the person who approves deals against them',
    originatingAction: 'APPROVAL_THRESHOLD_CHANGE',
    blockedAction: 'DEAL_APPROVE_UNDER_THRESHOLD',
    entityTypes: ['ApprovalPolicy'],
    awaitingRelease: 6,
  },
];

export const SOD_RULE_BY_CODE: Record<SodRuleCode, SodRule> = Object.fromEntries(
  SOD_RULES.map((rule) => [rule.code, rule]),
) as Record<SodRuleCode, SodRule>;

/**
 * Rules currently checkable for an entity type. SOD_07 matches everything by
 * design — it is the rule that survives someone accumulating roles.
 */
export function sodRulesFor(entityType: string): SodRule[] {
  return SOD_RULES.filter(
    (rule) =>
      rule.awaitingRelease === null &&
      (rule.entityTypes.includes('*') || rule.entityTypes.includes(entityType)),
  );
}
