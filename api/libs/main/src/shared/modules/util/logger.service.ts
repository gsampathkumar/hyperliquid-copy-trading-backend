import * as SyslogClient from 'syslog-client';
import { Logtail } from '@logtail/node';

import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { mainStorage } from '../../storage/main.storage';
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { fromIni } from "@aws-sdk/credential-provider-ini";
import { EnvironmentEnum } from '../../enums/environment.enum';

function formatDateTime() {
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const dateParts = now.split(',')[0].split('/').map(part => part.padStart(2, '0'));
  const timeParts = now.split(',')[1].trim().split(':').map(part => part.padStart(2, '0'));
  return `${dateParts[2]}/${dateParts[0]}/${dateParts[1]} ${timeParts[0]}:${timeParts[1]}:${timeParts[2]}`;
}

const originalLog = console.log;
console.log = (...args) => originalLog(`[${formatDateTime()}]`, ...args);

const originalError = console.error;
console.error = (...args) => originalError(`[${formatDateTime()}]`, ...args);

@Injectable()
export class LoggerService {
  private syslogClient: SyslogClient.Client;
  private sesClient: SESClient;
  private logtail: Logtail | null = null;

  private loggerLevel = 0
  private sendEmails = false
  private lastEmailSent: number = 0;

  private machine: string;
  private environment: EnvironmentEnum;
  private sharedPrefix: string;
  private serviceName: string;

  constructor(private configService: ConfigService) {
    this.syslogClient = new SyslogClient.Client("localhost", { syslogHostname: 'hyperliquid-api' });
    this.sesClient = new SESClient({
      region: this.configService.get('AWS_SES_REGION') || "ap-south-1",
      credentials: fromIni({ profile: this.configService.get('AWS_SES_PROFILE') || "ses-user" })
    });

    this.machine = this.configService.get('MACHINE') || 'unknown-machine';
    this.environment = (this.configService.get('ENVIRONMENT') as EnvironmentEnum) || EnvironmentEnum.dev;
    this.sharedPrefix = this.configService.get('SHARED_PREFIX') || 'unknown-prefix';
    this.serviceName = this.configService.get('SERVICE_NAME') || 'hyperliquid-api';

    const logtailToken = this.configService.get('LOGTAIL_SOURCE_TOKEN');
    const logtailIngestEndpoint = this.configService.get('LOGTAIL_INGESTING_HOST');
    if (logtailToken && logtailIngestEndpoint) {
      this.logtail = new Logtail(logtailToken, {
        endpoint: `https://${logtailIngestEndpoint}`,
        ignoreExceptions: true,
        batchInterval: 1000,
        batchSize: 1000,
        timeout: 10000,
      });
    } else if (logtailToken && !logtailIngestEndpoint) {
      console.warn('[LoggerService] Logtail not initialized: missing LOGTAIL_INGESTING_HOST');
    }

    this.sendEmails = this.configService.get('ERROR_EMAILS') === 'true' && !!this.configService.get('SUPPORT_EMAIL')

    switch (this.configService.get('LOG_LEVEL')) {
      case 'debug':
        this.loggerLevel = 3
        break
      case 'info':
        this.loggerLevel = 2
        break
      case 'warn':
        this.loggerLevel = 1
        break
      case 'error':
        this.loggerLevel = 0
        break
    }
  }

  private _getPrefix(): string {
    return `[${this.machine}] [${this.environment}] [${this.sharedPrefix}] [${this.serviceName}]`;
  }

  private _logToSyslog(message: string, severity: SyslogClient.Severity) {
    const options = {
      facility: SyslogClient.Facility.Local0,
      severity: severity,
    };
    this.syslogClient.log(message, options);
  }

  private _sendToBetterStack(level: 'debug' | 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>) {
    if (!this.logtail) return;

    const enrichedContext = {
      ...context,
      machine: this.machine,
      environment: this.environment,
      sharedPrefix: this.sharedPrefix,
      service: this.serviceName,
    };

    this.logtail[level](message, enrichedContext).catch((error) =>
    console.warn(`[LoggerService] Failed to send log to BetterStack: ${error}`));
  }

  private _canSendEmail(): boolean {
    const now = Date.now();
    if (now - this.lastEmailSent > 600000) {
      this.lastEmailSent = now;
      return true;
    }
    return false;
  }

  info(message: string, context: Record<string, unknown> = {}) {
    if (this.loggerLevel >= 2) {
      const requestId = this._getRequestId();
      const formattedMessage = `${this._getPrefix()} [${requestId}] ${message}`;
      console.log(formattedMessage);
      this._logToSyslog(formattedMessage, SyslogClient.Severity.Informational);
      this._sendToBetterStack('info', formattedMessage, { ...context, requestId });
    }
  }

  warn(message: string, context: Record<string, unknown> = {}) {
    if (this.loggerLevel >= 1) {
      const requestId = this._getRequestId();
      const formattedMessage = `${this._getPrefix()} [${requestId}] ${message}`;
      console.error(formattedMessage);
      this._logToSyslog(formattedMessage, SyslogClient.Severity.Warning);
      this._sendToBetterStack('warn', formattedMessage, { ...context, requestId });
    }
  }

  debug(message: string, context: Record<string, unknown> = {}) {
    if (this.loggerLevel >= 3) {
      const requestId = this._getRequestId();
      const formattedMessage = `${this._getPrefix()} [${requestId}] ${message}`;
      console.log(formattedMessage);
      this._logToSyslog(formattedMessage, SyslogClient.Severity.Debug);
      this._sendToBetterStack('debug', formattedMessage, { ...context, requestId });
    }
  }

  async error(message: string, options?: { subject?: string; sendAdminEmail?: boolean; context?: Record<string, unknown> }) {
    const { subject = '.error occurred', sendAdminEmail = true, context = {} } = options || {};
    const requestId = this._getRequestId();
    const formattedMessage = `${this._getPrefix()} [${requestId}] Error: ${message}, Subject: ${subject}`;

    if (this.loggerLevel >= 0) {
      console.error(formattedMessage);
      this._logToSyslog(formattedMessage, SyslogClient.Severity.Critical);
      this._sendToBetterStack('error', formattedMessage, { ...context, requestId, subject });
    }

    if (this.sendEmails && sendAdminEmail === true && this._canSendEmail()) {
      this._sendFatalErrorEmail(message, subject).catch((error) => {
        console.warn(`LoggerService::error Failed to send error email: ${error}`)
        this.sendEmails = false
      })
    }
  }

  private async _sendFatalErrorEmail(message: string, subject: string) {
    const stage = this.configService.get('MACHINE') || 'unknown';
    const htmlContent = `
      <html>
        <body style="font-family:Arial,sans-serif;">
          <h2 style="color:#d9534f;">Fatal Error Alert</h2>
          <p><strong>Subject:</strong> ${subject}</p>
          <p><strong>Message:</strong></p>
          <pre style="background:#f5f5f5;padding:10px;border-radius:5px;">${message}</pre>
          <p style="color:#666;font-size:12px;">
            Generated on ${new Date().toISOString()}<br/>
            Environment: ${stage}
          </p>
        </body>
      </html>
    `;

    const params = {
      Destination: { ToAddresses: this.configService.get('SUPPORT_EMAIL')?.split(',').filter(email => email) || [] },
      Message: {
        Body: {
          Html: { Charset: "UTF-8", Data: htmlContent },
          Text: { Charset: "UTF-8", Data: `Fatal Error: ${subject}\n\n${message}` }
        },
        Subject: { Charset: "UTF-8", Data: `[${stage.toUpperCase()}] Fatal Error: ${subject}` }
      },
      Source: "Team@Airavat <mailer@airavat.xyz>"
    };

    try {
      const command = new SendEmailCommand(params);
      const response = await this.sesClient.send(command);
      this.info(`Fatal error email sent: ${response.MessageId}`);
    } catch (error) {
      console.error(`Failed to send fatal error email: ${error}`);
      throw error;
    }
  }

  instrument(message: string) {
    if (this.configService.get('INSTRUMENT') === 'false') return
    const requestId = this._getRequestId();
    const formattedMessage = `${this._getPrefix()} [${requestId}] INSTRUMENT ${message}`;
    console.log(formattedMessage)
    this._logToSyslog(formattedMessage, SyslogClient.Severity.Informational);
    this._sendToBetterStack('info', formattedMessage, { requestId, type: 'instrument' });
  }

  private _getRequestId(): string {
    const contextStore = mainStorage.getStore() as Map<string, any>;
    return contextStore?.get('request_id') || 'no-request-id';
  }
}
