import { Controller, Get, Query } from '@nestjs/common';
import {
  ACCOUNT_RELATIONSHIP_TYPES,
  ACCOUNT_TYPES,
  ACTIVITY_TYPES,
  CONTACT_INFLUENCE_LEVELS,
  CONTACT_ROLES,
  CONTRACT_CLAUSE_TYPES,
  COUNTRIES,
  CREDIT_STATUSES,
  CURRENCIES,
  FORECAST_CATEGORIES,
  HEALTH_STATES,
  INDUSTRIES,
  INVERSE_ACCOUNT_RELATIONSHIP,
  LEAD_SOURCES,
  LEAD_STATUSES,
  LEAD_STATUS_TRANSITIONS,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_STATUSES,
  PARTNER_APPROVAL_STATUSES,
  PARTNER_RATING_DIMENSIONS,
  PARTNER_TYPES,
  QUOTATION_COMMERCIAL_STATUSES,
  QUOTATION_COMPLIANCES,
  QUOTATION_SCORE_DIMENSIONS,
  QUOTATION_TECHNICAL_STATUSES,
  DEFAULT_QUOTATION_WEIGHTS,
  RFQ_STATUSES,
  RISK_LEVELS,
  ROLES,
  STAGE_ORDER,
  STAGE_PRIMARY_OWNER,
} from '@acms/shared';
import { Public } from '../auth/guards';
import { RefListsService } from './ref-lists.service';

/**
 * Read-only catalogue of the system's controlled vocabularies. The UI builds
 * every dropdown from here rather than hard-coding enum values, so codes stay
 * defined in exactly one place (@acms/shared). Public: these are not sensitive
 * and the login screen may need country/locale lists before a token exists.
 */
@Controller('master-data')
export class MasterDataController {
  constructor(private readonly refLists: RefListsService) {}

  /**
   * The lists an administrator maintains now come from the database; the rest
   * still come from code because code branches on them. Both are returned in
   * the same shape so a screen does not need to know which is which.
   *
   * The legacy keys keep returning plain code arrays so existing screens carry
   * on working; `lists` carries the same values with their labels, which is
   * what a dropdown actually needs.
   */
  @Public()
  @Get()
  async all(@Query('activeOnly') activeOnly?: string) {
    const managed = await this.refLists.listAll(activeOnly !== 'false');
    const codesOf = (key: string) =>
      managed.find((l) => l.key === key)?.items.map((i) => i.code);

    return {
      lists: managed,
      ...this.staticCatalogue(),
      // Managed lists override the compiled defaults. Falling back to the
      // constants matters on a database seeded before this feature existed:
      // an empty dropdown would look like a broken screen rather than a
      // migration that has not run.
      industries: codesOf('INDUSTRY') ?? INDUSTRIES,
      accountTypes: codesOf('ACCOUNT_TYPE') ?? ACCOUNT_TYPES,
      leadSources: codesOf('LEAD_SOURCE') ?? LEAD_SOURCES,
      activityTypes: codesOf('ACTIVITY_TYPE') ?? ACTIVITY_TYPES,
      partnerTypes: codesOf('PARTNER_TYPE') ?? PARTNER_TYPES,
      contactRoles: codesOf('CONTACT_ROLE') ?? CONTACT_ROLES,
      countries: codesOf('COUNTRY') ?? COUNTRIES,
      currencies: codesOf('CURRENCY') ?? CURRENCIES,
    };
  }

  private staticCatalogue() {
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
      // Shipped with the list so a screen can label a link from the far end
      // without keeping its own copy of the mapping and drifting from it.
      inverseAccountRelationship: INVERSE_ACCOUNT_RELATIONSHIP,
      contractClauseTypes: CONTRACT_CLAUSE_TYPES,
      riskLevels: RISK_LEVELS,
      partnerTypes: PARTNER_TYPES,
      partnerApprovalStatuses: PARTNER_APPROVAL_STATUSES,
      partnerRatingDimensions: PARTNER_RATING_DIMENSIONS,
      rfqStatuses: RFQ_STATUSES,
      quotationTechnicalStatuses: QUOTATION_TECHNICAL_STATUSES,
      quotationCommercialStatuses: QUOTATION_COMMERCIAL_STATUSES,
      quotationCompliances: QUOTATION_COMPLIANCES,
      quotationScoreDimensions: QUOTATION_SCORE_DIMENSIONS,
      // Published so a comparison screen can show what the weighting was,
      // rather than presenting a score with no visible basis.
      quotationWeights: DEFAULT_QUOTATION_WEIGHTS,
      countries: COUNTRIES,
      currencies: CURRENCIES,
    };
  }
}
