import { Injectable, NotFoundException } from '@nestjs/common';
import type { DocumentCategory } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from './storage.service';
import type { AuthenticatedUser } from '../auth/auth.types';

interface UploadInput {
  title: string;
  category?: DocumentCategory;
  entityType: string;
  entityId: string;
  fileName: string;
  contentType: string;
  buffer: Buffer;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Creates a document and its first version, or appends a new version to an
   * existing document. Either way the bytes are written to object storage first
   * under a unique key, so a version row never points at a missing object.
   */
  async upload(user: AuthenticatedUser, input: UploadInput, documentId?: string) {
    const storageKey = `${input.entityType.toLowerCase()}/${input.entityId}/${randomUUID()}-${input.fileName}`;
    const stored = await this.storage.put(storageKey, input.buffer, input.contentType);

    return this.prisma.$transaction(async (tx) => {
      let doc = documentId
        ? await tx.document.findFirst({
            where: { id: documentId, deletedAt: null },
          })
        : null;

      if (documentId && !doc) throw new NotFoundException('Document not found');

      if (!doc) {
        doc = await tx.document.create({
          data: {
            title: input.title,
            category: input.category ?? 'OTHER',
            entityType: input.entityType,
            entityId: input.entityId,
            uploadedById: user.id,
          },
        });
      }

      const lastVersion = await tx.documentVersion.findFirst({
        where: { documentId: doc.id },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const nextVersion = (lastVersion?.version ?? 0) + 1;

      const version = await tx.documentVersion.create({
        data: {
          documentId: doc.id,
          version: nextVersion,
          storageKey: stored.storageKey,
          fileName: input.fileName,
          contentType: input.contentType,
          sizeBytes: stored.sizeBytes,
          checksum: stored.checksum,
          uploadedById: user.id,
        },
      });

      await tx.document.update({
        where: { id: doc.id },
        data: { currentVersionId: version.id },
      });

      await this.audit.record({
        entityType: 'Document',
        entityId: doc.id,
        action: nextVersion === 1 ? 'CREATE' : 'UPDATE',
        after: { version: nextVersion, fileName: input.fileName, checksum: stored.checksum },
      });

      return { document: doc, version };
    });
  }

  async listForEntity(entityType: string, entityId: string) {
    return this.prisma.document.findMany({
      where: { entityType, entityId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        versions: { orderBy: { version: 'desc' } },
        uploadedBy: { select: { id: true, fullNameEn: true, fullNameAr: true } },
      },
    });
  }

  async getVersionForDownload(documentId: string, versionId?: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, deletedAt: null },
      include: {
        versions: {
          where: versionId ? { id: versionId } : undefined,
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });
    if (!doc || doc.versions.length === 0) {
      throw new NotFoundException('Document version not found');
    }
    const version = doc.versions[0];
    const object = await this.storage.get(version.storageKey);
    return { version, object };
  }
}
