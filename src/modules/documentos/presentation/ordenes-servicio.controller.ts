/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Órdenes de servicio
 * Archivo: ordenes-servicio.controller.ts
 * Responsabilidad: Exponer la emisión y la consulta de las órdenes propias.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * DOS ENDPOINTS CON DOS LÓGICAS DE ACCESO OPUESTAS.
 *
 *   · **Emitir** es exclusivo del `DIRECTOR` (PER-05). Es un acto de la Dirección.
 *   · **Consultar las propias** lo hace **cualquier usuario autenticado**, y por eso no
 *     lleva `@Roles`: el filtro no es el rol, es la identidad. Cada quien ve las suyas.
 *
 * `/ordenes-servicio/mias` NO ACEPTA NINGÚN PARÁMETRO QUE DIGA DE QUIÉN SON. El
 * funcionario sale del usuario autenticado y de ningún otro sitio: es el caso 6 del plan
 * y la única forma de que manipular la petición no sirva de nada. Si el identificador
 * viajara en la ruta o en la consulta, bastaría cambiarlo para leer las órdenes de otro.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { ValidacionError } from '../../../common/errors/errores-dominio';
import { exportarOrden } from '../application/exportador-orden';
import type {
  Apartado,
  DatosOrdenMemorando,
} from '../application/exportador-orden-memorando';
import type { OrdenConOperativo } from '../infrastructure/orden-servicio.repository';
import {
  OrdenServicioService,
  type SugerenciaFirmante,
  type DatosGenerales,
  type PlantillaDeDirector,
} from '../application/orden-servicio.service';
import { DirectorGuard } from './director.guard';
import { EditarMemorandoDto } from './dto/editar-memorando.dto';
import { GuardarPlantillaDto } from './dto/guardar-plantilla.dto';
import { PrevisualizarPlantillaDto } from './dto/previsualizar-plantilla.dto';
import { enLenguajeNatural } from '../application/reglas-matriz';
import { esDatoAisladoValido } from '../domain/dato-aislado';
import {
  aOrdenServicioResponse,
  type OrdenServicioResponseDto,
} from './dto/orden-servicio.dto';

@Controller()
@UseGuards(IdentidadGuard, PermisosGuard)
export class OrdenesServicioController {
  constructor(private readonly ordenes: OrdenServicioService) {}

  /** CU-09. Una orden por cada funcionario asignado. Solo la Dirección emite. */
  @Post('operativos/:id/ordenes-servicio')
  @RequierePermiso('ordenes:gestionar')
  @UseGuards(DirectorGuard)
  async emitir(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<OrdenServicioResponseDto[]> {
    const emitidas = await this.ordenes.emitir(id, {
      usuarioId: usuario.usuarioId,
      nombre: usuario.nombre,
      roles: usuario.roles,
    });

    return this.responder(emitidas, usuario.usuarioId, true);
  }

  /** Lo ya emitido para un operativo. Pantalla P-05. */
  @Get('operativos/:id/ordenes-servicio')
  @RequierePermiso('ordenes:gestionar')
  @UseGuards(DirectorGuard)
  async consultarDeOperativo(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<OrdenServicioResponseDto[]> {
    const emitidas = await this.ordenes.consultarDeOperativo(id);
    return this.responder(emitidas, usuario.usuarioId, true);
  }

  /**
   * RN-49. Las órdenes de quien consulta. Pantalla P-06.
   *
   * **Sin `@Roles`, y es deliberado**: el destinatario de una orden es un funcionario,
   * no un rol. Cualquier usuario autenticado puede pedir las suyas, y «las suyas» lo
   * decide el servidor.
   */
  @Get('ordenes-servicio/mias')
  async consultarPropias(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query('desde') desde?: string,
  ): Promise<OrdenServicioResponseDto[]> {
    const propias = await this.ordenes.consultarPropias(
      usuario.usuarioId,
      desde ? exigirFecha(desde) : undefined,
    );

    return this.responder(propias, usuario.usuarioId, false);
  }

  /**
   * Compone la respuesta de una lista de órdenes con sus faltantes YA calculados (D12): el servicio
   * los deriva con la plantilla y versión DE CADA ORDEN, y el chip/estado sale de ahí.
   *
   * En las pantallas de la Dirección (`sincronizar`), una orden a la que ya no le falta nada pero aún
   * no tiene número se numera aquí mismo (paso automático a Vigente, punto 14). La consulta propia
   * del destinatario no escribe nada.
   */
  private async responder(
    ordenes: OrdenConOperativo[],
    usuarioId: number,
    sincronizar: boolean,
  ): Promise<OrdenServicioResponseDto[]> {
    const faltantes = await this.ordenes.faltantesPorCodigo(ordenes);
    if (sincronizar) await this.ordenes.asegurarVigencia(ordenes, faltantes);
    const nombresDirectores = await this.ordenes.nombresDeDirectores(ordenes);
    return ordenes.map((orden) =>
      aOrdenServicioResponse(orden, faltantes.get(orden.codigo) ?? [], {
        usuarioId,
        nombresDirectores,
      }),
    );
  }

  /**
   * El documento de una orden propia, en PDF.
   *
   * Se comprueba que la orden **sea de quien la pide**: sin esa comprobación, conocer un
   * código bastaría para descargar la asignación de otra persona, que es exactamente lo
   * que RN-49 impide.
   */
  @Get('ordenes-servicio/:codigo/documento')
  @Header('Content-Type', 'application/pdf')
  async descargar(
    @Param('codigo') codigo: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    const propias = await this.ordenes.consultarPropias(usuario.usuarioId);
    const orden = propias.find((candidata) => candidata.codigo === codigo);

    if (!orden) {
      // Se responde igual que si no existiera: decir «existe, pero no es suya» ya sería
      // confirmar que esa persona tiene un operativo ese día.
      throw new ValidacionError(
        `No existe una orden de servicio suya con el código ${codigo}.`,
        { codigo },
      );
    }

    const dato = orden.datoAislado as unknown;

    if (!esDatoAisladoValido(dato)) {
      throw new ValidacionError(
        `La orden ${codigo} tiene un contenido que no corresponde a los cuatro campos autorizados.`,
        { codigo },
      );
    }

    const contenido = await exportarOrden(
      {
        codigo: orden.codigo,
        fechaNatural: enLenguajeNatural(orden.operativo.cuadro.fecha),
        emitidaEn: orden.emitidaEn,
      },
      dato,
    );

    respuesta.setHeader(
      'Content-Disposition',
      `attachment; filename="orden-${codigo}.pdf"`,
    );

    return new StreamableFile(contenido);
  }

  /**
   * El memorando de una orden emitida, para que la Dirección lo vea desde P-05.
   *
   * A DIFERENCIA DE `/documento` (que es del destinatario), este es de la **Dirección**:
   * enumera los operativos de esa persona en su jornada, en el formato oficial. Reintroduce
   * la vista del PDF que la app había retirado el 2026-09-10, ahora en formato memorando y
   * solo para quien emite. Sigue siendo de ESA persona (RN-51): no menciona a las demás.
   */
  @Get('ordenes-servicio/:codigo/memorando')
  @RequierePermiso('ordenes:gestionar')
  @UseGuards(DirectorGuard)
  @Header('Content-Type', 'application/pdf')
  async memorando(
    @Param('codigo') codigo: string,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    const { pdf, esBorrador } = await this.ordenes.componerMemorando(codigo);

    // E22: un borrador se nombra «…-BORRADOR.pdf», en consonancia con su marca de agua.
    respuesta.setHeader(
      'Content-Disposition',
      `attachment; filename="${nombreMemorando(codigo, esBorrador)}"`,
    );

    return new StreamableFile(pdf);
  }

  /**
   * Los datos base del memorando, para que el editor de la Dirección los precargue.
   *
   * Lleva lo que el sistema conoce (nombre, operativos, fecha); lo que falta por completar viaja
   * vacío y el documento lo resalta como `[Etiqueta]` (D14). El editor lo cambia y lo devuelve por POST.
   */
  @Get('ordenes-servicio/:codigo/memorando/datos')
  @RequierePermiso('ordenes:gestionar')
  @UseGuards(DirectorGuard)
  async datosMemorando(
    @Param('codigo') codigo: string,
  ): Promise<DatosOrdenMemorando> {
    return this.ordenes.datosDeMemorando(codigo);
  }

  /**
   * El memorando con lo que la Dirección completó en el editor.
   *
   * El cuerpo solo trae los campos editables; los operativos y el nombre se re-derivan del
   * código, así que editar el documento no permite inventar la asignación (RN-51).
   */
  @Post('ordenes-servicio/:codigo/memorando')
  @RequierePermiso('ordenes:gestionar')
  @UseGuards(DirectorGuard)
  @Header('Content-Type', 'application/pdf')
  async memorandoEditado(
    @Param('codigo') codigo: string,
    @Body() editables: EditarMemorandoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    // D13: se PERSISTEN los datos completados (así «Ver documento» y la reemisión los reproducen y
    // la orden deja de estar en borrador) antes de generar el documento con ellos. Solo el Director
    // que generó la orden puede editarla (403 para los demás).
    await this.ordenes.guardarEditables(codigo, editables, usuario.usuarioId);
    const { pdf, esBorrador } = await this.ordenes.componerMemorando(
      codigo,
      editables,
    );

    respuesta.setHeader(
      'Content-Disposition',
      `attachment; filename="${nombreMemorando(codigo, esBorrador)}"`,
    );

    return new StreamableFile(pdf);
  }

  /**
   * La plantilla DEL DIRECTOR EN SESIÓN (plantilla por Director, 2026-10-05). Sin id en la URL: un
   * Director nunca ve ni edita la de otro. Si aún no tiene, se crea desde la base institucional con
   * sus datos prellenados. Se aplica a las órdenes que ESE Director genere después de guardarla.
   */
  @Get('plantilla-orden')
  @RequierePermiso('ordenes:gestionar')
  @UseGuards(DirectorGuard)
  async obtenerPlantilla(
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<
    PlantillaRespuesta & { sugerenciaFirmante: SugerenciaFirmante | null }
  > {
    // La sugerencia del firmante sale del Director EN SESIÓN (su ficha): solo prellena lo vacío.
    const [plantilla, sugerenciaFirmante] = await Promise.all([
      this.ordenes.plantillaDelDirector(usuario.usuarioId),
      this.ordenes.sugerenciaFirmante({
        funcionarioId: usuario.funcionarioId,
        nombre: usuario.nombre,
      }),
    ]);
    return { ...aPlantillaRespuesta(plantilla), sugerenciaFirmante };
  }

  @Put('plantilla-orden')
  @RequierePermiso('ordenes:gestionar')
  @UseGuards(DirectorGuard)
  async guardarPlantilla(
    @Body() dto: GuardarPlantillaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<PlantillaRespuesta> {
    return aPlantillaRespuesta(
      await this.ordenes.guardarPlantilla(
        dto.apartados as Apartado[],
        dto.datosGenerales,
        usuario.usuarioId,
      ),
    );
  }

  /**
   * El PDF de la plantilla EN EDICIÓN, para la vista previa real del editor.
   *
   * Recibe los apartados que la Dirección tiene en pantalla (aún sin guardar) y devuelve el
   * memorando renderizado para verlo tal cual saldrá, con los datos generales EN EDICIÓN. Es
   * genérica (D17): los datos de la orden salen como marcadores grises. No se persiste ni se firma.
   */
  @Post('plantilla-orden/previsualizar')
  @RequierePermiso('ordenes:gestionar')
  @UseGuards(DirectorGuard)
  @Header('Content-Type', 'application/pdf')
  async previsualizarPlantilla(
    @Body() dto: PrevisualizarPlantillaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    const contenido = await this.ordenes.previsualizarPlantilla(
      dto.apartados as Apartado[],
      dto.datosGenerales,
      usuario.usuarioId,
    );

    respuesta.setHeader(
      'Content-Disposition',
      'inline; filename="plantilla-orden.pdf"',
    );

    return new StreamableFile(contenido);
  }
}

/** La plantilla del Director tal como viaja por la API (GET/PUT `/plantilla-orden`). */
interface PlantillaRespuesta {
  apartados: Apartado[];
  datosGenerales: DatosGenerales;
  version: number;
  directorId: number;
}

function aPlantillaRespuesta(
  plantilla: PlantillaDeDirector,
): PlantillaRespuesta {
  return {
    apartados: plantilla.apartados,
    datosGenerales: plantilla.datosGenerales,
    version: plantilla.version,
    directorId: plantilla.directorId,
  };
}

/** El nombre del archivo del memorando; un borrador lleva el sufijo «-BORRADOR» (E22). */
function nombreMemorando(codigo: string, esBorrador: boolean): string {
  return `orden-memorando-${codigo}${esBorrador ? '-BORRADOR' : ''}.pdf`;
}

/** Mismo criterio que en el resto del módulo: `@db.Date` se interpreta en UTC. */
function exigirFecha(texto: string): Date {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);

  if (!partes) {
    throw new ValidacionError(
      `«${texto}» no es una fecha válida. Se escribe como AAAA-MM-DD.`,
      { fecha: texto },
    );
  }

  const [, anio, mes, dia] = partes.map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));

  if (
    fecha.getUTCFullYear() !== anio ||
    fecha.getUTCMonth() !== mes - 1 ||
    fecha.getUTCDate() !== dia
  ) {
    throw new ValidacionError(`La fecha ${texto} no existe.`, { fecha: texto });
  }

  return fecha;
}
