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
} from '@prisma/client';

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
    personal: { include: { funcionario: true } };
    observaciones: true;
    origen: { select: { id: true; identificador: true } };
    _count: { select: { adicionales: true } };
  };
}>;

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
    include: { funcionario: true },
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
  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * TRANSPORTE HEREDADO DE OTRO OPERATIVO. Solo para adicionales. 2026-08-21.
   *
   * **NO CONTRADICE RN-40.** La regla dice que la DAF es quien escribe conductor y
   * vehículo, y sigue siendo cierta: estos valores **no llegan del cliente** —
   * `CrearAdicionalDto` no los admite y el servidor los rechazaría— sino que el servicio
   * los **copia del operativo del que nace el adicional**, donde ya los puso la DAF.
   *
   * Se hereda una decisión suya, no se toma una nueva. Y queda en la traza, porque un
   * operativo que nace `ASIGNADO` sin que la DAF lo haya tocado es algo que quien audite
   * tiene que poder explicar.
   *
   * LOS DOS VIAJAN JUNTOS O NINGUNO: `ck_operativo_transporte` exige que `ASIGNADO`
   * lleve conductor **y** vehículo, y que los otros dos estados no lleven ninguno.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  transporte: {
    conductorId: number;
    vehiculoId: number;
  } | null;
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
}

/** Criterios de la consulta. El filtro por rol NO es opcional: lo impone PER-02. */
export interface FiltroOperativos {
  fecha?: Date;
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

  async buscarPorId(id: number): Promise<OperativoCompleto | null> {
    return this.prisma.operativo.findFirst({
      where: { id, activo: true },
      include: RELACIONES,
    });
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
        orderBy: [
          { cuadroId: 'desc' },
          { formularioId: 'asc' },
          { secuencial: 'asc' },
        ],
        skip: (filtro.pagina - 1) * filtro.tamanio,
        take: filtro.tamanio,
      }),
      this.prisma.operativo.count({ where }),
    ]);

    return { datos, total };
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
        // Sin transporte heredado, los tres campos quedan como nacen siempre (RN-40):
        // conductor y vehículo nulos, estado PENDIENTE. Es el valor por defecto del
        // esquema, y se escribe explícito para que la alternativa se lea de un vistazo.
        conductorId: datos.transporte?.conductorId ?? null,
        vehiculoId: datos.transporte?.vehiculoId ?? null,
        estadoTransporte: datos.transporte
          ? EstadoTransporte.ASIGNADO
          : EstadoTransporte.PENDIENTE,
        // El momento del servidor, no un dato del cliente. Mismo criterio que
        // `actualizarTransporte`, donde lo pone la DAF.
        asignadoEn: datos.transporte ? new Date() : null,
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
        formulario: { politicaVehiculo: { not: PoliticaVehiculo.NO_APLICA } },
      },
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
function condiciones(filtro: FiltroOperativos): Prisma.OperativoWhereInput {
  const where: Prisma.OperativoWhereInput = { activo: true };

  if (filtro.fecha) {
    where.cuadro = { fecha: filtro.fecha };
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
