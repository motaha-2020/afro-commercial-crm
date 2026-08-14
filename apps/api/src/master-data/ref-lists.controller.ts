import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { RefListsService } from './ref-lists.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequireRoles } from '../auth/guards';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CreateRefItemDto, ReorderDto, UpdateRefItemDto } from './dto';

/**
 * Administration of the reference lists. Reading them is open to every signed-in
 * user because every screen builds its dropdowns from them; changing them is
 * not, because a value here is the vocabulary the whole company then files work
 * under. Every change is audited.
 */
@Controller('ref-lists')
@RequireRoles('SYSTEM_ADMIN')
export class RefListsController {
  constructor(private readonly lists: RefListsService) {}

  /** Everything, including switched-off values — they have to be switchable back on. */
  @Get()
  all() {
    return this.lists.listAll(false);
  }

  @Post(':listKey/items')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listKey') listKey: string,
    @Body() dto: CreateRefItemDto,
  ) {
    return this.lists.create(user, listKey, dto);
  }

  @Patch('items/:id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateRefItemDto,
  ) {
    return this.lists.update(user, id, dto);
  }

  /** Deactivates. Nothing here is ever erased. */
  @Delete('items/:id')
  deactivate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.lists.deactivate(user, id);
  }

  @Patch(':listKey/order')
  reorder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listKey') listKey: string,
    @Body() dto: ReorderDto,
  ) {
    return this.lists.reorder(user, listKey, dto);
  }
}
