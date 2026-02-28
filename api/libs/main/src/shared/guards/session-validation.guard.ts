import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { RedisService } from '@hyperliquid-api/main/cache/redis.service'
import { LoggerService } from '@hyperliquid-api/main/shared/modules/util/logger.service'
import { UsersService } from '@hyperliquid-api/main/users'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator'
import { JwtPayload } from '../interfaces/jwt-payload.interface'
import { ErrorCodes } from '@hyperliquid-api/main/shared/constants/error-codes'
import { COOKIE_CONFIG } from '@hyperliquid-api/main/shared/constants/cookie-config'

const TOKEN_EXPIRY_EXTENSION_HOURS = 2
const REDIS_SESSION_TTL_SECONDS = TOKEN_EXPIRY_EXTENSION_HOURS * 60 * 60

interface SessionData {
  jwt_token: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  last_activity: string;
}

@Injectable()
export class SessionValidationGuard implements CanActivate {
  constructor(
    private readonly logger: LoggerService,
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly cacheService: RedisService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    const request = context.switchToHttp().getRequest()

    const sessionId = request.cookies?.[COOKIE_CONFIG.NAME] || request.headers['x-session-id']

    if (isPublic) {
      if (!sessionId) {
        return true
      }
      this.logger.debug(`SessionValidationGuard:: Public endpoint with session ${sessionId.substring(0, 8)}... - will validate and extend`)
    } else {
      if (!sessionId) {
        this.logger.debug('SessionValidationGuard:: No session found (cookie or header)')
        throw new UnauthorizedException({
          message: 'Session ID required',
          error_code: ErrorCodes.SESSION_REQUIRED,
          field: 'x-session-id'
        })
      }
    }

    const sessionKey = `api_session:${sessionId}`
    const sessionData = await this.cacheService.get<SessionData>(sessionKey)

    if (!sessionData) {
      this.logger.debug(`SessionValidationGuard:: Session not found: ${sessionId.substring(0, 8)}...`)
      throw new UnauthorizedException({
        message: 'Session not found',
        error_code: ErrorCodes.SESSION_NOT_FOUND,
        field: 'x-session-id'
      })
    }

    const { jwt_token, user_id } = sessionData

    if (!jwt_token || !user_id) {
      this.logger.error(`SessionValidationGuard:: Invalid session structure for session ${sessionId.substring(0, 8)}...`)
      await this.cacheService.delete(sessionKey)
      throw new UnauthorizedException({
        message: 'Invalid session data',
        error_code: ErrorCodes.SESSION_INVALID,
        field: 'x-session-id'
      })
    }

    try {
      const decoded = this.jwtService.verify(jwt_token) as JwtPayload

      if (!decoded.user_id || !decoded.role) {
        this.logger.error(
          `SessionValidationGuard:: Invalid JWT payload structure - missing user_id or role for session ${sessionId.substring(0, 8)}...`
        )
        await this.cacheService.delete(sessionKey)
        throw new UnauthorizedException({
          message: 'Invalid token payload',
          error_code: ErrorCodes.SESSION_INVALID,
          field: 'x-session-id'
        })
      }

      if (decoded.session_id !== sessionId) {
        this.logger.error(
          `SessionValidationGuard:: Session ID mismatch. Header: ${sessionId.substring(0, 8)}..., JWT: ${decoded.session_id?.substring(0, 8)}...`
        )
        await this.cacheService.delete(sessionKey)
        throw new UnauthorizedException({
          message: 'Session mismatch',
          error_code: ErrorCodes.SESSION_MISMATCH,
          field: 'x-session-id'
        })
      }

      if (user_id !== decoded.user_id) {
        this.logger.error(
          `SessionValidationGuard:: User ID mismatch. Session: ${user_id}, JWT: ${decoded.user_id}`
        )
        await this.cacheService.delete(sessionKey)
        throw new UnauthorizedException({
          message: 'User mismatch',
          error_code: ErrorCodes.USER_MISMATCH,
          field: 'user_id'
        })
      }

      const user = await this.usersService.findUser(decoded.user_id)

      if (!user) {
        this.logger.error(`SessionValidationGuard:: User not found: ${decoded.user_id}`)
        await this.cacheService.delete(sessionKey)
        throw new UnauthorizedException({
          message: 'User not found',
          error_code: ErrorCodes.USER_NOT_FOUND,
          field: 'user_id'
        })
      }

      const expiresAt = new Date(sessionData.expires_at)
      const now = new Date()

      if (now > expiresAt) {
        this.logger.info(
          `SessionValidationGuard:: Session expired for user ${decoded.user_id}. ` +
          `Expires: ${expiresAt.toISOString()}, Now: ${now.toISOString()}`
        )
        await this.cacheService.delete(sessionKey)
        throw new UnauthorizedException({
          message: 'Session expired',
          error_code: ErrorCodes.SESSION_EXPIRED,
          field: 'x-session-id'
        })
      }

      if (user.tokens_valid_after && (decoded.iat < user.tokens_valid_after.getTime() / 1000)) {
        this.logger.info(
          `SessionValidationGuard:: Token issued before last invalidation for user ${user._id}. ` +
          `Token iat: ${decoded.iat}, tokens_valid_after: ${user.tokens_valid_after.getTime() / 1000}`
        )
        await this.cacheService.delete(sessionKey)
        throw new UnauthorizedException({
          message: 'Session invalidated',
          error_code: ErrorCodes.SESSION_REVOKED,
          field: 'x-session-id'
        })
      }

      const newExpiresAt = new Date(now.getTime() + TOKEN_EXPIRY_EXTENSION_HOURS * 60 * 60 * 1000)
      sessionData.expires_at = newExpiresAt.toISOString()
      sessionData.last_activity = now.toISOString()

      setImmediate(() => {
        this._extendSession(sessionKey, sessionData).catch(error => {
          this.logger.error(`SessionValidationGuard:: Failed to extend Redis session: ${error}`)
        })
      })

      request.user = decoded
      request.userId = decoded.user_id
      request.sessionId = sessionId

      this.logger.debug(`SessionValidationGuard:: Session validated: ${sessionId.substring(0, 8)}...`)
      return true
    } catch (error) {
      const errorName = error instanceof Error ? error.constructor.name : typeof error
      const errorMessage = error instanceof Error ? error.message : String(error)

      if (error instanceof UnauthorizedException) {
        throw error
      }

      if (errorName === 'TokenExpiredError' || errorName === 'JsonWebTokenError' || errorName === 'NotBeforeError') {
        this.logger.debug(
          `SessionValidationGuard:: JWT validation failed for session ${sessionId.substring(0, 8)}...: ${errorName} - ${errorMessage}`
        )
        try {
          await this.cacheService.delete(sessionKey)
        } catch (redisError) {
          this.logger.error(`SessionValidationGuard:: Failed to delete session from Redis: ${redisError}`)
        }
        throw new UnauthorizedException({
          message: 'Invalid or expired token',
          error_code: ErrorCodes.INVALID_TOKEN,
          field: 'x-session-id'
        })
      }

      if (errorName === 'MongoServerError' || errorName === 'MongoNetworkError' || errorName === 'MongoError') {
        this.logger.error(
          `SessionValidationGuard:: Database error during session validation for ${sessionId.substring(0, 8)}...: ${errorName} - ${errorMessage}`,
          { subject: 'Database error in SessionValidationGuard' }
        )
        throw new UnauthorizedException({
          message: 'Authentication service temporarily unavailable',
          error_code: ErrorCodes.AUTH_SERVICE_UNAVAILABLE,
          field: 'x-session-id'
        })
      }

      if (errorName === 'RedisError' || errorName === 'ConnectionError' || errorName === 'TimeoutError') {
        this.logger.error(
          `SessionValidationGuard:: Network/Redis error during session validation for ${sessionId.substring(0, 8)}...: ${errorName} - ${errorMessage}`,
          { subject: 'Network error in SessionValidationGuard' }
        )
        throw new UnauthorizedException({
          message: 'Authentication service temporarily unavailable',
          error_code: ErrorCodes.AUTH_SERVICE_UNAVAILABLE,
          field: 'x-session-id'
        })
      }

      this.logger.error(
        `SessionValidationGuard:: Unexpected error during session validation for ${sessionId.substring(0, 8)}...: ${errorName} - ${errorMessage}`,
        { subject: 'Unexpected error in SessionValidationGuard', context: { stack: error?.stack } }
      )
      try {
        await this.cacheService.delete(sessionKey)
      } catch (redisError) {
        this.logger.error(`SessionValidationGuard:: Failed to delete session from Redis: ${redisError}`)
      }
      throw new UnauthorizedException({
        message: 'Authentication failed',
        error_code: ErrorCodes.AUTHENTICATION_FAILED,
        field: 'x-session-id'
      })
    }
  }

  private async _extendSession(sessionKey: string, sessionData: SessionData): Promise<void> {
    try {
      const ttlMs = REDIS_SESSION_TTL_SECONDS * 1000
      await this.cacheService.set(sessionKey, sessionData, ttlMs)
      this.logger.debug(`SessionValidationGuard::_extendSession: Extended Redis session`)
    } catch (error) {
      this.logger.error(
        `SessionValidationGuard::_extendSession: Failed to extend Redis session: ${error}`,
        { subject: '_extendSession failure' }
      )
    }
  }
}
