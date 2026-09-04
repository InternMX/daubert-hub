import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PasswordService } from './password.service';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

// No controller yet by design: login/sessions/guards are later phases. This
// module only wires the Users domain (password hashing + repository +
// service) for reuse by the bootstrap script and by future Auth phases.
@Module({
  imports: [DatabaseModule],
  providers: [PasswordService, UsersRepository, UsersService],
  exports: [PasswordService, UsersRepository, UsersService]
})
export class SecurityModule {}
