import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ClientSession } from 'mongoose';
import { User, UserDocument } from './user.schema';
import { LoggerService } from '../shared/modules/util/logger.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private logger: LoggerService,
  ) {}

  async findUser(userId: string, session?: ClientSession): Promise<UserDocument | null> {
    try {
      const query = this.userModel.findById(userId);

      if (session) {
        query.session(session);
      }

      const user = await query.exec();

      return user;
    } catch (error) {
      this.logger.error(`UsersService::findUser: error finding user ${userId}: ${error}`);
      return null;
    }
  }
}
