import { Controller, Post, Get, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // POST /auth/login  — público
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // POST /auth/users  — protegido
  @UseGuards(JwtAuthGuard)
  @Post('users')
  createUser(@Body() dto: CreateUserDto) {
    return this.authService.createUser(dto);
  }

  // GET /auth/users  — protegido
  @UseGuards(JwtAuthGuard)
  @Get('users')
  getUsers() {
    return this.authService.getUsers();
  }

  // DELETE /auth/users/:id  — protegido
  @UseGuards(JwtAuthGuard)
  @Delete('users/:id')
  deleteUser(@Param('id') id: string) {
    return this.authService.deleteUser(id);
  }
}