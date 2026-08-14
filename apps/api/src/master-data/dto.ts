import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateRefItemDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  code!: string;

  // All three labels are required on creation. Letting one through empty means
  // a user working in that language sees a bare code on their screen, which is
  // the exact problem these lists exist to remove.
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  labelEn!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  labelAr!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  labelFr!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateRefItemDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  labelEn?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  labelAr?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  labelFr?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ReorderDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids!: string[];
}
