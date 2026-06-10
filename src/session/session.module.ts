import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SessionService } from './session.service.js';

@Module({
  imports: [ConfigModule],
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionModule {}
