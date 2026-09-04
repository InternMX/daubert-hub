import { SetMetadata } from '@nestjs/common';

// Secure by default: every route requires an authenticated session unless
// explicitly marked @Public(). See AuthGuard.
export const IS_PUBLIC_KEY = 'security:isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

// A user with mustChangePassword=true has a valid session but is blocked
// from ordinary business routes (see MustChangePasswordGuard). Only the
// small set of routes that make a password change possible opt out of that
// block with this decorator.
export const ALLOW_WHILE_PASSWORD_CHANGE_REQUIRED_KEY = 'security:allowWhilePasswordChangeRequired';
export const AllowWhilePasswordChangeRequired = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_WHILE_PASSWORD_CHANGE_REQUIRED_KEY, true);
