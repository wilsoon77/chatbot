import { IsEmail, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  username!: string;  // ← agregar !

  @IsEmail()
  email!: string;  // ← agregar !

  @IsString()
  @MinLength(6)
  password!: string;  // ← agregar !
}