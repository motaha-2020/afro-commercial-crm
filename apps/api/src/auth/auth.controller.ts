import { Body, Controller, Get, Patch, Post, Req } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { Public } from './guards';
import type { AuthenticatedUser } from './auth.types';

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

class RefreshDto {
  @IsString()
  refreshToken!: string;
}

class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(10)
  newPassword!: string;
}

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullNameAr?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullNameEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  jobTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500000)
  avatarUrl?: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto.email, dto.password, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
  }

  @Public()
  @Post('logout')
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
    return { success: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  @Get('profile')
  profile(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.getProfile(user.id);
  }

  @Patch('profile')
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.auth.updateProfile(user.id, dto);
  }

  @Post('change-password')
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }
}
