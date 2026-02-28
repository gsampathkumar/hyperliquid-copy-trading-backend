import { AES, enc } from 'crypto-js';
import { Injectable } from '@nestjs/common';

@Injectable()
export class CryptoService {
  decrypt(secret: string, data: string): string {
    try {
      const bytes = AES.decrypt(data, secret)
      const decryptedEnvString = bytes.toString(enc.Utf8)
      return decryptedEnvString;
    } catch (error) {
      console.error(`CryptoService::decrypt: Decryption failed`, error);
      throw error;
    }
  }
}
