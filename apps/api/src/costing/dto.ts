import { PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  CostElementCategory,
  CostPackageType,
  CostSource,
  CostingScenarioType,
  ResourceType,
} from '@prisma/client';

export class CreateScenarioDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsEnum(CostingScenarioType)
  type?: CostingScenarioType;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsISO8601()
  exchangeRateDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateScenarioDto extends PartialType(CreateScenarioDto) {}

export class CreateVersionDto {
  @IsOptional()
  @IsString()
  revisionReason?: string;

  /**
   * Clone the packages, items and breakdown of an existing version. This is the
   * sanctioned way to change an approved costing: supersede it, never edit it.
   */
  @IsOptional()
  @IsString()
  cloneFromVersionId?: string;
}

export class RejectVersionDto {
  @IsString()
  @MinLength(10)
  reason!: string;
}

export class CreatePackageDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsEnum(CostPackageType)
  type?: CostPackageType;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdatePackageDto extends PartialType(CreatePackageDto) {}

export class CreateBoqItemDto {
  @IsString()
  @MinLength(2)
  description!: string;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsString()
  itemNumber?: string;

  @IsOptional()
  @IsString()
  technicalDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  customerRate?: number;

  /** Either set the rate directly, or use targetMarginPercent to derive it. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  sellingRate?: number;

  @IsOptional()
  @IsNumber()
  @Max(99.99)
  targetMarginPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateBoqItemDto extends PartialType(CreateBoqItemDto) {}

export class CreateBreakdownDto {
  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsNumber()
  @Min(0)
  unitCost!: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  elementId?: string;

  @IsOptional()
  @IsString()
  resourceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  wastePercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  productivityRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  durationDays?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  exchangeRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  allocationPercent?: number;

  @IsOptional()
  @IsEnum(CostSource)
  source?: CostSource;

  @IsOptional()
  @IsString()
  sourceReference?: string;
}

export class UpdateBreakdownDto extends PartialType(CreateBreakdownDto) {}

// --- libraries -------------------------------------------------------------

export class CreateCostElementDto {
  @IsString()
  @MinLength(2)
  code!: string;

  @IsEnum(CostElementCategory)
  category!: CostElementCategory;

  @IsString()
  nameAr!: string;

  @IsString()
  nameEn!: string;

  @IsOptional()
  @IsString()
  nameFr?: string;
}

export class CreateResourceDto {
  @IsString()
  @MinLength(2)
  code!: string;

  @IsEnum(ResourceType)
  type!: ResourceType;

  @IsString()
  nameAr!: string;

  @IsString()
  nameEn!: string;

  @IsString()
  unit!: string;

  @IsNumber()
  @Min(0)
  standardCost!: number;

  @IsISO8601()
  effectiveFrom!: string;

  @IsOptional()
  @IsISO8601()
  effectiveTo?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(2)
  country?: string;

  @IsOptional()
  @IsEnum(CostSource)
  source?: CostSource;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateCostRuleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  category!: string;

  @IsString()
  method!: string;

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

  /**
   * Narrowest scope: this one bid, named by its code.
   *
   * A code rather than an id because a code is what is on the screen and in
   * the tender file; asking a user to find a UUID to scope a rate is asking
   * them to paste the wrong one.
   */
  @IsOptional()
  @IsString()
  opportunityCode?: string;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  /** Why this rate. A bare percentage ages badly. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ApproveCostRuleDto {
  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class ListCostRulesQuery {
  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  orgUnitId?: string;

  /** Ask what applies to one bid, including any rule written for it alone. */
  @IsOptional()
  @IsString()
  opportunityId?: string;
}


// --- tax rules ---------------------------------------------------------------

export enum TaxTypeDto {
  VAT = 'VAT',
  WITHHOLDING = 'WITHHOLDING',
  CUSTOMS_DUTY = 'CUSTOMS_DUTY',
  STAMP_DUTY = 'STAMP_DUTY',
  SOCIAL_INSURANCE = 'SOCIAL_INSURANCE',
  OTHER = 'OTHER',
}

export enum TaxBaseDto {
  SELLING_PRICE = 'SELLING_PRICE',
  DIRECT_COST = 'DIRECT_COST',
  SUBCONTRACTOR_PAYMENTS = 'SUBCONTRACTOR_PAYMENTS',
  IMPORTED_MATERIALS = 'IMPORTED_MATERIALS',
}

export class CreateTaxRuleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsEnum(TaxTypeDto)
  taxType!: TaxTypeDto;

  /** What the rate is charged on — the whole reason this is not one number. */
  @IsEnum(TaxBaseDto)
  base!: TaxBaseDto;

  @IsNumber()
  @Min(0)
  @Max(100)
  ratePercent!: number;

  /** True when the company reclaims it, so it is charged but never borne. */
  @IsOptional()
  @IsBoolean()
  isRecoverable?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;

  @IsOptional()
  @IsString()
  orgUnitId?: string;

  @IsDateString()
  effectiveFrom!: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ApproveTaxRuleDto {
  @IsBoolean()
  approve!: boolean;

  /** Required on a rejection: "rejected" alone tells the next person nothing. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}
