import { Module } from '@nestjs/common';
import { BindErpClient } from './bind/bind-erp.client';
import { BindProductsController } from './bind/bind-products.controller';
import { BindProductsService } from './bind/bind-products.service';

// Hojas de Instrucción de Manufactura: consulta de productos de BIND (fase 2). No importa módulos de base de datos a propósito: este módulo no lee ni escribe en PostgreSQL.
@Module({ controllers: [BindProductsController], providers: [BindErpClient, BindProductsService] })
export class ManufacturingSheetsModule {}
