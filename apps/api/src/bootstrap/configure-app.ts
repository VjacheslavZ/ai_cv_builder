import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AllExceptionsFilter } from '../common/errors/all-exceptions.filter.js';
import { createValidationPipe } from '../common/validation/validation.pipe.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { originCheck } from '../common/http/origin-check.js';
import { bodyParsersExceptAuth } from './body-parsers.js';

/**
 * Everything `main.ts` does to the HTTP app besides listening. Integration tests call the
 * same function, so they exercise the real middleware stack.
 * The app must be created with `{ bodyParser: false, bufferLogs: true }`.
 */
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  const config = app.get<AppConfig>(APP_CONFIG);

  app.useLogger(app.get(Logger));

  app.use(
    helmet({
      // The API serves JSON only: nothing may load, frame, or submit anywhere.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      xFrameOptions: { action: 'deny' },
    }),
  );
  app.use(originCheck(config.auth.webOrigin));
  app.use(bodyParsersExceptAuth(config.http.jsonBodyLimit));

  app.setGlobalPrefix('api', { exclude: ['health', 'ready'] });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  return app;
}
