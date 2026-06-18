import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class CryptoService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor() {
    const secret = process.env.ENCRYPTION_KEY;

    if (!secret) {
      throw new Error('ENCRYPTION_KEY no está definida en el .env');
    }

    this.key = crypto.createHash('sha256').update(secret).digest();
  }

  encrypt(value: string): string {
    try {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);

      const encrypted = Buffer.concat([
        cipher.update(value, 'utf8'),
        cipher.final(),
      ]);

      const authTag = cipher.getAuthTag();

      return [
        iv.toString('base64'),
        authTag.toString('base64'),
        encrypted.toString('base64'),
      ].join(':');
    } catch {
      throw new InternalServerErrorException('No se pudo cifrar el valor');
    }
  }

  decrypt(payload: string): string {
    try {
      const [ivB64, authTagB64, encryptedB64] = payload.split(':');

      if (!ivB64 || !authTagB64 || !encryptedB64) {
        throw new Error('Formato inválido');
      }

      const iv = Buffer.from(ivB64, 'base64');
      const authTag = Buffer.from(authTagB64, 'base64');
      const encryptedText = Buffer.from(encryptedB64, 'base64');

      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(encryptedText),
        decipher.final(),
      ]);

      return decrypted.toString('utf8');
    } catch {
      throw new InternalServerErrorException('No se pudo descifrar el valor');
    }
  }
}