import { Module, OnModuleInit } from '@nestjs/common';
import { ImportsController } from './imports.controller';
import { ImportEngineService } from './import-engine.service';
import {
  AccountImportAdapter,
  ContactImportAdapter,
  CrmImportLookups,
  LeadImportAdapter,
  PartnerImportAdapter,
} from './adapters/crm.adapters';
import { OpportunityImportAdapter } from './adapters/opportunity.adapter';
import {
  BoqItemImportAdapter,
  ScopeItemImportAdapter,
  ScopePackageImportAdapter,
} from './adapters/breakdown.adapters';
import { AuthModule } from '../auth/auth.module';
// Every code the importer accepts is checked against the lists an
// administrator maintains, so an industry added this morning imports today.
import { MasterDataModule } from '../master-data/master-data.module';

const ADAPTERS = [
  AccountImportAdapter,
  ContactImportAdapter,
  LeadImportAdapter,
  PartnerImportAdapter,
  OpportunityImportAdapter,
  ScopePackageImportAdapter,
  ScopeItemImportAdapter,
  BoqItemImportAdapter,
];

@Module({
  imports: [AuthModule, MasterDataModule],
  controllers: [ImportsController],
  providers: [ImportEngineService, CrmImportLookups, ...ADAPTERS],
})
export class ImportsModule implements OnModuleInit {
  constructor(
    private readonly engine: ImportEngineService,
    private readonly accounts: AccountImportAdapter,
    private readonly contacts: ContactImportAdapter,
    private readonly leads: LeadImportAdapter,
    private readonly partners: PartnerImportAdapter,
    private readonly opportunities: OpportunityImportAdapter,
    private readonly scopePackages: ScopePackageImportAdapter,
    private readonly scopeItems: ScopeItemImportAdapter,
    private readonly boqItems: BoqItemImportAdapter,
  ) {}

  /**
   * Registered on boot rather than looked up per request: the engine then holds
   * the whole set, and the "what can be imported" endpoint cannot disagree with
   * what is actually wired.
   */
  onModuleInit() {
    for (const adapter of [
      this.accounts,
      this.contacts,
      this.leads,
      this.partners,
      this.opportunities,
      this.scopePackages,
      this.scopeItems,
      this.boqItems,
    ]) {
      this.engine.register(adapter);
    }
  }
}
