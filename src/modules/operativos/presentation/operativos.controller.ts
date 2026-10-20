/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Operativos
 * Archivo: operativos.controller.ts
 * Responsabilidad: Exponer el registro, la consulta, la edición y la baja.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * LA CADENA COMPLETA, POR PRIMERA VEZ EN EL SISTEMA:
 *
 *   IdentidadGuard → RolesGuard → FormularioRolGuard → VentanaCargaGuard → DTO → Servicio
 *        401            403             403                 423            400     409
 *
 * QUIÉN ESCRIBE. Solo los tres roles de carga. La DAF **no crea ni elimina operativos**
 * (PER-03): su escritura son dos campos y llega en M-17. El `DIRECTOR` tampoco: es el
 * caso 11 del plan, y su papel es revisar y cerrar, no cargar.
 *
 * QUIÉN CONSULTA. Los tres de carga ven lo suyo; la DAF y la Dirección ven la jornada
 * completa, porque la primera asigna transporte en los nueve formularios y la segunda
 * responde por el cuadro entero. El filtrado ocurre en la consulta, no en el cliente
 * (PER-02).
 *
 * `FormularioRolGuard` SOLO PUEDE ACTUAR EN EL REGISTRO, donde el código del formulario
 * viaja en el cuerpo. En `PATCH` y `DELETE` la ruta lleva el identificador del operativo
 * y la propiedad la comprueba el servicio, con el mismo 403. Ver `exigirPropiedad`.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  componerPaginada,
  type RespuestaPaginada,
} from '../../../common/dto/respuesta.dto';
import { FormularioDesde } from '../../../common/auth/decorators/formulario-desde.decorator';
import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import { FormularioRolGuard } from '../../../common/auth/guards/formulario-rol.guard';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import { VentanaCargaGuard } from '../../../common/auth/guards/ventana-carga.guard';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { ValidacionError } from '../../../common/errors/errores-dominio';
import {
  OperativosService,
  type Autor,
} from '../application/operativos.service';
import {
  ActualizarOperativoDto,
  ActualizarTurnoPersonalDto,
  aOperativoResponse,
  AsignacionPersonalDto,
  CrearOperativoDto,
  EditarPatrullaDto,
  FiltroCoincidenciasDto,
  FiltroConteoDto,
  FijarTramitePersonalDto,
  FiltroOperativosDto,
  ReemplazarPersonalDto,
  RetirarOperativoDto,
  type CoincidenciaTransporteDto,
  type ConteoFormularioDto,
  type OperativoListadoDto,
  type OperativoResponseDto,
  type RangoConsultaDto,
} from './dto/operativo.dto';
import { resolverRango } from '../application/politicas/rango-consulta';

@Controller('operativos')
@UseGuards(IdentidadGuard, PermisosGuard, FormularioRolGuard, VentanaCargaGuard)
export class OperativosController {
  constructor(private readonly operativos: OperativosService) {}

  /** PER-02. Cada perfil recibe ya filtrado lo que le corresponde. */
  @Get()
  @RequierePermiso('operativos:leer')
  async consultar(
    @Query() filtro: FiltroOperativosDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<RespuestaPaginada<OperativoListadoDto>> {
    const pagina = filtro.pagina ?? 1;
    const tamanio = filtro.tamanio ?? 25;

    // Rango Desde–Hasta (2026-10-13). `fecha` sola sigue valiendo: es desde = hasta.
    const { rangoMaxDias } = await this.operativos.parametrosDeRango();
    const rango = resolverRango(
      { fecha: filtro.fecha, desde: filtro.desde, hasta: filtro.hasta },
      rangoMaxDias,
    );

    const { datos, total } = await this.operativos.consultar(
      {
        desde: rango ? exigirFecha(rango.desde) : undefined,
        hasta: rango ? exigirFecha(rango.hasta) : undefined,
        formularioCodigo: filtro.formulario,
        pagina,
        tamanio,
      },
      // PER-02 con varios roles: el listado muestra la UNIÓN de lo que el usuario ve. Se pasan
      // TODOS sus roles, no `usuario.rol` (que la guarda estrechó al primero de la lista).
      usuario.roles,
    );

    const [admision, transporte] = await Promise.all([
      this.operativos.admisionDeEdicion(datos, usuario.roles),
      this.operativos.transporteDelListado(datos),
    ]);

    return componerPaginada(
      datos.map((operativo, i) => ({
        ...aOperativoResponse(operativo),
        admiteEdicion: admision[i],
        transporteAsignado: transporte[i],
      })),
      total,
      pagina,
      tamanio,
    );
  }

  /**
   * Fecha del cuadro vigente y rango máximo del listado (2026-10-13). Liviano a propósito: la
   * pantalla lo pide una vez al abrir para validar el rango sin consultar. Va ANTES de `:id`,
   * o `ParseIntPipe` lo tomaría por un identificador.
   */
  @Get('rango')
  @RequierePermiso('operativos:leer')
  async rango(): Promise<RangoConsultaDto> {
    return this.operativos.parametrosDeRango();
  }

  /**
   * Operativos vigentes de cada formulario permitido en la jornada `fecha` (2026-10-16): el
   * «N hoy» del selector del registro. Misma visibilidad que el listado (PER-02). Una fecha sin
   * cuadro devuelve todo en 0, no 404. Va ANTES de `:id`, como `rango`.
   */
  @Get('conteo')
  @RequierePermiso('operativos:leer')
  async conteo(
    @Query() filtro: FiltroConteoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ConteoFormularioDto[]> {
    return this.operativos.contarPorFormulario(
      exigirFecha(filtro.fecha),
      usuario.roles,
    );
  }

  /**
   * Coincidencias para COMPARTIR UNIDAD (2026-10-19): operativos del ámbito del usuario en el mismo
   * día, punto, zonal y horario que el que se está registrando, con si pueden ir juntos. Misma
   * visibilidad que el listado (RN-48). Va ANTES de `:id`, como `rango` y `conteo`.
   */
  @Get('coincidencias-transporte')
  @RequierePermiso('operativos:leer')
  async coincidenciasTransporte(
    @Query() filtro: FiltroCoincidenciasDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<CoincidenciaTransporteDto[]> {
    return this.operativos.coincidenciasTransporte(
      {
        fecha: exigirFecha(filtro.fecha),
        puntoEncuentroId: filtro.puntoEncuentroId,
        zonalId: filtro.zonalId,
        horaInicio: filtro.horaInicio,
        horaFin: filtro.horaFin,
        tipoTransporte: filtro.tipoTransporte,
        esMacrooperativo: filtro.esMacrooperativo,
        excluirOperativoId: filtro.excluirOperativoId,
      },
      usuario.roles,
    );
  }

  @Get(':id')
  @RequierePermiso('operativos:leer')
  async obtener(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<OperativoResponseDto> {
    return aOperativoResponse(
      await this.operativos.obtener(id, comoAutor(usuario), usuario.roles),
    );
  }

  /** RN-09 a RN-20. El identificador y el secuencial los pone el servidor. */
  @Post()
  @RequierePermiso('operativos:registrar')
  @FormularioDesde('body', 'formularioCodigo')
  async registrar(
    @Body() dto: CrearOperativoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<OperativoResponseDto> {
    return aOperativoResponse(
      await this.operativos.registrar(
        {
          ...dto,
          cuadroFecha: exigirFecha(dto.cuadroFecha),
        },
        comoAutor(usuario),
        // Para volver a preguntar a Inspección por los trámites elegidos (2026-10-07).
        usuario.tokenAuth,
      ),
    );
  }

  /** RN-13. El identificador no cambia; el resto sí. */
  @Patch(':id')
  @RequierePermiso('operativos:editar')
  async editar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActualizarOperativoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<OperativoResponseDto> {
    const editado = await this.operativos.editar(
      id,
      dto,
      comoAutor(usuario),
      usuario.roles,
    );
    // Avisos de la edición (2026-10-19, COMPARTIR_RETIRADO): solo si los hay.
    return editado.avisos
      ? { ...aOperativoResponse(editado), avisos: editado.avisos }
      : aOperativoResponse(editado);
  }

  /**
   * Editar los campos GENERALES de toda una patrulla (Form 5/6), en un solo paso. 2026-09-18.
   *
   * Los aplica a TODOS los códigos del `grupoRegistro`. Solo el registrante (DMIP) puede; el
   * servicio lo comprueba con el mismo 403 que `editar`. Devuelve los operativos ya actualizados.
   */
  @Patch('patrulla/:grupoRegistro')
  @RequierePermiso('operativos:editar')
  async editarPatrulla(
    @Param('grupoRegistro') grupoRegistro: string,
    @Body() dto: EditarPatrullaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<OperativoResponseDto[]> {
    const operativos = await this.operativos.editarPatrulla(
      grupoRegistro,
      dto,
      comoAutor(usuario),
      usuario.roles,
    );
    return operativos.map(aOperativoResponse);
  }

  /**
   * PER-06. Asigna una persona. El rol COMPARTIDO también, dentro de su cupo.
   *
   * La verificación del cupo **no puede ir en una guarda**: depende del área de la
   * persona y de cuántas lleva asignadas el rol en ese operativo, dos datos que la
   * petición no trae. Va en la capa de aplicación, como dice el plan.
   */
  @Post(':id/personal')
  @RequierePermiso('operativos:personal:gestionar')
  async asignarPersonal(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AsignacionPersonalDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<OperativoResponseDto> {
    return aOperativoResponse(
      await this.operativos.asignarPersonal(
        id,
        dto,
        comoAutor(usuario),
        usuario.roles,
      ),
    );
  }

  /**
   * RN-66. Cambia el horario (turno) de una persona ya asignada, al corregir un operativo.
   *
   * El operativo re-deriva su ventana de los turnos de su gente; la validación del descanso
   * y del cruce de esa persona vive en la capa de aplicación, no en una guarda, porque
   * depende de sus otras asignaciones del día.
   */
  @Patch(':id/personal/:funcionarioId')
  @RequierePermiso('operativos:personal:gestionar')
  async actualizarTurnoPersonal(
    @Param('id', ParseIntPipe) id: number,
    @Param('funcionarioId', ParseIntPipe) funcionarioId: number,
    @Body() dto: ActualizarTurnoPersonalDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<OperativoResponseDto> {
    return aOperativoResponse(
      await this.operativos.actualizarTurnoPersonal(
        id,
        funcionarioId,
        dto,
        comoAutor(usuario),
        usuario.roles,
      ),
    );
  }

  /**
   * Fija o quita el trámite de Inspección de una persona ya asignada (2026-10-07).
   *
   * El servidor vuelve a preguntar a Inspección con el token de la sesión: lo que el navegador
   * envía es solo el código. `codigoTramite: null` (o ausente) lo quita.
   */
  @Put(':id/personal/:funcionarioId/tramite')
  @RequierePermiso('operativos:personal:gestionar')
  async fijarTramitePersonal(
    @Param('id', ParseIntPipe) id: number,
    @Param('funcionarioId', ParseIntPipe) funcionarioId: number,
    @Body() dto: FijarTramitePersonalDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<OperativoResponseDto> {
    return aOperativoResponse(
      await this.operativos.fijarTramitePersonal(
        id,
        funcionarioId,
        dto.codigoTramite ?? null,
        comoAutor(usuario),
        usuario.roles,
        usuario.tokenAuth,
      ),
    );
  }

  /**
   * Reemplazar a la persona de un operativo de una sola persona (patrulla). 2026-09-18.
   *
   * Conserva el código y su horario; el servicio exige que la persona nueva sea de la misma área
   * que la saliente. La propiedad se comprueba por departamento, como en el retiro.
   */
  @Put(':id/personal')
  @RequierePermiso('operativos:personal:gestionar')
  async reemplazarPersonal(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReemplazarPersonalDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<OperativoResponseDto> {
    return aOperativoResponse(
      await this.operativos.reemplazarPersonal(
        id,
        dto.funcionarioId,
        comoAutor(usuario),
        usuario.roles,
      ),
    );
  }

  /** Caso 7 del plan: al retirar al último, la alerta de personal vuelve sola. */
  @Delete(':id/personal/:funcionarioId')
  @RequierePermiso('operativos:personal:gestionar')
  @HttpCode(HttpStatus.OK)
  async retirarPersonal(
    @Param('id', ParseIntPipe) id: number,
    @Param('funcionarioId', ParseIntPipe) funcionarioId: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<OperativoResponseDto> {
    return aOperativoResponse(
      await this.operativos.retirarPersonal(
        id,
        funcionarioId,
        comoAutor(usuario),
        usuario.roles,
      ),
    );
  }

  /**
   * PV-10. Baja. **Borra la fila si el operativo no tiene órdenes emitidas**; si las
   * tiene, la conserva desactivada, porque la base lo impide y una orden sin origen no
   * se podría explicar. `eliminado` dice cuál de las dos ocurrió.
   */
  @Delete(':id')
  @RequierePermiso('operativos:retirar')
  @HttpCode(HttpStatus.OK)
  async retirar(
    @Param('id', ParseIntPipe) id: number,
    @Query() dto: RetirarOperativoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<{
    id: number;
    identificador: string;
    retirado: boolean;
    eliminado: boolean;
    ordenesEmitidas: number;
  }> {
    const retirado = await this.operativos.retirar(
      id,
      dto.version,
      comoAutor(usuario),
      usuario.roles,
    );

    return {
      id: retirado.id,
      identificador: retirado.identificador,
      retirado: true,
      eliminado: retirado.eliminado,
      ordenesEmitidas: retirado.ordenesEmitidas,
    };
  }
}

function comoAutor(usuario: UsuarioAutenticado): Autor {
  return { usuarioId: usuario.usuarioId, rol: usuario.rol };
}

/**
 * Interpreta la fecha de la jornada en UTC.
 *
 * `cuad_fecha` es `@db.Date`: una fecha de calendario. Interpretarla con el huso del
 * proceso desplazaría la jornada un día en cualquier servidor al oeste de Greenwich, y
 * Quito lo está. Mismo criterio que en M-10, M-11 y M-13.
 */
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
