import { getMetadataStorage } from 'class-validator';
import { STAGE_EXIT_REQUIREMENTS } from '@acms/shared';
import { CreateOpportunityDto, UpdateOpportunityDto } from './dto';

/**
 * Progressive Data Capture only works if every field it demands can actually be
 * supplied. This caught a real dead end: `source` and `industry` gate the exit
 * from LEAD_INTAKE, are optional at creation, and had no update path — so an
 * opportunity registered without them could never advance, with the API
 * rejecting the very field needed to unblock it.
 *
 * The check is derived from STAGE_EXIT_REQUIREMENTS rather than a hand-written
 * list, so adding a requirement in @acms/shared fails here until the DTO can
 * carry it.
 */
function validatedProperties(target: Function): Set<string> {
  return new Set(
    getMetadataStorage()
      .getTargetValidationMetadatas(target, '', false, false)
      .map((m) => m.propertyName),
  );
}

/** Fields the system computes or assigns; a client never sends them. */
const DERIVED_OR_ASSIGNED = new Set([
  'marginPercent', // computed from cost and price on every update
  'ownerId', // defaults to the acting user at creation
  'accountId', // fixed at creation; re-parenting is not an edit
  'country', // fixed at creation, always present
]);

describe('opportunity DTOs vs progressive data capture', () => {
  const settable = new Set([
    ...validatedProperties(CreateOpportunityDto),
    ...validatedProperties(UpdateOpportunityDto),
    ...DERIVED_OR_ASSIGNED,
  ]);

  const required = [...new Set(Object.values(STAGE_EXIT_REQUIREMENTS).flat())];

  it('reads the requirements from the shared definition', () => {
    // Guards the reflection itself: an empty set would make this suite vacuous.
    expect(required.length).toBeGreaterThan(10);
    expect(validatedProperties(UpdateOpportunityDto).size).toBeGreaterThan(5);
  });

  it.each(required)('a client can supply "%s"', (field) => {
    expect(settable.has(field)).toBe(true);
  });

  // The stronger invariant, and the one that catches the real failure: being
  // settable at creation is not enough. A field the stage gate demands must
  // stay correctable afterwards, or a hasty registration is a dead end.
  const correctable = required.filter((f) => !DERIVED_OR_ASSIGNED.has(f));

  it.each(correctable)('an existing opportunity can still be given "%s"', (field) => {
    expect(validatedProperties(UpdateOpportunityDto).has(field)).toBe(true);
  });
});
