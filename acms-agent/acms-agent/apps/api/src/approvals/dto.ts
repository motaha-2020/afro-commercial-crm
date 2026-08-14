import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export enum ApprovalPolicyKeyDto {
  MIN_GROSS_MARGIN_PERCENT = 'MIN_GROSS_MARGIN_PERCENT',
  MIN_SELLING_PRICE_MARGIN_PERCENT = 'MIN_SELLING_PRICE_MARGIN_PERCENT',
  APPROVAL_VALUE_LIMIT = 'APPROVAL_VALUE_LIMIT',
  MAX_PAYMENT_TERM_DAYS = 'MAX_PAYMENT_TERM_DAYS',
  MAX_DISCOUNT_PERCENT = 'MAX_DISCOUNT_PERCENT',
  BID_GO_THRESHOLD = 'BID_GO_THRESHOLD',
  BID_CONDITIONAL_THRESHOLD = 'BID_CONDITIONAL_THRESHOLD',
}

export enum ApprovalDecisionDto {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  RETURN_FOR_REVISION = 'RETURN_FOR_REVISION',
  APPROVE_WITH_CONDITIONS = 'APPROVE_WITH_CONDITIONS',
}

export enum ProposalTypeDto {
  BUDGETARY = 'BUDGETARY',
  INITIAL = 'INITIAL',
  REVISED = 'REVISED',
  BAFO = 'BAFO',
  FINAL = 'FINAL',
  TECHNICAL = 'TECHNICAL',
  COMMERCIAL = 'COMMERCIAL',
  COMBINED = 'COMBINED',
}

/**
 * Setting a limit. Note there is no "value is optional" case: a policy row
 * exists to carry a number somebody chose.
 */
export class SetPolicyDto {
  @IsEnum(ApprovalPolicyKeyDto)
  key!: ApprovalPolicyKeyDto;

  @IsNumber()
  value!: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;

  @IsOptional()
  @IsString()
  orgUnitId?: string;

  @IsOptional()
  @IsString()
  opportunityId?: string;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  /** Why the limit is what it is. Asked for, because a bare number ages badly. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ListPoliciesQuery {
  @IsOptional()
  @IsEnum(ApprovalPolicyKeyDto)
  key?: ApprovalPolicyKeyDto;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  orgUnitId?: string;

  @IsOptional()
  @IsString()
  opportunityId?: string;

  /** Ask what applied on a past date — how an old approval stays explainable. */
  @IsOptional()
  @IsDateString()
  asOf?: string;

  @IsOptional()
  @IsBoolean()
  includeHistory?: boolean;
}

export class CreateWorkflowDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  businessProcess!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;

  @IsOptional()
  @IsString()
  orgUnitId?: string;
}

export class CreateWorkflowStepDto {
  @IsInt()
  @Min(1)
  sequence!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  approverRole!: string;

  @IsOptional()
  @IsString()
  approvalType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  slaHours?: number;

  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @IsOptional()
  @IsString()
  escalationRole?: string;
}

export class CreateRuleDto {
  @IsString()
  conditionField!: string;

  @IsString()
  operator!: string;

  @IsOptional()
  @IsNumber()
  threshold?: number;

  @IsOptional()
  @IsEnum(ApprovalPolicyKeyDto)
  thresholdPolicyKey?: ApprovalPolicyKeyDto;

  @IsString()
  requiredRole!: string;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class RaiseApprovalDto {
  @IsOptional()
  @IsString()
  recordType?: string;

  @IsOptional()
  @IsString()
  recordId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class DecideDto {
  @IsEnum(ApprovalDecisionDto)
  decision!: ApprovalDecisionDto;

  /** The spec: "لا موافقات شفوية غير مسجلة" — no unrecorded verbal approvals. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  conditions?: string;
}

export class CreateDiscountRequestDto {
  @IsNumber()
  @Min(0)
  requestedPercent!: number;

  @IsNumber()
  @Min(0)
  fromPrice!: number;

  @IsNumber()
  @Min(0)
  toPrice!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  justification!: string;
}

export class DecideDiscountDto {
  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class CreateProposalDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  bidId?: string;
}

export class CreateProposalVersionDto {
  @IsOptional()
  @IsEnum(ProposalTypeDto)
  type?: ProposalTypeDto;

  /** Required for anything commercial — see the service for why. */
  @IsOptional()
  @IsString()
  costingVersionId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  sellingPrice?: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsDateString()
  validUntil?: string;

  // The terms a contract will later be compared against, one by one.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  paymentTerms?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  warrantyMonths?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  ldPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  liabilityCap?: number;
}

export class SubmitProposalVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  submissionMethod?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  submittedTo?: string;
}
