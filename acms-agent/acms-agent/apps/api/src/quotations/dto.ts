import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  QuotationCommercialStatus,
  QuotationCompliance,
  QuotationTechnicalStatus,
  RfqStatus,
} from '@prisma/client';
import { CURRENCIES, PARTNER_RATING_MAX, PARTNER_RATING_MIN, type Currency } from '@acms/shared';

export class CreateRfqDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsISO8601()
  dueAt?: string;

  @IsOptional()
  @IsIn(CURRENCIES)
  currency?: Currency;

  /** Partners to send it to; may also be added later, before it is issued. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  partnerIds?: string[];
}

export class UpdateRfqDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsISO8601()
  dueAt?: string;

  @IsOptional()
  @IsEnum(RfqStatus)
  status?: RfqStatus;
}

export class AddRfqRecipientsDto {
  @IsArray()
  @IsString({ each: true })
  partnerIds!: string[];
}

export class QuotationLineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description!: string;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  /** The BOQ item this line answers — the link the costing exit gate demands. */
  @IsOptional()
  @IsString()
  boqItemId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  leadTimeDays?: number;

  @IsOptional()
  @IsEnum(QuotationCompliance)
  compliance?: QuotationCompliance;

  @IsOptional()
  @IsString()
  exception?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class CreateQuotationDto {
  @IsString()
  partnerId!: string;

  @IsOptional()
  @IsString()
  rfqId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  quotationNumber?: string;

  @IsOptional()
  @IsISO8601()
  quotationDate?: string;

  @IsOptional()
  @IsISO8601()
  validUntil?: string;

  @IsOptional()
  @IsIn(CURRENCIES)
  currency?: Currency;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  deliveryDays?: number;

  @IsOptional()
  @IsString()
  warranty?: string;

  @IsOptional()
  @IsString()
  freightTerms?: string;

  @IsOptional()
  @IsString()
  taxTreatment?: string;

  /** Freight, duty and handling beyond the quoted price. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  landedAdjustment?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationLineDto)
  items?: QuotationLineDto[];
}

export class UpdateQuotationDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  quotationNumber?: string;

  @IsOptional()
  @IsISO8601()
  quotationDate?: string;

  @IsOptional()
  @IsISO8601()
  validUntil?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  deliveryDays?: number;

  @IsOptional()
  @IsString()
  warranty?: string;

  @IsOptional()
  @IsString()
  freightTerms?: string;

  @IsOptional()
  @IsString()
  taxTreatment?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  landedAdjustment?: number;

  @IsOptional()
  @IsEnum(QuotationTechnicalStatus)
  technicalStatus?: QuotationTechnicalStatus;

  @IsOptional()
  @IsEnum(QuotationCommercialStatus)
  commercialStatus?: QuotationCommercialStatus;
}

/** Six scores, each 0–5. An omitted one counts as zero, never as excused. */
export class EvaluateQuotationDto {
  @IsOptional()
  @IsInt()
  @Min(PARTNER_RATING_MIN)
  @Max(PARTNER_RATING_MAX)
  priceScore?: number;

  @IsOptional()
  @IsInt()
  @Min(PARTNER_RATING_MIN)
  @Max(PARTNER_RATING_MAX)
  technicalScore?: number;

  @IsOptional()
  @IsInt()
  @Min(PARTNER_RATING_MIN)
  @Max(PARTNER_RATING_MAX)
  deliveryScore?: number;

  @IsOptional()
  @IsInt()
  @Min(PARTNER_RATING_MIN)
  @Max(PARTNER_RATING_MAX)
  paymentScore?: number;

  @IsOptional()
  @IsInt()
  @Min(PARTNER_RATING_MIN)
  @Max(PARTNER_RATING_MAX)
  qualityScore?: number;

  @IsOptional()
  @IsInt()
  @Min(PARTNER_RATING_MIN)
  @Max(PARTNER_RATING_MAX)
  riskScore?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  recommendation?: string;
}

export class SelectQuotationDto {
  /**
   * Required when the choice is not the system's recommendation. Checked in
   * the service, which knows what the recommendation actually was.
   */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  rationale?: string;
}
