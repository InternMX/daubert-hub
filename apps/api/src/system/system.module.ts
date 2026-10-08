import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { SystemStatusService } from './system-status.service';

@Module({ controllers: [SystemController], providers: [SystemStatusService] })
export class SystemModule {}
