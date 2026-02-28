import "./env"; // Load environment from root .env
import "./console_enhanced";
import {
  SESClient,
  SendEmailCommand,
} from "@aws-sdk/client-ses";
import { fromIni } from "@aws-sdk/credential-providers";
import { Logtail } from "@logtail/node";

enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

class Logger {
  private static instance: Logger;
  private logLevel: LogLevel;
  private pid: number;
  private lastEmailSent: number = 0;
  private errorCount: number = 0;
  private errorStatsInterval: NodeJS.Timeout | null = null;
  private pendingEmails: Set<Promise<boolean>> = new Set();
  private logtail: Logtail | null = null;

  private constructor() {
    this.logLevel = this._getLogLevelFromEnv();
    this.pid = process.pid;
    this._initLogtail();
    this._startErrorStatsTimer();
  }

  private _initLogtail(): void {
    const sourceToken = process.env.LOGTAIL_SOURCE_TOKEN;
    const logtailIngestEndpoint = process.env.LOGTAIL_INGEST_ENDPOINT;
     if (sourceToken && logtailIngestEndpoint) {
      try{
      this.logtail = new Logtail(sourceToken, {
        endpoint: `https://${logtailIngestEndpoint}`,
        ignoreExceptions: true,
        batchInterval: 1000,
        batchSize: 1000,
      });
    } catch (err) {
        console.log(`[PID:${this.pid}] WARN: Failed to initialize Logtail: ${err}`);
        this.logtail = null;
      }
    } else {
      console.log(`[PID:${this.pid}] WARN: LOGTAIL_SOURCE_TOKEN not set, Logtail disabled`);
    }
  }

  private _pushToLogtail(level: string, message: string, context?: Record<string, unknown>): void {
    if (!this.logtail) return;

    const logContext = {
      pid: this.pid,
      ...context,
    };

    const prefixedMessage = `[PID:${this.pid}] ${level}: ${message}`;

    try {
      const method = level.toLowerCase() as keyof Pick<Logtail, "debug" | "info" | "warn" | "error">;
      this.logtail[method](prefixedMessage, logContext).catch(this._handleLogtailError);
    } catch (err) {
      this._handleLogtailError(err);
    }
  }

  private _handleLogtailError = (err: unknown): void => {
    console.log(`[PID:${this.pid}] WARN: Logtail push failed: ${err}`);
  };

  private _safeStringify(context: Record<string, unknown>): string {
    try {
      return JSON.stringify(context);
    } catch (err) {
      console.log('[PID:' + this.pid + '] WARN: Failed to stringify log context: ' + err);
      return "[unserializable context]";
    }
  }

  private _logToConsole(level: string, message: string, context?: Record<string, unknown>): void {
    const contextStr = context ? ` | ${this._safeStringify(context)}` : "";
    console.log(`[PID:${this.pid}] ${level}: ${message}${contextStr}`);
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private _getLogLevelFromEnv(): LogLevel {
    const level = (process.env.LOG_LEVEL || process.env.logger_level || "info").toLowerCase();
    switch (level) {
      case "debug":
        return LogLevel.DEBUG;
      case "info":
        return LogLevel.INFO;
      case "warn":
        return LogLevel.WARN;
      case "error":
        return LogLevel.ERROR;
      default:
        return LogLevel.INFO;
    }
  }

  public debug(message: string, context?: Record<string, unknown>): void {
    if (this.logLevel <= LogLevel.DEBUG) {
      this._logToConsole("DEBUG", message, context);
    }
    this._pushToLogtail("DEBUG", message, context);
  }

  public info(message: string, context?: Record<string, unknown>): void {
    if (this.logLevel <= LogLevel.INFO) {
      this._logToConsole("INFO", message, context);
    }
    this._pushToLogtail("INFO", message, context);
  }

  public warn(message: string, context?: Record<string, unknown>): void {
    if (this.logLevel <= LogLevel.WARN) {
      this._logToConsole("WARN", message, context);
    }
    this._pushToLogtail("WARN", message, context);
  }

  private _canSendEmail(): boolean {
    if (process.env.ERROR_EMAILS !== 'true') {
      return false;
    }
    const now = Date.now();
    if (now - this.lastEmailSent > 600000) {
      this.lastEmailSent = now;
      return true;
    }
    return false;
  }

  private _startErrorStatsTimer(): void {
    this.errorStatsInterval = setInterval(() => {
      this.info(`[PID:${this.pid}] TOTAL ERROR STATS: ${this.errorCount}`);
    }, 3600000);
  }

  public async cleanup(): Promise<void> {
    if (this.errorStatsInterval) {
      clearInterval(this.errorStatsInterval);
      this.errorStatsInterval = null;
    }

    if (this.pendingEmails.size > 0) {
      this.info(`Waiting for ${this.pendingEmails.size} pending email(s) to complete...`);
      await Promise.allSettled(Array.from(this.pendingEmails));
      this.pendingEmails.clear();
    }

    if (this.logtail) {
      try {
        await this.logtail.flush();
        console.log(`[PID:${this.pid}] INFO: Logtail flushed successfully`);
      } catch (err) {
        console.log(`[PID:${this.pid}] WARN: Logtail flush failed: ${err}`);
      }
    }

    this.info("Logger cleanup completed - error stats timer cleared");
  }

  public async error(message: string, context?: Record<string, unknown>): Promise<void> {
    this.errorCount++;
    if (this.logLevel <= LogLevel.ERROR) {
      this._logToConsole("ERROR", message, context);
    }
    this._pushToLogtail("ERROR", message, { ...context, errorCount: this.errorCount });

    if (this._canSendEmail()) {
      const emailPromise = this.sendEmail(message);
      this.pendingEmails.add(emailPromise);

      emailPromise.finally(() => {
        this.pendingEmails.delete(emailPromise);
      });

      emailPromise.then(emailSent => {
        if (!emailSent) {
          this._logToConsole("WARN", "Failed to send error email.");
        }
      }).catch(err => {
        this._logToConsole("WARN", `Error sending email: ${err}`);
      });
    }
  }

  public async sendEmail(
    message: string,
    subject: string = ""
  ): Promise<boolean> {
    this.info(`Sending email with subject: ${subject}`);
    const client = new SESClient({
      region: process.env.AWS_SES_REGION || "ap-south-1",
      credentials: fromIni({
        profile: process.env.AWS_SES_PROFILE || "ses-user",
        filepath: process.env.HOME + "/.aws/credentials",
      }),
    });

    if (subject === "") {
      subject = "Hyperliquid analytics service error";
    }

    const htmlMessage = message
      .split("\n")
      .map((line) => `<div>${line}</div>`)
      .join("");

    const params = {
      Destination: {
        ToAddresses: (process.env.SUPPORT_EMAIL || '').split(',').filter(email => email.trim()),
      },
      Message: {
        Body: {
          Text: { Data: message },
          Html: { Data: htmlMessage },
        },
        Subject: { Data: subject },
      },
      Source: '"Team@Airavat" <mailer@airavat.xyz>',
    };

    try {
      const command = new SendEmailCommand(params);
      const response = await client.send(command);
      this.info(`Message sent: ${response.MessageId}`);
      return true;
    } catch (error) {
      this._logToConsole("WARN", `Error in sendEmail: ${error}`);
      return false;
    }
  }
}

export default Logger.getInstance();
