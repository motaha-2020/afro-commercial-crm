import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { StructuredLogger } from './common/structured-logger';
import { IsRefCodeConstraint } from './master-data/is-ref-code.validator';
import { RefListsService } from './master-data/ref-lists.service';

async function bootstrap() {
  // Buffered so startup messages are emitted through our logger too, not the
  // default one — otherwise the first lines of every boot are unstructured.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(new StructuredLogger());

  app.use(helmet());

  // The default 100kb body was set for forms. A 500-row opportunity import is
  // a few hundred kilobytes of text, and under the default it failed as a bare
  // 413 with nothing naming the file as the cause.
  app.useBodyParser('json', { limit: '4mb' });

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.WEB_ORIGIN?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  });

  // Reference-code validation asks the database which values are currently
  // active, so the constraint needs the service. class-validator builds its own
  // validators, so it is handed over once here rather than injected.
  IsRefCodeConstraint.use(app.get(RefListsService));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Afro Commercial Management System API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  }

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
