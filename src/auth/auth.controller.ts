import { Body, Controller, Delete, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { Roles } from './decorators/roles.decorator';
import { AuthService } from './auth.service';
import { CreateUserDto } from './dto/create-user.dto';
import { BootstrapAdminDto } from './dto/bootstrap-admin.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('bootstrap')
  bootstrap(
    @Body() dto: BootstrapAdminDto,
    @Headers('x-bootstrap-token') bootstrapToken?: string,
  ) {
    return this.authService.bootstrapAdmin(dto, bootstrapToken);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('users')
  createUser(@Body() dto: CreateUserDto) {
    return this.authService.createUser(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('users')
  getUsers() {
    return this.authService.getUsers();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Delete('users/:id')
  deleteUser(@Param('id') id: string, @Req() request: Request & { user?: { id?: string } }) {
    return this.authService.deleteUser(id, request.user?.id);
  }
}
