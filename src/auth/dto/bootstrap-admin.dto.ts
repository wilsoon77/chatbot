import { IsEmail, IsString, MinLength } from 'class-validator';

export class BootstrapAdminDto {
  @IsString()
  username!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
