import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { TARGET_METRICS, TARGET_PERIODS } from '@acms/shared';

export class SetTargetDto {
  /** Exactly one of these. The service refuses a row that names both. */
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  orgUnitId?: string;

  @IsIn([...TARGET_PERIODS])
  period!: string;

  /** First day of the period. The period type says how long it runs. */
  @IsDateString()
  periodStart!: string;

  @IsIn([...TARGET_METRICS])
  metric!: string;

  /** Required for money metrics; ignored and stored null for counts. */
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsNumber()
  @Min(0)
  value!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ListTargetsQuery {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  orgUnitId?: string;

  @IsOptional()
  @IsIn([...TARGET_METRICS])
  metric?: string;
}
