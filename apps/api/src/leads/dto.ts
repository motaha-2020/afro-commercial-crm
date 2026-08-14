import {
  IsBoolean,
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
import { Transform, Type } from 'class-transformer';
import { IsRefCode } from '../master-data/is-ref-code.validator';
import { LeadStatus } from '@prisma/client';
import { CURRENCIES, type Currency } from '@acms/shared';

export class CreateLeadDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsRefCode('LEAD_SOURCE')
  source!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(2)
  country!: string;

  @IsOptional()
  @IsRefCode('INDUSTRY')
  industry?: string;

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
  @IsRefCode('LEAD_SOURCE')
  source?: string;

  @IsOptional()
  @IsRefCode('INDUSTRY')
  industry?: string;

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
  @IsRefCode('LEAD_SOURCE')
  source?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(2)
  country?: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  /**
   * Archived leads are out of the working list by default. Asking for them is
   * deliberate — a list that quietly includes them is the reason people stop
   * trusting the count in the corner.
   */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeArchived?: boolean;

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
