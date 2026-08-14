import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import {
  AssumptionCategory,
  ClarificationImpact,
  ClarificationStatus,
  ConfirmationStatus,
  Responsibility,
  ScopeCategory,
  ScopeInclusion,
  ScopePackageStatus,
} from '@prisma/client';

export class CreateScopePackageDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsEnum(ScopeCategory)
  category?: ScopeCategory;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  responsibleTeam?: string;

  @IsOptional()
  @IsEnum(ScopeInclusion)
  inclusion?: ScopeInclusion;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

/** Every field optional — an edit touches one corner of a scope package. */
export class UpdateScopePackageDto extends PartialType(CreateScopePackageDto) {
  @IsOptional()
  @IsEnum(ScopePackageStatus)
  status?: ScopePackageStatus;
}

export class CreateScopeItemDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  /** Present when breaking a line down — the Scope Builder's "Add Child Item". */
  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  technicalSpecification?: string;

  @IsOptional()
  @IsEnum(Responsibility)
  responsibility?: Responsibility;

  @IsOptional()
  @IsString()
  customerResponsibility?: string;

  @IsOptional()
  @IsString()
  afroResponsibility?: string;

  @IsOptional()
  @IsString()
  exclusion?: string;

  @IsOptional()
  @IsString()
  acceptanceCriteria?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateScopeItemDto extends PartialType(CreateScopeItemDto) {}

export class CreateAssumptionDto {
  @IsString()
  @MinLength(3)
  description!: string;

  @IsOptional()
  @IsEnum(AssumptionCategory)
  category?: AssumptionCategory;

  @IsOptional()
  @IsString()
  impactIfIncorrect?: string;

  @IsOptional()
  @IsString()
  scopeItemId?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;
}

export class UpdateAssumptionDto extends PartialType(CreateAssumptionDto) {
  @IsOptional()
  @IsEnum(ConfirmationStatus)
  confirmationStatus?: ConfirmationStatus;

  @IsOptional()
  @IsString()
  confirmationDocumentId?: string;
}

export class CreateClarificationDto {
  @IsString()
  @MinLength(3)
  question!: string;

  @IsOptional()
  @IsString()
  askedTo?: string;

  @IsOptional()
  @IsISO8601()
  askedAt?: string;

  @IsOptional()
  @IsEnum(ClarificationImpact)
  impact?: ClarificationImpact;
}

export class UpdateClarificationDto {
  @IsOptional()
  @IsString()
  question?: string;

  @IsOptional()
  @IsString()
  askedTo?: string;

  @IsOptional()
  @IsISO8601()
  askedAt?: string;

  @IsOptional()
  @IsString()
  response?: string;

  @IsOptional()
  @IsISO8601()
  respondedAt?: string;

  @IsOptional()
  @IsEnum(ClarificationImpact)
  impact?: ClarificationImpact;

  @IsOptional()
  @IsEnum(ClarificationStatus)
  status?: ClarificationStatus;
}
