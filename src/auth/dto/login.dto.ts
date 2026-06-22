import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;  // ← agregar !

  @IsString()
  password!: string;  // ← agregar !
}