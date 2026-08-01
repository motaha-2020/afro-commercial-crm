import { Controller, Get } from '@nestjs/common';
import {
  ACCOUNT_RELATIONSHIP_TYPES,
  ACCOUNT_TYPES,
  ACTIVITY_TYPES,
  CONTACT_INFLUENCE_LEVELS,
  CONTACT_ROLES,
  COUNTRIES,
  CREDIT_STATUSES,
  CURRENCIES,
  FORECAST_CATEGORIES,
  HEALTH_STATES,
  INDUSTRIES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  LEAD_STATUS_TRANSITIONS,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_STATUSES,
  ROLES,
  STAGE_ORDER,
  STAGE_PRIMARY_OWNER,
} from '@acms/shared';
import { Public } from '../auth/guards';

/**
 * Read-only catalogue of the system's controlled vocabularies. The UI builds
 * every dropdown from here rather than hard-coding enum values, so codes stay
 * defined in exactly one place (@acms/shared). Public: these are not sensitive
 * and the login screen may need country/locale lists before a token exists.
 */
@Controller('master-data')
export class MasterDataController {
  @Public()
  @Get()
  all() {
    return {
      stages: OPPORTUNITY_STAGES.map((code) => ({
        code,
        order: STAGE_ORDER[code],
        primaryOwner: STAGE_PRIMARY_OWNER[code],
      })),
      opportunityStatuses: OPPORTUNITY_STATUSES,
      forecastCategories: FORECAST_CATEGORIES,
      healthStates: HEALTH_STATES,
      roles: ROLES,
      industries: INDUSTRIES,
      accountTypes: ACCOUNT_TYPES,
      creditStatuses: CREDIT_STATUSES,
      leadSources: LEAD_SOURCES,
      leadStatuses: LEAD_STATUSES,
      // Shipped alongside the list so a screen can grey out the moves a lead
      // cannot make instead of offering them and letting the API refuse.
      leadStatusTransitions: LEAD_STATUS_TRANSITIONS,
      activityTypes: ACTIVITY_TYPES,
      contactRoles: CONTACT_ROLES,
      contactInfluenceLevels: CONTACT_INFLUENCE_LEVELS,
      accountRelationshipTypes: ACCOUNT_RELATIONSHIP_TYPES,
      countries: COUNTRIES,
      currencies: CURRENCIES,
    };
  }
}
