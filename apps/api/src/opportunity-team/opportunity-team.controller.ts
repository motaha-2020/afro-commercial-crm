import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { OpportunityTeamService } from './opportunity-team.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AddTeamMemberDto, UpdateTeamMemberDto } from './dto';

@Controller()
export class OpportunityTeamController {
  constructor(private readonly team: OpportunityTeamService) {}

  @Get('opportunities/:id/team')
  list(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.team.list(user, id);
  }

  // Declared before the write below only for readability; the paths differ,
  // so there is no literal-versus-parameter capture to worry about here.
  @Get('opportunities/:id/team/candidates')
  candidates(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.team.candidates(user, id);
  }

  @Post('opportunities/:id/team')
  add(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddTeamMemberDto,
  ) {
    return this.team.add(user, id, dto);
  }

  @Patch('team-members/:id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateTeamMemberDto,
  ) {
    return this.team.update(user, id, dto);
  }

  @Delete('team-members/:id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.team.remove(user, id);
  }
}
