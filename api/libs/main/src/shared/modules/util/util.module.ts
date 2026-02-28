import { Module, Global } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { MongooseModule } from '@nestjs/mongoose'
import { LoggerService } from './logger.service'

@Global()
@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature(),
  ],
  providers: [
     LoggerService,
  ],
  exports: [
    LoggerService,
  ],
})
export class UtilModule {}
