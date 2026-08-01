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

export enum AwardTypeDto {
  VERBAL_AWARD = 'VERBAL_AWARD',
  LETTER_OF_INTENT = 'LETTER_OF_INTENT',
  PURCHASE_ORDER = 'PURCHASE_ORDER',
  CONTRACT_RECEIVED = 'CONTRACT_RECEIVED',
  CONTRACT_SIGNED = 'CONTRACT_SIGNED',
  NOTICE_TO_PROCEED = 'NOTICE_TO_PROCEED',
}

export enum ContractTypeDto {
  LUMP_SUM = 'LUMP_SUM',
  UNIT_RATE = 'UNIT_RATE',
  COST_PLUS = 'COST_PLUS',
  FRAMEWORK = 'FRAMEWORK',
  SUPPLY_ONLY = 'SUPPLY_ONLY',
  SUPPLY_AND_INSTALL = 'SUPPLY_AND_INSTALL',
  SERVICE = 'SERVICE',
}

export enum DeviationStatusDto {
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  MITIGATED = 'MITIGATED',
}

export enum HandoverPartyDto {
  SALES = 'SALES',
  COMMERCIAL = 'COMMERCIAL',
  FINANCE = 'FINANCE',
  OPERATIONS = 'OPERATIONS',
  PROCUREMENT = 'PROCUREMENT',
  PROJECT_MANAGER = 'PROJECT_MANAGER',
  LEGAL = 'LEGAL',
}

export class RecordAwardDto {
  @IsEnum(AwardTypeDto)
  type!: AwardTypeDto;

  @IsDateString()
  awardedAt!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  awardedValue?: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  customerReference?: string;

  @IsOptional()
  @IsString()
  documentId?: string;

  /** The code Afro opens under the project cost centre once work is awarded. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  erpCostCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  erpCostCenter?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CreateContractDto {
  @IsOptional()
  @IsString()
  awardId?: string;

  /** The proposal this contract should embody; deviations compare against it. */
  @IsOptional()
  @IsString()
  proposalVersionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contractNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  legalEntity?: string;

  @IsOptional()
  @IsEnum(ContractTypeDto)
  type?: ContractTypeDto;

  @IsOptional()
  @IsNumber()
  @Min(0)
  contractValue?: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  paymentTerms?: string;

  @IsOptional()
  @IsNumber()
  retentionPercent?: number;

  @IsOptional()
  @IsNumber()
  advancePercent?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  warrantyMonths?: number;

  @IsOptional()
  @IsNumber()
  ldPercent?: number;

  @IsOptional()
  @IsNumber()
  liabilityCap?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  governingLaw?: string;
}

export class UpdateContractDto extends CreateContractDto {}

export class DecideDeviationDto {
  @IsEnum(DeviationStatusDto)
  status!: DeviationStatusDto;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class AddDeviationDto {
  @IsString()
  field!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  clauseName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  proposalValue?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  contractValue?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  impact?: string;

  @IsOptional()
  @IsString()
  riskLevel?: string;
}

export class CreateHandoverDto {
  @IsOptional()
  @IsString()
  contractId?: string;

  @IsOptional()
  @IsString()
  costBaselineVersionId?: string;

  @IsOptional()
  @IsString()
  projectManagerId?: string;

  @IsOptional()
  @IsDateString()
  plannedStartDate?: string;
}

export class UpdateHandoverDto extends CreateHandoverDto {}

export class AddHandoverItemDto {
  @IsString()
  category!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  documentId?: string;

  @IsOptional()
  @IsString()
  responsibleId?: string;
}

export class UpdateHandoverItemDto {
  @IsOptional()
  @IsBoolean()
  isComplete?: boolean;

  @IsOptional()
  @IsBoolean()
  notApplicable?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notApplicableReason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;

  @IsOptional()
  @IsString()
  documentId?: string;
}

export class SignoffDto {
  @IsEnum(HandoverPartyDto)
  party!: HandoverPartyDto;

  @IsBoolean()
  accept!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
