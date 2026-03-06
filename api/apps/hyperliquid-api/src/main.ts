import 'reflect-metadata';
import * as cluster from 'cluster';
import { cpus } from 'os';
import * as fs from 'fs'
import { NestFactory, Reflector } from '@nestjs/core'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common'
import { AllExceptionsFilter } from './all-exceptions.filter'
import { validationExceptionFactory } from './validation-exception.factory'
import { ConfigService } from '@nestjs/config'
import { WsAdapter } from '@nestjs/platform-ws'
import { CryptoService } from '@hyperliquid-api/main/shared/modules/crypto/crypto.service'
import { asyncLocalStorageMiddleware } from '@hyperliquid-api/main/shared/middlewares/async-local-storage.middleware'
import { EnvironmentEnum } from '@hyperliquid-api/main/shared/enums/environment.enum'
import * as cookieParser from 'cookie-parser';
import { Logtail } from '@logtail/node';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { fromIni } from '@aws-sdk/credential-provider-ini';

let decodedConfig = ''
const dirs = ['conf', 'locks']

class BootstrapLogger {
  private logtail: Logtail | null = null;
  private pid = process.pid;

  constructor() {
    this._initLogtail();
  }

  private _initLogtail(): void {
    const sourceToken = process.env.LOGTAIL_SOURCE_TOKEN;
    const endpoint = process.env.LOGTAIL_INGEST_ENDPOINT;
    if (sourceToken && endpoint) {
      try {
        this.logtail = new Logtail(sourceToken, {
          endpoint: `https://${endpoint}`,
          ignoreExceptions: true,
          batchInterval: 1000,
          batchSize: 100,
        });
      } catch (e) {
        console.error(`[PID:${this.pid}] ERROR: Failed to initialize Logtail: ${e}`);
      }
    }
  }

  error(message: string, subject: string = 'Error Occurred') {
    const formatted = `[PID:${this.pid}] ERROR: ${message}`;
    console.error(formatted);
    if (this.logtail) {
      this.logtail.error(formatted, { subject }).catch(() => {});
    }
  }

  warn(message: string) {
    const formatted = `[PID:${this.pid}] WARN: ${message}`;
    console.warn(formatted);
    if (this.logtail) {
      this.logtail.warn(formatted).catch(() => {});
    }
  }

  info(message: string) {
    const formatted = `[PID:${this.pid}] INFO: ${message}`;
    console.info(formatted);
    if (this.logtail) {
      this.logtail.info(formatted).catch(() => {});
    }
  }

  async flush(): Promise<void> {
    if (this.logtail) {
      try {
        await this.logtail.flush();
      } catch (e) {
        console.error(`[PID:${this.pid}] ERROR: Logtail flush failed: ${e}`);
      }
    }
  }
}

const bootstrapLogger = new BootstrapLogger();

async function getSecretValue(secretName: string) {
  try {
    const client = new SecretsManagerClient({
      credentials: fromIni({ profile: process.env.AWS_SECRETS_PROFILE || 'secrets-user' }),
      region: process.env.AWS_SECRETS_REGION || 'eu-west-2'
    })
    const command = new GetSecretValueCommand({ SecretId: secretName })
    const data = await client.send(command)
    let secret = ''
    if ('SecretString' in data && data.SecretString) {
      secret = data.SecretString
    } else if (data.SecretBinary) {
      secret = Buffer.from(data.SecretBinary).toString('utf-8')
    }
    return JSON.parse(secret)["api_secret"]
  } catch (err: any) {
    bootstrapLogger.error(`Failed to retrieve secret: ${err.message}`, 'AWS Secrets Manager Error')
    throw err
  }
}

async function loadConfiguration(): Promise<void> {
  return new Promise((resolve, reject) => {
    (async () => {
    let password
    const rootEnvPath = '../.env'
    const localEnvEncodedPath = './.env.encoded'

    const envEncodedExists = fs.existsSync(localEnvEncodedPath)
    if (envEncodedExists) {
      try {
        password = await getSecretValue(process.env.AWS_SECRET_NAME || 'aira_stack')
      } catch {
        bootstrapLogger.error('AIRASTACK: Failed to retrieve secret from AWS Secrets Manager', 'Configuration Error')
      }
    }

    const envExists = fs.existsSync(rootEnvPath)

    if (envEncodedExists) {
      const crypto = new CryptoService()
      const data = fs.readFileSync(localEnvEncodedPath).toString()
      try {
        decodedConfig = crypto.decrypt(password, data)
        for (const line of decodedConfig.toString().split('\n')) {
          const field = line.slice(0, line.indexOf('=')).trim()
          const value = line.slice(line.indexOf('=') + 1).trim()
          if (field && value) {
            process.env[field] = String(value)
          }
        }
        resolve()
      } catch (error) {
        bootstrapLogger.error(`Config decryption failed: ${error}`, 'Crypto Decryption Error')
        bootstrapLogger.error('Incorrect Password Provided. Try again', 'Crypto Decryption Error')
        reject(error instanceof Error ? error : new Error(String(error)))
      }

    } else if (envExists) {
      const data = fs.readFileSync(rootEnvPath).toString()
      for (const line of data.toString().split('\n')) {
        const field = line.slice(0, line.indexOf('=')).trim()
        const value = line.slice(line.indexOf('=') + 1).trim()
        if (field && value) {
          process.env[field] = String(value)
        }
      }
      resolve()
    } else {
      reject(new Error('Missing env file at ' + rootEnvPath))
    }
    })().catch(reject);
  })
}

loadConfiguration().then(() => {
  const numCPUs = process.env.ENVIRONMENT === EnvironmentEnum.prod ? cpus().length : 1;

  const logger = new BootstrapLogger();

  const isPrimaryProcess = (cluster as any).isPrimary !== undefined ? (cluster as any).isPrimary : (cluster as any).isMaster;
  if (isPrimaryProcess) {
    for (let i = 0; i < numCPUs; i++) {
      cluster.fork();
    }

    cluster.on('fork', (worker) => {
      logger.info(`Worker ${worker.process.pid} has started.`);
    });

    cluster.on('exit', (worker, code, signal) => {
      logger.error(`Worker ${worker.process.pid} died with code ${code} signal ${signal}`, 'Cluster Worker Failure');
      logger.info('Forking new worker...');
      cluster.fork();
    });
  } else {
    process.on('unhandledRejection', (reason, promise) => {
      logger.error(`Unhandled Rejection at: ${promise} reason: ${reason}`, 'Global unhandledRejection');
    });

    process.on('uncaughtException', (error) => {
      logger.error(`Uncaught Exception: ${error}`, 'Global uncaughtException');
    });

    async function bootstrap() {
      for (const dir of dirs) {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir)
        }
      }

      if (!process.env.MACHINE) {
        throw new Error("Need env variable specified on command line with MACHINE=")
      }

      const app = await NestFactory.create(AppModule, {})

      app.useWebSocketAdapter(new WsAdapter(app));

      app.use(cookieParser());

      app.use(asyncLocalStorageMiddleware);

      const isProd = process.env.ENVIRONMENT === 'prod';
      app.enableCors({
        origin: (origin, callback) => {
          if (!origin) return callback(null, true);

          if (isProd) {
            if (/^https:\/\/([a-z0-9-]+\.)?airavat\.xyz$/.test(origin)) {
              return callback(null, true);
            }
          } else {
            if (/^http:\/\/(([a-z0-9-]+\.)?(localhost|lvh\.me))(:\d+)?$/.test(origin)) {
              return callback(null, true);
            }
          }

          callback(new Error('Not allowed by CORS'));
        },
        credentials: true,
      })

      app.setGlobalPrefix('/v1')

      const disableSwagger = app.get(ConfigService).get('DISABLE_SWAGGER')
      if (isProd) {
        logger.info('Production mode — Swagger is disabled');
      } else if (disableSwagger !== 'true' && disableSwagger !== true) {
        const options = new DocumentBuilder()
          .setTitle('Hyperliquid Analytics API')
          .setDescription('Hyperliquid Copy Trading Analytics API')
          .addApiKey(
            { type: 'apiKey', in: 'header', name: 'x-session-id' },
            'x-session-id'
          )
          .build()
        const document = SwaggerModule.createDocument(app, options)
        SwaggerModule.setup('api', app, document)
      }

      app.useGlobalPipes(
        new ValidationPipe({
          transform: true,
          whitelist: true,
          forbidNonWhitelisted: true,
          exceptionFactory: validationExceptionFactory,
        })
      )

      if (app.get(ConfigService).get('VERBOSE_ERRORS')) {
        app.useGlobalFilters(new AllExceptionsFilter())
      }

      app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)))

      await app.listen(Number(app.get(ConfigService).get('PORT') || 3003))
    }

    bootstrap()
  }
}).catch(async (error) => {
  bootstrapLogger.error(`Failed to load configuration: ${error}`, 'Configuration Error');
  await bootstrapLogger.flush();
  process.exit(1)
})
