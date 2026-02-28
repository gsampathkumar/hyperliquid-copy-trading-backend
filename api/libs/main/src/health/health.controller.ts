import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../shared/decorators/public.decorator';
import { ApiRequestId } from '../shared/decorators/api-request-id.decorator';

@ApiRequestId()
@ApiTags('health')
@Controller('/')
export class HealthController {
    @Public()
    @Get('health')
    @ApiOperation({
        summary: 'Health check endpoint',
        description: 'Returns the health status of the Hyperliquid API service'
    })
    @ApiResponse({
        status: 200,
        description: 'Service is healthy',
        schema: {
            type: 'object',
            properties: {
                status: {
                    type: 'string',
                    example: 'ok'
                },
                timestamp: {
                    type: 'string',
                    format: 'date-time'
                }
            }
        }
    })
    healthCheck() {
        return { status: 'ok', timestamp: new Date() };
    }
}
