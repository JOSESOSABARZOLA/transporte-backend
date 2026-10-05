/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Órdenes de servicio
 * Archivo: orden-servicio.repository.ts
 * Responsabilidad: Leer el operativo a emitir y escribir las órdenes.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * INV-23 e INV-25 SE SOSTIENEN EN LA BASE, no en una comprobación previa. El índice
 * `uq_orden_vigente` es único y PARCIAL —solo sobre las filas vigentes—, de modo que:
 *
 *   · no puede haber dos órdenes vigentes para el mismo operativo y funcionario;
 *   · sí puede haber todas las anuladas que hagan falta, que es lo que INV-25 exige
 *     cuando una corrección genera una reemisión.
 *
 * Por eso `anularVigentes` y `crear` ocurren **con el mismo cliente de transacción**:
 * entre marcar la anterior como no vigente y escribir la nueva no puede quedar un hueco
 * en el que otra emisión se cuele.
 *
 * LEE `t_operativo` con la licencia que ya declararon M-11, M-12, M-13 y M-19: una
 * lectura, sin importar el repositorio de otro submódulo. Trae el personal, el conductor
 * y el vehículo porque son de donde salen los cuatro campos del dato aislado.
 */

import { Injectable } from '@nestjs/common';
import type { OrdenServicio, Prisma, RolDepartamental } from '@prisma/client';

import { RepositorioPrisma } from '../../../common/persistencia/repositorio-prisma';
import { PrismaService } from '../../../prisma/prisma.service';

/** Operativo con lo que el dato aislado necesita, y nada más de lo que ya trae. */
export type OperativoParaOrden = Prisma.OperativoGetPayload<{
  include: {
    personal: { include: { funcionario: true } };
    conductor: true;
    vehiculo: true;
    cuadro: true;
  };
}>;

/** Orden con la persona a la que se entregó, para la consulta propia. */
export type OrdenConOperativo = Prisma.OrdenServicioGetPayload<{
  include: {
    operativo: { include: { cuadro: true; formulario: true } };
    funcionario: true;
  };
}>;

/** Asignación de una persona con su operativo, zonales e instituciones, para el memorando. */
export type AsignacionParaMemorando = Prisma.AsignacionPersonalGetPayload<{
  include: {
    operativo: {
      include: {
        zonales: { include: { zonal: true } };
        instituciones: { include: { institucion: true } };
        cuadro: true;
      };
    };
  };
}>;

export interface DatosOrden {
  operativoId: number;
  funcionarioId: number;
  codigo: string;
  datoAislado: Prisma.InputJsonValue;
  emitidaPor: number;
  /** Copia del firmante (Director) al emitir. Siempre se guarda (F, 2026-10-02). */
  firmante: Prisma.InputJsonValue;
  /** Editables heredados de la vigente anterior (reemisión conserva los datos). */
  editables?: Prisma.InputJsonValue;
  /** Número heredado de la vigente anterior (la reemisión conserva el número, G). */
  numeroSecuencial?: number | null;
  numeroAnio?: number | null;
  /** Plantilla por Director (2026-10-05): quién la generó y con qué plantilla y versión. */
  directorId: number;
  plantillaId: number;
  plantillaVersion: number;
}

/** Lo que se copia de la orden vigente anterior al reemitir: datos, firmante y número. */
export interface VigenteAnterior {
  editables: Prisma.JsonValue;
  firmante: Prisma.JsonValue;
  numeroSecuencial: number | null;
  numeroAnio: number | null;
}

/** La config del memorando de una jornada (D13, 2026-10-02): NULL = sin configurar. */
export interface ConfigCuadroFila {
  // El número de memorando se movió a los DATOS GENERALES de la plantilla (2026-10-02): aquí quedan
  // solo el NUT y quién elabora, que SÍ son del día. La columna `ocuc_numero_memorando` permanece en
  // la tabla (sin uso) para no hacer una migración destructiva.
  nut: string | null;
  elaboradoPor: string | null;
}

/** Un borrador de la jornada candidato a numerarse al guardar la config del cuadro. */
export interface BorradorDeCuadro {
  id: number;
  codigo: string;
  /** Plantilla con la que se resuelve ESTE borrador (2026-10-05). */
  directorId: number | null;
  plantillaId: number | null;
  plantillaVersion: number | null;
  firmante: Prisma.JsonValue;
  editables: Prisma.JsonValue;
  numeroSecuencial: number | null;
  numeroAnio: number | null;
  emitidaEn: Date;
  funcionario: {
    nombres: string;
    apellidos: string;
    cargo: string | null;
    direccion: RolDepartamental;
  };
}

/**
 * Un borrador de CUALQUIER jornada de un Director, candidato a numerarse al guardar SU plantilla:
 * lleva además la fecha de su cuadro, para agrupar la config por día.
 */
export interface BorradorGlobal extends BorradorDeCuadro {
  operativo: { cuadro: { fecha: Date } };
}

/** Lo que se lee de una plantilla: su identidad, versión vigente y contenido. */
const SELECCION_PLANTILLA = {
  id: true,
  directorId: true,
  version: true,
  apartados: true,
  datosGenerales: true,
} as const;

/** Una plantilla (de un Director o la base) en su versión vigente. */
export interface PlantillaFila {
  id: number;
  directorId: number | null;
  version: number;
  apartados: Prisma.JsonValue;
  datosGenerales: Prisma.JsonValue | null;
}

/** Una versión del historial de una plantilla (con la que se resuelve una orden). */
export interface VersionPlantillaFila {
  plantillaId: number;
  version: number;
  apartados: Prisma.JsonValue;
  datosGenerales: Prisma.JsonValue | null;
}

@Injectable()
export class OrdenServicioRepository extends RepositorioPrisma {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // ─────────────────────────── Lectura ───────────────────────────

  async buscarOperativo(id: number): Promise<OperativoParaOrden | null> {
    return this.prisma.operativo.findFirst({
      where: { id, activo: true },
      include: {
        personal: {
          include: { funcionario: true },
          orderBy: [{ esResponsable: 'desc' }, { id: 'asc' }],
        },
        conductor: true,
        vehiculo: true,
        cuadro: true,
      },
    });
  }

  /** Las órdenes vigentes de un operativo, para mostrar lo ya emitido. */
  async listarDeOperativo(operativoId: number): Promise<OrdenConOperativo[]> {
    return this.prisma.ordenServicio.findMany({
      where: { operativoId, vigente: true },
      include: {
        operativo: { include: { cuadro: true, formulario: true } },
        funcionario: true,
      },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * Persiste los datos editables del memorando de una orden (D13, 2026-10-01). Son los campos que
   * la Dirección completa tras emitir (número de memorando, NUT, firmante…); se guardan para
   * reproducir el documento y para saber qué requeridos faltan.
   */
  async guardarEditables(
    codigo: string,
    editables: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.ordenServicio.update({
      where: { codigo },
      data: { editables },
    });
  }

  /**
   * RN-49. Las órdenes de una persona. `idx_orden_funcionario` es exactamente este orden.
   *
   * Solo las vigentes: una orden anulada por reemisión ya no es lo que se comunicó.
   */
  async listarDeFuncionario(
    funcionarioId: number,
    desde?: Date,
  ): Promise<OrdenConOperativo[]> {
    return this.prisma.ordenServicio.findMany({
      where: {
        funcionarioId,
        vigente: true,
        operativo: desde ? { cuadro: { fecha: { gte: desde } } } : undefined,
      },
      include: {
        operativo: { include: { cuadro: true, formulario: true } },
        funcionario: true,
      },
      orderBy: { emitidaEn: 'desc' },
    });
  }

  // ─────────────────── Plantilla del memorando, por Director ───────────────────
  // Desde el 2026-10-05 cada Director tiene SU plantilla (una fila por director, versionada) y hay
  // UNA plantilla BASE institucional (solo apartados). Cada versión queda en el historial inmutable
  // `t_plantilla_orden_version`, con el que se resuelve cada orden.

  /** La plantilla de un Director (su versión vigente), o `null` si aún no tiene. */
  async plantillaDeDirector(
    directorId: number,
    cliente?: Prisma.TransactionClient,
  ): Promise<PlantillaFila | null> {
    const db = cliente ?? this.prisma;
    // `directorId` es único por el índice PARCIAL uq_plantilla_director (no declarable en Prisma).
    return db.plantillaOrden.findFirst({
      where: { directorId },
      select: SELECCION_PLANTILLA,
    });
  }

  /** La plantilla BASE institucional (solo apartados), o `null` si no existe. */
  async plantillaBase(
    cliente?: Prisma.TransactionClient,
  ): Promise<PlantillaFila | null> {
    const db = cliente ?? this.prisma;
    return db.plantillaOrden.findFirst({
      where: { esBase: true },
      select: SELECCION_PLANTILLA,
    });
  }

  /**
   * Crea la plantilla de un Director (versión 1) y la registra en el historial. Va en la transacción
   * del llamador; si dos peticiones la crean a la vez, `uq_plantilla_director` rechaza la segunda.
   */
  async crearPlantillaDirector(
    datos: {
      directorId: number;
      apartados: Prisma.InputJsonValue;
      datosGenerales: Prisma.InputJsonValue;
      usuarioId: number;
    },
    cliente: Prisma.TransactionClient,
  ): Promise<PlantillaFila> {
    const creada = await cliente.plantillaOrden.create({
      data: {
        clave: `director-${datos.directorId}`,
        directorId: datos.directorId,
        apartados: datos.apartados,
        datosGenerales: datos.datosGenerales,
        version: 1,
        actualizadoPor: datos.usuarioId,
      },
      select: SELECCION_PLANTILLA,
    });
    await cliente.plantillaOrdenVersion.create({
      data: {
        plantillaId: creada.id,
        version: 1,
        apartados: datos.apartados,
        datosGenerales: datos.datosGenerales,
        creadoPor: datos.usuarioId,
      },
    });
    return creada;
  }

  /**
   * Guarda una NUEVA versión de la plantilla de un Director: incrementa `plor_version` (atómico, en
   * la misma sentencia) y deja la versión en el historial. Devuelve la versión resultante.
   */
  async guardarNuevaVersion(
    plantillaId: number,
    apartados: Prisma.InputJsonValue,
    datosGenerales: Prisma.InputJsonValue,
    usuarioId: number,
    cliente: Prisma.TransactionClient,
  ): Promise<number> {
    const fila = await cliente.plantillaOrden.update({
      where: { id: plantillaId },
      data: {
        apartados,
        datosGenerales,
        actualizadoPor: usuarioId,
        version: { increment: 1 },
      },
      select: { version: true },
    });
    await cliente.plantillaOrdenVersion.create({
      data: {
        plantillaId,
        version: fila.version,
        apartados,
        datosGenerales,
        creadoPor: usuarioId,
      },
    });
    return fila.version;
  }

  /**
   * Las versiones de plantilla pedidas, en UNA consulta (sin N+1): con ellas se resuelve cada orden
   * con la plantilla y versión con las que se generó.
   */
  async versionesDePlantilla(
    pares: { plantillaId: number; version: number }[],
    cliente?: Prisma.TransactionClient,
  ): Promise<VersionPlantillaFila[]> {
    if (pares.length === 0) return [];
    const db = cliente ?? this.prisma;
    return db.plantillaOrdenVersion.findMany({
      where: {
        OR: pares.map((par) => ({
          plantillaId: par.plantillaId,
          version: par.version,
        })),
      },
      select: {
        plantillaId: true,
        version: true,
        apartados: true,
        datosGenerales: true,
      },
    });
  }

  /**
   * Lo que el primer ingreso de un Director necesita para prellenar su plantilla: su nombre y, si su
   * cuenta está enlazada a una ficha de personal, su cargo y su dirección (de la que sale la
   * dependencia). Una sola lectura.
   */
  async usuarioParaPlantilla(usuarioId: number): Promise<{
    nombre: string;
    funcionario: { cargo: string | null; direccion: RolDepartamental } | null;
  } | null> {
    return this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: {
        nombre: true,
        funcionario: { select: { cargo: true, direccion: true } },
      },
    });
  }

  /** El nombre de varios usuarios (los directores de una lista de órdenes), en UNA consulta. */
  async nombresDeUsuarios(ids: number[]): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    const filas = await this.prisma.usuario.findMany({
      where: { id: { in: ids } },
      select: { id: true, nombre: true },
    });
    return new Map(filas.map((fila) => [fila.id, fila.nombre]));
  }

  /** Mueve un borrador a la nueva versión de la plantilla de su Director (al guardarla). */
  async actualizarVersionPlantilla(
    ordenId: number,
    plantillaId: number,
    version: number,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.ordenServicio.update({
      where: { id: ordenId },
      data: { plantillaId, plantillaVersion: version },
    });
  }

  async buscarPorCodigo(codigo: string): Promise<OrdenConOperativo | null> {
    return this.prisma.ordenServicio.findUnique({
      where: { codigo },
      include: {
        operativo: { include: { cuadro: true, formulario: true } },
        funcionario: true,
      },
    });
  }

  /**
   * Los operativos de UNA persona en una fecha, para el memorando (apartado cuarto).
   *
   * Se parte de `AsignacionPersonal` (el índice `idx_asignacion_funcionario` es este orden)
   * porque el horario que interesa es el de la persona, no el del operativo. Solo la
   * jornada de ESA fecha y operativos activos: es el mismo aislamiento por persona que rige
   * la orden, solo que enumerado.
   */
  async operativosDeFuncionarioEnFecha(
    funcionarioId: number,
    fecha: Date,
  ): Promise<AsignacionParaMemorando[]> {
    return this.prisma.asignacionPersonal.findMany({
      where: {
        funcionarioId,
        operativo: { activo: true, cuadro: { fecha } },
      },
      include: {
        operativo: {
          include: {
            zonales: { include: { zonal: true } },
            instituciones: { include: { institucion: true } },
            cuadro: true,
          },
        },
      },
      orderBy: { operativo: { identificador: 'asc' } },
    });
  }

  /**
   * Cuántas emisiones lleva esa persona en ese operativo, vigentes o no.
   *
   * Se cuenta **con el cliente de la transacción**: el número forma parte del código
   * único, y contar desde fuera vería un estado anterior al de la emisión en curso.
   */
  async contarEmisiones(
    operativoId: number,
    funcionarioId: number,
    cliente: Prisma.TransactionClient,
  ): Promise<number> {
    return cliente.ordenServicio.count({
      where: { operativoId, funcionarioId },
    });
  }

  /** El funcionario al que corresponde una cuenta de acceso. M-20. */
  /**
   * La ficha mínima del funcionario EN SESIÓN para sugerir el firmante de la plantilla (2026-10-05):
   * solo nombre, cargo y dirección. Una sola lectura; `null` si la ficha no existe.
   */
  async fichaFirmante(funcionarioId: number): Promise<{
    nombres: string;
    apellidos: string;
    cargo: string | null;
    direccion: RolDepartamental;
  } | null> {
    return this.prisma.funcionario.findUnique({
      where: { id: funcionarioId },
      select: { nombres: true, apellidos: true, cargo: true, direccion: true },
    });
  }

  async funcionarioDeUsuario(usuarioId: number): Promise<number | null> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { funcionarioId: true },
    });

    return usuario?.funcionarioId ?? null;
  }

  // ─────────────────────────── Escritura ───────────────────────────

  /**
   * INV-25. Deja sin vigencia lo emitido antes para esa persona en ese operativo.
   *
   * **No borra nada.** La orden anterior sigue en la tabla como evidencia de lo que se
   * comunicó: es la diferencia entre corregir y hacer desaparecer.
   */
  async anularVigentes(
    operativoId: number,
    funcionarioId: number,
    cliente: Prisma.TransactionClient,
  ): Promise<number> {
    const anuladas = await cliente.ordenServicio.updateMany({
      where: { operativoId, funcionarioId, vigente: true },
      data: { vigente: false },
    });

    return anuladas.count;
  }

  /** La orden vigente actual (si la hay) para copiar sus datos/firmante/número al reemitir. */
  async vigenteAnterior(
    operativoId: number,
    funcionarioId: number,
    cliente: Prisma.TransactionClient,
  ): Promise<VigenteAnterior | null> {
    return cliente.ordenServicio.findFirst({
      where: { operativoId, funcionarioId, vigente: true },
      select: {
        editables: true,
        firmante: true,
        numeroSecuencial: true,
        numeroAnio: true,
      },
    });
  }

  async crear(
    datos: DatosOrden,
    cliente: Prisma.TransactionClient,
  ): Promise<OrdenServicio> {
    return cliente.ordenServicio.create({ data: datos });
  }

  /**
   * SECUENCIAL ANUAL ATÓMICO (G, 2026-10-02). Incrementa el contador del año y devuelve el nuevo
   * número en UNA sentencia: el `ON CONFLICT DO UPDATE` toma el bloqueo de la fila, así que dos
   * emisiones simultáneas obtienen números distintos sin colisión. Año nuevo sin fila → arranca en 1.
   * Parametrizado (tagged template de `$queryRaw`); nunca `$queryRawUnsafe`.
   */
  async siguienteSecuencial(
    anio: number,
    cliente: Prisma.TransactionClient,
  ): Promise<number> {
    const filas = await cliente.$queryRaw<{ seor_ultimo_secuencial: number }[]>`
      INSERT INTO "t_secuencia_orden" ("seor_anio", "seor_ultimo_secuencial")
      VALUES (${anio}, 1)
      ON CONFLICT ("seor_anio") DO UPDATE
        SET "seor_ultimo_secuencial" = "t_secuencia_orden"."seor_ultimo_secuencial" + 1
      RETURNING "seor_ultimo_secuencial"
    `;
    return filas[0].seor_ultimo_secuencial;
  }

  /** Fija el número AMC-OS en la orden (al quedar Vigente). */
  async asignarNumero(
    ordenId: number,
    anio: number,
    secuencial: number,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.ordenServicio.update({
      where: { id: ordenId },
      data: { numeroAnio: anio, numeroSecuencial: secuencial },
    });
  }

  /**
   * La orden por código con lo necesario para completar sus editables y decidir si numera, dentro de
   * una transacción. Trae el funcionario, la fecha de la jornada y el número para construir la fuente
   * de tokens (D12) con la que se calculan los faltantes al guardar.
   */
  async paraCompletar(
    codigo: string,
    cliente: Prisma.TransactionClient,
  ): Promise<{
    id: number;
    vigente: boolean;
    firmante: Prisma.JsonValue;
    directorId: number | null;
    plantillaId: number | null;
    plantillaVersion: number | null;
    numeroSecuencial: number | null;
    numeroAnio: number | null;
    emitidaEn: Date;
    funcionario: {
      nombres: string;
      apellidos: string;
      cargo: string | null;
      direccion: RolDepartamental;
    };
    operativo: { cuadro: { fecha: Date } };
  } | null> {
    return cliente.ordenServicio.findUnique({
      where: { codigo },
      select: {
        id: true,
        vigente: true,
        firmante: true,
        directorId: true,
        plantillaId: true,
        plantillaVersion: true,
        numeroSecuencial: true,
        numeroAnio: true,
        emitidaEn: true,
        funcionario: {
          select: {
            nombres: true,
            apellidos: true,
            cargo: true,
            direccion: true,
          },
        },
        operativo: { select: { cuadro: { select: { fecha: true } } } },
      },
    });
  }

  // ───────────────── Config del memorando por cuadro (D13) ─────────────────

  /**
   * La config del memorando de una jornada (número de memorando, NUT, quién elabora), o `null` si
   * aún no se ha configurado. Acepta el cliente de transacción para leerse dentro del completado.
   */
  async obtenerConfigCuadro(
    fecha: Date,
    cliente?: Prisma.TransactionClient,
  ): Promise<ConfigCuadroFila | null> {
    const db = cliente ?? this.prisma;
    return db.ordenConfigCuadro.findUnique({
      where: { fecha },
      select: { nut: true, elaboradoPor: true },
    });
  }

  /** Crea o actualiza la config del memorando de una jornada. */
  async upsertConfigCuadro(
    fecha: Date,
    datos: ConfigCuadroFila,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.ordenConfigCuadro.upsert({
      where: { fecha },
      create: { fecha, ...datos },
      update: datos,
    });
  }

  /**
   * Los borradores VIGENTES de la jornada que aún no tienen número, para promoverlos al guardar la
   * config del cuadro: con sus datos de persona (incluida la dirección, de la que sale la
   * dependencia), firmante y editables se recalculan los faltantes con los mismos criterios (D12).
   */
  async borradoresSinNumeroDeCuadro(
    fecha: Date,
    cliente: Prisma.TransactionClient,
  ): Promise<BorradorDeCuadro[]> {
    return cliente.ordenServicio.findMany({
      where: {
        vigente: true,
        numeroSecuencial: null,
        operativo: { cuadro: { fecha } },
      },
      select: {
        id: true,
        codigo: true,
        firmante: true,
        directorId: true,
        plantillaId: true,
        plantillaVersion: true,
        editables: true,
        numeroSecuencial: true,
        numeroAnio: true,
        emitidaEn: true,
        funcionario: {
          select: {
            nombres: true,
            apellidos: true,
            cargo: true,
            direccion: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * Los borradores VIGENTES sin número de UN Director (de cualquier jornada), para regenerarlos al
   * guardar SU plantilla: solo los suyos —nunca los de otro Director—. Lleva la fecha del cuadro para
   * leer la config (NUT/elaboradoPor) de cada jornada por separado.
   */
  async borradoresDeDirector(
    directorId: number,
    cliente: Prisma.TransactionClient,
  ): Promise<BorradorGlobal[]> {
    return cliente.ordenServicio.findMany({
      where: { vigente: true, numeroSecuencial: null, directorId },
      select: {
        id: true,
        codigo: true,
        firmante: true,
        directorId: true,
        plantillaId: true,
        plantillaVersion: true,
        editables: true,
        numeroSecuencial: true,
        numeroAnio: true,
        emitidaEn: true,
        funcionario: {
          select: {
            nombres: true,
            apellidos: true,
            cargo: true,
            direccion: true,
          },
        },
        operativo: { select: { cuadro: { select: { fecha: true } } } },
      },
      orderBy: { id: 'asc' },
    });
  }

  /** Persiste los editables dentro de una transacción (para el flujo de completar). */
  async actualizarEditables(
    codigo: string,
    editables: Prisma.InputJsonValue,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.ordenServicio.update({
      where: { codigo },
      data: { editables },
    });
  }

  /**
   * Re-sella la copia del firmante de una orden (cargo/dependencia) al completar el perfil del
   * Director. Solo se usa sobre borradores con el firmante INCOMPLETO: completa un dato que faltaba,
   * no reescribe una firma ya válida (F20).
   */
  async actualizarFirmante(
    ordenId: number,
    firmante: Prisma.InputJsonValue,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.ordenServicio.update({
      where: { id: ordenId },
      data: { firmante },
    });
  }
}
