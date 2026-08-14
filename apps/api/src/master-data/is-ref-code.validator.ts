import { Injectable } from '@nestjs/common';
import {
  registerDecorator,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { RefListsService } from './ref-lists.service';

/**
 * Replaces `@IsEnum(Industry)` and its siblings.
 *
 * The legal set used to be a compiled enum, so validation was a compile-time
 * fact. Now that an administrator maintains these lists, the legal set is a
 * query — and it has to be the *active* set, or a value switched off this
 * morning would still be accepted onto new records this afternoon.
 */
@ValidatorConstraint({ name: 'isRefCode', async: true })
@Injectable()
export class IsRefCodeConstraint implements ValidatorConstraintInterface {
  /**
   * Validators are constructed by class-validator, not by Nest, so the service
   * is handed over once at bootstrap rather than injected per instance.
   */
  private static lists: RefListsService | null = null;

  static use(lists: RefListsService) {
    IsRefCodeConstraint.lists = lists;
  }

  async validate(value: unknown, args: ValidationArguments) {
    if (value === undefined || value === null) return true; // @IsOptional decides
    const [listKey] = args.constraints as [string];

    // No service means the app is not fully booted. Refusing here would reject
    // legitimate writes for a reason the caller cannot act on, so the length
    // and pattern rules on the field stand alone for that instant.
    if (!IsRefCodeConstraint.lists) return true;

    const codes = await IsRefCodeConstraint.lists.activeCodes(listKey);
    const values = Array.isArray(value) ? value : [value];
    return values.every((v) => typeof v === 'string' && codes.includes(v));
  }

  defaultMessage(args: ValidationArguments) {
    const [listKey] = args.constraints as [string];
    // Names the list, so the caller knows where the value has to be added
    // rather than being told only that this one was wrong.
    return `${args.property} must be an active value of the ${listKey} list`;
  }
}

export function IsRefCode(listKey: string, each = false) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isRefCode',
      target: object.constructor,
      propertyName,
      constraints: [listKey],
      options: { each },
      validator: IsRefCodeConstraint,
    });
  };
}
