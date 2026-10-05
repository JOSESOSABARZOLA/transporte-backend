/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Maestro de personal
 * Archivo: funcionarios.service.ts
 * Responsabilidad: Gobernar el alta, la modificación y la baja del personal.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ESTE ES EL PRIMER MÓDULO QUE MANEJA DATOS PERSONALES. Cédula, teléfono y nombre de
 * personas reales. Tres decisiones lo gobiernan, y las tres son deliberadas:
 *
 *   1. LA TRAZA NO GUARDA EL VALOR de la cédula ni del teléfono. Registra QUE
 *      cambiaron, quién y cuándo. Ver §3 del documento del módulo.
 *   2. EL TELÉFONO NO SALE en la consulta de personal elegible. RN-34 dice que vive
 *      solo aquí; quien arma el cuadro elige personas, no las llama.
 *   3. LA BAJA ES LÓGICA, siempre. `fk_asignacion_funcionario` es RESTRICT: borrar a
 *      quien ya salió en un operativo fallaría en la base, y con razón.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Injectable } from '@nestjs/common';
import {
  AccionAuditoria,
  type AreaPersonal,
  type Funcionario,
  type RolDepartamental,
  type TipoContrato,
} from '@prisma/client';

import {
  AuditoriaService,
  type CambioCampo,
} from '../../../common/auditoria/auditoria.service';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import {
  AutorizacionError,
  RecursoNoEncontradoError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import { direccionesDeLosRoles, ROL_DEL_AREA } from '../domain/areas-del-rol';
import {
  CambiosFuncionario,
  DatosParaSeleccion,
  FiltroPersonal,
  FuncionariosRepository,
} from '../infrastructure/funcionarios.repository';
import { RolDireccionRepository } from '../infrastructure/rol-direccion.repository';
import {
  tieneFormatoCedula,
  esCorreoValido,
  esTelefonoValido,
} from './reglas-personal';

export interface DatosFuncionario {
  cedula: string;
  apellidos: string;
  nombres: string;
  telefono?: string | null;
  /** Correo institucional. Opcional, como el teléfono. Añadido el 2026-09-01. */
  correoInstitucional?: string | null;
  /** Correo personal. Opcional, con la misma política. Añadido el 2026-10-01. */
  correoPersonal?: string | null;
  cargo?: string | null;
  area: AreaPersonal;
  tipoContrato: TipoContrato;
  /**
   * Zonal de trabajo. OPCIONAL en la ficha (2026-09-21); se ofrece al personal DMIP
   * (OPERATIVOS/GENERAL/TECNICO). Para INSTRUCCION la fija la matriz de cobertura del DMIT (no
   * viaja por aquí). Ver `exigirZonalVigente`.
   */
  zonalId?: number | null;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LA DIRECCIÓN SE DEDUCE DEL ÁREA, Y DEJÓ DE PEDIRSE. 2026-09-01.
 *
 * `func_direccion` **sigue existiendo y sigue siendo la regla de aislamiento** —PER-09:
 * de ella dependen qué fichas ve cada departamento, de quién puede registrar ausencias y
 * quién puede retirarlas—. Lo que se retiró es el **campo del formulario**, no la columna.
 *
 * POR QUÉ SE PUEDE DEDUCIR: porque el sistema ya lo declaraba. `ROL_DEL_AREA` dice, desde
 * que existe, «el departamento al que pertenece cada área de personal», y el formulario
 * pedía las dos cosas por separado como si pudieran discrepar. Podían: nada impedía
 * guardar a alguien del área OPERATIVOS bajo la dirección DMIT, y esa ficha habría quedado
 * en un maestro que no le corresponde, invisible para quien debía administrarla. Pedir dos
 * veces el mismo hecho no es una comprobación: es una oportunidad de contradecirse.
 *
 * QUÉ SE PIERDE, Y CONSTA: **una ficha con dirección DAF ya no se crea desde la pantalla**.
 * La DAF tiene gente y no tiene área —lo explica `areas-del-rol.ts`—, así que no hay área
 * de la que deducirla. No se pierde nada en uso: ese personal nunca fue convocable a un
 * operativo, porque los formularios admiten gente por área y ninguna es suya. Las fichas
 * DAF que ya existan siguen intactas y siguen administrándose igual.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function direccionDelArea(area: AreaPersonal): RolDepartamental {
  return ROL_DEL_AREA[area];
}

/** Resultado de una baja, con lo que el administrador necesita saber. */
export interface ResultadoBajaFuncionario {
  funcionario: Funcionario;
  operativosHistoricos: number;
  mensaje: string;
}

/**
 * Campos cuyo VALOR no se copia a la traza de auditoría.
 *
 * La auditoría demuestra quién cambió qué. Para eso basta con saber que el teléfono
 * cambió; copiar el número replicaría un dato personal en una segunda tabla, con otra
 * política de acceso y sin fecha de caducidad. El registro sigue siendo suficiente
 * para pedir cuentas, que es su finalidad.
 */
const CAMPOS_PERSONALES = [
  'func_cedula',
  'func_telefono',
  'func_correo',
  'func_correo_personal',
];
const VALOR_OCULTO = '[dato personal]';

@Injectable()
export class FuncionariosService {
  constructor(
    private readonly repositorio: FuncionariosRepository,
    private readonly rolesDireccion: RolDireccionRepository,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ─────────────────────────── Alcance ───────────────────────────

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * DE QUÉ DIRECCIONES ALCANZA EL PERSONAL QUIEN TIENE ESTOS ROLES. 2026-09-01.
   *
   * Es la vara única de PER-09, y ahora suma dos orígenes: las direcciones que la persona
   * **es** —un `DMIT_INSTRUCTOR` ve lo suyo por serlo— y las que **administra**, que salen
   * de `t_rol_direccion`. `ADMINISTRADOR_DMIT` no es ninguna dirección y administra una.
   *
   * DEVUELVE VACÍO PARA QUIEN NO ALCANZA NADA, y quien llama debe tratarlo como «no ve a
   * nadie». Es lo que ya prescribe `direccionesDeLosRoles` y no cambia aquí.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  async direccionesAlAlcance(
    roles: readonly RolDepartamental[],
  ): Promise<RolDepartamental[]> {
    const administradas = await this.direccionesQueAdministra(roles);

    return direccionesDeLosRoles(roles, administradas);
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * QUÉ ÁREAS DE PERSONAL ALCANZA QUIEN TIENE ESTOS ROLES. 2026-09-01, tarde.
   *
   * Es la misma vara de PER-09 vista desde el otro lado. El negocio pidió que el
   * administrador de la DMIP viera «Unidad de Operativos, Inspector General e Inspector
   * Técnico» y que «Personal de Instrucción» fuera solo del DMIT: esas cuatro etiquetas son
   * **áreas**, y cada área pertenece a una dirección desde que existe `ROL_DEL_AREA`.
   *
   * NO ES UN REPARTO NUEVO, ES EL MISMO TRADUCIDO. Se deriva de `direccionesAlAlcance`, así
   * que no puede contradecirla: quien no alcanza una dirección no alcanza ninguna de sus
   * áreas, y el día que el negocio mueva un departamento se mueve una fila de
   * `t_rol_direccion` y las dos respuestas cambian juntas.
   *
   * PARA QUÉ SIRVE: para que el formulario de ficha ofrezca **solo** las áreas que quien
   * mira puede crear. Sin esto, elegir un área ajena sería un 403 al pulsar Guardar, y ese
   * es exactamente el defecto que se evitó al retirar el campo «Dirección» esta mañana.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  async areasAlAlcance(
    roles: readonly RolDepartamental[],
  ): Promise<AreaPersonal[]> {
    const alcance = await this.direccionesAlAlcance(roles);

    return (Object.keys(ROL_DEL_AREA) as AreaPersonal[]).filter((area) =>
      alcance.includes(ROL_DEL_AREA[area]),
    );
  }

  /**
   * Solo las direcciones que estos roles **administran**, sin las que son.
   *
   * ES LA FORMA DE PREGUNTAR «¿ES ADMINISTRADOR?» SIN NOMBRAR NINGÚN ROL. Un
   * `DMIT_INSTRUCTOR` alcanza a su gente por pertenecer a ella y no administra nada;
   * `ADMINISTRADOR_DMIT` administra `DMIT_INSTRUCTOR`. La diferencia decide potestades
   * que la pertenencia no da —retirar la ausencia que anotó otro, por ejemplo—, y
   * resolverla con la tabla evita volver a escribir un rol concreto en un `if`.
   */
  async direccionesQueAdministra(
    roles: readonly RolDepartamental[],
  ): Promise<RolDepartamental[]> {
    return this.rolesDireccion.direccionesQueAdministran(roles);
  }

  /**
   * Exige que esa dirección esté al alcance de quien pide.
   *
   * ═══════════════════════════════════════════════════════════════════════════════
   * SE COMPRUEBA TAMBIÉN AL LEER UNA FICHA POR SU IDENTIFICADOR, y ese agujero llevaba
   * abierto desde el 2026-08-27. El **listado** se acotó entonces con cuidado —PER-09—,
   * pero `GET /administracion/personal/:id` heredaba el `@Roles` de la clase y no miraba
   * la dirección: cualquiera de los tres roles departamentales podía recorrer
   * identificadores y leer **cédula y teléfono** de toda la AMC, que es justo lo que
   * `FuncionarioResponseDto` declara reservado.
   *
   * No basta con acotar la lista: quien conoce un identificador no pasa por ella.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  async exigirEnSuAlcance(
    direccion: RolDepartamental,
    roles: readonly RolDepartamental[],
    contexto: { funcionarioId?: number } = {},
  ): Promise<void> {
    const alcance = await this.direccionesAlAlcance(roles);

    if (alcance.includes(direccion)) return;

    throw new AutorizacionError(
      CODIGOS_ERROR.ROL_NO_AUTORIZADO,
      `Esa persona pertenece a ${direccion} y usted no administra esa dirección. Cada departamento gestiona su propio personal.`,
      { ...contexto, direccion },
    );
  }

  // ─────────────────────────── Consulta ───────────────────────────

  async listar(filtro: FiltroPersonal = {}): Promise<Funcionario[]> {
    return this.repositorio.listar(filtro);
  }

  async obtener(id: number): Promise<Funcionario> {
    const funcionario = await this.repositorio.buscarPorId(id);
    if (!funcionario) {
      throw new RecursoNoEncontradoError(
        `No existe un funcionario con identificador ${id}.`,
        { id },
      );
    }
    return funcionario;
  }

  /**
   * Personal activo de las áreas indicadas, **sin cédula ni teléfono**.
   *
   * Lo consume la consulta de elegibles. El recorte se hace en la propia consulta a la
   * base, no al componer la respuesta: ver el comentario del repositorio.
   */
  async listarPorAreas(areas: AreaPersonal[]): Promise<DatosParaSeleccion[]> {
    return this.repositorio.listarPorAreas(areas);
  }

  // ─────────────────────────── Alta ───────────────────────────

  async crear(
    datos: DatosFuncionario,
    usuarioId: number,
    roles: readonly RolDepartamental[],
  ): Promise<Funcionario> {
    const limpio = this.normalizar(datos);
    this.exigirIdentidadValida(
      limpio.cedula,
      limpio.telefono,
      limpio.correoInstitucional,
      limpio.correoPersonal,
    );

    /*
      LA DIRECCIÓN SALE DEL ÁREA, no de la petición. Ver `direccionDelArea`. El cliente
      dejó de enviarla el 2026-09-01, y aceptarla si llegara permitiría guardar a alguien
      del área OPERATIVOS en el maestro del DMIT: una ficha invisible para quien tendría
      que administrarla.
    */
    const direccion = direccionDelArea(limpio.area);

    // No se da de alta gente en una dirección ajena: sería colarla en el maestro de otro
    // departamento, que después no podría ni corregirla. Con la dirección deducida, esto
    // sigue valiendo y además significa algo más claro: quien administra Instrucción no
    // puede crear fichas del área OPERATIVOS, porque no es suya.
    await this.exigirEnSuAlcance(direccion, roles);

    await this.exigirZonalVigente(limpio.zonalId);

    // Caso 1 del plan. La base lo respalda con `uq_funcionario_cedula`; comprobarlo
    // antes permite decir de quién se trata en lugar de devolver un error del motor.
    const existente = await this.repositorio.buscarPorCedula(limpio.cedula);
    if (existente) {
      throw new ValidacionError(
        `La cédula ${limpio.cedula} ya está registrada a nombre de ${existente.apellidos} ${existente.nombres}. Si la persona reingresó, reactive su ficha en lugar de crear otra.`,
        { cedula: limpio.cedula, funcionarioId: existente.id },
      );
    }

    return this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      const creado = await this.repositorio.crear(
        { ...limpio, direccion },
        cliente,
      );

      await this.auditoria.registrar(
        {
          entidad: 't_funcionario',
          entidadId: creado.id,
          accion: AccionAuditoria.CREAR,
          usuario: usuarioId,
        },
        cliente,
      );

      return creado;
    });
  }

  // ─────────────────────────── Modificación ───────────────────────────

  async actualizar(
    id: number,
    cambios: Partial<DatosFuncionario> & { activo?: boolean },
    usuarioId: number,
    roles: readonly RolDepartamental[],
  ): Promise<Funcionario> {
    const actual = await this.obtener(id);
    const propuesto = this.componer(actual, cambios);

    /*
     * SE COMPRUEBAN LAS DOS DIRECCIONES, LA DE ANTES Y LA DE DESPUÉS.
     *
     * La primera es evidente: no se edita una ficha ajena. La segunda no lo es tanto, y
     * sin ella el control sería decorativo — quien administra Instrucción podría llevarse
     * a los suyos a DMIP, o traerse a alguien ajeno cambiándole la dirección en dos pasos.
     * Mover una persona entre departamentos exige alcanzar los dos.
     */
    await this.exigirEnSuAlcance(actual.direccion, roles, {
      funcionarioId: id,
    });

    /*
      ═══════════════════════════════════════════════════════════════════════════════
      MOVER A ALGUIEN DE DEPARTAMENTO ES AHORA CAMBIARLE EL ÁREA. 2026-09-01.

      Antes se miraba `cambios.direccion`, que llegaba en la petición. Desde que la
      dirección se deduce del área —ver `direccionDelArea`— la petición ya no la trae, y
      quien cambia el área **está moviendo la ficha de maestro** aunque no lo escriba así:
      pasar a alguien de OPERATIVOS a INSTRUCCION lo saca del maestro del DMIP y lo mete
      en el del DMIT.

      SIN ESTA COMPROBACIÓN EL CONTROL SERÍA DECORATIVO, exactamente igual que antes: quien
      administra Instrucción podría llevarse a los suyos a DMIP cambiándoles el área, o
      traerse a alguien ajeno en dos pasos. Mover una persona entre departamentos sigue
      exigiendo alcanzar los dos.
      ═══════════════════════════════════════════════════════════════════════════════
    */
    const direccionPropuesta = cambios.area
      ? direccionDelArea(cambios.area)
      : null;

    if (direccionPropuesta && direccionPropuesta !== actual.direccion) {
      await this.exigirEnSuAlcance(direccionPropuesta, roles, {
        funcionarioId: id,
      });
    }

    this.exigirIdentidadValida(
      propuesto.cedula,
      propuesto.telefono,
      propuesto.correoInstitucional,
      propuesto.correoPersonal,
    );

    await this.exigirZonalVigente(propuesto.zonalId);

    if (propuesto.cedula !== actual.cedula) {
      const otro = await this.repositorio.buscarPorCedula(propuesto.cedula);
      if (otro && otro.id !== id) {
        throw new ValidacionError(
          `La cédula ${propuesto.cedula} pertenece a otra ficha del maestro.`,
          { cedula: propuesto.cedula },
        );
      }
    }

    const traza = this.trazaDe(actual, propuesto);
    if (traza.length === 0) return actual;

    return this.escribirConTraza(
      id,
      AccionAuditoria.ACTUALIZAR,
      usuarioId,
      propuesto,
      traza,
    );
  }

  // ─────────────────────────── Baja ───────────────────────────

  /**
   * Caso 3 del plan. La baja es LÓGICA, siempre.
   *
   * La rotación del personal es mensual, así que dar de baja es una operación
   * frecuente, y el histórico de quién salió en cada operativo tiene que sobrevivir a
   * ella: es lo que sostiene las reglas de descanso y las órdenes ya emitidas.
   */
  async desactivar(
    id: number,
    usuarioId: number,
    roles: readonly RolDepartamental[],
    motivo: string,
    detalle: string | null,
  ): Promise<ResultadoBajaFuncionario> {
    const funcionario = await this.obtener(id);

    await this.exigirEnSuAlcance(funcionario.direccion, roles, {
      funcionarioId: id,
    });

    const historicos = await this.repositorio.contarAsignaciones(id);
    const nombre = `${funcionario.apellidos} ${funcionario.nombres}`;

    if (!funcionario.activo) {
      return {
        funcionario,
        operativosHistoricos: historicos,
        mensaje: `${nombre} ya estaba fuera del maestro. No se modificó nada.`,
      };
    }

    // El detalle solo se guarda con «OTRO»; con un motivo estándar se descarta.
    const detalleGuardado = motivo === 'OTRO' ? detalle?.trim() || null : null;

    const actualizado = await this.escribirConTraza(
      id,
      AccionAuditoria.ELIMINAR,
      usuarioId,
      { activo: false, motivoBaja: motivo, motivoBajaDetalle: detalleGuardado },
      [
        { campo: 'func_activo', valorAnterior: 'true', valorNuevo: 'false' },
        {
          campo: 'func_motivo_baja',
          valorAnterior: funcionario.motivoBaja ?? '',
          valorNuevo: motivo,
        },
        {
          campo: 'func_motivo_baja_detalle',
          valorAnterior: funcionario.motivoBajaDetalle ?? '',
          valorNuevo: detalleGuardado ?? '',
        },
      ],
    );

    return {
      funcionario: actualizado,
      operativosHistoricos: historicos,
      mensaje: this.mensajeDeBaja(nombre, historicos),
    };
  }

  /**
   * Reingreso: la ficha vuelve al maestro con su historial intacto.
   *
   * COMPRUEBA EL ALCANCE, igual que `desactivar` y `actualizar`. Sin `roles` no lo hacía,
   * y exponerlo así habría dejado que el administrador de un departamento reactivara la
   * ficha de otro —justo lo que PER-09 y `exigirEnSuAlcance` existen para impedir—. La
   * dirección se conserva al dar de baja, de modo que sigue sirviendo para acotar.
   */
  async reactivar(
    id: number,
    usuarioId: number,
    roles: readonly RolDepartamental[],
  ): Promise<Funcionario> {
    const funcionario = await this.obtener(id);

    await this.exigirEnSuAlcance(funcionario.direccion, roles, {
      funcionarioId: id,
    });

    if (funcionario.activo) return funcionario;

    // El reingreso LIMPIA el motivo de baja (ya no está vigente); el historial de por qué salió
    // cada vez permanece en la auditoría.
    return this.escribirConTraza(
      id,
      AccionAuditoria.ACTUALIZAR,
      usuarioId,
      { activo: true, motivoBaja: null, motivoBajaDetalle: null },
      [
        { campo: 'func_activo', valorAnterior: 'false', valorNuevo: 'true' },
        {
          campo: 'func_motivo_baja',
          valorAnterior: funcionario.motivoBaja ?? '',
          valorNuevo: '',
        },
      ],
    );
  }

  // ─────────────────────────── Apoyo ───────────────────────────

  private async escribirConTraza(
    id: number,
    accion: AccionAuditoria,
    usuarioId: number,
    cambios: CambiosFuncionario,
    traza: CambioCampo[],
  ): Promise<Funcionario> {
    return this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      const actualizado = await this.repositorio.actualizar(
        id,
        cambios,
        cliente,
      );

      await this.auditoria.registrar(
        {
          entidad: 't_funcionario',
          entidadId: id,
          accion,
          cambios: traza,
          usuario: usuarioId,
        },
        cliente,
      );

      return actualizado;
    });
  }

  private normalizar(datos: DatosFuncionario): DatosFuncionario {
    const telefono = datos.telefono?.trim();
    const cargo = datos.cargo?.trim();
    /*
      EL CORREO BAJA A MINÚSCULAS, y los nombres suben a mayúsculas: no es incoherencia.
      Los nombres se escriben así en el cuadro —es su formato— mientras que en un correo
      la caja no significa nada: la parte del dominio es insensible por norma y ningún
      servidor institucional distingue la del buzón. Guardarlo tal como se teclee dejaría
      dos escrituras del mismo buzón que no se parecen, y al buscarlo fallaría una.
    */
    const correoInstitucional = datos.correoInstitucional?.trim().toLowerCase();
    const correoPersonal = datos.correoPersonal?.trim().toLowerCase();

    return {
      ...datos,
      cedula: datos.cedula.trim(),
      apellidos: datos.apellidos.trim().toUpperCase(),
      nombres: datos.nombres.trim().toUpperCase(),
      telefono: telefono && telefono.length > 0 ? telefono : null,
      correoInstitucional:
        correoInstitucional && correoInstitucional.length > 0
          ? correoInstitucional
          : null,
      correoPersonal:
        correoPersonal && correoPersonal.length > 0 ? correoPersonal : null,
      cargo: cargo && cargo.length > 0 ? cargo : null,
    };
  }

  private componer(
    actual: Funcionario,
    cambios: Partial<DatosFuncionario> & { activo?: boolean },
  ): CambiosFuncionario & { cedula: string; telefono: string | null } {
    const area = cambios.area ?? actual.area;

    const propuesto = this.normalizar({
      cedula: cambios.cedula ?? actual.cedula,
      apellidos: cambios.apellidos ?? actual.apellidos,
      nombres: cambios.nombres ?? actual.nombres,
      telefono:
        cambios.telefono === undefined ? actual.telefono : cambios.telefono,
      // `=== undefined` y no `??`, igual que el teléfono y el cargo: `null` es un valor
      // que quien edita puede querer —borrar el correo— y `??` lo confundiría con «no lo
      // mandó», dejando el anterior escrito para siempre.
      correoInstitucional:
        cambios.correoInstitucional === undefined
          ? actual.correoInstitucional
          : cambios.correoInstitucional,
      correoPersonal:
        cambios.correoPersonal === undefined
          ? actual.correoPersonal
          : cambios.correoPersonal,
      cargo: cambios.cargo === undefined ? actual.cargo : cambios.cargo,
      area,
      tipoContrato: cambios.tipoContrato ?? actual.tipoContrato,
      // `=== undefined` (no `??`): al editar una ficha de INSTRUCCION la ficha no envía zonal, y
      // se conserva la que fijó la matriz de cobertura, no se pisa con null.
      zonalId: cambios.zonalId === undefined ? actual.zonalId : cambios.zonalId,
    });

    return {
      ...propuesto,
      /*
        LA DIRECCIÓN SE RECALCULA, no se arrastra. Si aquí se conservara `actual.direccion`
        al cambiar el área, la ficha quedaría con un área de un departamento y el maestro
        de otro: exactamente la contradicción que deducirla vino a cerrar. Y como sale de
        `propuesto`, la traza de auditoría registra el movimiento entre maestros aunque
        quien editó solo tocara el área.
      */
      direccion: direccionDelArea(area),
      telefono: propuesto.telefono ?? null,
      activo: cambios.activo ?? actual.activo,
    };
  }

  /** La traza nombra columnas y OCULTA el valor de los campos personales. */
  private trazaDe(
    actual: Funcionario,
    propuesto: CambiosFuncionario,
  ): CambioCampo[] {
    const antes = this.comoColumnas(actual);
    const despues = this.comoColumnas(propuesto);

    return this.auditoria.compararCambios(antes, despues).map((cambio) =>
      CAMPOS_PERSONALES.includes(cambio.campo)
        ? {
            campo: cambio.campo,
            valorAnterior: VALOR_OCULTO,
            valorNuevo: VALOR_OCULTO,
          }
        : cambio,
    );
  }

  private comoColumnas(
    funcionario: Funcionario | CambiosFuncionario,
  ): Record<string, unknown> {
    return {
      func_cedula: funcionario.cedula,
      func_apellidos: funcionario.apellidos,
      func_nombres: funcionario.nombres,
      func_telefono: funcionario.telefono,
      func_cargo: funcionario.cargo,
      func_area: funcionario.area,
      func_tipo_contrato: funcionario.tipoContrato,
      func_direccion: funcionario.direccion,
      func_zonal_id: funcionario.zonalId,
      func_activo: funcionario.activo,
    };
  }

  /**
   * La zonal de la ficha es OPCIONAL (2026-09-21). Se ofrece al personal de la DMIP
   * (OPERATIVOS/GENERAL/TECNICO); para INSTRUCCION la fija la matriz de cobertura del DMIT, no la
   * ficha. Cuando LLEGA una zonal se exige que esté vigente en el catálogo; si no llega, se deja
   * nula sin más.
   */
  private async exigirZonalVigente(
    zonalId: number | null | undefined,
  ): Promise<void> {
    if (
      zonalId != null &&
      !(await this.repositorio.existeZonalActiva(zonalId))
    ) {
      throw new ValidacionError(
        'La zonal seleccionada no está vigente. Vuelva a elegirla en la lista.',
        { zonalId },
      );
    }
  }

  private exigirIdentidadValida(
    cedula: string,
    telefono: string | null | undefined,
    correoInstitucional?: string | null,
    correoPersonal?: string | null,
  ): void {
    if (!tieneFormatoCedula(cedula)) {
      throw new ValidacionError(
        `La cédula ${cedula} no es válida. Debe tener diez dígitos.`,
        { cedula },
      );
    }

    if (telefono && !esTelefonoValido(telefono)) {
      throw new ValidacionError(
        'El teléfono debe contener entre siete y trece dígitos.',
        {},
      );
    }

    /*
      EL MENSAJE NO REPITE EL CORREO. Los otros dos sí llevan la cédula en el texto porque
      identifica a la persona; aquí el valor es el dato que está mal y quien lo escribió lo
      tiene delante en el campo. Devolverlo dejaría un dato personal en la respuesta y en
      cualquier registro que la copie, sin decir nada que el formulario no diga ya. Cada
      correo nombra cuál es para que quien edita sepa qué campo corregir (regla 8).
    */
    if (correoInstitucional && !esCorreoValido(correoInstitucional)) {
      throw new ValidacionError(
        'El correo institucional no tiene un formato válido. Debe ser del estilo nombre@dominio.gob.ec.',
        {},
      );
    }

    if (correoPersonal && !esCorreoValido(correoPersonal)) {
      throw new ValidacionError(
        'El correo personal no tiene un formato válido. Debe ser del estilo nombre@dominio.com.',
        {},
      );
    }
  }

  private mensajeDeBaja(nombre: string, historicos: number): string {
    if (historicos === 0) {
      return `${nombre} salió del maestro y ya no se ofrecerá al armar el cuadro. La ficha se conserva por si reingresa.`;
    }
    return `${nombre} salió del maestro y ya no se ofrecerá al armar el cuadro. La ficha no se elimina porque figura en ${historicos} operativo${historicos === 1 ? '' : 's'} anterior${historicos === 1 ? '' : 'es'}.`;
  }
}
