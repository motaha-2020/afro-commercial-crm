import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CONTACT_INFLUENCE_LEVELS,
  CONTACT_ROLES,
  type ContactInfluence,
  type ContactRole,
} from '@acms/shared';

export class CreateContactDto {
  @IsString()
  accountId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  fullName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  jobTitle?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  mobile?: string;

  @IsOptional()
  @IsIn(CONTACT_INFLUENCE_LEVELS)
  influence?: ContactInfluence;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Roles are rows; several may be granted at creation time. */
  @IsOptional()
  @IsIn(CONTACT_ROLES, { each: true })
  roles?: ContactRole[];
}

export class UpdateContactDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  jobTitle?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  mobile?: string;

  @IsOptional()
  @IsIn(CONTACT_INFLUENCE_LEVELS)
  influence?: ContactInfluence;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class AddContactRoleDto {
  @IsIn(CONTACT_ROLES)
  roleCode!: ContactRole;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ListContactsQuery {
  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(CONTACT_ROLES)
  role?: ContactRole;

  // Query strings arrive as text; without @Type the validator rejects "25".
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
