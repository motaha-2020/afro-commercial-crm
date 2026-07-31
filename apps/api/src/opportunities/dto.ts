import {
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
  ForecastCategory,
  HealthState,
  Industry,
  LeadSource,
  OpportunityStage,
  OpportunityStatus,
  ExitReason,
} from '@prisma/client';

export class CreateOpportunityDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsString()
  accountId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(2)
  country!: string;

  @IsOptional()
  @IsEnum(Industry)
  industry?: Industry;

  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedValue?: number;

  @IsOptional()
  @IsString()
  primaryContactId?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  nextStep?: string;
}

export class UpdateOpportunityDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  primaryContactId?: string;

  // Progressive Data Capture requires these to leave LEAD_INTAKE and
  // OPPORTUNITY_QUALIFICATION, and all three are optional at creation — without
  // an update path an opportunity registered in a hurry could never advance.
  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @IsOptional()
  @IsEnum(Industry)
  industry?: Industry;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsEnum(ForecastCategory)
  forecastCategory?: ForecastCategory;

  @IsOptional()
  @IsEnum(HealthState)
  health?: HealthState;

  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedValue?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  proposedPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  awardedValue?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  bidNoBidScore?: number;

  @IsOptional()
  @IsString()
  scopeSummary?: string;

  @IsOptional()
  @IsString()
  solutionStrategy?: string;

  @IsOptional()
  @IsString()
  nextStep?: string;

  @IsOptional()
  @IsISO8601()
  expectedCloseDate?: string;

  @IsOptional()
  @IsISO8601()
  submissionDate?: string;
}

export class ChangeStageDto {
  @IsEnum(OpportunityStage)
  toStage!: OpportunityStage;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class ChangeStatusDto {
  @IsEnum(OpportunityStatus)
  status!: OpportunityStatus;

  /** Required when moving to a terminal status; records why it left the funnel. */
  @IsOptional()
  @IsEnum(ExitReason)
  exitReason?: ExitReason;

  @IsOptional()
  @IsString()
  exitNotes?: string;
}

export class ListOpportunitiesQuery {
  @IsOptional()
  @IsEnum(OpportunityStage)
  stage?: OpportunityStage;

  @IsOptional()
  @IsEnum(OpportunityStatus)
  status?: OpportunityStatus;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(2)
  country?: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
