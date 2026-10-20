/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Disponibilidad del personal
 * Archivo: disponibilidad.service.ts
 * Responsabilidad: Registrar las ausencias y decidir a quién excluyen.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * RN-30. Vacaciones, permiso, calamidad y reposo médico excluyen a la persona del
 * cuadro. Es la primera de las reglas que protegen a las personas que llega al sistema,
 * y la más simple de todas: no hay que calcular nada, hay que mirar si está.
 *
 * INV-14. Los períodos de una misma persona NO SE SOLAPAN. Sin esa regla, dos
 * registros contradictorios —de vacaciones y disponible el mismo día— dejarían la
 * decisión al orden en que se consulten, que es la peor forma de decidir.
 *
 * EL MOTIVO DE LA AUSENCIA NO SALE de este submódulo. `disp_motivo` puede decir «cirugía
 * programada»: es un dato de salud. Quien arma el cuadro necesita saber que la persona
 * no está, no por qué. Solo el ADMINISTRADOR_DMIP, que lo registró, vuelve a verlo.
 */

import { Injectable } from '@nestjs/common';
import {
  AccionAuditoria,
  EstadoDisponibilidad,
  RolDepartamental,
  type Disponibilidad,
  type Funcionario,
} from '@prisma/client';

import { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import {
  AutorizacionError,
  RecursoNoEncontradoError,
  ReglaNegocioError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import { fechaIsoEnZona } from '../../../common/utilidades/marca-tiempo';
import {
  DisponibilidadRepository,
  type AusenciaDelMaestro,
  type NuevaAusencia,
  type OperativoDeLaPersona,
} from '../infrastructure/disponibilidad.repository';
import { FuncionariosService } from './funcionarios.service';
import {
  comoFechaIso,
  ESTADOS_DE_PERSONA,
  ESTADOS_QUE_EXCLUYEN,
  estadoDeAusencia,
  seSolapan,
} from './reglas-personal';

export interface DatosAusencia {
  estado: EstadoDisponibilidad;
  desde: Date;
  hasta: Date;
  motivo?: string | null;
}

@Injectable()
export class DisponibilidadService {
  constructor(
    private readonly repositorio: DisponibilidadRepository,
    private readonly funcionarios: FuncionariosService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ─────────────────────────── Consulta ───────────────────────────

  /**
   * Ausencias de una persona, acotadas al alcance de quien consulta.
   *
   * El `motivo` puede describir una condición de salud (RN-30), así que leer las
   * ausencias de personal ajeno es una fuga de datos sensibles: la misma vara que
   * `registrar`/`retirar` —`exigirSuDepartamento`— cierra aquí el IDOR por `:id`.
   */
  async listarDe(
    funcionarioId: number,
    roles: readonly RolDepartamental[],
  ): Promise<Disponibilidad[]> {
    const funcionario = await this.funcionarios.obtener(funcionarioId);
    await this.exigirSuDepartamento(funcionario, roles);
    return this.repositorio.listarDeFuncionario(funcionarioId);
  }

  /**
   * RN-30. Identificadores de las personas ausentes en el rango.
   *
   * Devuelve un conjunto de identificadores, no las ausencias: quien consulta necesita
   * descartar personas, y traer el estado de cada una expondría a quien arma el cuadro
   * si alguien está de reposo médico o de calamidad doméstica.
   */
  async ausentesEntre(desde: Date, hasta: Date): Promise<Set<number>> {
    return this.repositorio.funcionariosAusentesEntre(
      desde,
      hasta,
      ESTADOS_QUE_EXCLUYEN,
    );
  }

  /**
   * Ausencias en curso y próximas de TODO el maestro al alcance de quien consulta, en una
   * sola consulta (rediseño de P-07, B5). Sin el motivo: la lista solo dice «Ausente del … al
   * …»; el motivo se lee persona a persona, en su modal, con `listarDe`.
   */
  async delMaestro(
    desde: Date,
    roles: readonly RolDepartamental[],
  ): Promise<AusenciaDelMaestro[]> {
    const alcance = await this.funcionarios.direccionesAlAlcance(roles);
    return this.repositorio.vigentesYProximas(
      desde,
      alcance,
      ESTADOS_QUE_EXCLUYEN,
    );
  }

  /**
   * Operativos activos de una persona entre dos fechas (rediseño de P-07, B6).
   *
   * Lo pide el modal de ausencias para AVISAR, no para bloquear: registrar la ausencia no
   * retira a la persona de esos operativos y no se notifica a nadie —no hay canal para eso—,
   * así que la pantalla dice cuáles son para que quien registra avise al responsable.
   * Misma vara de alcance que las ausencias (H-01): de otra dirección, 403.
   */
  async operativosDe(
    funcionarioId: number,
    desde: Date,
    hasta: Date,
    roles: readonly RolDepartamental[],
  ): Promise<OperativoDeLaPersona[]> {
    const funcionario = await this.funcionarios.obtener(funcionarioId);
    await this.exigirSuDepartamento(funcionario, roles);
    this.exigirRango(desde, hasta);
    return this.repositorio.operativosEntre(funcionarioId, desde, hasta);
  }

  /** Si una persona concreta está excluida en la fecha indicada. */
  async estaAusente(funcionarioId: number, fecha: Date): Promise<boolean> {
    const ausentes = await this.ausentesEntre(fecha, fecha);
    return ausentes.has(funcionarioId);
  }

  // ─────────────────────────── Registro ───────────────────────────

  async registrar(
    funcionarioId: number,
    datos: DatosAusencia,
    usuarioId: number,
    roles: readonly RolDepartamental[],
  ): Promise<Disponibilidad> {
    const funcionario = await this.funcionarios.obtener(funcionarioId);

    await this.exigirSuDepartamento(funcionario, roles);
    this.exigirEstadoDePersona(datos.estado);
    this.exigirRango(datos.desde, datos.hasta);
    await this.exigirSinSolape(funcionarioId, datos);

    const ausencia: NuevaAusencia = {
      funcionarioId,
      estado: datos.estado,
      desde: datos.desde,
      hasta: datos.hasta,
      motivo: datos.motivo?.trim() || null,
      registradoPor: usuarioId,
    };

    return this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      const creada = await this.repositorio.crear(ausencia, cliente);

      // La traza NO copia el motivo: puede describir una condición de salud. Deja
      // constancia de qué se registró, sobre quién y en qué fechas, que es lo que
      // permite pedir cuentas.
      await this.auditoria.registrar(
        {
          entidad: 't_disponibilidad',
          entidadId: creada.id,
          accion: AccionAuditoria.CREAR,
          cambios: [
            {
              campo: 'disp_estado',
              valorNuevo: this.resumen(
                datos.estado,
                funcionario.id,
                datos.desde,
                datos.hasta,
              ),
            },
          ],
          usuario: usuarioId,
        },
        cliente,
      );

      return creada;
    });
  }

  /**
   * Retira un período registrado por error.
   *
   * Aquí la eliminación SÍ es física, al revés que en los catálogos y en el maestro de
   * personal. El motivo es que una ausencia no es un dato de referencia: nada apunta a
   * ella, y conservarla desactivada obligaría a filtrar por ese estado en cada consulta
   * de RN-30, con el riesgo de que un olvido excluya a alguien que sí está disponible.
   * La traza de auditoría conserva la constancia de que existió y de quién la retiró.
   *
   * EXIGE EL FUNCIONARIO, y no solo el período. La ruta es
   * `/administracion/personal/:id/disponibilidad/:periodoId`: sin comprobar que el
   * período pertenece a esa persona, un identificador equivocado borraba la ausencia
   * de OTRO funcionario, y quien lo hizo creía haber corregido la de este. La traza
   * quedaría impecable sobre el período borrado y no diría nada del error.
   */
  async retirar(
    funcionarioId: number,
    id: number,
    usuarioId: number,
    roles: readonly RolDepartamental[],
    hoy: string = fechaIsoEnZona(),
  ): Promise<void> {
    const funcionario = await this.funcionarios.obtener(funcionarioId);
    const ausencia = await this.repositorio.buscarPorId(id);

    if (!ausencia || ausencia.funcionarioId !== funcionarioId) {
      throw new RecursoNoEncontradoError(
        `El funcionario ${funcionarioId} no tiene registrado un período de disponibilidad con identificador ${id}.`,
        { funcionarioId, id },
      );
    }

    await this.exigirSuDepartamento(funcionario, roles);
    await this.exigirAutoria(ausencia, funcionario, usuarioId, roles);

    /*
      UNA AUSENCIA QUE YA TERMINÓ NO SE QUITA (rediseño de P-07, B7, 2026-10-08). Es historia:
      explica por qué esa persona no salió en los cuadros de esos días, y borrarla dejaría la
      matriz de entonces sin su porqué. «Hoy» es el de Quito, no el del servidor.
    */
    if (
      estadoDeAusencia(
        comoFechaIso(ausencia.desde),
        comoFechaIso(ausencia.hasta),
        hoy,
      ) === 'PASADA'
    ) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.AUSENCIA_PASADA,
        `La ausencia del ${comoFechaIso(ausencia.desde)} al ${comoFechaIso(ausencia.hasta)} ya terminó y forma parte del historial: no se puede quitar.`,
        { ausenciaId: ausencia.id },
      );
    }

    await this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      await this.repositorio.eliminar(id, cliente);

      await this.auditoria.registrar(
        {
          entidad: 't_disponibilidad',
          entidadId: id,
          accion: AccionAuditoria.ELIMINAR,
          cambios: [
            {
              campo: 'disp_estado',
              valorAnterior: this.resumen(
                ausencia.estado,
                funcionarioId,
                ausencia.desde,
                ausencia.hasta,
              ),
            },
          ],
          usuario: usuarioId,
        },
        cliente,
      );
    });
  }

  // ─────────────────────────── Reglas ───────────────────────────

  private exigirEstadoDePersona(estado: EstadoDisponibilidad): void {
    if (!ESTADOS_DE_PERSONA.includes(estado)) {
      throw new ValidacionError(
        `${estado} no es una situación aplicable a una persona. Las situaciones son: ${ESTADOS_DE_PERSONA.join(', ')}.`,
        { estado },
      );
    }
  }

  /** Caso 6 del plan. Lo respalda `ck_disponibilidad_rango`. */
  private exigirRango(desde: Date, hasta: Date): void {
    if (hasta < desde) {
      throw new ValidacionError(
        `La ausencia no puede terminar antes de empezar: del ${comoFechaIso(desde)} al ${comoFechaIso(hasta)}.`,
        { desde: comoFechaIso(desde), hasta: comoFechaIso(hasta) },
      );
    }
  }

  /** Caso 2 del plan · INV-14. */
  private async exigirSinSolape(
    funcionarioId: number,
    datos: DatosAusencia,
  ): Promise<void> {
    const existentes = await this.repositorio.listarSolapados(
      funcionarioId,
      datos.desde,
      datos.hasta,
    );

    const choque = existentes.find((periodo) =>
      seSolapan(
        { desde: periodo.desde, hasta: periodo.hasta },
        { desde: datos.desde, hasta: datos.hasta },
      ),
    );

    // 409 desde el 2026-10-08 (rediseño de P-07): no es un dato mal escrito, es un choque con lo
    // que ya está registrado. Con su código propio, el modal lo distingue del rango invertido.
    if (choque) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.AUSENCIA_SOLAPADA,
        `La persona ya tiene registrado un período del ${comoFechaIso(choque.desde)} al ${comoFechaIso(choque.hasta)}, que se cruza con el que intenta registrar. Retire el anterior o ajuste las fechas.`,
        {
          periodoExistenteId: choque.id,
          desde: comoFechaIso(choque.desde),
          hasta: comoFechaIso(choque.hasta),
        },
      );
    }
  }

  /**
   * Resumen de la ausencia para la traza. **No incluye el motivo**, a propósito: es lo
   * que puede describir una condición de salud.
   */
  private resumen(
    estado: EstadoDisponibilidad,
    funcionarioId: number,
    desde: Date,
    hasta: Date,
  ): string {
    return `${estado} · funcionario ${funcionarioId} · ${comoFechaIso(desde)} a ${comoFechaIso(hasta)}`;
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * CADA DEPARTAMENTO REGISTRA LAS AUSENCIAS DE SU GENTE. 2026-08-27.
   *
   * Desde hoy los tres roles departamentales entran a P-07, y pueden anotar que alguien
   * suyo no está. **De su gente**: el departamento de la persona es `func_direccion`, y
   * una ausencia ajena bloquearía a alguien de otra dirección para todo el cuadro.
   *
   * SE MIRAN TODOS LOS ROLES, NO `usuario.rol`. Ese campo lo estrecha `RolesGuard` al
   * **primero** de la lista del decorador que la persona tenga, y como `ADMINISTRADOR_DMIP` va
   * el primero, quien tuviera además ese rol pasaría por administrador aquí sin serlo
   * para este propósito. Es el mismo defecto que se corrigió el 2026-08-27 en el filtro
   * de personal elegible, y por eso esta puerta recibe el conjunto.
   * ═══════════════════════════════════════════════════════════════════════════════
   *
   * ═══════════════════════════════════════════════════════════════════════════════
   * DEJÓ DE COMPARAR EL ROL CON LA DIRECCIÓN EL 2026-09-01.
   *
   * Tenía dos atajos y los dos se quedaron cortos al repartirse la administración: un
   * `return` para `ADMINISTRADOR_DMIP` —que ahora alcanza sus dos unidades y no todas— y
   * un `roles.includes(direccion)` que solo acierta cuando el rol **es** la dirección.
   * `ADMINISTRADOR_DMIT` no es ninguna: administra una, y eso lo dice `t_rol_direccion`.
   *
   * Ahora pregunta lo mismo que el listado, que es lo que esta cabecera ya exigía: **leer
   * y escribir se acotan con la misma vara**. Antes eran dos varas parecidas.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  private async exigirSuDepartamento(
    funcionario: Funcionario,
    roles: readonly RolDepartamental[],
  ): Promise<void> {
    const alcance = await this.funcionarios.direccionesAlAlcance(roles);

    if (alcance.includes(funcionario.direccion)) return;

    throw new AutorizacionError(
      CODIGOS_ERROR.ROL_NO_AUTORIZADO,
      `${funcionario.apellidos} ${funcionario.nombres} pertenece a ${funcionario.direccion}. Cada departamento registra las ausencias de su propio personal.`,
      { funcionarioId: funcionario.id, direccion: funcionario.direccion },
    );
  }

  /**
   * Quien no es administrador solo retira **la ausencia que él mismo registró**.
   *
   * `registradoPor` se guardaba desde M-10 y no lo comprobaba nadie. Se comprueba ahora
   * porque el retiro deja de ser exclusivo del administrador: sin esto, dos personas del
   * mismo departamento podrían deshacerse el trabajo sin enterarse.
   *
   * Es el mismo criterio que `retirarPersonal` aplica con `asignadoPorRol`.
   *
   * ═══════════════════════════════════════════════════════════════════════════════
   * «SER ADMINISTRADOR» SE PREGUNTA A LA TABLA, NO A UN `if` CON UN ROL DENTRO.
   *
   * Hasta el 2026-09-01 esto decía `roles.includes(ADMINISTRADOR_DMIP)`. Con la
   * administración repartida esa línea sobraba y faltaba a la vez: le daba la potestad
   * sobre direcciones que ya no administra, y se la negaba a los administradores de
   * Instrucción y de la DAF sobre las suyas.
   *
   * La potestad la da **administrar esa dirección concreta**, que es justo lo que
   * `t_rol_direccion` declara. Pertenecer no basta: un `DMIT_INSTRUCTOR` sigue retirando
   * solo lo suyo, como desde el 27-AGO.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  private async exigirAutoria(
    ausencia: Disponibilidad,
    funcionario: Funcionario,
    usuarioId: number,
    roles: readonly RolDepartamental[],
  ): Promise<void> {
    const administradas =
      await this.funcionarios.direccionesQueAdministra(roles);

    if (administradas.includes(funcionario.direccion)) return;
    if (ausencia.registradoPor === usuarioId) return;

    throw new AutorizacionError(
      CODIGOS_ERROR.ROL_NO_AUTORIZADO,
      'Esa ausencia la registró otra persona: solicite el retiro a quien la anotó o al administrador.',
      { ausenciaId: ausencia.id },
    );
  }
}
