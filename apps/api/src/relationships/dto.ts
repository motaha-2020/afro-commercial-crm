import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  ACCOUNT_RELATIONSHIP_TYPES,
  type AccountRelationshipType,
} from '@acms/shared';

export class CreateAccountRelationshipDto {
  /** The account at the far end. The near end comes from the route. */
  @IsString()
  toId!: string;

  @IsIn(ACCOUNT_RELATIONSHIP_TYPES)
  typeCode!: AccountRelationshipType;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/**
 * Only the notes are editable.
 *
 * Changing which two accounts a link joins, or what kind of link it is, is not
 * a correction — it is a different fact. Editing it in place would silently
 * rewrite the group tree with nothing in the audit trail naming what it used
 * to say, so the endpoint refuses and the caller removes the row and adds the
 * one they meant.
 */
export class UpdateAccountRelationshipDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
