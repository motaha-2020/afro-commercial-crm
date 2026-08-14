import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsRefCode } from '../master-data/is-ref-code.validator';
import { CreditStatus } from '@prisma/client';

export class CreateAccountDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  legalName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  tradeName?: string;

  @IsRefCode('ACCOUNT_TYPE')
  type!: string;

  @IsOptional()
  @IsRefCode('INDUSTRY')
  industry?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(2)
  country!: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  taxId?: string;

  @IsOptional()
  @IsEnum(CreditStatus)
  creditStatus?: CreditStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  paymentTermDays?: number;

  @IsOptional()
  @IsString()
  parentId?: string;

  /** Defaults to the creating user when omitted. */
  @IsOptional()
  @IsString()
  ownerId?: string;
}

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  legalName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  tradeName?: string;

  @IsOptional()
  @IsRefCode('ACCOUNT_TYPE')
  type?: string;

  @IsOptional()
  @IsRefCode('INDUSTRY')
  industry?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  taxId?: string;

  @IsOptional()
  @IsEnum(CreditStatus)
  creditStatus?: CreditStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  paymentTermDays?: number;

  @IsOptional()
  @IsString()
  ownerId?: string;
}

export class ListAccountsQuery {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(2)
  country?: string;

  @IsOptional()
  @IsRefCode('ACCOUNT_TYPE')
  type?: string;

  // Query strings arrive as text. Without an explicit @Type the validator sees
  // "100" and rejects it as not an integer — which meant every paginated
  // request 400'd, unnoticed until a caller finally passed one.
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
