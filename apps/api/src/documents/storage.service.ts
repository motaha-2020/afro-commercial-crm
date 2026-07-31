import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

export interface StoredObject {
  storageKey: string;
  checksum: string;
  sizeBytes: number;
}

/**
 * MinIO-backed object storage (S3 API). File bytes never touch the database —
 * the spec is explicit that documents live in object storage. On the way in we
 * compute a SHA-256 so the stored bytes can later be verified against the
 * checksum recorded in DocumentVersion.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    this.bucket = config.get<string>('MINIO_BUCKET') ?? 'acms-documents';
    const endpoint = config.get<string>('MINIO_ENDPOINT') ?? 'http://minio:9000';

    this.client = new S3Client({
      region: 'us-east-1',
      endpoint,
      forcePathStyle: true, // MinIO needs path-style addressing
      credentials: {
        accessKeyId: config.getOrThrow<string>('MINIO_ROOT_USER'),
        secretAccessKey: config.getOrThrow<string>('MINIO_ROOT_PASSWORD'),
      },
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      // Absent on first boot — create it. A failure here is logged, not fatal:
      // the API should still start so health and non-document routes work.
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created object storage bucket "${this.bucket}"`);
      } catch (err) {
        this.logger.error(
          `Could not ensure bucket "${this.bucket}" — document uploads will fail until storage is reachable`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }

  async put(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<StoredObject> {
    const checksum = createHash('sha256').update(body).digest('hex');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return { storageKey: key, checksum, sizeBytes: body.length };
  }

  async get(key: string): Promise<{ body: Readable; contentType?: string }> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return {
      body: res.Body as Readable,
      contentType: res.ContentType,
    };
  }
}
