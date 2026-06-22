import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,

    PassportModule,

    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: '8h',
      },
    }),
  ],

  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard, // ← FALTABA ESTO
  ],

  controllers: [AuthController],

  exports: [
    JwtAuthGuard,
    AuthService,
  ],
})
export class AuthModule {}