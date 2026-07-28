import { BadRequestException, Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { BootstrapAdminDto } from './dto/bootstrap-admin.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    if (!user) throw new UnauthorizedException('Credenciales inválidas');

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) throw new UnauthorizedException('Credenciales inválidas');

    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return { access_token: token, user: { id: user.id, email: user.email, role: user.role } };
  }

  async createUser(dto: CreateUserDto) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) throw new ConflictException('El email ya está registrado');

    const hashed = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        email: dto.email,
        password: hashed,
        role: dto.role ?? Role.CLIENT,
      },
      select: { id: true, username: true, email: true, role: true, createdAt: true },
    });

    return user;
  }

  async bootstrapAdmin(dto: BootstrapAdminDto, bootstrapToken?: string) {
    const expectedToken = this.config.get<string>('BOOTSTRAP_TOKEN');
    if (!expectedToken || !bootstrapToken || bootstrapToken !== expectedToken) {
      throw new UnauthorizedException('Bootstrap no autorizado');
    }

    const hashed = await bcrypt.hash(dto.password, 12);
    return this.prisma.$transaction(async (tx) => {
      const userCount = await tx.user.count();
      if (userCount > 0) {
        throw new ConflictException('El bootstrap ya no está disponible');
      }

      return tx.user.create({
        data: {
          username: dto.username,
          email: dto.email,
          password: hashed,
          role: Role.ADMIN,
        },
        select: { id: true, username: true, email: true, role: true, createdAt: true },
      });
    });
  }

  async getUsers() {
    return this.prisma.user.findMany({
      select: { id: true, username: true, email: true, role: true, createdAt: true },
    });
  }

  async deleteUser(id: string, requesterId?: string) {
    if (id === requesterId) {
      throw new BadRequestException('No puedes eliminar tu propio usuario');
    }

    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) {
      throw new BadRequestException('El usuario no existe');
    }

    if (target.role === Role.ADMIN) {
      const adminCount = await this.prisma.user.count({ where: { role: Role.ADMIN } });
      if (adminCount <= 1) {
        throw new BadRequestException('Debe existir al menos un administrador');
      }
    }

    return this.prisma.user.delete({
      where: { id },
      select: { id: true, username: true, email: true, role: true, createdAt: true },
    });
  }
}
