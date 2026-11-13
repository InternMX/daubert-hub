import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ManufacturingSheetsModule } from '../manufacturing-sheets/manufacturing-sheets.module';
import { ClientAbbreviationsController } from './client-abbreviations.controller';
import { ClientAbbreviationsRepository } from './client-abbreviations.repository';
import { ClientAbbreviationsService } from './client-abbreviations.service';
import { DocumentsController } from './documents.controller';
import { DocumentsRepository } from './documents.repository';
import { DocumentsService } from './documents.service';
import { ResponsablesRepository } from './responsables.repository';
import { ManufacturingEnabledGuard } from './manufacturing-enabled.guard';
import { SheetEngine, SheetEngineAdapter } from './sheet-engine.port';

// Gestor documental de Hojas de Instrucción de Manufactura (TEST). Módulo SEPARADO de `manufacturing-sheets`: no contiene lógica de composición; usa el puerto `SheetEngine`
// (implementado con los servicios que `ManufacturingSheetsModule` exporta). Registrado en `AppModule` con `ManufacturingEnabledGuard`: sus rutas solo responden cuando la base configurada es
// `daubert_hub_test` (donde está aplicada la migración `manufactura`); en cualquier otra base devuelven 404.
@Module({
  imports: [DatabaseModule, ManufacturingSheetsModule],
  controllers: [DocumentsController, ClientAbbreviationsController],
  providers: [DocumentsRepository, ResponsablesRepository, ClientAbbreviationsRepository, ClientAbbreviationsService, DocumentsService, ManufacturingEnabledGuard, { provide: SheetEngine, useClass: SheetEngineAdapter }]
})
export class ManufacturingDocumentsModule {}
