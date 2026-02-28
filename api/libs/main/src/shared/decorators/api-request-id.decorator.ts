import { ApiHeader } from '@nestjs/swagger';

/**
 * Decorator to add x-request-id header to OpenAPI documentation
 * Request ID is used for tracking and logging across services
 *
 * The header is optional - if not provided, the middleware will auto-generate a UUID
 */
export const ApiRequestId = () =>
  ApiHeader({
    name: 'x-request-id',
    description: 'Request ID for tracking and logging (optional, auto-generated if not provided)',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  });
