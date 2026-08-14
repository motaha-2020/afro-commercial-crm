import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { setContextUser } from '../common/request-context';
import type { AuthenticatedUser, JwtPayload } from './auth.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    // Bind the acting user into the request context so audit and logging can
    // attribute everything that happens downstream without being passed the id.
    setContextUser(payload.sub);
    return {
      id: payload.sub,
      email: payload.email,
      orgUnitId: payload.orgUnitId,
      roles: payload.roles,
    };
  }
}
