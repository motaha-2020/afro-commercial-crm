import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ActivityType } from '@prisma/client';

/**
 * `Boolean("false")` is true, so a query flag cannot be coerced with @Type —
 * `?openOnly=false` would have meant the opposite of what it says.
 */
const queryFlag = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value === 'true' || value === '1' : value,
  );

export class CreateActivityDto {
  @IsEnum(ActivityType)
  type!: ActivityType;

  @IsString()
  @MinLength(2)
  @MaxLength(300)
  subject!: string;

  @IsOptional()
  @IsString()
  body?: string;

  // At least one of the four links is required; which one is checked in the
  // service, since class-validator cannot express "any of these".
  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  opportunityId?: string;

  @IsOptional()
  @IsString()
  leadId?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  /**
   * Overrides the default, which completes a logged call or meeting on the
   * spot and leaves a task open.
   */
  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}

export class UpdateActivityDto {
  @IsOptional()
  @IsEnum(ActivityType)
  type?: ActivityType;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  subject?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;
}

export class ListActivitiesQuery {
  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  opportunityId?: string;

  @IsOptional()
  @IsString()
  leadId?: string;

  @IsOptional()
  @IsEnum(ActivityType)
  type?: ActivityType;

  /** Open items only — anything not yet completed. */
  @IsOptional()
  @queryFlag()
  @IsBoolean()
  openOnly?: boolean;

  /** Restricts to the caller's own activities: the "my follow-ups" list. */
  @IsOptional()
  @queryFlag()
  @IsBoolean()
  mine?: boolean;

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
