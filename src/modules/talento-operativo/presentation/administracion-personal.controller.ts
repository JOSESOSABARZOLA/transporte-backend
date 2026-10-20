/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Maestro de personal
 * Archivo: administracion-personal.controller.ts
 * Responsabilidad: Exponer la administración del personal y sus ausencias.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * DEJÓ DE SER EXCLUSIVO DEL ADMINISTRADOR EL 2026-08-27, POR DECISIÓN DEL NEGOCIO.
 *
 * Hasta ese día la cabecera decía que un rol de más aquí sería «una filtración de datos
 * personales, no una molestia de permisos», y **el argumento sigue siendo cierto**: es el
 * único endpoint del módulo que devuelve cédulas, teléfonos y motivos de ausencia, y el
 * motivo puede describir una condición de salud.
 *
 * El negocio pidió que los tres departamentos vieran a su personal desde la bandeja del
 * Cuadro y lo confirmó con esa consecuencia delante. Queda dicho aquí porque quien lea
 * este archivo mañana merece saber que la línea se movió a propósito y no por descuido.
 *
 * LO QUE **NO** SE LES ABRIÓ ENTONCES: el maestro. Dar de alta, editar una ficha y darla
 * de baja llevaban su propio `@Roles` a nivel de método. Editar toca el área —que decide
 * en qué formularios aparece esa persona— y el tipo de contrato —que gobierna RN-26,
 * quién puede salir de noche—.
 *
 * LO ÚNICO QUE ESCRIBÍAN era la ausencia de **su** gente, acotada en el servicio por
 * `func_direccion`, y solo retiraban la que ellos mismos habían anotado.
 *
 * **TODO ESTO SE REVIRTIÓ EL 2026-09-01**, y se conserva escrito porque explica por qué
 * el servicio sigue teniendo comprobaciones por departamento que hoy solo atraviesa un
 * rol. Ver el bloque siguiente.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * Y VOLVIÓ A SER DE UN SOLO ROL EL MISMO 2026-09-01, POR DECISIÓN DEL NEGOCIO.
 *
 * Ese día ocurrieron dos cosas seguidas. Primero la administración se repartió en tres
 * —Inspecciones, Instrucción y Vehículos manejan cada una su personal— y esta pantalla se
 * abrió a `ADMINISTRADOR_DMIT` y `ADMINISTRADOR_DAF`. Después, viéndola en marcha, el
 * negocio decidió que **P-07 la abre solo `ADMINISTRADOR_DMIP`**.
 *
 * Sale con ello lo que PER-09 había concedido el 27-AGO: los tres roles departamentales
 * dejan de ver a su gente y de anotarle ausencias desde aquí. Queda escrito porque es un
 * retroceso deliberado sobre una decisión anterior, no un descuido.
 *
 * LO QUE **NO** SE DESHIZO, y conviene saber por qué:
 *
 *   · El alcance por dirección sigue vivo en `FuncionariosService`, contra
 *     `t_rol_direccion`. Con un solo rol entrando podría parecer sobrante, pero es la
 *     pieza que impide que reabrir la pantalla a alguien le entregue el maestro entero
 *     por omisión. Es defensa en profundidad, no código muerto.
 *
 *   · `ADMINISTRADOR_DMIP` recibió las cuatro direcciones en
 *     `20260901094000`. Sin eso, el personal de Instrucción y de la DAF se quedaba sin
 *     nadie que pudiera darlo de alta ni corregirlo.
 *
 *   · Las filas de los otros dos administradores se conservan. No conceden nada mientras
 *     no abran un endpoint, y describen un reparto ya acordado que vuelve a estar a una
 *     línea de distancia.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * `DELETE` DA DE BAJA, NO BORRA. La ficha se conserva porque el histórico de quién
 * salió en cada operativo depende de ella, y porque la rotación del personal es
 * mensual: quien sale hoy puede reingresar el mes que viene con su historial intacto.
 * `fk_asignacion_funcionario` es RESTRICT, de modo que la base tampoco lo permitiría.
 *
 * SIN `VentanaCargaGuard`: la ventana gobierna la jornada del cuadro, no la
 * administración del sistema. Mismo criterio que en M-06, M-07 y M-08.
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
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AreaPersonal, RolDepartamental } from '@prisma/client';

import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { ValidacionError } from '../../../common/errors/errores-dominio';
import { interpretarEnumerado } from '../../../common/utilidades/enumerado';
import { fechaIsoEnZona } from '../../../common/utilidades/marca-tiempo';
import { CorreoInstitucionalAuthService } from '../../identidad/application/correo-institucional-auth.service';
import { CoberturaTurnosService } from '../application/cobertura-turnos.service';
import type {
  MatrizCobertura,
  ResultadoLote,
  ResultadoPropuestaRotacion,
  ResultadoPublicar,
} from '../application/cobertura-turnos.service';
import { DisponibilidadService } from '../application/disponibilidad.service';
import { FuncionariosService } from '../application/funcionarios.service';
import { aFechaUtc } from '../application/reglas-personal';
import {
  DatosInstruccionDto,
  EditarCeldaCoberturaDto,
  EditarLoteCoberturaDto,
  MesCoberturaDto,
  PropuestaRotacionDto,
} from './dto/cobertura-turno.dto';
import {
  ActualizarFuncionarioDto,
  BajaFuncionarioDto,
  CrearDisponibilidadDto,
  CrearFuncionarioDto,
  DesdeFechaDto,
  ORIGENES_DE_ALTA,
  RangoFechasDto,
  aAusenciaDelMaestroResponse,
  aDisponibilidadResponse,
  aFuncionarioResponse,
  aOperativoDeLaPersonaResponse,
  type AusenciaDelMaestroResponseDto,
  type DisponibilidadResponseDto,
  type FuncionarioResponseDto,
  type OperativoDeLaPersonaResponseDto,
} from './dto/personal.dto';

/** Respuesta de la baja lógica: qué quedó y por qué no se elimina. */
interface BajaPersonalResponseDto {
  id: number;
  activo: boolean;
  operativosHistoricos: number;
  mensaje: string;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * P-07 LA ABREN DOS ADMINISTRADORES, Y CADA UNO VE LO SUYO. 2026-09-01, tarde.
 *
 * El negocio lo fijó así: el de la DMIP administra «Unidad de Operativos, Inspector General
 * e Inspector Técnico»; «Personal de Instrucción» es **solo** del DMIT.
 *
 * ES LA TERCERA VEZ QUE ESTE `@Roles` SE MUEVE EN UN DÍA, y conviene tener la historia
 * entera para no deshacer una decisión creyendo que se corrige un descuido:
 *
 *   · Por la mañana admitía a los tres roles departamentales, que consultaban el maestro.
 *   · Ese mismo día pasó a `ADMINISTRADOR_DMIP` a secas: «esta página solo debería verla
 *     Administrador DMIP».
 *   · Ahora entra `ADMINISTRADOR_DMIT`, porque el personal de Instrucción es suyo.
 *
 * LO QUE HACE ESTO SEGURO NO ES EL DECORADOR, ES EL ACOTE. Quién entra lo dice esta línea;
 * **qué ve cada uno** lo decide `direccionesAlAlcance` contra `t_rol_direccion`, fila por
 * fila, en el listado, en la ficha por identificador, en el alta, en la edición y en la
 * baja. Abrir la puerta a un rol más no le enseña el personal de nadie.
 *
 * `ADMINISTRADOR_DAF` NO ENTRA, y es una ausencia deliberada: la DAF tiene gente pero no
 * tiene área, así que no hay ficha suya que crear desde aquí. Si algún día se registra
 * personal de la DAF habrá que decidir esto explícitamente.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
@Controller('administracion/personal')
@UseGuards(IdentidadGuard, PermisosGuard)
@RequierePermiso('personal:administrar')
export class AdministracionPersonalController {
  constructor(
    private readonly funcionarios: FuncionariosService,
    private readonly disponibilidad: DisponibilidadService,
    private readonly cobertura: CoberturaTurnosService,
    private readonly correoAuth: CorreoInstitucionalAuthService,
  ) {}

  // ─────────────────────── Cobertura por turnos (Instrucción) ───────────────────────

  /**
   * La matriz mensual de turnos del personal de Instrucción a su alcance. Solo para quien
   * gestiona esa dirección; el resto la recibe vacía (mismo acote PER-09 que el maestro).
   *
   * VA ANTES DE `@Get(':id')`, como `direcciones` y `areas`: Nest resuelve por orden y `:id`
   * lleva `ParseIntPipe`, así que declarado después «cobertura» se leería como identificador.
   */
  @Get('cobertura')
  async matrizCobertura(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query('mes') mes: string,
  ): Promise<MatrizCobertura> {
    return this.cobertura.matriz(usuario, mes);
  }

  /** Fija el turno de una persona en un día (DIURNO/NOCTURNO/DESCANSO). Acotado a Instrucción. */
  @Put('cobertura')
  @HttpCode(HttpStatus.NO_CONTENT)
  async editarCobertura(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: EditarCeldaCoberturaDto,
  ): Promise<void> {
    await this.cobertura.editarCelda(
      usuario,
      dto.funcionarioId,
      dto.fecha,
      dto.estado,
    );
  }

  /** Fija la zona y denominación de una persona de Instrucción (para agruparla en la matriz). */
  /** Edición en lote: aplica las celdas válidas en una transacción y devuelve las omitidas. */
  @Put('cobertura/lote')
  async editarCoberturaLote(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: EditarLoteCoberturaDto,
  ): Promise<ResultadoLote> {
    return this.cobertura.editarLote(usuario, dto.celdas);
  }

  /** «Continuar rotación»: propone (no escribe) el turno de las celdas vacías del mes. */
  @Post('cobertura/propuesta-rotacion')
  @HttpCode(HttpStatus.OK)
  async proponerRotacion(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: PropuestaRotacionDto,
  ): Promise<ResultadoPropuestaRotacion> {
    return this.cobertura.proponerRotacion(
      usuario,
      dto.mes,
      dto.funcionarioIds,
    );
  }

  /** Publica el mes (estado INFORMATIVO). La confirmación por celdas vacías la pide el front. */
  @Post('cobertura/publicar')
  @HttpCode(HttpStatus.OK)
  async publicarCobertura(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: MesCoberturaDto,
  ): Promise<ResultadoPublicar> {
    return this.cobertura.publicarMes(usuario, dto.mes);
  }

  /** La matriz del mes en Excel (.xlsx), con el formato de Instrucción. */
  @Get('cobertura/exportar')
  async exportarCobertura(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query('mes') mes: string,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    const contenido = await this.cobertura.exportar(usuario, mes);
    respuesta.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    respuesta.setHeader(
      'Content-Disposition',
      `attachment; filename="cobertura-instruccion-${mes}.xlsx"`,
    );
    return new StreamableFile(contenido);
  }

  @Put(':id/instruccion')
  @HttpCode(HttpStatus.NO_CONTENT)
  async fijarInstruccion(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: DatosInstruccionDto,
  ): Promise<void> {
    await this.cobertura.fijarDatosInstruccion(
      usuario,
      id,
      dto.zonalId,
      dto.denominacion,
    );
  }

  // ─────────────────────────── Personal ───────────────────────────

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * CADA DEPARTAMENTO VE A SU GENTE, Y CADA ADMINISTRADOR LA SUYA. PER-09, 2026-08-27.
   *
   * EL FILTRO SALE DE QUIEN PREGUNTA, NO DE LO QUE MANDE. Hasta hoy `direccion` y
   * `area` se tomaban del `query` tal cual y **nadie miraba al usuario**: los tres roles
   * departamentales se descargaban el maestro entero —cédulas y teléfonos de toda la
   * AMC— y la pantalla se limitaba a filtrar en memoria lo que ya tenía en el navegador.
   * Un filtro de cliente no es una restricción: es una cortina.
   *
   * Por eso a un rol departamental **se le descarta el parámetro** en lugar de
   * combinárselo. Combinarlo dejaría la puerta de que un `?direccion=` vacío o mal
   * interpretado se leyera como «sin filtro», y ese es justo el descuido que este cambio
   * viene a cerrar. Hay una prueba que manda la dirección de otro departamento a mano.
   *
   * `area` se le sigue admitiendo: es el desplegable de la pantalla, acota **dentro** de
   * lo que ya puede ver y no puede ensanchar nada.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  @Get()
  async listar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query('direccion') direccion?: string,
    @Query('area') area?: string,
    @Query('incluirInactivos') incluirInactivos?: string,
  ): Promise<FuncionarioResponseDto[]> {
    /*
     * ═══════════════════════════════════════════════════════════════════════════════
     * DESAPARECIÓ EL `esAdministrador`, Y CON ÉL EL ÚLTIMO ROL ESCRITO EN ESTE MÉTODO.
     *
     * Había dos caminos: el administrador filtraba por lo que pidiera el `query`, y el
     * departamental recibía sus direcciones. Con la administración repartida esa
     * bifurcación deja de valer —`ADMINISTRADOR_DMIT` no es departamental, pero tampoco
     * lo ve todo— y además obligaba a nombrar un rol aquí.
     *
     * Ahora hay un solo camino: se calcula el alcance y el parámetro se **interseca**
     * con él. Quien no alcanza nada recibe una lista vacía; pedir una dirección ajena
     * devuelve vacío en lugar de ensanchar. Un solo camino no puede desincronizarse
     * consigo mismo, que es lo que le pasaba al filtro de cliente que esto sustituyó.
     * ═══════════════════════════════════════════════════════════════════════════════
     */
    const alcance = await this.funcionarios.direccionesAlAlcance(usuario.roles);
    const pedida = interpretarEnumerado(
      direccion,
      RolDepartamental,
      'dirección',
    );

    const personal = await this.funcionarios.listar({
      direccion: pedida ? alcance.filter((suya) => suya === pedida) : alcance,
      area: interpretarEnumerado(area, AreaPersonal, 'área'),
      incluirInactivos: incluirInactivos === 'true',
    });

    return personal.map(aFuncionarioResponse);
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * LAS DIRECCIONES QUE QUIEN PREGUNTA PUEDE GESTIONAR. 2026-09-01.
   *
   * Lo necesita P-07 para dos cosas: con qué dirección nace un alta y cuáles ofrece el
   * desplegable de la ficha. Hasta hoy la pantalla lo deducía sola con
   * `rolCodes.includes(direccion)`, que acierta para un rol departamental —el rol **es**
   * la dirección— y devuelve vacío para un administrador, que no es ninguna.
   *
   * **NO SE RESUELVE EN EL NAVEGADOR, Y ESA ES LA DECISIÓN.** El reparto vive en
   * `t_rol_direccion`; copiarlo al frontend crearía una segunda fuente que se separaría
   * de la primera en el momento en que alguien reorganice un departamento, y la pantalla
   * ofrecería direcciones que el servidor rechaza con 403 al guardar.
   *
   * VA ANTES DE `@Get(':id')` A PROPÓSITO. Nest resuelve por orden de declaración, y
   * `:id` lleva `ParseIntPipe`: declarado después, «direcciones» se leería como
   * identificador y respondería 400 en lugar de esto.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  /**
   * Ausencias EN CURSO y PRÓXIMAS de todo el maestro al alcance (rediseño de P-07, B5): una
   * consulta para la columna «Estado» de la lista, en vez de una petición por fila. Sin el
   * motivo. `desde` es opcional: sin él, hoy en Quito.
   *
   * VA ANTES DE `@Get(':id')`: Nest resuelve por orden y `:id` se tragaría «ausencias».
   */
  @Get('ausencias')
  async ausenciasDelMaestro(
    @Query() consulta: DesdeFechaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<AusenciaDelMaestroResponseDto[]> {
    const hoy = fechaIsoEnZona();
    const desde = exigirFecha(consulta.desde ?? hoy, 'desde');
    const ausencias = await this.disponibilidad.delMaestro(
      desde,
      usuario.roles,
    );
    return ausencias.map((ausencia) =>
      aAusenciaDelMaestroResponse(ausencia, hoy),
    );
  }

  @Get('direcciones')
  async direccionesQueGestiona(
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<RolDepartamental[]> {
    return this.funcionarios.direccionesAlAlcance(usuario.roles);
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * LAS ÁREAS QUE ESTA PERSONA PUEDE DAR DE ALTA. 2026-09-01, tarde.
   *
   * Lo pide el formulario de ficha para acotar su desplegable de «Área». Sin esto, el
   * administrador de la DMIP podría elegir «Personal de Instrucción» y descubrir el 403
   * al pulsar Guardar, que es el defecto que este módulo lleva evitando desde que el
   * reparto existe: **no se ofrece un camino que el servidor va a cerrar**.
   *
   * SE PREGUNTA, NO SE DEDUCE EN EL NAVEGADOR. La correspondencia área → dirección vive en
   * `ROL_DEL_AREA` y el reparto en `t_rol_direccion`; copiar cualquiera de las dos al
   * frontend crearía una segunda fuente que se separaría de la primera el día que el
   * negocio reorganice un departamento. Es la misma razón por la que `direcciones` se
   * pregunta en vez de derivarse de `rolCodes`.
   *
   * VA ANTES DE `@Get(':id')`, por lo mismo que su vecina: Nest resuelve por orden de
   * declaración y `:id` lleva `ParseIntPipe`.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  @Get('areas')
  async areasQueGestiona(
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<AreaPersonal[]> {
    return this.funcionarios.areasAlAlcance(usuario.roles);
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * ESTA FICHA TAMBIÉN SE ACOTA, Y NO LO HACÍA. Corregido el 2026-09-01.
   *
   * El listado se acotó por dirección el 27-AGO con PER-09. **Este método no**, y heredaba
   * un `@Roles` de clase que entonces admitía a los tres roles departamentales: cualquiera
   * de ellos podía recorrer identificadores y leer **cédula y teléfono** de toda la AMC,
   * que es exactamente el dato que `FuncionarioResponseDto` declara reservado y que RN-34
   * mantiene fuera de la consulta de elegibles.
   *
   * Acotar la lista y dejar abierta la ficha por identificador no es acotar nada: quien
   * conoce un número no pasa por la lista.
   *
   * LA COMPROBACIÓN SE QUEDA AUNQUE HOY SOLO ENTRE UN ROL, y no por inercia: el día que
   * la pantalla vuelva a abrirse a alguien, esta puerta ya está cerrada. Reabrirla y
   * descubrir el hueco otra vez es el ciclo que conviene romper.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  @Get(':id')
  async obtener(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<FuncionarioResponseDto> {
    const funcionario = await this.funcionarios.obtener(id);

    await this.funcionarios.exigirEnSuAlcance(
      funcionario.direccion,
      usuario.roles,
      { funcionarioId: id },
    );

    return aFuncionarioResponse(funcionario);
  }

  /**
   * El alta es del administrador, y **sobre las direcciones que alcanza**.
   *
   * El `@Roles` de la clase dice quién entra; `crear` comprueba sobre qué dirección. Hoy
   * `ADMINISTRADOR_DMIP` alcanza las cuatro, así que la segunda puerta no rechaza nada —y
   * sigue ahí porque es la que impide dar de alta gente en el maestro de otro el día que
   * alguien vuelva a repartir la administración.
   */
  @Post()
  async crear(
    @Body() dto: CrearFuncionarioDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<FuncionarioResponseDto> {
    /*
      ALTA DESDE AUTH: EL CORREO INSTITUCIONAL LO PONE AUTH (rediseño de P-07, 2026-10-08).
      El que llegue del navegador se descarta y se pregunta a Auth por la cédula, con el token
      de la sesión (solo viaja a Auth). Sin la persona en Auth → 422; Auth caído → 503. El alta
      MANUAL —la de «¿No aparece?»— sigue aceptando el correo del cliente: no hay Auth a quien
      preguntar, que es justo por lo que existe.
    */
    // `origen` decide de dónde sale el correo, pero NO es una columna de `t_funcionario`: si
    // llegara a `funcionario.create()` Prisma rechazaría toda el alta. Se separa aquí.
    const { origen, ...ficha } = dto;
    const datos =
      origen === ORIGENES_DE_ALTA.AUTH
        ? {
            ...ficha,
            correoInstitucional: await this.correoAuth.correoPorCedula(
              ficha.cedula.trim(),
              usuario.tokenAuth,
            ),
          }
        : ficha;

    return aFuncionarioResponse(
      await this.funcionarios.crear(datos, usuario.usuarioId, usuario.roles),
    );
  }

  /**
   * La edición sigue siendo del administrador, y no es una cautela genérica: aquí se
   * cambian el **área** —que decide en qué formularios aparece esa persona— y el **tipo
   * de contrato** —que gobierna RN-26, quién puede salir de noche—.
   */
  @Put(':id')
  async actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActualizarFuncionarioDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<FuncionarioResponseDto> {
    return aFuncionarioResponse(
      await this.funcionarios.actualizar(
        id,
        dto,
        usuario.usuarioId,
        usuario.roles,
      ),
    );
  }

  /** La baja sigue siendo del administrador. Ver la cabecera. Desde 2026-09-30 exige un motivo. */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async desactivar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BajaFuncionarioDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<BajaPersonalResponseDto> {
    const baja = await this.funcionarios.desactivar(
      id,
      usuario.usuarioId,
      usuario.roles,
      dto.motivo,
      dto.detalle ?? null,
    );

    return {
      id: baja.funcionario.id,
      activo: baja.funcionario.activo,
      operativosHistoricos: baja.operativosHistoricos,
      mensaje: baja.mensaje,
    };
  }

  /**
   * Reingreso. Es la vuelta de la baja: la ficha, que se conserva porque el histórico
   * depende de ella, vuelve al maestro. `POST` y no `PUT` porque es una acción, no una
   * edición de campos; y con su propia ruta, simétrica con el `DELETE` de la baja.
   */
  @Post(':id/reactivar')
  @HttpCode(HttpStatus.OK)
  async reactivar(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<FuncionarioResponseDto> {
    return aFuncionarioResponse(
      await this.funcionarios.reactivar(id, usuario.usuarioId, usuario.roles),
    );
  }

  // ─────────────────────── Disponibilidad ───────────────────────

  @Get(':id/disponibilidad')
  async listarAusencias(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<DisponibilidadResponseDto[]> {
    const periodos = await this.disponibilidad.listarDe(id, usuario.roles);
    // Con una flecha y no `map(aDisponibilidadResponse)`: el índice del arreglo entraría como `hoy`.
    const hoy = fechaIsoEnZona();
    return periodos.map((periodo) => aDisponibilidadResponse(periodo, hoy));
  }

  /**
   * Operativos activos de la persona entre dos fechas (rediseño de P-07, B6). El modal de
   * ausencias lo usa para avisar: la ausencia no la retira de ellos y no se notifica a nadie.
   */
  @Get(':id/operativos')
  async operativosDeLaPersona(
    @Param('id', ParseIntPipe) id: number,
    @Query() consulta: RangoFechasDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<OperativoDeLaPersonaResponseDto[]> {
    const operativos = await this.disponibilidad.operativosDe(
      id,
      exigirFecha(consulta.desde, 'desde'),
      exigirFecha(consulta.hasta, 'hasta'),
      usuario.roles,
    );
    return operativos.map(aOperativoDeLaPersonaResponse);
  }

  @Post(':id/disponibilidad')
  async registrarAusencia(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CrearDisponibilidadDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<DisponibilidadResponseDto> {
    const registrada = await this.disponibilidad.registrar(
      id,
      {
        estado: dto.estado,
        desde: exigirFecha(dto.desde, 'desde'),
        hasta: exigirFecha(dto.hasta, 'hasta'),
        motivo: dto.motivo,
      },
      usuario.usuarioId,
      usuario.roles,
    );

    return aDisponibilidadResponse(registrada);
  }

  @Delete(':id/disponibilidad/:periodoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async retirarAusencia(
    @Param('id', ParseIntPipe) id: number,
    @Param('periodoId', ParseIntPipe) periodoId: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<void> {
    await this.disponibilidad.retirar(
      id,
      periodoId,
      usuario.usuarioId,
      usuario.roles,
    );
  }
}

function exigirFecha(texto: string, cual: string): Date {
  const fecha = aFechaUtc(texto);
  if (!fecha) {
    throw new ValidacionError(
      `La fecha «${cual}» no es válida. Se escribe como AAAA-MM-DD.`,
      { [cual]: texto },
    );
  }
  return fecha;
}
