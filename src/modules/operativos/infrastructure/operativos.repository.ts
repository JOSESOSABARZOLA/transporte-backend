/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Operativos
 * Archivo: operativos.repository.ts
 * Responsabilidad: Leer y escribir el operativo con sus zonales e instituciones.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * ÚNICO PUNTO DE ESTE SUBMÓDULO QUE TOCA PRISMA.
 *
 * DOS GARANTÍAS VIVEN AQUÍ Y NO EN EL SERVICIO, porque solo la base puede darlas:
 *
 * 1. **El secuencial diario (RN-12, VAL-32).** `contarDelFormulario` y `crear` se
 *    ejecutan con el MISMO cliente de transacción. Contar fuera y crear dentro dejaría
 *    una ventana entre las dos operaciones, que es exactamente el momento en el que dos
 *    departamentos registran a la vez a las 14H50. La garantía real es
 *    `uq_operativo_cuad_form_sec`; el reintento del servicio resuelve la colisión.
 *
 * 2. **El bloqueo optimista.** `actualizar` filtra por `id` **y** por `version`, e
 *    incrementa la versión en el mismo `UPDATE`. Si no afecta ninguna fila, alguien
 *    guardó antes: no se sobrescribe en silencio. Comprobar la versión leyendo primero
 *    y escribiendo después dejaría el mismo hueco que en el punto anterior.
 */

import { Injectable } from '@nestjs/common';
import {
  EstadoTransporte,
  PoliticaVehiculo,
  Prisma,
  type Operativo,
  type RolDepartamental,
  TipoTransporte,
} from '@prisma/client';

import { autoresPorIds } from '../../../common/notas/autores';
import { firmantesDeNotas } from '../../../common/notas/notas-operativo';
import { RepositorioPrisma } from '../../../common/persistencia/repositorio-prisma';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Operativo con todo lo que la respuesta necesita, cargado por anticipado.
 *
 * `formulario.areas` y `personal` se incorporaron en M-15: las áreas admitidas deciden
 * quién puede componer el operativo (VAL-10) y el personal es lo que la fila del cuadro
 * muestra. Traerlos aquí evita una consulta por fila al listar la jornada entera.
 */
export type OperativoCompleto = Prisma.OperativoGetPayload<{
  include: {
    formulario: { include: { areas: true; prefijos: true; roles: true } };
    cuadro: true;
    puntoEncuentro: { include: { zonal: true } };
    tipoControl: true;
    tiposControl: { include: { tipo: true } };
    zonales: { include: { zonal: true } };
    instituciones: { include: { institucion: true } };
    personal: { include: { funcionario: true; tramiteInspeccion: true } };
    observaciones: true;
    origen: { select: { id: true; identificador: true } };
    compartirCon: { select: { id: true; identificador: true } };
    _count: { select: { adicionales: true } };
  };
}> & {
  /**
   * Nombre de cada usuario que firma una nota o la solicitud de compartir (2026-10-19), por
   * `usua_id`. Lo llena `conAutores` con UNA consulta por lote; sin él, las notas dicen el rol.
   * Opcional: lo que no viaja a la tabla (transacciones intermedias, pruebas) no lo necesita.
   */
  autores?: Record<number, string>;
};

/**
 * Un operativo visto como posible ANFITRIÓN de compartir unidad (2026-10-19): lo que decide sus
 * tramos, su punto y hora, y el nombre de su personal para la sugerencia del registro. Sin
 * teléfono ni cédula: la sugerencia solo nombra.
 */
export type OperativoParaCoincidencia = Prisma.OperativoGetPayload<{
  select: typeof SELECCION_COINCIDENCIA;
}>;

const SELECCION_COINCIDENCIA = {
  id: true,
  identificador: true,
  cuadroId: true,
  puntoEncuentroId: true,
  horaInicio: true,
  horaFin: true,
  tipoTransporte: true,
  esMacrooperativo: true,
  compartirConId: true,
  formulario: { select: { numero: true } },
  zonales: {
    select: { zonalId: true },
    orderBy: { orden: 'asc' },
  },
  personal: {
    select: { funcionario: { select: { apellidos: true, nombres: true } } },
    orderBy: [{ esResponsable: 'desc' }, { id: 'asc' }],
  },
} satisfies Prisma.OperativoSelect;

/** Carga anticipada común a todas las lecturas. Evita la consulta por fila. */
const RELACIONES = {
  formulario: { include: { areas: true, prefijos: true, roles: true } },
  cuadro: true,
  puntoEncuentro: { include: { zonal: true } },
  tipoControl: true,
  // Solo trae filas donde el formulario admite varios tipos (form 8); vacío en el resto.
  // Orden DETERMINISTA por nombre (2026-09-21): igual que las instituciones. El 8 admite varios
  // tipos y la clave de fusión compara el arreglo; sin orden fijo, dos copias con los MISMOS tipos
  // en distinto orden no se fundían y salían como operativos aparte.
  tiposControl: {
    include: { tipo: true },
    orderBy: { tipo: { nombre: 'asc' } },
  },
  zonales: { include: { zonal: true }, orderBy: { orden: 'asc' } },
  // Orden DETERMINISTA por sigla (2026-09-21): sin `orderBy` el motor las devolvía en orden
  // arbitrario, y dos copias del 8 con las MISMAS instituciones en distinto orden no se fundían
  // en pantalla (la clave de fusión compara el arreglo). Con el orden fijo vuelven a agruparse.
  instituciones: {
    include: { institucion: true },
    orderBy: { institucion: { sigla: 'asc' } },
  },
  personal: {
    // Con el trámite de Inspección copiado a cada inspector (2026-10-07), para la fila y la orden.
    include: { funcionario: true, tramiteInspeccion: true },
    // El responsable primero: es el nombre que encabeza la fila del cuadro.
    orderBy: [{ esResponsable: 'desc' }, { id: 'asc' }],
  },
  // Notas del operativo (bitacora, 2026-09-09), en el orden en que se escribieron.
  observaciones: { orderBy: { creadoEn: 'asc' } },
  // ADICIONAL DEL DÍA · 2026-08-20.
  //
  // Del padre se traen SOLO dos columnas y no el operativo entero: la pantalla necesita
  // nombrar de dónde nació el adicional —«adicional de OCPMO-004»—, no repetir su
  // horario, su personal ni su transporte. Traerlo completo abriría además una cadena de
  // cargas anidadas sobre la tabla que más se lee.
  origen: { select: { id: true, identificador: true } },
  // COMPARTIR UNIDAD (2026-10-19): con quién pide viajar, por su identificador para nombrarlo.
  compartirCon: { select: { id: true, identificador: true } },
  // Cuántos adicionales cuelgan de este operativo. Es un conteo y no la lista por lo
  // mismo: la fila del cuadro solo necesita saber que existen, y la baja necesita saber
  // que impiden borrarlo.
  _count: { select: { adicionales: true } },
  // `satisfies` y no `as const`: este último congela los `orderBy` en tuplas de solo
  // lectura, que Prisma rechaza porque espera un arreglo mutable.
} satisfies Prisma.OperativoInclude;

/** Lo que el servicio ya resolvió y el repositorio se limita a escribir. */
export interface DatosOperativo {
  cuadroId: number;
  formularioId: number;
  identificador: string;
  secuencial: number;
  horaInicio: string;
  horaFin: string;
  esNocturno: boolean;
  cruzaMedianoche: boolean;
  duracionHoras: number;
  puntoEncuentroId: number | null;
  puntoLibre: string | null;
  tipoControlId: number | null;
  /** Varios tipos, SOLO donde el formulario lo admite (form 8). Vacío en el resto. */
  tipoControlIds: number[];
  tipoLibre: string | null;
  /** Notas del operativo (bitacora), ya limpias. Vacío si no se capturó ninguna. */
  observaciones: string[];
  zonalIds: number[];
  institucionIds: number[];
  /** Operativo del que nace, si es un adicional. Nulo en un registro ordinario. */
  origenId: number | null;
  /** Lote del registro-patrulla (Form 5/6). El mismo para los N; nulo en el resto. */
  grupoRegistro: string | null;
  /** Transporte pedido y macrooperativo (2026-10-06). Sin valor, los del esquema. */
  tipoTransporte?: TipoTransporte;
  esMacrooperativo?: boolean;
  /** Compartir unidad (2026-10-19): el anfitrión con el que pide viajar, y la justificación. */
  compartirConId?: number | null;
  justificacionExclusivo?: string | null;
  rol: RolDepartamental;
  usuarioId: number;
}

/** Campos modificables de un operativo ya registrado. */
export interface CambiosOperativo {
  horaInicio?: string;
  horaFin?: string;
  esNocturno?: boolean;
  cruzaMedianoche?: boolean;
  duracionHoras?: number;
  puntoEncuentroId?: number | null;
  puntoLibre?: string | null;
  tipoControlId?: number | null;
  tipoLibre?: string | null;
  tipoTransporte?: TipoTransporte;
  esMacrooperativo?: boolean;
  compartirConId?: number | null;
  justificacionExclusivo?: string | null;
  /** Quién pidió compartir y cuándo (2026-10-19). Los fija `solicitudDeCompartir`. */
  compartirSolicitadoPor?: number | null;
  compartirSolicitadoEn?: Date | null;
}

/** Criterios de la consulta. El filtro por rol NO es opcional: lo impone PER-02. */
export interface FiltroOperativos {
  /**
   * Rango de fechas del cuadro, ambos extremos inclusive (2026-10-13). Un solo día es
   * desde = hasta. Sin ninguno de los dos, no se filtra por fecha.
   */
  desde?: Date;
  hasta?: Date;
  formularioCodigo?: string;
  /**
   * Roles bajo los que se ve. `null` = ve la jornada completa (Dirección/DAF). Es una
   * LISTA desde el 2026-09-09: quien tiene varios roles ve la UNIÓN de lo suyo, no la parte
   * de uno solo. Una lista vacía no ve nada (no tiene rol que le dé acceso).
   */
  visiblesPara: RolDepartamental[] | null;
  pagina: number;
  tamanio: number;
}

@Injectable()
export class OperativosRepository extends RepositorioPrisma {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // ─────────────────────────── Lectura ───────────────────────────

  /**
   * Pone a cada operativo el nombre de quien firmó sus notas y su solicitud de compartir
   * (2026-10-19, plan «acciones-icono-notas»). UNA consulta para todo el lote, nunca por fila:
   * `oobs_creado_por` y `oper_compartir_solicitado_por` no tienen FK (como `oper_creado_por`),
   * así que no hay relación que incluir. Solo el nombre: nada más de la cuenta.
   */
  async conAutores<T extends OperativoCompleto>(
    operativos: T[],
    cliente?: Prisma.TransactionClient,
  ): Promise<T[]> {
    const ids = firmantesDeNotas(operativos);
    if (ids.length === 0) return operativos;

    const autores = await autoresPorIds(cliente ?? this.prisma, ids);
    return operativos.map((operativo) => ({ ...operativo, autores }));
  }

  async buscarPorId(id: number): Promise<OperativoCompleto | null> {
    const operativo = await this.prisma.operativo.findFirst({
      where: { id, activo: true },
      include: RELACIONES,
    });
    return operativo ? (await this.conAutores([operativo]))[0] : null;
  }

  /**
   * El mismo operativo, leído DENTRO de una transacción en curso.
   *
   * Hace falta para recalcular las alertas después de asignar o retirar personal: la
   * lectura tiene que ver la escritura que acaba de ocurrir, y una consulta con el
   * cliente de fuera todavía no la ve.
   */
  async buscarPorIdEn(
    id: number,
    cliente: Prisma.TransactionClient,
  ): Promise<OperativoCompleto | null> {
    return cliente.operativo.findFirst({
      where: { id, activo: true },
      include: RELACIONES,
    });
  }

  /**
   * Todos los operativos ACTIVOS de una misma patrulla (`grupoRegistro`), en el orden en que
   * se crearon (`id` ascendente). El primero es el que abrió el lote —el registrante—, dato con
   * el que `editarPatrulla` decide quién puede editar los campos generales. 2026-09-18.
   */
  async buscarPorGrupoRegistro(
    grupoRegistro: string,
    cliente?: Prisma.TransactionClient,
  ): Promise<OperativoCompleto[]> {
    return (cliente ?? this.prisma).operativo.findMany({
      where: { grupoRegistro, activo: true },
      include: RELACIONES,
      orderBy: { id: 'asc' },
    });
  }

  async listar(
    filtro: FiltroOperativos,
  ): Promise<{ datos: OperativoCompleto[]; total: number }> {
    const where = condiciones(filtro);

    const [datos, total] = await Promise.all([
      this.prisma.operativo.findMany({
        where,
        include: RELACIONES,
        // Fecha del cuadro descendente y luego identificador (2026-10-13): con un rango, lo más
        // reciente primero; dentro del día, el orden del identificador que ve la pantalla.
        orderBy: [{ cuadro: { fecha: 'desc' } }, { identificador: 'asc' }],
        skip: (filtro.pagina - 1) * filtro.tamanio,
        take: filtro.tamanio,
      }),
      this.prisma.operativo.count({ where }),
    ]);

    return { datos: await this.conAutores(datos), total };
  }

  /**
   * Cuántos operativos VIGENTES tiene cada formulario con el mismo filtro del listado
   * (2026-10-16), sin paginar. Alimenta el «N hoy» del selector de formularios del registro.
   * Mismo `condiciones` que `listar`: los activos, del rango y visibles para los roles. Una
   * sola consulta agrupada; el formulario sin operativos no aparece en el mapa.
   */
  async contarPorFormulario(
    filtro: Omit<FiltroOperativos, 'pagina' | 'tamanio'>,
  ): Promise<Map<number, number>> {
    const grupos = await this.prisma.operativo.groupBy({
      by: ['formularioId'],
      where: condiciones(filtro),
      _count: { _all: true },
    });

    return new Map(
      grupos.map((grupo) => [grupo.formularioId, grupo._count._all]),
    );
  }

  /**
   * RN-12. Cuántos operativos lleva el formulario en esa jornada.
   *
   * Cuenta también los dados de baja: el secuencial de un operativo retirado NO se
   * reutiliza. `uq_operativo_cuad_form_sec` sigue ocupándolo, y volver a emitirlo
   * produciría dos códigos iguales en dos órdenes de servicio distintas.
   *
   * ═══════════════════════════════════════════════════════════════════════════════
   * DOS SERIES, NO UNA · 2026-08-20. `esAdicional` decide cuál se cuenta, y la consulta
   * se filtra por `oper_origen_id` porque es la columna que las separa.
   *
   * El negocio decidió que el adicional enumere aparte: el primero del día es el 001
   * aunque el formulario lleve seis operativos ordinarios. Contar las dos series juntas
   * daría `OCAPMO-007`, un código que sugiere seis adicionales previos que no existieron.
   *
   * Cada `where` corresponde exactamente a uno de los dos índices únicos parciales que
   * lo respaldan, y esa correspondencia es la garantía real frente a dos registros
   * simultáneos: sin ella el conteo seguiría siendo solo una intención.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  async contarDelFormulario(
    cuadroId: number,
    formularioId: number,
    esAdicional: boolean,
    cliente: Prisma.TransactionClient,
  ): Promise<number> {
    return cliente.operativo.count({
      where: {
        cuadroId,
        formularioId,
        origenId: esAdicional ? { not: null } : null,
      },
    });
  }

  /**
   * Cuenta los operativos de un PREFIJO en el cuadro (numeración por área de las patrullas 5/6).
   *
   * Cada prefijo lleva su propia serie: `IGNECU-001`, `ITNECU-001`, `INECU-001`. Se cuenta por el
   * identificador (`startsWith '${prefijo}-'`): el guion desambigua (`IG-` no cuenta a `IGA-` ni a
   * `IGNECU-`; `INECU-` no cuenta a `IGNECU-`), y subsume ordinario/adicional porque el prefijo del
   * adicional ya es distinto. Como la fecha es constante por cuadro, contar el prefijo es contar su
   * serie del día. Se cuenta también a los dados de baja, igual que `contarDelFormulario`: su
   * identificador sigue ocupado (`uq_operativo_cuad_ident`) y reutilizarlo lo duplicaría.
   */
  async contarDelPrefijo(
    cuadroId: number,
    formularioId: number,
    prefijo: string,
    cliente: Prisma.TransactionClient,
  ): Promise<number> {
    return cliente.operativo.count({
      where: {
        cuadroId,
        formularioId,
        identificador: { startsWith: `${prefijo}-` },
      },
    });
  }

  /**
   * Operativos que COINCIDEN con uno en captura para compartir unidad (2026-10-19): mismo cuadro,
   * mismo punto de encuentro, alguna zonal en común, transporte de la DAF y activos. El cruce de
   * horario y la compatibilidad de tramos los decide el servicio. Misma visibilidad que el listado
   * (PER-02, RN-48): nunca devuelve operativos de formularios ajenos. Una sola consulta, acotada.
   */
  async buscarCoincidencias(filtro: {
    fecha: Date;
    puntoEncuentroId: number;
    zonalId: number;
    excluirOperativoId?: number;
    visiblesPara: RolDepartamental[] | null;
  }): Promise<OperativoParaCoincidencia[]> {
    const where = condiciones({
      desde: filtro.fecha,
      hasta: filtro.fecha,
      visiblesPara: filtro.visiblesPara,
    });
    return this.prisma.operativo.findMany({
      where: {
        ...where,
        puntoEncuentroId: filtro.puntoEncuentroId,
        tipoTransporte: { not: TipoTransporte.PROPIOS_MEDIOS },
        zonales: { some: { zonalId: filtro.zonalId } },
        ...(filtro.excluirOperativoId
          ? { id: { not: filtro.excluirOperativoId } }
          : {}),
      },
      select: SELECCION_COINCIDENCIA,
      orderBy: [{ horaInicio: 'asc' }, { identificador: 'asc' }],
      // Un punto y un día dan pocos operativos; el tope protege la consulta en tiempo real.
      take: 50,
    });
  }

  /**
   * Los operativos pedidos por id, con la MISMA visibilidad del listado (2026-10-19). Resuelve el
   * anfitrión raíz de una coincidencia y valida el destino al guardar: uno ajeno no aparece, y el
   * servicio responde 404 sin revelar que existe.
   */
  async buscarParaCompartir(
    ids: readonly number[],
    visiblesPara: RolDepartamental[] | null,
  ): Promise<OperativoParaCoincidencia[]> {
    if (ids.length === 0) return [];
    const where = condiciones({ visiblesPara });
    return this.prisma.operativo.findMany({
      where: { ...where, id: { in: [...new Set(ids)] } },
      select: SELECCION_COINCIDENCIA,
    });
  }

  /**
   * Quienes ya piden viajar en la unidad de cada anfitrión (2026-10-19, «la misma unidad»): los
   * operativos activos con `compartirConId` hacia alguno de `anfitrionIds`, con la misma visibilidad
   * del listado. Con ellos, la unidad del registro es la del grupo entero, no solo la del anfitrión:
   * un «solo retirar» puede viajar con el retiro de un «dejar y retirar» que ya se unió.
   */
  async miembrosDeUnidad(
    anfitrionIds: readonly number[],
    visiblesPara: RolDepartamental[] | null,
    excluirOperativoId?: number,
  ): Promise<OperativoParaCoincidencia[]> {
    if (anfitrionIds.length === 0) return [];
    const where = condiciones({ visiblesPara });
    return this.prisma.operativo.findMany({
      where: {
        ...where,
        compartirConId: { in: [...new Set(anfitrionIds)] },
        tipoTransporte: { not: TipoTransporte.PROPIOS_MEDIOS },
        ...(excluirOperativoId ? { id: { not: excluirOperativoId } } : {}),
      },
      select: SELECCION_COINCIDENCIA,
      take: 50,
    });
  }

  // ─────────────────────────── Escritura ───────────────────────────

  async crear(
    datos: DatosOperativo,
    cliente: Prisma.TransactionClient,
  ): Promise<OperativoCompleto> {
    return cliente.operativo.create({
      data: {
        cuadroId: datos.cuadroId,
        formularioId: datos.formularioId,
        identificador: datos.identificador,
        secuencial: datos.secuencial,
        horaInicio: datos.horaInicio,
        horaFin: datos.horaFin,
        esNocturno: datos.esNocturno,
        cruzaMedianoche: datos.cruzaMedianoche,
        duracionHoras: datos.duracionHoras,
        puntoEncuentroId: datos.puntoEncuentroId,
        puntoLibre: datos.puntoLibre,
        tipoControlId: datos.tipoControlId,
        tipoLibre: datos.tipoLibre,
        // Notas como filas independientes (bitacora, 2026-09-09), con el autor del registro.
        observaciones: {
          create: datos.observaciones.map((texto) => ({
            texto,
            creadoPorRol: datos.rol,
            creadoPor: datos.usuarioId,
          })),
        },
        origenId: datos.origenId,
        grupoRegistro: datos.grupoRegistro,
        tipoTransporte: datos.tipoTransporte,
        esMacrooperativo: datos.esMacrooperativo,
        compartirConId: datos.compartirConId ?? null,
        justificacionExclusivo: datos.justificacionExclusivo ?? null,
        // Quién pidió compartir y cuándo (2026-10-19): al registrar, quien registra y ahora.
        compartirSolicitadoPor: datos.compartirConId ? datos.usuarioId : null,
        compartirSolicitadoEn: datos.compartirConId ? new Date() : null,
        // RN-40: conductor y vehículo nacen nulos y el estado PENDIENTE, también en el adicional
        // (desde el 2026-10-14 ya no hereda: la DAF lo asigna por tramos). Es el valor por
        // defecto del esquema, y se escribe explícito para que se lea de un vistazo.
        conductorId: null,
        vehiculoId: null,
        estadoTransporte: EstadoTransporte.PENDIENTE,
        asignadoEn: null,
        creadoPorRol: datos.rol,
        creadoPor: datos.usuarioId,
        modificadoPorRol: datos.rol,
        modificadoPor: datos.usuarioId,
        // RN-19. El orden refleja cómo se reparte la jornada entre zonales.
        zonales: {
          create: datos.zonalIds.map((zonalId, indice) => ({
            zonalId,
            orden: indice + 1,
          })),
        },
        instituciones: {
          create: datos.institucionIds.map((institucionId) => ({
            institucionId,
          })),
        },
        // Solo el formulario que admite varios (form 8) trae ids aquí; en el resto va vacío
        // y el tipo único viaja en `tipoControlId`.
        tiposControl: {
          create: datos.tipoControlIds.map((tipoId) => ({ tipoId })),
        },
      },
      include: RELACIONES,
    });
  }

  /**
   * Bloqueo optimista. Devuelve `null` si la versión ya no es la esperada.
   *
   * El servicio traduce ese `null` a `409 CONFLICTO_CONCURRENCIA`; el repositorio no
   * lanza errores de negocio.
   */
  async actualizar(
    id: number,
    version: number,
    cambios: CambiosOperativo,
    autor: { rol: RolDepartamental; usuarioId: number },
    cliente: Prisma.TransactionClient,
    // Notas NUEVAS a agregar (bitacora append-only, 2026-09-09). Las ya escritas no se tocan.
    observacionesNuevas: string[] = [],
  ): Promise<OperativoCompleto | null> {
    const afectadas = await cliente.operativo.updateMany({
      where: { id, version, activo: true },
      data: {
        ...cambios,
        modificadoPorRol: autor.rol,
        modificadoPor: autor.usuarioId,
        version: { increment: 1 },
      },
    });

    if (afectadas.count === 0) return null;

    // Se AGREGAN dentro de la misma transacción, tras superar el bloqueo optimista: una
    // nota escrita sobre una versión caduca no debe quedar huérfana.
    if (observacionesNuevas.length > 0) {
      await cliente.operativoObservacion.createMany({
        data: observacionesNuevas.map((texto) => ({
          operativoId: id,
          texto,
          creadoPorRol: autor.rol,
          creadoPor: autor.usuarioId,
        })),
      });
    }

    return cliente.operativo.findUniqueOrThrow({
      where: { id },
      include: RELACIONES,
    });
  }

  /**
   * Re-deriva la ventana del operativo desde los turnos de su gente (RN-66, 2026-09-09).
   *
   * NO LLEVA BLOQUEO OPTIMISTA a propósito: es la consecuencia de editar el turno de una
   * persona —flujo inmediato, hermano de asignar y retirar—, no una edición con `version`
   * del cliente. Sube la versión igualmente para que quien mire el operativo reciba el
   * cambio, y anota quién lo modificó. Solo toca las columnas de ventana; nada más.
   */
  async actualizarVentana(
    id: number,
    ventana: {
      horaInicio: string;
      horaFin: string;
      esNocturno: boolean;
      cruzaMedianoche: boolean;
      duracionHoras: number;
    },
    autor: { rol: RolDepartamental; usuarioId: number },
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.operativo.update({
      where: { id },
      data: {
        ...ventana,
        modificadoPorRol: autor.rol,
        modificadoPor: autor.usuarioId,
        version: { increment: 1 },
      },
    });
  }

  /**
   * Operativos de la jornada que la DAF todavía no ha resuelto. M-17.
   *
   * Solo los que **habilitan vehículo**: un formulario `NO_APLICA` opera por propios
   * medios por definición (RN-41, RN-42) y ofrecerlo en la pantalla de transporte sería
   * pedirle a la DAF que resuelva algo que no existe.
   */
  async listarPendientesDeTransporte(
    fecha: Date,
    soloPendientes = true,
  ): Promise<OperativoCompleto[]> {
    return this.prisma.operativo.findMany({
      where: {
        activo: true,
        cuadro: { fecha },
        // Con `soloPendientes` en falso viajan también los ya resueltos —asignados y por
        // propios medios—, que es lo que la DAF necesita para CORREGIR: sin verlos, un
        // error de asignación solo se arreglaba con una sentencia en la base.
        estadoTransporte: soloPendientes
          ? EstadoTransporte.PENDIENTE
          : undefined,
        formulario: { politicaVehiculo: { not: PoliticaVehiculo.NO_APLICA } },
      },
      include: RELACIONES,
      // Los nocturnos primero: son los que impiden cerrar la jornada (INV-11).
      orderBy: [
        { esNocturno: 'desc' },
        { formularioId: 'asc' },
        { secuencial: 'asc' },
      ],
    });
  }

  /**
   * RN-46. Cuántos operativos de la jornada necesitan vehículo. M-18.
   *
   * Cuenta los que **habilitan vehículo** y no se cubren por propios medios, estén ya
   * asignados o no: la demanda del día es la misma antes y después de que la DAF
   * resuelva, y una demanda que baja al asignar no serviría para declarar capacidad.
   */
  async contarQueRequierenTransporte(fecha: Date): Promise<number> {
    return this.prisma.operativo.count({
      where: {
        activo: true,
        cuadro: { fecha },
        estadoTransporte: { not: EstadoTransporte.PROPIOS_MEDIOS },
        // Transporte requerido (2026-10-07): quien registra pidió PROPIOS_MEDIOS, así que no
        // solicita vehículo a la DAF y no es demanda de flota.
        tipoTransporte: { not: TipoTransporte.PROPIOS_MEDIOS },
        formulario: { politicaVehiculo: { not: PoliticaVehiculo.NO_APLICA } },
      },
    });
  }

  /**
   * Transporte requerido (2026-10-07). ¿El operativo ya tiene transporte asignado? Lo tiene si la
   * DAF le puso conductor (asignación clásica) o si alguno de sus tramos tiene conductor
   * (planificación por tramos). Es lo que obliga a CONFIRMAR antes de cambiarle el tipo.
   */
  async tieneTransporteAsignado(id: number): Promise<boolean> {
    const [operativo, tramos] = await Promise.all([
      this.prisma.operativo.findUnique({
        where: { id },
        select: { conductorId: true },
      }),
      this.prisma.tramoTransporte.count({
        where: { operativoId: id, conductorId: { not: null } },
      }),
    ]);
    return (operativo?.conductorId ?? null) !== null || tramos > 0;
  }

  /**
   * Conductor y placa de cada operativo del listado (2026-10-13), para la celda «Conductor» de
   * «Mis operativos». Es solo LECTURA de lo que escribió la DAF (RN-40 intacta). Dos consultas
   * para toda la página —la asignación clásica y los tramos—, nunca una por fila. Cada operativo
   * recibe los pares distintos en el orden en que aparecen: primero la asignación clásica, luego
   * los tramos por hora de inicio.
   */
  async transporteDeOperativos(
    ids: readonly number[],
  ): Promise<Map<number, { conductor: string; placa: string | null }[]>> {
    const resultado = new Map<
      number,
      { conductor: string; placa: string | null }[]
    >();
    if (ids.length === 0) return resultado;

    const [clasicos, tramos] = await Promise.all([
      this.prisma.operativo.findMany({
        where: { id: { in: [...ids] }, conductorId: { not: null } },
        select: {
          id: true,
          conductor: { select: { nombreCompleto: true } },
          vehiculo: { select: { placa: true } },
        },
      }),
      this.prisma.tramoTransporte.findMany({
        where: { operativoId: { in: [...ids] }, conductorId: { not: null } },
        select: {
          operativoId: true,
          conductor: { select: { nombreCompleto: true } },
          vehiculo: { select: { placa: true } },
        },
        orderBy: [{ horaInicio: 'asc' }, { id: 'asc' }],
      }),
    ]);

    const sumar = (
      id: number,
      conductor: string | undefined,
      placa: string | null,
    ): void => {
      if (!conductor) return;
      const lista = resultado.get(id) ?? [];
      if (
        !lista.some((par) => par.conductor === conductor && par.placa === placa)
      ) {
        lista.push({ conductor, placa });
      }
      resultado.set(id, lista);
    };

    for (const fila of clasicos) {
      sumar(
        fila.id,
        fila.conductor?.nombreCompleto,
        fila.vehiculo?.placa ?? null,
      );
    }
    for (const tramo of tramos) {
      if (tramo.operativoId === null) continue;
      sumar(
        tramo.operativoId,
        tramo.conductor?.nombreCompleto,
        tramo.vehiculo?.placa ?? null,
      );
    }
    return resultado;
  }

  /**
   * Transporte requerido (2026-10-07). El registro cambió el tipo de transporte: los tramos ya no
   * corresponden y se BORRAN (la DAF los regenera con el tipo nuevo). Si había transporte
   * asignado, además se libera el conductor y el vehículo del operativo, vuelve a PENDIENTE y,
   * cuando el tipo nuevo sigue pidiendo vehículo, se marca `oper_transporte_liberado_en` para que
   * la DAF vea la alerta ALV-07 hasta reasignarlo.
   *
   * Es la ÚNICA escritura de transporte que no hace la DAF, y no la decide el cliente: solo
   * libera (pone a nulo), nunca asigna. RN-40 sigue intacta.
   */
  async liberarPorCambio(
    id: number,
    opciones: { conTransporte: boolean; marcarLiberado: boolean },
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await this.soltarInvitadosDe(id, cliente);
    await cliente.tramoTransporte.deleteMany({ where: { operativoId: id } });
    if (!opciones.conTransporte) return;
    await cliente.operativo.update({
      where: { id },
      data: {
        conductorId: null,
        vehiculoId: null,
        estadoTransporte: EstadoTransporte.PENDIENTE,
        asignadoEn: null,
        transporteLiberadoEn: opciones.marcarLiberado ? new Date() : null,
      },
    });
  }

  /**
   * Compartir unidad (2026-10-19): si los tramos que se van a BORRAR eran ANFITRIONES, quienes
   * viajaban en su unidad se quedan sin ella. Sin esto la FK (`ON DELETE SET NULL`) solo borraba la
   * marca y el invitado seguía con el conductor y la placa de una unidad que ya no va. Se les quita
   * conductor, placa y marca; y su reflejo vuelve a PENDIENTE si ya no les queda ningún tramo
   * asignado (si les queda otro, la DAF lo sincroniza en su siguiente escritura). Solo libera.
   */
  private async soltarInvitadosDe(
    operativoId: number,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    const propios = await cliente.tramoTransporte.findMany({
      where: { operativoId },
      select: { id: true },
    });
    if (propios.length === 0) return;
    const invitados = await cliente.tramoTransporte.findMany({
      where: {
        compartidoConTramoId: { in: propios.map((t) => t.id) },
        NOT: { operativoId },
      },
      select: { id: true, operativoId: true },
    });
    if (invitados.length === 0) return;
    await cliente.tramoTransporte.updateMany({
      where: { id: { in: invitados.map((t) => t.id) } },
      data: { conductorId: null, vehiculoId: null, compartidoConTramoId: null },
    });
    const operativos = [
      ...new Set(
        invitados
          .map((t) => t.operativoId)
          .filter((id): id is number => id !== null),
      ),
    ];
    for (const id of operativos) {
      const asignados = await cliente.tramoTransporte.count({
        where: { operativoId: id, conductorId: { not: null } },
      });
      if (asignados > 0) continue;
      await cliente.operativo.updateMany({
        where: { id, estadoTransporte: EstadoTransporte.ASIGNADO },
        data: {
          conductorId: null,
          vehiculoId: null,
          estadoTransporte: EstadoTransporte.PENDIENTE,
          asignadoEn: null,
        },
      });
    }
  }

  /** ALV-07 se apaga cuando la DAF vuelve a resolver el transporte del operativo. */
  async limpiarTransporteLiberado(
    id: number,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.operativo.update({
      where: { id },
      data: { transporteLiberadoEn: null },
    });
  }

  /**
   * ESCRITURA ACOTADA DE LA DAF. Cuarto nivel de la restricción de M-17.
   *
   * El método recibe **exactamente** conductor, vehículo y estado, y no acepta un objeto
   * de cambios genérico: no hay forma de colar otra columna ni por descuido ni a
   * propósito. `oper_asignado_en` se pone aquí y no llega de fuera, porque es el momento
   * del servidor y no un dato del cliente.
   *
   * No toca `oper_version`: la DAF y los departamentos escriben columnas disjuntas —dos
   * campos frente a todo lo demás—, así que el conflicto que el bloqueo optimista resuelve
   * no se produce entre ellos.
   */
  async actualizarTransporte(
    id: number,
    datos: {
      conductorId: number | null;
      vehiculoId: number | null;
      estadoTransporte: EstadoTransporte;
    },
    cliente: Prisma.TransactionClient,
  ): Promise<OperativoCompleto> {
    return cliente.operativo.update({
      where: { id },
      data: {
        conductorId: datos.conductorId,
        vehiculoId: datos.vehiculoId,
        estadoTransporte: datos.estadoTransporte,
        asignadoEn: datos.conductorId === null ? null : new Date(),
      },
      include: RELACIONES,
    });
  }

  /**
   * Guarda el conjunto de alertas derivado. POL-06.
   *
   * **No toca `oper_version`, y es deliberado.** La versión sostiene el bloqueo optimista
   * entre personas que editan el operativo; las alertas son una proyección que el propio
   * sistema recalcula. Incrementarla aquí haría que asignar personal invalidara la
   * pantalla que otro tiene abierta, y ese conflicto no existe.
   */
  async guardarAlertas(
    id: number,
    alertas: Prisma.InputJsonValue,
    hayAlertas: boolean,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.operativo.update({
      where: { id },
      data: { alertas, alertaActiva: hayAlertas },
    });
  }

  /** Reemplaza las zonales del operativo. Se llama solo si cambiaron. */
  async reemplazarZonales(
    operativoId: number,
    zonalIds: number[],
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.operativoZonal.deleteMany({ where: { operativoId } });
    await cliente.operativoZonal.createMany({
      data: zonalIds.map((zonalId, indice) => ({
        operativoId,
        zonalId,
        orden: indice + 1,
      })),
    });
  }

  /** Reemplaza las instituciones participantes. Se llama solo si cambiaron. */
  async reemplazarInstituciones(
    operativoId: number,
    institucionIds: number[],
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.operativoInstitucion.deleteMany({ where: { operativoId } });
    await cliente.operativoInstitucion.createMany({
      data: institucionIds.map((institucionId) => ({
        operativoId,
        institucionId,
      })),
    });
  }

  /**
   * Reemplaza los tipos de control del operativo. Solo el formulario que admite varios
   * (form 8) los usa; se llama solo si cambiaron.
   */
  async reemplazarTiposControl(
    operativoId: number,
    tipoIds: number[],
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.operativoTipoControl.deleteMany({ where: { operativoId } });
    await cliente.operativoTipoControl.createMany({
      data: tipoIds.map((tipoId) => ({
        operativoId,
        tipoId,
      })),
    });
  }

  /**
   * Cuántas órdenes de servicio se emitieron desde este operativo.
   *
   * Se cuentan **todas, incluidas las sustituidas**: una orden anulada por reemisión ya
   * se comunicó a un funcionario, y además `fk_orden_operativo` es `RESTRICT`, así que la
   * base rechazaría el borrado igual. Contar solo las vigentes daría permiso para algo
   * que después fallaría.
   *
   * Se consulta por la relación del propio operativo, no por el repositorio de
   * `documentos`: el operativo sabe qué documentos nacieron de él, y preguntárselo a otro
   * submódulo crearía la dependencia inversa a la que ya existe.
   */
  async contarOrdenesEmitidas(id: number): Promise<number> {
    return this.prisma.ordenServicio.count({ where: { operativoId: id } });
  }

  /**
   * Cuántos adicionales cuelgan de este operativo. 2026-08-20.
   *
   * DEVUELVE DOS CIFRAS PORQUE RESPONDEN A DOS PREGUNTAS DISTINTAS, y confundirlas deja
   * un operativo que no se puede retirar nunca:
   *
   *   · `activos` decide si el retiro **se permite**. Un adicional vigente describe una
   *     salida que va a ocurrir hoy; retirar aquello de lo que nació la dejaría colgando.
   *   · `total` decide si el retiro puede ser **físico**. `fk_operativo_origen` es
   *     RESTRICT, así que un adicional ya retirado —que sigue siendo una fila— impide el
   *     `DELETE` igual que uno vigente. Es el mismo criterio con el que
   *     `contarOrdenesEmitidas` cuenta también las anuladas.
   */
  async contarAdicionales(
    id: number,
  ): Promise<{ activos: number; total: number }> {
    const [activos, total] = await Promise.all([
      this.prisma.operativo.count({ where: { origenId: id, activo: true } }),
      this.prisma.operativo.count({ where: { origenId: id } }),
    ]);

    return { activos, total };
  }

  /**
   * PV-10. Borrado FÍSICO, decidido por el Product Owner el 2026-08-07.
   *
   * Se usa **solo cuando el operativo no tiene órdenes emitidas**; el servicio lo
   * comprueba antes. Las asignaciones de personal, las zonales, las instituciones y las
   * solicitudes de apoyo caen con él por `CASCADE`. Las filas de auditoría **sobreviven**
   * con `oper_id` en nulo (`SET NULL`), y por eso el asiento de la baja nombra el
   * identificador: es lo único que queda para reconstruir qué se borró.
   *
   * `version` en el `where` conserva el bloqueo optimista: si otra persona modificó el
   * operativo mientras tanto, no se borra nada y el servicio informa el conflicto.
   */
  async eliminar(
    id: number,
    version: number,
    cliente: Prisma.TransactionClient,
  ): Promise<boolean> {
    const borradas = await cliente.operativo.deleteMany({
      where: { id, version, activo: true },
    });

    return borradas.count > 0;
  }

  /** PV-10. La baja es lógica: el operativo sale del cuadro y conserva su traza. */
  async desactivar(
    id: number,
    version: number,
    autor: { rol: RolDepartamental; usuarioId: number },
    cliente: Prisma.TransactionClient,
  ): Promise<Operativo | null> {
    const afectadas = await cliente.operativo.updateMany({
      where: { id, version, activo: true },
      data: {
        activo: false,
        modificadoPorRol: autor.rol,
        modificadoPor: autor.usuarioId,
        version: { increment: 1 },
      },
    });

    if (afectadas.count === 0) return null;

    return cliente.operativo.findUniqueOrThrow({ where: { id } });
  }
}

/**
 * PER-02. El filtrado por propiedad ocurre en la consulta, nunca en el cliente.
 *
 * Un rol departamental ve **lo que registró**, **lo de los formularios que le pertenecen**
 * y **lo de los formularios que comparte**. Las tres condiciones hacen falta:
 *
 *   · sin la primera, no vería lo suyo si el formulario cambiara de dueño;
 *   · sin la segunda, el dueño no vería lo que otro cargó dentro de su formulario y no
 *     podría revisar su propio cuadro;
 *   · sin la tercera, el DMIT no encontraría los operativos del formulario 6 —donde
 *     tiene cupo de una persona— y en M-15 no sabría dónde asignarla.
 *
 * Es la misma condición que `OperativosService.obtener` aplica a una fila suelta: el
 * listado y la consulta directa no pueden discrepar, o la pantalla mostraría una fila
 * que al abrirse responde 403.
 */
function condiciones(
  filtro: Omit<FiltroOperativos, 'pagina' | 'tamanio'>,
): Prisma.OperativoWhereInput {
  const where: Prisma.OperativoWhereInput = { activo: true };

  if (filtro.desde || filtro.hasta) {
    where.cuadro = {
      fecha: {
        ...(filtro.desde ? { gte: filtro.desde } : {}),
        ...(filtro.hasta ? { lte: filtro.hasta } : {}),
      },
    };
  }

  if (filtro.formularioCodigo) {
    where.formulario = { codigo: filtro.formularioCodigo };
  }

  if (filtro.visiblesPara) {
    // Lo ve quien lo registró y quien participa en su formulario, escriba o aporte.
    // Desde el 2026-08-25 la participación son filas, no dos columnas. Desde el 2026-09-09
    // es la UNIÓN de los roles del usuario (`in`), no un rol único: quien tiene DMIP
    // Operativos e Inspecciones ve los operativos de ambos. Una lista vacía no casa con nada.
    where.OR = [
      { creadoPorRol: { in: filtro.visiblesPara } },
      { formulario: { roles: { some: { rol: { in: filtro.visiblesPara } } } } },
    ];
  }

  return where;
}
