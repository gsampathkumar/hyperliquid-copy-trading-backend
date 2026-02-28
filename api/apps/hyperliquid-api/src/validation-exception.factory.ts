import { BadRequestException } from '@nestjs/common';
import { ValidationError } from 'class-validator';

/**
 * Custom exception factory for ValidationPipe
 * Transforms class-validator errors into structured errors with error_code and field
 */
export function validationExceptionFactory(errors: ValidationError[]) {
  const firstError = errors[0];

  if (!firstError) {
    throw new BadRequestException({
      message: 'Validation failed',
      error_code: 'INVALID_PARAMETER',
    });
  }

  const field = firstError.property;
  const constraints = firstError.constraints;
  let message = 'Validation failed';
  let error_code = 'INVALID_PARAMETER_VALUE';

  if (constraints) {
    const firstConstraintKey = Object.keys(constraints)[0];
    message = constraints[firstConstraintKey];

    switch (firstConstraintKey) {
      case 'isNotEmpty':
        error_code = 'MISSING_REQUIRED_FIELD';
        break;
      case 'isNumberString':
        message = message.replace('must be a number', `must be a valid number (e.g., "1", "2.5", "10")`);
        break;
      case 'isBoolean':
        message = `${field} must be a boolean value (true or false)`;
        break;
      default:
        break;
    }
  }

  throw new BadRequestException({
    message,
    error_code,
    field,
  });
}
