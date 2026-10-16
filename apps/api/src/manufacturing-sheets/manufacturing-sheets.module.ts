import { Module } from '@nestjs/common';
import { BindErpClient } from './bind/bind-erp.client';
import { BindProductsController } from './bind/bind-products.controller';
import { BindProductsService } from './bind/bind-products.service';
import { SheetPreviewController } from './preview/sheet-preview.controller';
import { SheetPreviewService } from './preview/sheet-preview.service';

// Hojas de Instrucción de Manufactura: consulta de productos de BIND (fase 2) y vista previa HTML (fase 3). No importa módulos de base de datos a propósito: este módulo no lee ni escribe en PostgreSQL.
@Module({ controllers: [BindProductsController, SheetPreviewController], providers: [BindErpClient, BindProductsService, SheetPreviewService] })
export class ManufacturingSheetsModule {}
