import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ManufacturingSheetsModule } from '../manufacturing-sheets/manufacturing-sheets.module';
import { DocumentsController } from './documents.controller';
import { DocumentsRepository } from './documents.repository';
import { DocumentsService } from './documents.service';
import { SheetEngine, SheetEngineAdapter } from './sheet-engine.port';

// Gestor documental de Hojas de Instrucción de Manufactura (TEST). Módulo SEPARADO de `manufacturing-sheets`: no contiene lógica de composición; usa el puerto `SheetEngine`
// (implementado con los servicios que `ManufacturingSheetsModule` exporta). NO está registrado en `AppModule`: se activará solo cuando la migración `manufactura` esté autorizada
// y aplicada en daubert_hub_test (sin esas tablas, ninguna ruta funcionaría).
@Module({
  imports: [DatabaseModule, ManufacturingSheetsModule],
  controllers: [DocumentsController],
  providers: [DocumentsRepository, DocumentsService, { provide: SheetEngine, useClass: SheetEngineAdapter }]
})
export class ManufacturingDocumentsModule {}
