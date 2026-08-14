import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import {
  BidDecision,
  BidStatus,
  BidType,
  CompletionStatus,
  RequirementType,
  SubmissionMethod,
} from '@prisma/client';

export class CreateBidDto {
  @IsEnum(BidType)
  type!: BidType;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  tenderNumber?: string;

  @IsOptional()
  @IsISO8601()
  issueDate?: string;

  @IsOptional()
  @IsISO8601()
  submissionDeadline?: string;

  @IsOptional()
  @IsISO8601()
  clarificationDeadline?: string;

  @IsOptional()
  @IsBoolean()
  bidBondRequired?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  bidBondAmount?: number;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  bidBondCurrency?: string;

  @IsOptional()
  @IsEnum(SubmissionMethod)
  submissionMethod?: SubmissionMethod;

  @IsOptional()
  @IsString()
  portalReference?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateBidDto extends PartialType(CreateBidDto) {
  @IsOptional()
  @IsEnum(BidStatus)
  status?: BidStatus;

  @IsOptional()
  @IsISO8601()
  submittedAt?: string;
}

export class CreateRequirementDto {
  @IsString()
  @MinLength(3)
  description!: string;

  @IsOptional()
  @IsEnum(RequirementType)
  type?: RequirementType;

  @IsOptional()
  @IsBoolean()
  mandatory?: boolean;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsISO8601()
  dueDate?: string;
}

export class UpdateRequirementDto extends PartialType(CreateRequirementDto) {
  @IsOptional()
  @IsEnum(CompletionStatus)
  status?: CompletionStatus;

  @IsOptional()
  @IsString()
  documentId?: string;
}

export class AssessBidDto {
  /**
   * Factor code -> rating on the 0..5 scale. Validated against the known factor
   * list in the service, since class-validator cannot check dynamic keys.
   */
  @IsObject()
  ratings!: Record<string, number>;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class RecordDecisionDto {
  @IsEnum(BidDecision)
  decision!: BidDecision;

  /** Required by the service when the decision departs from the suggestion. */
  @IsOptional()
  @IsString()
  @MinLength(10)
  rationale?: string;
}

export class UpdateWeightsDto {
  @IsObject()
  weights!: Record<string, number>;
}
