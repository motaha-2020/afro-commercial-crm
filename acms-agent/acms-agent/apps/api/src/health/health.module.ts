import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  // For StorageService: readiness reports on object storage too.
  imports: [DocumentsModule],
  controllers: [HealthController],
})
export class HealthModule {}
