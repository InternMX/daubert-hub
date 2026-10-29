import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res, StreamableFile, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { Matches } from 'class-validator';
import type { AuthenticatedRequest } from '../common/authenticated-request';
import { AssignReviewerDto, CreateDraftDto, UpdateDraftDto, VersionDto } from './documents.dto';
import { DocumentsService } from './documents.service';
import type { ActorDocumental } from './documents.types';

export class HistoryQueryDto {
  @Matches(/^[A-Za-z0-9._-]{1,64}$/) codigo!: string;
}

/**
 * Quién actúa: se construye SOLO a partir de `request.user` (puesto por AuthGuard desde una sesión activa) y del `requestId` generado por el servidor. Ninguna ruta de este controlador lee
 * usuario, correo, rol ni fechas del cuerpo, los parámetros ni las cabeceras.
 */
export function actorDeSolicitud(request: AuthenticatedRequest): ActorDocumental {
  const usuario = request.user;
  if (!usuario) throw new UnauthorizedException();
  return { userId: usuario.id, email: usuario.email, displayName: usuario.displayName, role: usuario.role, requestId: request.requestId };
}

// Gestor documental de Hojas de Instrucción de Manufactura (TEST). Autenticado por los guards globales (sin @Public) y con CSRF de origen en las escrituras.
// Rutas finales: /api/manufacturing-sheets/documents/…  Los identificadores públicos son UUID (nunca ids internos).
@Controller('manufacturing-sheets/documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** Cuentas activas que pueden asignarse como revisor (solo id y nombre). */
  @Get('reviewers')
  reviewers(@Req() request: AuthenticatedRequest): ReturnType<DocumentsService['usuariosRevisores']> {
    return this.documents.usuariosRevisores(actorDeSolicitud(request));
  }

  /** Borradores y finalizaciones en curso visibles para esta cuenta (recuperar trabajo). */
  @Get('open')
  open(@Req() request: AuthenticatedRequest): ReturnType<DocumentsService['listarAbiertas']> {
    return this.documents.listarAbiertas(actorDeSolicitud(request));
  }

  /** Historial por código DCMX: versiones finalizadas de todas sus variantes y revisiones abiertas visibles. */
  @Get('history')
  history(@Query() query: HistoryQueryDto, @Req() request: AuthenticatedRequest): ReturnType<DocumentsService['historial']> {
    return this.documents.historial(actorDeSolicitud(request), query.codigo);
  }

  @Post('drafts')
  @HttpCode(HttpStatus.CREATED)
  createDraft(@Body() body: CreateDraftDto, @Req() request: AuthenticatedRequest): ReturnType<DocumentsService['crearBorrador']> {
    return this.documents.crearBorrador(actorDeSolicitud(request), body);
  }

  @Get('revisions/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): ReturnType<DocumentsService['obtener']> {
    return this.documents.obtener(actorDeSolicitud(request), id);
  }

  @Patch('revisions/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateDraftDto, @Req() request: AuthenticatedRequest): ReturnType<DocumentsService['actualizarBorrador']> {
    return this.documents.actualizarBorrador(actorDeSolicitud(request), id, body);
  }

  @Post('revisions/:id/discard')
  @HttpCode(HttpStatus.OK)
  discard(@Param('id', ParseUUIDPipe) id: string, @Body() body: VersionDto, @Req() request: AuthenticatedRequest): ReturnType<DocumentsService['descartarBorrador']> {
    return this.documents.descartarBorrador(actorDeSolicitud(request), id, body.version);
  }

  @Put('revisions/:id/reviewer')
  assignReviewer(@Param('id', ParseUUIDPipe) id: string, @Body() body: AssignReviewerDto, @Req() request: AuthenticatedRequest): ReturnType<DocumentsService['asignarRevisor']> {
    return this.documents.asignarRevisor(actorDeSolicitud(request), id, body);
  }

  /** Registra la revisión de la cuenta de la sesión sobre la versión indicada. */
  @Post('revisions/:id/review')
  @HttpCode(HttpStatus.OK)
  review(@Param('id', ParseUUIDPipe) id: string, @Body() body: VersionDto, @Req() request: AuthenticatedRequest): ReturnType<DocumentsService['registrarRevision']> {
    return this.documents.registrarRevision(actorDeSolicitud(request), id, body.version);
  }

  @Post('revisions/:id/finalize')
  @HttpCode(HttpStatus.OK)
  finalize(@Param('id', ParseUUIDPipe) id: string, @Body() body: VersionDto, @Req() request: AuthenticatedRequest): ReturnType<DocumentsService['finalizar']> {
    return this.documents.finalizar(actorDeSolicitud(request), id, body.version);
  }

  @Post('revisions/:id/cancel-finalization')
  @HttpCode(HttpStatus.OK)
  cancelFinalization(@Param('id', ParseUUIDPipe) id: string, @Body() body: VersionDto, @Req() request: AuthenticatedRequest): ReturnType<DocumentsService['cancelarFinalizacion']> {
    return this.documents.cancelarFinalizacion(actorDeSolicitud(request), id, body.version);
  }

  /** Descarga el PDF de una versión FINALIZADA (verifica su SHA-256 antes de entregarlo). */
  @Get('revisions/:id/pdf')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async pdf(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const documento = await this.documents.descargarPdf(actorDeSolicitud(request), id);
    res.setHeader('Content-Disposition', `attachment; filename="${documento.nombre}"`);
    res.setHeader('X-PDF-SHA256', documento.sha256);
    return new StreamableFile(documento.contenido, { type: 'application/pdf' });
  }

  /** Nueva revisión (borrador) a partir de la última versión finalizada del documento. No modifica las anteriores. */
  @Post(':documentId/revisions')
  @HttpCode(HttpStatus.CREATED)
  newRevision(@Param('documentId', ParseUUIDPipe) documentId: string, @Req() request: AuthenticatedRequest): ReturnType<DocumentsService['crearRevisionNueva']> {
    return this.documents.crearRevisionNueva(actorDeSolicitud(request), documentId);
  }
}
