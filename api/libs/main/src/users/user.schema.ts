import { Prop, raw, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { v4 as uuid } from 'uuid';

export type UserDocument = User & Document;

const SHARED_PREFIX = process.env.SHARED_PREFIX || '';

@Schema({
  collection: SHARED_PREFIX ? `${SHARED_PREFIX}_users` : 'users',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
})
export class User {

  @Prop(raw({ type: String, default: uuid }))
  _id: string

  @Prop({ required: true })
  token_expiry: Date;

  @Prop()
  tokens_valid_after: Date;

  created_at: Date;
  updated_at: Date;

  save(options?: { session?: any }): Promise<UserDocument> {
    return (this as any).save(options);
  }
}

export const UserSchema = SchemaFactory.createForClass(User);
