import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsRefCode } from '../master-data/is-ref-code.validator';
import { PartnerApprovalStatus } from '@prisma/client';
import { PARTNER_RATING_MAX, PARTNER_RATING_MIN } from '@acms/shared';

export class CreatePartnerDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  legalName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  tradeName?: string;

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
  taxNumber?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  /**
   * A partner is normally both things at once — supplying material and
   * installing it — so several types may be granted at creation.
   */
  @IsOptional()
  @IsRefCode('PARTNER_TYPE', true)
  types?: string[];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;
}

export class UpdatePartnerDto {
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
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  taxNumber?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;
}

/**
 * Ratings are set together but stored apart. There is no "overall" field to
 * write: an overall score is derived on read, never persisted, so nobody can
 * set it to something the four parts do not support.
 */
export class RatePartnerDto {
  @IsOptional()
  @IsInt()
  @Min(PARTNER_RATING_MIN)
  @Max(PARTNER_RATING_MAX)
  technicalRating?: number;

  @IsOptional()
  @IsInt()
  @Min(PARTNER_RATING_MIN)
  @Max(PARTNER_RATING_MAX)
  commercialRating?: number;

  @IsOptional()
  @IsInt()
  @Min(PARTNER_RATING_MIN)
  @Max(PARTNER_RATING_MAX)
  financialRating?: number;

  @IsOptional()
  @IsInt()
  @Min(PARTNER_RATING_MIN)
  @Max(PARTNER_RATING_MAX)
  hseRating?: number;
}

export class ChangeApprovalStatusDto {
  @IsEnum(PartnerApprovalStatus)
  approvalStatus!: PartnerApprovalStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class BlacklistPartnerDto {
  @IsBoolean()
  isBlacklisted!: boolean;

  /** Mandatory when blacklisting — enforced in the service. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AddPartnerTypeDto {
  @IsRefCode('PARTNER_TYPE')
  type!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ListPartnersQuery {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsRefCode('PARTNER_TYPE')
  type?: string;

  @IsOptional()
  @IsEnum(PartnerApprovalStatus)
  approvalStatus?: PartnerApprovalStatus;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(2)
  country?: string;

  /** Only partners eligible to be awarded work: approved and not blacklisted. */
  @IsOptional()
  @IsIn(['true', 'false'])
  eligibleOnly?: string;

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
