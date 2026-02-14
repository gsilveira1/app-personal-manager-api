import { Controller, Post, Body, UnauthorizedException, HttpCode, HttpStatus, UseGuards, Get, Request } from '@nestjs/common';

import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { CreateUserDto } from '../users/users-create.dto';
import { AuthLoginDTO } from './auth-login.dto';
import { AuthGuard } from '@nestjs/passport';
import { RequestWithUser } from '../../types/global';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService,
    private readonly usersService: UsersService 
  ) {}

  @Post('login')
  async login(@Body() body: AuthLoginDTO) {
    const user = await this.authService.validateUser(body.email, body.password);
    if (!user) {
      throw new UnauthorizedException('Credenciais inválidas');
    }
    return this.authService.login(user);
  }

  @Post('logout')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  logout() {
    // Em JWT stateless, o servidor não precisa "destruir" a sessão ativamente.
    // O frontend deve receber este 200 OK e apagar o token do armazenamento local.
    return { message: 'Logout realizado com sucesso' };
  }

  @Post('signup')
  async signup(@Body() body: CreateUserDto) {
    return this.usersService.create(body);
  }

   // Endpoint para obter o perfil do utilizador logado
  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  async getProfile(@Request() req: RequestWithUser) {
    // req.user é populado pelo JwtStrategy com o payload do token (userId, username, role)
    // Usamos o UsersService para buscar os dados frescos do banco (sem a senha)
    return this.usersService.findOne(req.user.userId);
  }
}