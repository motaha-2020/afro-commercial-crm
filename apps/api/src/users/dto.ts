import {
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DataScope, Role } from '@prisma/client';

/**
 * A role and the visibility scope it is granted at. The same person often holds
 * several roles, each seeing a different slice of the group — so a role is a row
 * with its own scope, never a single column.
 */
export class RoleAssignmentDto {
  @IsEnum(Role)
  role!: Role;

  @IsEnum(DataScope)
  scope!: DataScope;
}

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullNameAr!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullNameEn!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  jobTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  @IsString()
  orgUnitId!: string;

  @IsOptional()
  @IsString()
  managerId?: string;

  /** At least one role — a user with no role can log in but see nothing. */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleAssignmentDto)
  roles!: RoleAssignmentDto[];
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullNameAr?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullNameEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  jobTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  @IsOptional()
  @IsString()
  orgUnitId?: string;

  @IsOptional()
  @IsString()
  managerId?: string;
}

/** Granting a single role at a scope to an existing user. */
export class GrantRoleDto {
  @IsEnum(Role)
  role!: Role;

  @IsEnum(DataScope)
  scope!: DataScope;
}
