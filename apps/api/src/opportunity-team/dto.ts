import { Role } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

export class AddTeamMemberDto {
  @IsString()
  userId!: string;

  /**
   * The hat this person wears on this bid. Roles are rows here for the same
   * reason contact roles are: the estimator who also runs procurement on a
   * small job holds two, and one column would force a choice that loses the
   * second.
   */
  @IsEnum(Role)
  role!: Role;

  @IsOptional()
  @IsBoolean()
  isLead?: boolean;
}

/**
 * Only the lead flag moves.
 *
 * Changing who a membership is for, or which role it records, is not an edit —
 * it is a different membership, and rewriting it in place would leave the
 * audit trail saying somebody was on the bid team all along.
 */
export class UpdateTeamMemberDto {
  @IsBoolean()
  isLead!: boolean;
}
