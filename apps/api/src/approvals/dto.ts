import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApprovalRequestStatus } from '@prisma/client';
import { ROLES } from '@acms/shared';

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
export enum ApprovalProcessDto {
  OPPORTUNITY_PRICING = 'OPPORTUNITY_PRICING',
  DISCOUNT = 'DISCOUNT',
  PROPOSAL_SUBMISSION = 'PROPOSAL_SUBMISSION',
  CONTRACT = 'CONTRACT',
}
export enum ApprovalTypeDto {
  SINGLE = 'SINGLE',
  ALL_OF = 'ALL_OF',
  ANY_OF = 'ANY_OF',
}
export enum ApprovalConditionFieldDto {
  GROSS_MARGIN_PERCENT = 'GROSS_MARGIN_PERCENT',
  OPPORTUNITY_VALUE = 'OPPORTUNITY_VALUE',
  PAYMENT_TERM_DAYS = 'PAYMENT_TERM_DAYS',
  DISCOUNT_PERCENT = 'DISCOUNT_PERCENT',
  COUNTRY_IS_NEW = 'COUNTRY_IS_NEW',
  SINGLE_SOURCE_SUPPLIER = 'SINGLE_SOURCE_SUPPLIER',
  FOREIGN_CURRENCY = 'FOREIGN_CURRENCY',
  SCOPE_NOT_READY = 'SCOPE_NOT_READY',
}
export enum ApprovalOperatorDto {
  LESS_THAN = 'LESS_THAN',
  LESS_OR_EQUAL = 'LESS_OR_EQUAL',
  GREATER_THAN = 'GREATER_THAN',
  GREATER_OR_EQUAL = 'GREATER_OR_EQUAL',
  EQUALS = 'EQUALS',
  IS_TRUE = 'IS_TRUE',
}

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
  /** Short stable handle, e.g. PRICING-KE. Unique, and what a person quotes. */
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsEnum(ApprovalProcessDto)
  businessProcess!: ApprovalProcessDto;

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

  @IsIn(ROLES)
  approverRole!: string;

  @IsOptional()
  @IsEnum(ApprovalTypeDto)
  approvalType?: ApprovalTypeDto;

  @IsOptional()
  @IsInt()
  @Min(0)
  slaHours?: number;

  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @IsOptional()
  @IsIn(ROLES)
  escalationRole?: string;
}

export class CreateRuleDto {
  @IsEnum(ApprovalConditionFieldDto)
  conditionField!: ApprovalConditionFieldDto;

  @IsEnum(ApprovalOperatorDto)
  operator!: ApprovalOperatorDto;

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

/**
 * Filters for the approvals queue.
 *
 * `status` defaults to PENDING in the service rather than here: the queue's
 * job is "what is waiting on you", and an unfiltered screen that also listed
 * everything already decided would bury it.
 */
export class MyQueueQuery {
  @IsOptional()
  @IsEnum(ApprovalRequestStatus)
  status?: ApprovalRequestStatus;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  recordType?: string;

  @IsOptional()
  @IsString()
  requestedById?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
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

// --- workflow editing --------------------------------------------------------




/** Editing an existing workflow: the name, the country it serves, or whether it runs at all. */
export class UpdateWorkflowDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;
}

export class UpdateWorkflowStepDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  sequence?: number;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(ROLES)
  approverRole?: string;

  @IsOptional()
  @IsEnum(ApprovalTypeDto)
  approvalType?: ApprovalTypeDto;

  @IsOptional()
  @IsInt()
  @Min(1)
  slaHours?: number;

  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @IsOptional()
  @IsIn(ROLES)
  escalationRole?: string;
}

export class UpdateRuleDto {
  @IsOptional()
  @IsEnum(ApprovalConditionFieldDto)
  conditionField?: ApprovalConditionFieldDto;

  @IsOptional()
  @IsEnum(ApprovalOperatorDto)
  operator?: ApprovalOperatorDto;

  @IsOptional()
  @IsNumber()
  threshold?: number;

  @IsOptional()
  @IsEnum(ApprovalPolicyKeyDto)
  thresholdPolicyKey?: ApprovalPolicyKeyDto;

  @IsOptional()
  @IsIn(ROLES)
  requiredRole?: string;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
