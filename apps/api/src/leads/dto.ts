import {
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
import { Type } from 'class-transformer';
import { Industry, LeadSource, LeadStatus } from '@prisma/client';
import { CURRENCIES, type Currency } from '@acms/shared';

export class CreateLeadDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(LeadSource)
  source!: LeadSource;

  @IsString()
  @MinLength(2)
  @MaxLength(2)
  country!: string;

  @IsOptional()
  @IsEnum(Industry)
  industry?: Industry;

  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedValue?: number;

  @IsOptional()
  @IsIn(CURRENCIES)
  currency?: Currency;

  /** An enquiry may arrive before the company behind it is known. */
  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  nextStep?: string;

  /** Defaults to the creating user when omitted. */
  @IsOptional()
  @IsString()
  ownerId?: string;
}

export class UpdateLeadDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @IsOptional()
  @IsEnum(Industry)
  industry?: Industry;

  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedValue?: number;

  @IsOptional()
  @IsIn(CURRENCIES)
  currency?: Currency;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  nextStep?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;
}

export class ChangeLeadStatusDto {
  @IsEnum(LeadStatus)
  status!: LeadStatus;

  /**
   * Mandatory when disqualifying — checked in the service, because "why did we
   * walk away?" is the only question anyone asks about a dead lead later.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ConvertLeadDto {
  /**
   * Required when the lead never named a company: an opportunity without an
   * account has nobody to bill.
   */
  @IsOptional()
  @IsString()
  accountId?: string;

  /** Defaults to the lead's own name when omitted. */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  opportunityName?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedValue?: number;
}

export class ListLeadsQuery {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(2)
  country?: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}
