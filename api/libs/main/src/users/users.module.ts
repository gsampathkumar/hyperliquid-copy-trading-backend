import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './user.schema';
import { UsersService } from './users.service';

@Module({
  imports: [
    // Use 'auth' connection for user lookups (shared with core-exchange-api)
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema }
    ], 'auth'),
  ],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
