/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · línea de tiempo por conductor
 * Archivo: planificacion-transporte.service.ts
 * Responsabilidad: Generar tramos, evaluar conductores y asignar bloques de tramos (Fases 1 y 2).
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * LA ASIGNACIÓN DEJA DE SER 1 OPERATIVO → 1 CONDUCTOR. En la calle un conductor ENCADENA varios
 * operativos del día y la analista de la DAF va llenando sus huecos; los PMO solo piden dejar y/o
 * retirar. Por eso aquí se asignan TRAMOS (ver `plan-tramos.ts`), y la decisión de si un conductor
 * puede tomarlos la toma la política pura `asignacion-conductor.policy.ts`.
 *
 * REGLA 3 INTACTA: `ActualizarTransporteDto` sigue con exactamente dos campos y su endpoint no
 * cambia. Esto vive en endpoints propios.
 *
 * REGLA 10 INTACTA: la orden de servicio y la matriz siguen leyendo `operativo.conductorId/
 * vehiculoId`. Aquí ese par se SINCRONIZA con el PRIMER tramo asignado (con conductor y vehículo)
 * del operativo, a través del servicio publicado de operativos (`asignarTransporte` /
 * `desasignarTransporte`, que auditan). La sincronización corre después de confirmar la escritura de
 * los tramos y es idempotente: si fallara, la siguiente escritura la repone.
 *
 * Toda lectura para evaluar se hace EN LOTE por fecha (sin N+1).
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Injectable } from '@nestjs/common';
import {
  AccionAuditoria,
  EstadoTransporte,
  TipoTramo,
  type Prisma,
  type TurnoConductor,
} from '@prisma/client';

import { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import {
  RecursoNoEncontradoError,
  ReglaNegocioError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import {
  OperativosService,
  type Autor,
} from '../../operativos/application/operativos.service';
import {
  ElegibilidadService,
  type BloqueDeConduccion,
  type EvaluadorConduccion,
} from '../../talento-operativo/application/elegibilidad.service';
import {
  PlanificacionTransporteRepository,
  type NuevoTramo,
  type OperativoDePlanificacion,
  type TramoCompleto,
} from '../infrastructure/planificacion-transporte.repository';
import {
  ParametrosTransporteService,
  type ParametrosPlanificacion,
} from './parametros-transporte.service';
import {
  evaluar,
  finDeAyerEnHoy,
  type CodigoMotivo,
  type ConductorEvaluado,
  type Evaluacion,
  type Motivo,
  type ParametrosAsignacion,
  type TramoEvaluado,
  type VehiculoEvaluado,
} from './politicas/asignacion-conductor.policy';
import { actaVigente } from './politicas/acta-parqueadero';
import {
  agendaPorUnidad,
  claveDeUnidad,
  conSuUnidad,
  contiene,
  encajarEnUnidad,
  maximoAbordo,
  mismoLugar,
  palabraDeTramo,
  type MomentoDeLaUnidad,
  type TramoDeLaUnidad,
  type TramoQueSeSuma,
} from './politicas/compartir-tramo';
import { agruparCadenas, type BloqueTransporte } from './politicas/cadenas';
import {
  aEscalaDeLinea,
  aHora,
  franjaDe,
  MINUTOS_DIA,
  seSolapan,
  type Franja,
} from './politicas/linea-de-tiempo';
import { nombreDeUnidad } from './politicas/nombre-unidad';
import { planificarTramos } from './politicas/plan-tramos';
import { claveTraslado, type Lugar } from './politicas/traslados';

const NOMBRE_TIPO: Record<TipoTramo, string> = {
  DEJAR: 'dejar',
  RETIRAR: 'retirar',
  COMPLETO: 'completo',
  TAREA: 'tarea',
};

/** El resultado de evaluar a un conductor para un bloque. */
export interface EvaluacionConductor {
  conductorId: number;
  nombre: string;
  estado: Evaluacion['estado'];
  motivos: (Motivo & { tipo: 'DURO' | 'AVISO' })[];
  costo: number;
  /** Vehículo con el que se evaluó: el enviado o, en la lista de candidatos, el propuesto. */
  vehiculoId: number | null;
}

/** Una placa del día evaluada para un conductor y un bloque (sustitución de flota, 2026-10-15). */
export interface VehiculoParaElBloque {
  vehiculoId: number;
  placa: string;
  descripcion: string | null;
  tipo: string | null;
  asientos: number | null;
  /** La que se le propondría (`vehiculoPropuesto`): la que ya usa hoy o su habitual. */
  propuesto: boolean;
  estado: Evaluacion['estado'];
  motivos: EvaluacionConductor['motivos'];
  /** RN-DAF-01: con quién está esa placa en una franja que se cruza con el bloque. */
  ocupadaPor: {
    conductorId: number | null;
    nombre: string | null;
    horaInicio: string;
    horaFin: string;
  } | null;
}

export interface EvaluacionDeVehiculos {
  conductorId: number;
  propuestoId: number | null;
  /** La propuesta primero; luego ✓ / ⚠ / ✕ y por placa. */
  vehiculos: VehiculoParaElBloque[];
}

/** Lo que se asigna: un bloque de operativos (o unos tramos concretos) a un conductor. */
export interface DatosAsignacionBloque {
  fecha: Date;
  operativoIds: number[];
  /** Si se indican, solo estos tramos (p. ej. solo el «dejar»). Deben ser de esos operativos. */
  tramoIds?: number[];
  conductorId: number;
  vehiculoId: number | null;
}

/**
 * Un operativo que viajaba en una unidad compartida y quedó sin conductor porque su anfitrión se
 * quitó o se reasignó (2026-10-19). La respuesta lo devuelve para avisar a la DAF.
 */
export interface OperativoLiberado {
  operativoId: number;
  identificador: string;
}

/** Un anfitrión con el que un operativo puede compartir unidad (diálogo de candidatos, 2026-10-19). */
export interface AnfitrionCompartible {
  operativoId: number;
  identificador: string;
  formulario: string;
  horaInicio: string;
  horaFin: string;
  conductor: { id: number; nombre: string };
  vehiculo: { id: number; placa: string; asientos: number | null };
  /**
   * Asientos que quedan en el momento más lleno de la unidad, sin este operativo; `null` si la placa
   * no los tiene registrados.
   */
  asientosLibres: number | null;
  /**
   * Los asientos de cada momento con este operativo a bordo (2026-10-21, por momento): «al dejar
   * (08:00) 3 de 3 · al retirar (16:00) 3 de 3». Vacío si no es compatible.
   */
  asientosPorMomento: { tipo: string; hora: string; ocupados: number }[];
  /** Lo pidió quien registró el operativo (`compartirConId`). Va primero. */
  solicitado: boolean;
  compatible: boolean;
  /** Por qué no, en palabras del funcionario; `null` si es compatible. */
  motivo: string | null;
  /** Traslados que harían juntos («dejar»), 2026-10-19 «la misma unidad». */
  comparte: string[];
  /**
   * Traslados que van DENTRO de un «completo» (2026-10-20): con ABARCA, los de la unidad que el
   * «completo» del invitado cubre («dejar», «retirar»); con DENTRO, los del invitado que caen en el
   * «completo» de la unidad. Vacío sin «completo».
   */
  contiene: string[];
  /** Traslados del invitado sin pareja («retirar»): la misma unidad los haría aparte. */
  propios: string[];
  /** ¿Puede esa misma unidad hacer los propios? `null` si no hay propios. */
  propiosViables: boolean | null;
  /** Por qué no puede (la política con esa placa); `null` si puede o no hay propios. */
  motivoPropios: string | null;
  /**
   * Las personas del momento más lleno de la unidad con el invitado (2026-10-21, los asientos se
   * cuentan por momento). `null` si no es compatible.
   */
  personasConInvitado: number | null;
  /**
   * «Completo» (2026-10-20): `ABARCA` si el «completo» del invitado cubre los traslados de esa
   * unidad; `DENTRO` si sus traslados caen en el «completo» de la unidad; `null` si no hay «completo».
   */
  completo: 'ABARCA' | 'DENTRO' | null;
}

/** El aviso de la DAF cuando quitar o reasignar un anfitrión deja sin conductor a sus invitados. */
export function avisoLiberados(
  liberados: readonly OperativoLiberado[],
): string | null {
  if (liberados.length === 0) return null;
  const ids = liberados.map((l) => l.identificador).join(', ');
  return liberados.length === 1
    ? `1 operativo que compartía esta unidad quedó sin conductor: ${ids}.`
    : `${liberados.length} operativos que compartían esta unidad quedaron sin conductor: ${ids}.`;
}

/**
 * Hasta cuántos minutos de diferencia de inicio se MUESTRA un anfitrión incompatible en
 * «Compartir unidad» (apagado, con su motivo). No decide nada: compatible o no lo dice la regla
 * pura con COMPARTIR_VENTANA_MIN (regla 2); esto solo acota la lista para no mostrar el día entero.
 */
const MINUTOS_CERCANIA_COMPARTIR = 120;

/** Cuántos anfitriones devuelve `compartibles` como mucho. */
const MAXIMO_COMPARTIBLES = 10;

/** Un tramo del invitado visto para compartir: el existente o el que planificaría. */
interface TramoParaCompartir {
  id: number;
  tipo: string;
  franja: Franja;
  origen: Lugar | null;
  esMacrooperativo: boolean;
  /** El punto de encuentro de su operativo («completo», 2026-10-20). */
  puntoId?: number | null;
}

/**
 * Un traslado del invitado SIN pareja en la unidad del anfitrión (2026-10-19, «la misma unidad»):
 * si la misma unidad lo hace (`asignado`) o queda pendiente, con el motivo.
 */
export interface TramoPropio {
  tramoId: number;
  tipo: string;
  asignado: boolean;
  motivo?: string;
}

/** Un tramo que viajaba con un anfitrión y quedó suelto (lo que tenía, para la traza). */
type InvitadoLiberado = Awaited<
  ReturnType<PlanificacionTransporteRepository['liberarInvitados']>
>[number];

/** Lo que `contextoCompartir` deja a mano para evaluar «compartir» sobre un día cargado. */
interface ContextoCompartir {
  franjaDe(t: TramoCompleto): Franja;
  lugarDe(zonalId: number | null): Lugar | null;
  lugarDeTramo(t: TramoCompleto): Lugar | null;
  comoCompartible(
    t: TramoCompleto,
    operativo: Pick<OperativoDePlanificacion, 'esMacrooperativo'>,
  ): TramoParaCompartir;
  anfitrionesDe(operativoId: number): TramoCompleto[];
  /**
   * LA UNIDAD DEL GRUPO de un operativo ya asignado (2026-10-19): los tramos con su conductor y su
   * placa del anfitrión y de quienes ya van con él (piden viajar con él o comparten un tramo del
   * grupo), cada uno por su tramo raíz y sin los del operativo que se evalúa. Un «solo retirar» C puede así viajar
   * con el retiro de B, que esa misma unidad hace después del dejar de A.
   */
  unidadDe(operativoId: number, excluirOperativoId: number): TramoCompleto[];
  /** Todo lo que hace hoy la unidad (ese conductor con esa placa), sea o no del grupo. */
  deLaUnidad(conductorId: number, vehiculoId: number | null): TramoCompleto[];
  /**
   * Las personas del momento más lleno de la unidad de esos tramos (su conductor y su placa), sin
   * `excluirOperativoId` (2026-10-21): los asientos se cuentan por momento.
   */
  ocupadosEnLaUnidad(
    tramos: readonly TramoCompleto[],
    ventanaMin: number,
    excluirOperativoId?: number,
  ): number;
  /** El punto de encuentro del operativo del tramo, o `null`. */
  puntoDe(t: TramoCompleto): number | null;
  personasDe(operativoId: number | null): number;
  /** Los funcionarios del operativo (para contar personas distintas en un grupo). */
  funcionariosDe(operativoId: number | null): number[];
  esMacroDe(t: TramoCompleto): boolean;
  asientosDe(vehiculoId: number | null): number | null;
}

/** Todo lo que se lee de una vez para evaluar un día (lo comparten la asignación y el optimizador). */
export interface DatosDelDia {
  parametros: ParametrosPlanificacion;
  asignacion: ParametrosAsignacion;
  conductores: Awaited<
    ReturnType<PlanificacionTransporteRepository['conductoresActivos']>
  >;
  vehiculos: Awaited<
    ReturnType<PlanificacionTransporteRepository['vehiculosActivos']>
  >;
  tramosHoy: TramoCompleto[];
  tramosAyer: TramoCompleto[];
  turnos: Map<number, TurnoConductor>;
  activados: Set<number>;
  ausentes: Set<number>;
  enTaller: Set<number>;
  amaneceEn: Map<number, Lugar>;
  /** Vehículo → conductor que se lo llevó anoche a su domicilio (mañana se le repite). */
  llevadoPor: Map<number, number>;
  /**
   * RN-44 y RN-25 (2026-10-14): las restricciones de descanso que decide `talento-operativo`, con
   * los antecedentes de todos los conductores del día ya cargados por lote.
   */
  restriccion: EvaluadorConduccion;
}

/**
 * Cómo se llama en la política de tramos un veredicto de descanso de `talento-operativo`. El
 * evaluador de conducción solo devuelve dos: RN-44 (patrulla consecutiva) y RN-25 (tope).
 */
function codigoDeRestriccion(codigo: string | undefined): CodigoMotivo {
  return codigo === CODIGOS_ERROR.CONDUCTOR_PATRULLA_CONSECUTIVA
    ? 'PATRULLA_DIA_ANTERIOR'
    : 'TOPE_SALIDAS_PESADAS';
}

/** G2 (2026-10-15): asignar sin placa vale, pero el operativo no queda completo sin ella. */
const AVISO_SIN_VEHICULO: Motivo = {
  codigo: 'SIN_VEHICULO',
  mensaje: 'Asignado sin vehículo: falta la placa.',
};

/** RN-DAF-01, en palabras del funcionario: la placa ya está con otro conductor a esa hora. */
function mensajePlacaOcupada(choque: TramoCompleto): string {
  return `La placa ${choque.vehiculo?.placa ?? ''} ya está con ${choque.conductor?.nombreCompleto ?? 'otro conductor'} de ${choque.horaInicio} a ${choque.horaFin}.`;
}

/** Los motivos DUROS de una evaluación, en una frase. */
function mensajeNoViable(
  nombre: string,
  evaluacion: EvaluacionConductor,
): string {
  return `No se puede asignar a ${nombre}: ${evaluacion.motivos
    .filter((m) => m.tipo === 'DURO')
    .map((m) => m.mensaje)
    .join(' ')}`;
}

@Injectable()
export class PlanificacionTransporteService {
  constructor(
    private readonly repositorio: PlanificacionTransporteRepository,
    private readonly parametros: ParametrosTransporteService,
    private readonly operativos: OperativosService,
    private readonly auditoria: AuditoriaService,
    private readonly elegibilidad: ElegibilidadService,
  ) {}

  // ─────────────────────────── Lectura ───────────────────────────

  /**
   * El plan del día para la línea de tiempo: operativos (con su cadena), tramos, conductores con su
   * turno/activación/ausencia, vehículos con taller y dónde amanecen. No escribe nada.
   */
  async planDelDia(fecha: Date) {
    const manana = new Date(fecha.getTime() + MINUTOS_DIA * 60_000);
    const [dia, operativos, tramosManana] = await Promise.all([
      this.datosDelDia(fecha),
      this.repositorio.operativosDeFecha(fecha),
      this.repositorio.tramosDeFecha(manana),
    ]);
    // Fase 5 · «dejar con combustible para el siguiente turno»: el vehículo sale otra vez mañana.
    const saleManana = new Set(
      tramosManana
        .filter((t) => t.vehiculoId !== null)
        .map((t) => t.vehiculoId as number),
    );
    const bloques = this.bloquesDe(operativos, dia.parametros.inicioJornada);
    // La política compara en la escala interna (desde las 00H00); la línea se dibuja desde el
    // inicio de la jornada. La conversión es SOLO de la respuesta (2026-10-07, desfase de +5 h).
    const enLinea = (franja: Franja) =>
      aEscalaDeLinea(franja, dia.parametros.inicioJornada);
    const bloqueDe = new Map<number, number>();
    bloques.forEach((b, indice) =>
      b.operativoIds.forEach((id) => bloqueDe.set(id, indice)),
    );

    return {
      fecha: fecha.toISOString().slice(0, 10),
      inicioJornada: dia.parametros.inicioJornada,
      /**
       * Franjas para DIBUJAR la línea de tiempo (Fase 4), en minutos sobre la línea que empieza en
       * `inicioJornada`: el límite del nombramiento de conductores y la ventana de cada turno. Son
       * los mismos parámetros que evalúa la política (regla 2); el navegador no los recalcula.
       */
      ventanaNombramiento: enLinea(dia.parametros.ventanaNombramiento),
      ventanasTurno: {
        DIA: enLinea(dia.parametros.ventanasTurno.DIA),
        NOCHE: enLinea(dia.parametros.ventanasTurno.NOCHE),
        ECU_NOCHE: enLinea(dia.parametros.ventanasTurno.ECU_NOCHE),
      },
      operativos: operativos.map((o) => ({
        id: o.id,
        identificador: o.identificador,
        formulario: `${o.formulario.numero}. ${o.formulario.nombre}`,
        horaInicio: o.horaInicio,
        horaFin: o.horaFin,
        tipoTransporte: o.tipoTransporte,
        esMacrooperativo: o.esMacrooperativo,
        // ALV-07 (2026-10-07): la DAF lo ve como «Transporte liberado» hasta reasignarlo.
        transporteLiberado: Boolean(o.transporteLiberadoEn),
        estadoTransporte: o.estadoTransporte,
        departamento: nombreDeUnidad(o.creadoPorRol),
        departamentoCodigo: o.creadoPorRol,
        zonal: o.zonales[0]?.zonal ?? null,
        funcionarios: o.personal.map((p) => ({
          id: p.funcionarioId,
          nombre: `${p.funcionario.apellidos} ${p.funcionario.nombres}`,
        })),
        bloque: bloqueDe.get(o.id) ?? null,
      })),
      bloques: bloques.map((b) => ({
        operativoIds: b.operativoIds,
        funcionarioIds: b.funcionarioIds,
        enCadena: b.operativoIds.length > 1,
      })),
      tramos: dia.tramosHoy.map((t) => this.tramoDto(t)),
      conductores: dia.conductores.map((c) => ({
        id: c.id,
        nombre: c.nombreCompleto,
        sector: c.sector,
        tipoContrato: c.tipoContrato,
        parqueaderoAutorizado: c.parqueaderoAutorizado,
        actaVigente: actaVigente(c, fecha),
        turno: dia.turnos.get(c.id) ?? null,
        activado: dia.activados.has(c.id),
        ausente: dia.ausentes.has(c.id),
        /** Minuto de HOY (línea 05H00) en que terminó su último tramo de ayer; > 0 = vino de noche. */
        ultimoFinAyer: this.ultimoFinAyer(c.id, dia),
        vehiculoHabitualId: c.vehiculoHabitualId,
      })),
      vehiculos: dia.vehiculos.map((v) => ({
        id: v.id,
        placa: v.placa,
        tipo: v.tipo,
        asientos: v.asientos,
        enTaller: dia.enTaller.has(v.id),
        amaneceEn: dia.amaneceEn.get(v.id) ?? null,
        /** Quien se lo llevó anoche a su domicilio (se le repite hoy), o null. */
        llevadoPor: dia.llevadoPor.get(v.id) ?? null,
        avisoCombustible: saleManana.has(v.id),
      })),
    };
  }

  /**
   * Evalúa a TODOS los conductores activos para un bloque (o unos tramos): ✓ / ⚠ / ✕ con su motivo
   * y su costo. Los tramos que aún no existen se evalúan con el PLAN que generarían.
   */
  async evaluarBloque(
    fecha: Date,
    operativoIds: number[],
    tramoIds?: number[],
  ): Promise<EvaluacionConductor[]> {
    return (await this.evaluarConContexto(fecha, operativoIds, tramoIds))
      .evaluaciones;
  }

  /**
   * Lo mismo que `evaluarBloque`, con lo que hace falta para redactar los candidatos del diálogo
   * «Asignar / Cambiar conductor» (2026-10-08): los datos del día, los operativos, sus tramos y las
   * franjas del bloque. No escribe nada.
   */
  async evaluarConContexto(
    fecha: Date,
    operativoIds: number[],
    tramoIds?: number[],
  ): Promise<{
    evaluaciones: EvaluacionConductor[];
    dia: DatosDelDia;
    operativos: OperativoDePlanificacion[];
    existentes: TramoCompleto[];
    bloque: { tramos: TramoEvaluado[]; idsTramos: number[] };
  }> {
    const [dia, operativos, existentes] = await Promise.all([
      this.datosDelDia(fecha),
      this.exigirOperativosDe(fecha, operativoIds),
      this.repositorio.tramosDeOperativos(operativoIds),
    ]);
    const bloque = this.bloqueEvaluado(
      operativos,
      existentes,
      tramoIds,
      dia.parametros,
    );
    const ids = new Set(bloque.idsTramos);
    const conBloque = {
      ...bloque.evaluado,
      conduccion: this.conduccionDe(operativos),
    };

    const evaluaciones = dia.conductores
      .map((c) =>
        this.evaluarConductor(
          c,
          this.vehiculoPropuesto(c, ids, dia),
          conBloque,
          ids,
          fecha,
          dia,
        ),
      )
      .sort(
        (a, b) =>
          ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado] ||
          a.costo - b.costo ||
          a.nombre.localeCompare(b.nombre),
      );
    return {
      evaluaciones,
      dia,
      operativos,
      existentes,
      bloque: { tramos: bloque.evaluado.tramos, idsTramos: bloque.idsTramos },
    };
  }

  /**
   * Dónde está cada vehículo ese día: dónde AMANECE (la guarda que se declaró ayer), dónde QUEDA
   * (la de hoy) y si está en TALLER. Es la tabla de ubicaciones de la línea de tiempo.
   */
  async ubicacionesDelDia(fecha: Date) {
    const ayer = new Date(fecha.getTime() - MINUTOS_DIA * 60_000);
    const [vehiculos, destinosAyer, destinosHoy, enTaller] = await Promise.all([
      this.repositorio.vehiculosActivos(),
      this.repositorio.destinosDe(ayer),
      this.repositorio.destinosDe(fecha),
      this.repositorio.vehiculosEnTaller(fecha),
    ]);
    const describir = (d: (typeof destinosHoy)[number] | undefined) =>
      d
        ? {
            tipo: d.tipo ?? (d.domicilio ? 'DOMICILIO' : 'GARAJE'),
            ubicacion: d.ubicacion
              ? { id: d.ubicacion.id, nombre: d.ubicacion.nombre }
              : null,
            zonalId: d.ubicacion?.zonal?.id ?? null,
            domicilio: d.domicilio,
            observacion: d.observacion,
          }
        : null;
    return vehiculos.map((v) => ({
      vehiculoId: v.id,
      placa: v.placa,
      enTaller: enTaller.has(v.id),
      amaneceEn: describir(destinosAyer.find((d) => d.vehiculoId === v.id)),
      quedaEn: describir(destinosHoy.find((d) => d.vehiculoId === v.id)),
    }));
  }

  // ─────────────────────────── Escritura ───────────────────────────

  /** Genera los tramos de los operativos del día que aún no tienen ninguno. Idempotente. */
  async generarTramosDelDia(
    fecha: Date,
    autor: Autor,
  ): Promise<{ generados: number }> {
    const [operativos, parametros] = await Promise.all([
      this.repositorio.operativosDeFecha(fecha),
      this.parametros.leer(),
    ]);
    const existentes = await this.repositorio.tramosDeOperativos(
      operativos.map((o) => o.id),
    );
    const conTramos = new Set(existentes.map((t) => t.operativoId));
    const nuevos = operativos
      .filter((o) => !conTramos.has(o.id))
      .flatMap((o) => this.planDeOperativo(o, fecha, parametros, autor));

    if (nuevos.length === 0) return { generados: 0 };

    await this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      await this.repositorio.crearTramos(nuevos, cliente);
      await this.auditoria.registrar(
        {
          entidad: 't_tramo_transporte',
          entidadId: 0,
          accion: AccionAuditoria.CREAR,
          cambios: [
            { campo: 'tramos_generados', valorNuevo: String(nuevos.length) },
          ],
          usuario: autor.usuarioId,
          rol: autor.rol,
        },
        cliente,
      );
    });
    return { generados: nuevos.length };
  }

  /**
   * SUSTITUCIÓN DE FLOTA (2026-10-15). Cada placa activa del día evaluada para UN conductor y UN
   * bloque, para que el diálogo de candidatos deje elegir otra que la propuesta (MD §1: un
   * conductor no está amarrado a su vehículo). Mismas reglas que `asignarBloque`: la política de
   * tramos con ese vehículo (taller, asientos, arranque lejos) y RN-DAF-01 (placa con otro
   * conductor a esa hora, como `PLACA_OCUPADA`). Todo sale de `datosDelDia`: una lectura por día,
   * no una por placa. No escribe.
   */
  async evaluarVehiculos(
    fecha: Date,
    operativoIds: number[],
    tramoIds: number[] | undefined,
    conductorId: number,
  ): Promise<EvaluacionDeVehiculos> {
    const [dia, operativos, existentes] = await Promise.all([
      this.datosDelDia(fecha),
      this.exigirOperativosDe(fecha, operativoIds),
      this.repositorio.tramosDeOperativos(operativoIds),
    ]);
    const conductor = dia.conductores.find((c) => c.id === conductorId);
    if (!conductor) {
      throw new RecursoNoEncontradoError(
        'El conductor indicado no existe o está dado de baja.',
        { conductorId },
      );
    }
    const bloque = this.bloqueEvaluado(
      operativos,
      existentes,
      tramoIds,
      dia.parametros,
    );
    const ids = new Set(bloque.idsTramos);
    const conBloque = {
      ...bloque.evaluado,
      conduccion: this.conduccionDe(operativos),
    };
    const propuestoId = this.vehiculoPropuesto(conductor, ids, dia);

    const vehiculos = dia.vehiculos.map((v): VehiculoParaElBloque => {
      const { evaluacion, choque } = this.viabilidad(
        conductor,
        v.id,
        conBloque,
        ids,
        fecha,
        dia,
      );
      const motivos = choque
        ? [
            {
              codigo: 'PLACA_OCUPADA' as const,
              mensaje: mensajePlacaOcupada(choque),
              tipo: 'DURO' as const,
            },
            ...evaluacion.motivos,
          ]
        : evaluacion.motivos;
      return {
        vehiculoId: v.id,
        placa: v.placa,
        descripcion: v.descripcion,
        tipo: v.tipo,
        asientos: v.asientos,
        propuesto: v.id === propuestoId,
        estado: choque ? 'DURO' : evaluacion.estado,
        motivos,
        ocupadaPor: choque
          ? {
              conductorId: choque.conductorId,
              nombre: choque.conductor?.nombreCompleto ?? null,
              horaInicio: choque.horaInicio,
              horaFin: choque.horaFin,
            }
          : null,
      };
    });
    vehiculos.sort(
      (a, b) =>
        Number(b.propuesto) - Number(a.propuesto) ||
        ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado] ||
        a.placa.localeCompare(b.placa),
    );
    return { conductorId, propuestoId, vehiculos };
  }

  /**
   * Asigna un bloque (o unos tramos) a un conductor y su vehículo. Si la política da algún DURO, se
   * rechaza con todos los motivos; los AVISOS se devuelven para mostrarlos.
   */
  async asignarBloque(
    datos: DatosAsignacionBloque,
    autor: Autor,
  ): Promise<{
    evaluacion: EvaluacionConductor;
    tramosAsignados: number;
    /** Invitados de una unidad compartida que quedaron sin conductor al reasignar (2026-10-19). */
    liberados: OperativoLiberado[];
    aviso: string | null;
  }> {
    if (datos.operativoIds.length === 0) {
      throw new ValidacionError('Indique al menos un operativo.', {});
    }
    // Los tramos que falten se generan primero (mismo plan que «generar»).
    await this.asegurarTramos(datos.fecha, datos.operativoIds, autor);

    const [dia, operativos, existentes] = await Promise.all([
      this.datosDelDia(datos.fecha),
      this.exigirOperativosDe(datos.fecha, datos.operativoIds),
      this.repositorio.tramosDeOperativos(datos.operativoIds),
    ]);
    const conductor = dia.conductores.find((c) => c.id === datos.conductorId);
    if (!conductor) {
      throw new RecursoNoEncontradoError(
        'El conductor indicado no existe o está dado de baja.',
        {
          conductorId: datos.conductorId,
        },
      );
    }
    if (
      datos.vehiculoId !== null &&
      !dia.vehiculos.some((v) => v.id === datos.vehiculoId)
    ) {
      throw new RecursoNoEncontradoError(
        'El vehículo indicado no existe o está dado de baja.',
        {
          vehiculoId: datos.vehiculoId,
        },
      );
    }

    const bloque = this.bloqueEvaluado(
      operativos,
      existentes,
      datos.tramoIds,
      dia.parametros,
    );
    if (bloque.idsTramos.length === 0) {
      throw new ValidacionError(
        'Esos operativos no piden transporte (propios medios) o los tramos indicados no son suyos.',
        { operativoIds: datos.operativoIds },
      );
    }
    // Varios operativos que se cruzan en el bloque van en UNA unidad (2026-10-21): el «completo» y los
    // dejar y retirar de su punto. Si no caben juntos, 409 con el motivo; nunca se escriben dos
    // traslados que se pisan sin su marca de grupo.
    const grupo = await this.agruparEnElBloque(
      existentes.filter((t) => bloque.idsTramos.includes(t.id)),
      operativos,
      datos.vehiculoId,
      dia,
    );
    const { evaluacion, choque } = this.viabilidad(
      conductor,
      datos.vehiculoId,
      {
        ...bloque.evaluado,
        personas: grupo?.personasDeLaUnidad ?? bloque.evaluado.personas,
        conduccion: this.conduccionDe(operativos),
      },
      new Set(bloque.idsTramos),
      datos.fecha,
      dia,
    );
    if (choque) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.VEHICULO_OCUPADO,
        mensajePlacaOcupada(choque),
        { tramoId: choque.id },
      );
    }
    if (evaluacion.estado === 'DURO') {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.ASIGNACION_NO_VIABLE,
        mensajeNoViable(conductor.nombreCompleto, evaluacion),
        { motivos: evaluacion.motivos },
      );
    }

    const soltados = await this.repositorio.ejecutarEnTransaccion(
      async (cliente) => {
        // Compartir unidad (2026-10-19): si alguno de estos tramos era ANFITRIÓN, quienes viajaban
        // con él quedan sin conductor (su unidad cambia), con su traza.
        const invitados = await this.repositorio.liberarInvitados(
          bloque.idsTramos,
          bloque.idsTramos,
          cliente,
        );
        await this.trazarLiberados(invitados, autor, cliente);
        await this.repositorio.asignarTramos(
          bloque.idsTramos,
          datos.conductorId,
          datos.vehiculoId,
          cliente,
        );
        for (const [tramoId, raizId] of grupo?.marcas ?? [])
          await this.repositorio.compartirTramo(
            tramoId,
            {
              id: raizId,
              conductorId: datos.conductorId,
              vehiculoId: datos.vehiculoId,
            },
            cliente,
          );
        await this.auditoria.registrar(
          {
            entidad: 't_tramo_transporte',
            entidadId: bloque.idsTramos[0],
            accion: AccionAuditoria.ACTUALIZAR,
            operativoId: datos.operativoIds[0],
            cambios: [
              { campo: 'cond_id', valorNuevo: String(datos.conductorId) },
              {
                campo: 'vehi_id',
                valorNuevo:
                  datos.vehiculoId === null ? '' : String(datos.vehiculoId),
              },
              { campo: 'trtr_ids', valorNuevo: bloque.idsTramos.join(',') },
              ...(grupo && grupo.marcas.size > 0
                ? [
                    {
                      campo: 'trtr_compartido_con_id',
                      valorNuevo: [...grupo.marcas]
                        .map(([tramoId, raizId]) => `${tramoId}→${raizId}`)
                        .join(','),
                    },
                  ]
                : []),
            ],
            usuario: autor.usuarioId,
            rol: autor.rol,
          },
          cliente,
        );
        return invitados;
      },
    );

    const liberados = await this.despuesDeLiberar(soltados, autor);
    await this.sincronizarOperativos(datos.operativoIds, autor);
    return {
      evaluacion,
      tramosAsignados: bloque.idsTramos.length,
      liberados,
      aviso: avisoLiberados(liberados),
    };
  }

  /**
   * LOS OPERATIVOS DE UN BLOQUE QUE SE CRUZAN VAN EN UNA UNIDAD (2026-10-21). Asignar varios
   * operativos de una vez al mismo conductor con traslados que se pisan solo vale si viajan juntos:
   * el «completo» primero (es la raíz) y cada uno de los demás encaja con la regla única
   * (`encajarEnUnidad`, asientos por momento con la placa elegida). Devuelve qué tramo va en el grupo
   * de cuál y cuántas personas distintas lleva la unidad (para la política), o `null`
   * si nada se cruza (el bloque de siempre). Si alguno no encaja, 409 con su motivo. No escribe.
   */
  private async agruparEnElBloque(
    tramosBloque: readonly TramoCompleto[],
    operativos: readonly OperativoDePlanificacion[],
    vehiculoId: number | null,
    dia: DatosDelDia,
  ): Promise<{
    marcas: Map<number, number>;
    personasDeLaUnidad: number;
  } | null> {
    const inicio = dia.parametros.inicioJornada;
    const franjaDeTramo = (t: TramoCompleto): Franja =>
      franjaDe(t.horaInicio, t.horaFin, inicio);
    const seCruzanEnElBloque = tramosBloque.some((a) =>
      tramosBloque.some(
        (b) =>
          a.operativoId !== b.operativoId &&
          seSolapan(franjaDeTramo(a), franjaDeTramo(b)),
      ),
    );
    if (!seCruzanEnElBloque) return null;

    const { compartirVentanaMin } = await this.parametros.leerOptimizacion();
    const contexto = this.contextoCompartir(dia, operativos);
    const deOperativo = (o: OperativoDePlanificacion) =>
      tramosBloque.filter((t) => t.operativoId === o.id);
    const tieneCompleto = (o: OperativoDePlanificacion) =>
      deOperativo(o).some((t) => t.tipo === 'COMPLETO');
    const primerInicio = (o: OperativoDePlanificacion) =>
      Math.min(...deOperativo(o).map((t) => franjaDeTramo(t).inicio));
    const orden = operativos
      .filter((o) => deOperativo(o).length > 0)
      .sort(
        (a, b) =>
          Number(tieneCompleto(b)) - Number(tieneCompleto(a)) ||
          primerInicio(a) - primerInicio(b) ||
          a.id - b.id,
      );

    let unidad: TramoDeLaUnidad[] = [];
    const marcas = new Map<number, number>();
    for (const operativo of orden) {
      const suyos: TramoQueSeSuma[] = deOperativo(operativo).map((t) => {
        const compartible = contexto.comoCompartible(t, operativo);
        return {
          id: t.id,
          tipo: t.tipo,
          inicio: compartible.franja.inicio,
          fin: compartible.franja.fin,
          origen: compartible.origen,
          esMacrooperativo: compartible.esMacrooperativo,
          puntoId: compartible.puntoId ?? null,
        };
      });
      const cruza = suyos.some((s) =>
        unidad.some((u) => s.inicio < u.fin && u.inicio < s.fin),
      );
      if (!cruza) {
        for (const s of suyos)
          unidad.push({
            ...s,
            operativoId: operativo.id,
            compartidoConTramoId: null,
          });
        continue;
      }
      const resultado = encajarEnUnidad(
        { operativoId: operativo.id, tramos: suyos },
        unidad,
        {
          ventanaMin: compartirVentanaMin,
          asientos: contexto.asientosDe(vehiculoId),
          personasDe: (id) => contexto.personasDe(id),
          funcionariosDe: (id) => contexto.funcionariosDe(id),
        },
      );
      if (!resultado.compatible) {
        throw new ReglaNegocioError(
          CODIGOS_ERROR.ASIGNACION_NO_VIABLE,
          `${operativo.identificador} no puede ir en la misma unidad que el resto: ${resultado.motivo}`,
          { operativoId: operativo.id, codigo: resultado.codigo },
        );
      }
      const raizDe = new Map(resultado.pares.map((p) => [p.tramoId, p.raizId]));
      for (const { tramoId, raizId } of resultado.reraizar) {
        marcas.set(tramoId, raizId);
        unidad = unidad.map((u) =>
          u.id === tramoId ? { ...u, compartidoConTramoId: raizId } : u,
        );
      }
      for (const s of suyos) {
        const raiz = raizDe.get(s.id) ?? null;
        if (raiz !== null) marcas.set(s.id, raiz);
        unidad.push({
          ...s,
          operativoId: operativo.id,
          compartidoConTramoId: raiz,
        });
      }
    }

    // El momento más lleno de la unidad (2026-10-21): lo que la política compara con los asientos.
    const personasDeLaUnidad = maximoAbordo(unidad, {
      ventanaMin: compartirVentanaMin,
      personasDe: (id) => contexto.personasDe(id),
      funcionariosDe: (id) => contexto.funcionariosDe(id),
    });
    return { marcas, personasDeLaUnidad };
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * EL ADICIONAL HEREDA EL TRANSPORTE DE SU ORIGINAL, POR TRAMOS (2026-10-14).
   *
   * Lo pide `operativos` al crear un adicional, por el puerto `RegistroHerenciaTransporte`
   * (`HerenciaTransporteService` lo inscribe). Se crean los tramos del adicional con el mismo
   * plan que «generar» y, a cada uno, el conductor y el vehículo del tramo del original DEL MISMO
   * TIPO; si el original no tiene un tramo asignado de ese tipo, el reflejo del operativo
   * (`t_operativo.cond_id/vehi_id`, su primer tramo asignado).
   *
   * MISMAS REGLAS QUE LA DAF: cada conductor pasa por `viabilidad`, la misma que `asignarBloque`
   * (política de tramos, placa ocupada, RN-44/RN-25). Se hereda a quien puede; el tramo de quien
   * no, nace libre y la traza dice el motivo.
   *
   * SIN VENTANA: el adicional se dispone por urgencia con la ventana de la DAF cerrada (regla 9).
   * Este método no la consulta y no tiene endpoint propio; solo lo alcanza el puerto.
   *
   * UNA TRANSACCIÓN para crear los tramos y su traza (regla 5): una fila por tramo heredado y el
   * asiento `transporte` del adicional, que dice de dónde salió. El reflejo del operativo se
   * sincroniza después, como en toda asignación.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  async heredarDeOriginal(
    datos: { padreId: number; adicionalId: number },
    autor: Autor,
  ): Promise<{ heredado: boolean; motivo: string | null }> {
    const [operativos, tramosPadre, existentes] = await Promise.all([
      this.repositorio.operativosPorId([datos.padreId, datos.adicionalId]),
      this.repositorio.tramosDeOperativos([datos.padreId]),
      this.repositorio.tramosDeOperativos([datos.adicionalId]),
    ]);
    const padre = operativos.find((o) => o.id === datos.padreId);
    const adicional = operativos.find((o) => o.id === datos.adicionalId);
    // Ya tiene tramos (o no existe): no se toca lo que haya. Idempotente.
    if (!padre || !adicional || existentes.length > 0) {
      return { heredado: false, motivo: null };
    }

    const asignadosPadre = tramosPadre.filter((t) => t.conductorId !== null);
    const reflejo =
      padre.conductorId !== null && padre.vehiculoId !== null
        ? { conductorId: padre.conductorId, vehiculoId: padre.vehiculoId }
        : null;
    const sinHeredar = (texto: string) =>
      this.asentarHerencia(adicional.id, `sin heredar · ${texto}`, autor);

    if (asignadosPadre.length === 0 && !reflejo) {
      await sinHeredar('el operativo original no tenía transporte asignado');
      return { heredado: false, motivo: null };
    }

    const fecha = adicional.cuadro.fecha;
    const dia = await this.datosDelDia(fecha);
    const plan = this.planDeOperativo(adicional, fecha, dia.parametros, autor);
    if (plan.length === 0) {
      await sinHeredar('el adicional no pide transporte (propios medios)');
      return { heredado: false, motivo: null };
    }

    // De quién es cada tramo: el del original del mismo tipo, o su reflejo.
    const fuenteDe = (tipo: TipoTramo) => {
      const tramo = asignadosPadre.find((t) => t.tipo === tipo);
      return tramo
        ? {
            conductorId: tramo.conductorId as number,
            vehiculoId: tramo.vehiculoId,
          }
        : reflejo;
    };

    // Un bloque por conductor: dos tramos del mismo conductor se evalúan juntos (jornada,
    // traslado). El vehículo es el del primero que lo trae.
    const porConductor = new Map<
      number,
      { vehiculoId: number | null; indices: number[] }
    >();
    const motivos: string[] = [];
    plan.forEach((tramo, indice) => {
      const fuente = fuenteDe(tramo.tipo);
      if (!fuente) {
        motivos.push(
          `El tramo «${NOMBRE_TIPO[tramo.tipo]}» no tiene conductor en ${padre.identificador}.`,
        );
        return;
      }
      const grupo = porConductor.get(fuente.conductorId) ?? {
        vehiculoId: null,
        indices: [],
      };
      grupo.vehiculoId ??= fuente.vehiculoId;
      grupo.indices.push(indice);
      porConductor.set(fuente.conductorId, grupo);
    });

    const zonal = adicional.zonales[0]?.zonal ?? null;
    const lugar = zonal ? { zonalId: zonal.id, sector: zonal.sector } : null;
    const personas = new Set(adicional.personal.map((p) => p.funcionarioId))
      .size;
    const asignacion = new Map<
      number,
      { conductorId: number; vehiculoId: number | null }
    >();

    for (const [conductorId, grupo] of porConductor) {
      const conductor = dia.conductores.find((c) => c.id === conductorId);
      if (!conductor) {
        motivos.push(
          `El conductor de ${padre.identificador} ya no está activo.`,
        );
        continue;
      }
      const vehiculoId =
        grupo.vehiculoId !== null &&
        dia.vehiculos.some((v) => v.id === grupo.vehiculoId)
          ? grupo.vehiculoId
          : null;
      const { evaluacion, choque } = this.viabilidad(
        conductor,
        vehiculoId,
        {
          tramos: grupo.indices.map((i) => ({
            franja: franjaDe(
              plan[i].horaInicio,
              plan[i].horaFin,
              dia.parametros.inicioJornada,
            ),
            origen: lugar,
            destino: lugar,
            etiqueta: `${adicional.identificador} (${NOMBRE_TIPO[plan[i].tipo]})`,
          })),
          personas,
          conduccion: this.conduccionDe([adicional]),
        },
        new Set(),
        fecha,
        dia,
      );
      if (choque) {
        motivos.push(mensajePlacaOcupada(choque));
        continue;
      }
      if (evaluacion.estado === 'DURO') {
        motivos.push(mensajeNoViable(conductor.nombreCompleto, evaluacion));
        continue;
      }
      grupo.indices.forEach((i) =>
        asignacion.set(i, { conductorId, vehiculoId }),
      );
    }

    const nuevos: NuevoTramo[] = plan.map((tramo, indice) => ({
      ...tramo,
      conductorId: asignacion.get(indice)?.conductorId ?? null,
      vehiculoId: asignacion.get(indice)?.vehiculoId ?? null,
    }));
    const motivo = motivos.length > 0 ? motivos.join(' ') : null;
    const origenTexto = `heredado de ${padre.identificador}, donde lo asignó la DAF`;

    await this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      const creados = await this.repositorio.crearTramosDevolviendo(
        nuevos,
        cliente,
      );
      await this.auditoria.registrarVarios(
        [
          ...creados
            .filter((t) => t.conductorId !== null)
            .map((t) => ({
              entidad: 't_tramo_transporte',
              entidadId: t.id,
              accion: AccionAuditoria.CREAR,
              operativoId: adicional.id,
              cambios: [
                { campo: 'cond_id', valorNuevo: String(t.conductorId) },
                { campo: 'vehi_id', valorNuevo: String(t.vehiculoId ?? '') },
                { campo: 'herencia', valorNuevo: origenTexto },
              ],
              usuario: autor.usuarioId,
              rol: autor.rol,
            })),
          this.datosAsiento(
            adicional.id,
            asignacion.size > 0
              ? `${origenTexto}${motivo ? ` · sin heredar en parte: ${motivo}` : ''}`
              : `sin heredar · ${motivo ?? 'no se pudo heredar'}`,
            autor,
          ),
        ],
        cliente,
      );
    });

    if (asignacion.size > 0) {
      await this.sincronizarOperativos([adicional.id], autor);
    }
    return { heredado: asignacion.size > 0, motivo };
  }

  /** El asiento `transporte` del adicional: de dónde salió (o por qué no se heredó). */
  private datosAsiento(operativoId: number, texto: string, autor: Autor) {
    return {
      entidad: 't_operativo',
      entidadId: operativoId,
      accion: AccionAuditoria.ACTUALIZAR,
      operativoId,
      cambios: [{ campo: 'transporte', valorNuevo: texto }],
      usuario: autor.usuarioId,
      rol: autor.rol,
    };
  }

  private async asentarHerencia(
    operativoId: number,
    texto: string,
    autor: Autor,
  ): Promise<void> {
    await this.auditoria.registrar(
      this.datosAsiento(operativoId, texto, autor),
    );
  }

  /**
   * Asigna una TAREA (p. ej. «Llevar a taller», Fase 5) a un conductor. El vehículo es el de la
   * tarea. Mismas reglas que un bloque, salvo «vehículo en taller», que es justamente su objeto.
   */
  async asignarTarea(
    tramoId: number,
    conductorId: number,
    autor: Autor,
  ): Promise<{ evaluacion: EvaluacionConductor }> {
    const tramo = await this.exigirTramo(tramoId);
    if (tramo.tipo !== TipoTramo.TAREA) {
      throw new ValidacionError(
        'El tramo indicado no es una tarea: asígnelo con su operativo.',
        { tramoId },
      );
    }
    const dia = await this.datosDelDia(tramo.fecha);
    const conductor = dia.conductores.find((c) => c.id === conductorId);
    if (!conductor) {
      throw new RecursoNoEncontradoError(
        'El conductor indicado no existe o está dado de baja.',
        { conductorId },
      );
    }
    const evaluacion = this.evaluarConductor(
      conductor,
      tramo.vehiculoId,
      {
        tramos: [this.tramoEvaluado(tramo, dia.parametros.inicioJornada)],
        personas: 0,
        esTareaTaller: true,
      },
      new Set([tramoId]),
      tramo.fecha,
      dia,
    );
    if (evaluacion.estado === 'DURO') {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.ASIGNACION_NO_VIABLE,
        `No se puede asignar la tarea a ${conductor.nombreCompleto}: ${evaluacion.motivos
          .filter((m) => m.tipo === 'DURO')
          .map((m) => m.mensaje)
          .join(' ')}`,
        { motivos: evaluacion.motivos },
      );
    }
    await this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      await this.repositorio.asignarTramos(
        [tramoId],
        conductorId,
        tramo.vehiculoId,
        cliente,
      );
      await this.auditoria.registrar(
        {
          entidad: 't_tramo_transporte',
          entidadId: tramoId,
          accion: AccionAuditoria.ACTUALIZAR,
          cambios: [{ campo: 'cond_id', valorNuevo: String(conductorId) }],
          usuario: autor.usuarioId,
          rol: autor.rol,
        },
        cliente,
      );
    });
    return { evaluacion };
  }

  /**
   * Quita el conductor y el vehículo de un tramo (vuelve a «por cubrir»). Si el tramo era el
   * ANFITRIÓN de una unidad compartida, quienes viajaban con él quedan también sin conductor
   * (2026-10-19) y se devuelven para avisar. Si era un INVITADO, solo él deja de compartir.
   */
  async quitarTramo(
    tramoId: number,
    autor: Autor,
  ): Promise<{ liberados: OperativoLiberado[]; aviso: string | null }> {
    const tramo = await this.exigirTramo(tramoId);
    if (tramo.conductorId === null) return { liberados: [], aviso: null };
    const soltados = await this.repositorio.ejecutarEnTransaccion(
      async (cliente) => {
        const invitados = await this.repositorio.liberarInvitados(
          [tramoId],
          [tramoId],
          cliente,
        );
        await this.trazarLiberados(invitados, autor, cliente);
        // Una TAREA (taller) conserva su vehículo: es el objeto de la tarea, no una elección.
        await this.repositorio.asignarTramos(
          [tramoId],
          null,
          tramo.tipo === TipoTramo.TAREA ? tramo.vehiculoId : null,
          cliente,
        );
        await this.auditoria.registrar(
          {
            entidad: 't_tramo_transporte',
            entidadId: tramoId,
            accion: AccionAuditoria.ACTUALIZAR,
            operativoId: tramo.operativoId ?? undefined,
            cambios: [
              {
                campo: 'cond_id',
                valorAnterior: String(tramo.conductorId),
                valorNuevo: '',
              },
              ...(tramo.compartidoConTramoId
                ? [
                    {
                      campo: 'trtr_compartido_con_id',
                      valorAnterior: String(tramo.compartidoConTramoId),
                      valorNuevo: '',
                    },
                  ]
                : []),
            ],
            usuario: autor.usuarioId,
            rol: autor.rol,
          },
          cliente,
        );
        return invitados;
      },
    );
    const liberados = await this.despuesDeLiberar(soltados, autor);
    if (tramo.operativoId !== null)
      await this.sincronizarOperativos([tramo.operativoId], autor);
    return { liberados, aviso: avisoLiberados(liberados) };
  }

  /**
   * Quita conductor y vehículo de TODOS los tramos de un operativo (2026-10-14). Lo usa
   * `PATCH /transporte/operativos/:id/desasignar`, que desde la ocupación por tramos ya no puede
   * limitarse a vaciar el operativo: si quedaran sus tramos asignados, el conductor seguiría
   * ocupado. Una escritura, con su traza por tramo; después se sincroniza el operativo.
   */
  async liberarOperativo(operativoId: number, autor: Autor): Promise<number> {
    const asignados = (
      await this.repositorio.tramosDeOperativos([operativoId])
    ).filter((t) => t.conductorId !== null);
    let soltados: InvitadoLiberado[] = [];
    if (asignados.length > 0) {
      await this.repositorio.ejecutarEnTransaccion(async (cliente) => {
        const ids = asignados.map((t) => t.id);
        // Compartir unidad (2026-10-19): sus invitados se quedan sin la unidad que los llevaba.
        soltados = await this.repositorio.liberarInvitados(ids, ids, cliente);
        await this.trazarLiberados(soltados, autor, cliente);
        await this.repositorio.asignarTramos(ids, null, null, cliente);
        for (const tramo of asignados) {
          await this.auditoria.registrar(
            {
              entidad: 't_tramo_transporte',
              entidadId: tramo.id,
              accion: AccionAuditoria.ACTUALIZAR,
              operativoId,
              cambios: [
                {
                  campo: 'cond_id',
                  valorAnterior: String(tramo.conductorId),
                  valorNuevo: '',
                },
                {
                  campo: 'vehi_id',
                  valorAnterior:
                    tramo.vehiculoId === null ? '' : String(tramo.vehiculoId),
                  valorNuevo: '',
                },
              ],
              usuario: autor.usuarioId,
              rol: autor.rol,
            },
            cliente,
          );
        }
      });
    }
    await this.despuesDeLiberar(soltados, autor);
    await this.sincronizarOperativos([operativoId], autor);
    return asignados.length;
  }

  /**
   * Vuelve a generar los tramos de un operativo (p. ej. tras cambiar su tipo de transporte). Solo si
   * ninguno está asignado: lo asignado se quita antes, a propósito, para no borrar trabajo de la DAF.
   */
  async regenerarTramos(
    operativoId: number,
    autor: Autor,
  ): Promise<{ generados: number }> {
    const [operativo] = await this.repositorio.operativosPorId([operativoId]);
    if (!operativo) {
      throw new RecursoNoEncontradoError(
        'El operativo indicado no existe o fue retirado.',
        {
          operativoId,
        },
      );
    }
    const existentes = await this.repositorio.tramosDeOperativos([operativoId]);
    if (existentes.some((t) => t.conductorId !== null)) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.ASIGNACION_NO_VIABLE,
        `El operativo ${operativo.identificador} tiene tramos asignados: quítelos antes de regenerarlos.`,
        { operativoId },
      );
    }
    const parametros = await this.parametros.leer();
    const nuevos = this.planDeOperativo(
      operativo,
      operativo.cuadro.fecha,
      parametros,
      autor,
    );
    await this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      await this.repositorio.borrarTramosLibres(operativoId, cliente);
      await this.repositorio.crearTramos(nuevos, cliente);
      await this.auditoria.registrar(
        {
          entidad: 't_tramo_transporte',
          entidadId: operativoId,
          operativoId,
          accion: AccionAuditoria.CREAR,
          cambios: [
            { campo: 'tramos_regenerados', valorNuevo: String(nuevos.length) },
          ],
          usuario: autor.usuarioId,
          rol: autor.rol,
        },
        cliente,
      );
    });
    return { generados: nuevos.length };
  }

  /** Activa a un conductor LIBRE ese día (horas extra). Idempotente. */
  async activarLibre(
    conductorId: number,
    fecha: Date,
    motivo: string,
    autor: Autor,
  ): Promise<void> {
    const limpio = motivo.trim();
    if (limpio === '') {
      throw new ValidacionError('Indique el motivo de la activación.', {
        conductorId,
      });
    }
    const conductores = await this.repositorio.conductoresActivos();
    if (!conductores.some((c) => c.id === conductorId)) {
      throw new RecursoNoEncontradoError(
        'El conductor indicado no existe o está dado de baja.',
        {
          conductorId,
        },
      );
    }
    await this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      const fila = await this.repositorio.activar(
        conductorId,
        fecha,
        limpio,
        autor.usuarioId,
        cliente,
      );
      await this.auditoria.registrar(
        {
          entidad: 't_activacion_conductor',
          entidadId: fila.id,
          accion: AccionAuditoria.CREAR,
          cambios: [{ campo: 'acco_motivo', valorNuevo: limpio }],
          usuario: autor.usuarioId,
          rol: autor.rol,
        },
        cliente,
      );
    });
  }

  /** Retira la activación. Si ya tiene tramos ese día, no: quedarían en un conductor libre. */
  async desactivarLibre(
    conductorId: number,
    fecha: Date,
    autor: Autor,
  ): Promise<void> {
    const asignados = await this.repositorio.tramosAsignadosDelConductor(
      conductorId,
      fecha,
    );
    if (asignados > 0) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.ASIGNACION_NO_VIABLE,
        'El conductor ya tiene tramos asignados ese día: quítelos antes de retirar la activación.',
        { conductorId },
      );
    }
    await this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      const quitadas = await this.repositorio.desactivar(
        conductorId,
        fecha,
        cliente,
      );
      if (quitadas > 0) {
        await this.auditoria.registrar(
          {
            entidad: 't_activacion_conductor',
            entidadId: conductorId,
            accion: AccionAuditoria.ELIMINAR,
            usuario: autor.usuarioId,
            rol: autor.rol,
          },
          cliente,
        );
      }
    });
  }

  // ─────────────────────────── Sincronización (regla 10) ───────────────────────────

  /**
   * `operativo.conductorId/vehiculoId` = el PRIMER tramo asignado con conductor y vehículo. Sin
   * ninguno, el operativo vuelve a PENDIENTE (salvo que la DAF lo haya declarado propios medios).
   */
  async sincronizarOperativos(
    operativoIds: readonly number[],
    autor: Autor,
  ): Promise<void> {
    const [operativos, tramos, parametros] = await Promise.all([
      this.repositorio.operativosPorId(operativoIds),
      this.repositorio.tramosDeOperativos(operativoIds),
      this.parametros.leer(),
    ]);
    for (const operativo of operativos) {
      if (operativo.estadoTransporte === EstadoTransporte.PROPIOS_MEDIOS)
        continue;
      const primero = tramos
        .filter(
          (t) =>
            t.operativoId === operativo.id &&
            t.conductorId !== null &&
            t.vehiculoId !== null,
        )
        .sort(
          (a, b) =>
            franjaDe(a.horaInicio, a.horaFin, parametros.inicioJornada).inicio -
            franjaDe(b.horaInicio, b.horaFin, parametros.inicioJornada).inicio,
        )[0];
      if (primero) {
        if (
          operativo.conductorId !== primero.conductorId ||
          operativo.vehiculoId !== primero.vehiculoId ||
          operativo.estadoTransporte !== EstadoTransporte.ASIGNADO
        ) {
          await this.operativos.asignarTransporte(
            operativo.id,
            {
              conductorId: primero.conductorId as number,
              vehiculoId: primero.vehiculoId as number,
            },
            autor,
          );
        }
      } else if (operativo.estadoTransporte === EstadoTransporte.ASIGNADO) {
        await this.operativos.desasignarTransporte(operativo.id, autor);
      }
    }
  }

  // ─────────────────────────── Compartir unidad (2026-10-19) ───────────────────────────

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * COMPARTIR UNIDAD A MANO (plan «compartir unidad», 2026-10-19). Varios operativos independientes
   * con mismo día, punto y horario no podían recibir el mismo conductor: la política los ve como
   * SOLAPAMIENTO. Aquí la DAF los junta en la unidad de un ANFITRIÓN que ya tiene conductor y placa:
   * los tramos del invitado copian ese conductor y esa placa y quedan marcados con
   * `compartidoConTramoId` (el mismo dato que ya escribía el optimizador).
   *
   * MISMA REGLA QUE EL OPTIMIZADOR Y EL REGISTRO: `puedeCompartirTramo`, aquí CON asientos (la placa
   * del anfitrión ya existe). Cada tramo del invitado necesita un tramo del anfitrión compatible.
   * RN-44 y RN-25 del conductor se aplican igual que al asignar: el invitado entra en su día.
   *
   * RN-40 y regla 3 intactas: solo se escriben conductor y vehículo de los tramos; el reflejo del
   * operativo se sincroniza después, como en toda asignación. Una transacción con la traza por tramo.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  async compartirUnidad(
    datos: { operativoId: number; anfitrionOperativoId: number },
    autor: Autor,
  ): Promise<{
    evaluacion: EvaluacionConductor;
    tramosAsignados: number;
    compartidoCon: OperativoLiberado;
    /** Los traslados sin pareja: si la misma unidad los hace (`asignado`) o quedan pendientes. */
    tramosPropios: TramoPropio[];
    aviso: string | null;
  }> {
    if (datos.operativoId === datos.anfitrionOperativoId) {
      throw new ValidacionError(
        'Un operativo no comparte unidad consigo mismo.',
        { operativoId: datos.operativoId },
      );
    }
    const [invitado, anfitrion] = await this.exigirParaCompartir(
      datos.operativoId,
      datos.anfitrionOperativoId,
    );
    const fecha = invitado.cuadro.fecha;
    await this.asegurarTramos(fecha, [invitado.id], autor);

    const [dia, tramosInvitado, operativosDia, parametros] = await Promise.all([
      this.datosDelDia(fecha),
      this.repositorio.tramosDeOperativos([invitado.id]),
      this.repositorio.operativosDeFecha(fecha),
      this.parametros.leerOptimizacion(),
    ]);
    if (tramosInvitado.length === 0) {
      throw new ValidacionError(
        `${invitado.identificador} no pide transporte de la DAF (propios medios).`,
        { operativoId: invitado.id },
      );
    }
    // Solo lo que falta: un traslado que ya tiene conductor no se toca.
    const pendientes = tramosInvitado.filter((t) => t.conductorId === null);
    if (pendientes.length === 0) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.COMPARTIR_NO_COMPATIBLE,
        `${invitado.identificador} ya tiene conductor: quítelo antes de compartir unidad.`,
        { operativoId: invitado.id },
      );
    }

    const contexto = this.contextoCompartir(dia, operativosDia);
    const deAnfitrion = contexto.anfitrionesDe(anfitrion.id);
    if (deAnfitrion.length === 0) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.COMPARTIR_NO_COMPATIBLE,
        `${anfitrion.identificador} todavía no tiene conductor y placa: asígnelo antes de compartir su unidad.`,
        { anfitrionOperativoId: anfitrion.id },
      );
    }
    const unidad = contexto.unidadDe(anfitrion.id, invitado.id);
    const resultado = this.emparejar(
      pendientes.map((t) => contexto.comoCompartible(t, invitado)),
      invitado,
      unidad,
      contexto,
      parametros.compartirVentanaMin,
      anfitrion.esMacrooperativo,
    );
    if (!resultado.compatible) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.COMPARTIR_NO_COMPATIBLE,
        `No se puede compartir la unidad de ${anfitrion.identificador}: ${resultado.motivo}`,
        { anfitrionOperativoId: anfitrion.id, codigo: resultado.codigo },
      );
    }

    // RN-44 y RN-25 del conductor del anfitrión con el invitado en su día (talento-operativo).
    const conductorId = deAnfitrion[0].conductorId as number;
    const vehiculoId = deAnfitrion[0].vehiculoId;
    const conductor = dia.conductores.find((c) => c.id === conductorId);
    if (!conductor) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.ASIGNACION_NO_VIABLE,
        'El conductor de esa unidad ya no está activo.',
        { conductorId },
      );
    }
    const restricciones = this.restriccionesDe(
      dia,
      conductorId,
      this.conduccionDe([invitado]),
    );
    if (restricciones.length > 0) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.ASIGNACION_NO_VIABLE,
        `No se puede compartir con ${conductor.nombreCompleto}: ${restricciones.map((m) => m.mensaje).join(' ')}`,
        { motivos: restricciones },
      );
    }

    const evaluadosPendientes = new Map(
      pendientes.map((t) => [
        t.id,
        this.tramoEvaluado(t, dia.parametros.inicioJornada),
      ]),
    );
    // Lo que ese conductor hace FUERA del grupo también cuenta (2026-10-20): un «completo» que
    // abarca la unidad no puede ir con un conductor que a media mañana está en otro punto.
    const fueraDelGrupo = this.choqueFueraDelGrupo(
      resultado.pares.map((par) => par.tramoId),
      evaluadosPendientes,
      new Set(tramosInvitado.map((t) => t.id)),
      resultado.grupo,
      invitado,
      conductor,
      vehiculoId,
      fecha,
      dia,
    );
    if (fueraDelGrupo) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.COMPARTIR_NO_COMPATIBLE,
        `No se puede compartir la unidad de ${anfitrion.identificador}: ${fueraDelGrupo}`,
        { anfitrionOperativoId: anfitrion.id },
      );
    }

    /*
     * LA MISMA UNIDAD HACE TAMBIÉN LO PROPIO (2026-10-19). Lo que se comparte es el conductor con su
     * vehículo: al dejar, la unidad lleva a los dos; después queda libre y puede hacer el retiro del
     * invitado. Cada traslado sin pareja se evalúa con la POLÍTICA COMPLETA de esa unidad (la misma
     * `viabilidad` de `asignarBloque`: solapamiento, traslados, jornada, asientos con sus personas,
     * taller, ausencia, la placa con otro conductor). Si pasa, se asigna normal (sin marca); si no,
     * queda pendiente con su motivo y la DAF lo asigna aparte.
     */
    const propios = this.propiosConLaUnidad(
      resultado.sinPareja,
      evaluadosPendientes,
      new Set(tramosInvitado.map((t) => t.id)),
      invitado,
      conductor,
      vehiculoId,
      fecha,
      dia,
    );
    const asignables = propios.filter((p) => p.asignado).map((p) => p.tramoId);
    // Sin nada que viaje junto y sin nada que la misma unidad pueda hacer después, no hay «éxito»:
    // se dice por qué no (el motivo de la política).
    if (resultado.pares.length === 0 && asignables.length === 0) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.COMPARTIR_NO_COMPATIBLE,
        `La unidad de ${anfitrion.identificador} no puede hacer los traslados de ${invitado.identificador}: ${propios.find((p) => !p.asignado)?.motivo ?? 'su agenda no lo permite.'}`,
        { anfitrionOperativoId: anfitrion.id },
      );
    }

    /*
     * EL «COMPLETO» QUE ABARCA LA UNIDAD ES SU RAÍZ (2026-10-20; raíz 2026-10-21). Si el invitado es
     * un «completo» que cubre los traslados de la unidad, se asigna sin marca y todo lo que esa unidad
     * hace en su horario (con quien viajaba con ello) pasa a su grupo: la política lo ve como un solo
     * intervalo, quitar el «completo» libera a todos y no importa en qué orden llegaron.
     */
    const raices = new Set(resultado.raices);
    const reraizados = resultado.reraizar
      .map(({ tramoId, raizId }) => ({
        tramo: dia.tramosHoy.find((t) => t.id === tramoId),
        raizId,
      }))
      .filter(
        (r): r is { tramo: TramoCompleto; raizId: number } =>
          r.tramo !== undefined && r.tramo.compartidoConTramoId !== r.raizId,
      );
    const compartidosJuntos = resultado.pares.filter(
      (par) => !raices.has(par.tramoId),
    );

    await this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      if (raices.size > 0)
        await this.repositorio.asignarTramos(
          [...raices],
          conductorId,
          vehiculoId,
          cliente,
        );
      for (const par of compartidosJuntos) {
        await this.repositorio.compartirTramo(
          par.tramoId,
          {
            id: par.anfitrion.id,
            conductorId: par.anfitrion.conductorId as number,
            vehiculoId: par.anfitrion.vehiculoId,
          },
          cliente,
        );
      }
      for (const { tramo, raizId } of reraizados) {
        await this.repositorio.compartirTramo(
          tramo.id,
          { id: raizId, conductorId, vehiculoId },
          cliente,
        );
      }
      if (asignables.length > 0)
        await this.repositorio.asignarTramos(
          asignables,
          conductorId,
          vehiculoId,
          cliente,
        );
      await this.auditoria.registrarVarios(
        [
          ...[...raices].map((tramoId) => ({
            entidad: 't_tramo_transporte',
            entidadId: tramoId,
            accion: AccionAuditoria.ACTUALIZAR,
            operativoId: invitado.id,
            cambios: [
              { campo: 'cond_id', valorNuevo: String(conductorId) },
              { campo: 'vehi_id', valorNuevo: String(vehiculoId ?? '') },
              {
                campo: 'unidad_completo',
                valorNuevo: `acompaña la unidad de ${anfitrion.identificador}`,
              },
            ],
            usuario: autor.usuarioId,
            rol: autor.rol,
          })),
          ...compartidosJuntos.map((par) => ({
            entidad: 't_tramo_transporte',
            entidadId: par.tramoId,
            accion: AccionAuditoria.ACTUALIZAR,
            operativoId: invitado.id,
            cambios: [
              {
                campo: 'trtr_compartido_con_id',
                valorNuevo: String(par.anfitrion.id),
              },
              {
                campo: 'cond_id',
                valorNuevo: String(par.anfitrion.conductorId),
              },
              {
                campo: 'vehi_id',
                valorNuevo: String(par.anfitrion.vehiculoId ?? ''),
              },
              {
                campo: 'compartir_unidad',
                valorNuevo: `con ${anfitrion.identificador}`,
              },
            ],
            usuario: autor.usuarioId,
            rol: autor.rol,
          })),
          ...asignables.map((tramoId) => ({
            entidad: 't_tramo_transporte',
            entidadId: tramoId,
            accion: AccionAuditoria.ACTUALIZAR,
            operativoId: invitado.id,
            cambios: [
              { campo: 'cond_id', valorNuevo: String(conductorId) },
              { campo: 'vehi_id', valorNuevo: String(vehiculoId ?? '') },
              {
                campo: 'misma_unidad',
                valorNuevo: `la de ${anfitrion.identificador}`,
              },
            ],
            usuario: autor.usuarioId,
            rol: autor.rol,
          })),
          ...reraizados.map(({ tramo, raizId }) => ({
            entidad: 't_tramo_transporte',
            entidadId: tramo.id,
            accion: AccionAuditoria.ACTUALIZAR,
            operativoId: tramo.operativoId ?? undefined,
            cambios: [
              {
                campo: 'trtr_compartido_con_id',
                valorAnterior: String(tramo.compartidoConTramoId ?? ''),
                valorNuevo: String(raizId),
              },
              {
                campo: 'unidad_completo',
                valorNuevo: `con ${invitado.identificador}`,
              },
            ],
            usuario: autor.usuarioId,
            rol: autor.rol,
          })),
        ],
        cliente,
      );
    });

    await this.sincronizarOperativos([invitado.id], autor);
    return {
      evaluacion: {
        conductorId,
        nombre: conductor.nombreCompleto,
        estado: 'OK',
        motivos: [],
        costo: 0,
        vehiculoId,
      },
      tramosAsignados: resultado.pares.length + asignables.length,
      compartidoCon: {
        operativoId: anfitrion.id,
        identificador: anfitrion.identificador,
      },
      tramosPropios: propios,
      aviso: avisoPropiosPendientes(propios.filter((p) => !p.asignado)),
    };
  }

  /**
   * ¿Hace la misma unidad (conductor + vehículo) los traslados del invitado que no tienen pareja?
   * Pasan JUNTOS por `viabilidad` —la política completa con esa placa— con las personas del
   * invitado. Puro sobre el día cargado: no escribe.
   */
  private propiosConLaUnidad(
    sinPareja: readonly { tramoId: number; tipo: string }[],
    evaluados: ReadonlyMap<number, TramoEvaluado>,
    excluir: ReadonlySet<number>,
    invitado: OperativoDePlanificacion,
    conductor: DatosDelDia['conductores'][number],
    vehiculoId: number | null,
    fecha: Date,
    dia: DatosDelDia,
  ): TramoPropio[] {
    if (sinPareja.length === 0) return [];
    const tramos = sinPareja
      .map((p) => evaluados.get(p.tramoId))
      .filter((t): t is TramoEvaluado => t !== undefined);
    const { evaluacion, choque } = this.viabilidad(
      conductor,
      vehiculoId,
      {
        tramos,
        personas: new Set(invitado.personal.map((p) => p.funcionarioId)).size,
        conduccion: this.conduccionDe([invitado]),
      },
      new Set(excluir),
      fecha,
      dia,
    );
    const motivo = choque
      ? mensajePlacaOcupada(choque)
      : evaluacion.estado === 'DURO'
        ? evaluacion.motivos
            .filter((m) => m.tipo === 'DURO')
            .map((m) => m.mensaje)
            .join(' ')
        : null;
    return sinPareja.map((p) =>
      motivo === null
        ? { tramoId: p.tramoId, tipo: p.tipo, asignado: true }
        : { tramoId: p.tramoId, tipo: p.tipo, asignado: false, motivo },
    );
  }

  /**
   * ¿Puede el conductor de la unidad hacer los traslados que el invitado comparte con ella, sin
   * chocar con lo que ese conductor hace FUERA del grupo? (2026-10-20). `emparejar` solo mira la
   * unidad: un «completo» de 08:00 a 16:30 abarca el dejar y el retirar de la unidad, pero si ese
   * conductor tiene además otro operativo en otro punto a media mañana (OCPMO-003, 09:30–14:30), no
   * puede estar en los dos sitios. Se evalúan los traslados compartidos con la POLÍTICA COMPLETA
   * (`viabilidad`: solapamiento, traslados, jornada, RN-44/RN-25, ausencia, taller, la placa con
   * otro conductor), excluyendo al invitado y al GRUPO de la unidad —que es el mismo viaje—, así
   * que solo choca lo ajeno. Devuelve el motivo, o `null` si puede. Puro sobre el día cargado.
   */
  private choqueFueraDelGrupo(
    compartidos: readonly number[],
    evaluados: ReadonlyMap<number, TramoEvaluado>,
    excluirInvitado: ReadonlySet<number>,
    grupo: readonly number[],
    invitado: OperativoDePlanificacion,
    conductor: DatosDelDia['conductores'][number],
    vehiculoId: number | null,
    fecha: Date,
    dia: DatosDelDia,
  ): string | null {
    const tramos = compartidos
      .map((id) => evaluados.get(id))
      .filter((t): t is TramoEvaluado => t !== undefined);
    if (tramos.length === 0) return null;
    const { evaluacion, choque } = this.viabilidad(
      conductor,
      vehiculoId,
      {
        tramos,
        personas: new Set(invitado.personal.map((p) => p.funcionarioId)).size,
        conduccion: this.conduccionDe([invitado]),
      },
      new Set([...excluirInvitado, ...grupo]),
      fecha,
      dia,
    );
    if (choque) return mensajePlacaOcupada(choque);
    if (evaluacion.estado !== 'DURO') return null;
    return `El conductor de esa unidad no puede: ${evaluacion.motivos
      .filter((m) => m.tipo === 'DURO')
      .map((m) => m.mensaje)
      .join(' ')}`;
  }

  /**
   * Con QUIÉN puede compartir unidad un operativo (2026-10-19): los operativos del día que ya
   * tienen conductor y placa, evaluados con la misma regla que `compartirUnidad` (con asientos).
   * Lo que pidió quien registró (`compartirConId`) va primero. Los incompatibles CERCANOS (misma
   * zonal o sector y a menos de dos horas) y el pedido vienen con su motivo, para mostrarlos
   * apagados. No escribe. Todo sale de `datosDelDia` y de los operativos de la fecha.
   */
  async compartibles(operativoId: number): Promise<{
    operativoId: number;
    identificador: string;
    solicitado: OperativoLiberado | null;
    anfitriones: AnfitrionCompartible[];
  }> {
    const [invitado] = await this.repositorio.operativosPorId([operativoId]);
    if (!invitado) {
      throw new RecursoNoEncontradoError(
        'El operativo indicado no existe o fue retirado.',
        { operativoId },
      );
    }
    const fecha = invitado.cuadro.fecha;
    const [dia, propios, operativosDia, parametros] = await Promise.all([
      this.datosDelDia(fecha),
      this.repositorio.tramosDeOperativos([invitado.id]),
      this.repositorio.operativosDeFecha(fecha),
      this.parametros.leerOptimizacion(),
    ]);
    const contexto = this.contextoCompartir(dia, operativosDia);
    // Sin tramos todavía: se evalúa con el PLAN que generaría (el mismo de «generar»), con ids
    // negativos para no confundirlos con tramos reales. Con tramos, solo los que faltan (como
    // `compartirUnidad`); si ya están todos, todos.
    const sinConductor = propios.filter((t) => t.conductorId === null);
    const reales = sinConductor.length > 0 ? sinConductor : propios;
    const evaluados = new Map<number, TramoEvaluado>();
    const tramosInvitado: TramoParaCompartir[] =
      reales.length > 0
        ? reales.map((t) => {
            evaluados.set(
              t.id,
              this.tramoEvaluado(t, dia.parametros.inicioJornada),
            );
            return contexto.comoCompartible(t, invitado);
          })
        : this.planDeOperativo(invitado, fecha, dia.parametros, {
            usuarioId: 0,
            rol: invitado.creadoPorRol,
          }).map((t, i) => {
            const franja = franjaDe(
              t.horaInicio,
              t.horaFin,
              dia.parametros.inicioJornada,
            );
            const origen = contexto.lugarDe(t.zonalOrigenId);
            evaluados.set(-(i + 1), {
              franja,
              origen,
              destino: contexto.lugarDe(t.zonalDestinoId) ?? origen,
              etiqueta: `${invitado.identificador} (${NOMBRE_TIPO[t.tipo]})`,
            });
            return {
              id: -(i + 1),
              tipo: t.tipo,
              franja,
              origen,
              esMacrooperativo: invitado.esMacrooperativo,
            };
          });
    const excluir = new Set(propios.map((t) => t.id));
    const lugarInvitado = tramosInvitado[0]?.origen ?? null;
    const inicioInvitado = tramosInvitado[0]?.franja.inicio ?? 0;

    const anfitriones: (AnfitrionCompartible & { distancia: number })[] = [];
    for (const otro of operativosDia) {
      if (otro.id === invitado.id) continue;
      const deOtro = contexto.anfitrionesDe(otro.id);
      if (deOtro.length === 0) continue;
      const primero = deOtro[0];
      const vehiculo = dia.vehiculos.find((v) => v.id === primero.vehiculoId);
      const conductor = dia.conductores.find(
        (c) => c.id === primero.conductorId,
      );
      if (!vehiculo || !conductor) continue;

      const solicitado = invitado.compartirConId === otro.id;
      const unidad = contexto.unidadDe(otro.id, invitado.id);
      const resultado =
        tramosInvitado.length === 0
          ? ({
              compatible: false,
              codigo: 'SIN_TRAMOS',
              motivo: `${invitado.identificador} no pide transporte de la DAF.`,
            } as const)
          : this.emparejar(
              tramosInvitado,
              invitado,
              unidad,
              contexto,
              parametros.compartirVentanaMin,
              otro.esMacrooperativo,
            );
      // Lo que el conductor de esa unidad hace FUERA del grupo también cuenta (2026-10-20).
      const fueraDelGrupo = resultado.compatible
        ? this.choqueFueraDelGrupo(
            resultado.pares.map((par) => par.tramoId),
            evaluados,
            excluir,
            resultado.grupo,
            invitado,
            conductor,
            vehiculo.id,
            fecha,
            dia,
          )
        : null;
      const compatible = resultado.compatible && fueraDelGrupo === null;
      const distancia = Math.abs(
        contexto.franjaDe(primero).inicio - inicioInvitado,
      );
      const cercano =
        distancia <= MINUTOS_CERCANIA_COMPARTIR &&
        lugarInvitado !== null &&
        mismoLugar(contexto.lugarDeTramo(primero), lugarInvitado);
      if (!compatible && !solicitado && !cercano) continue;
      const ok = resultado.compatible && compatible ? resultado : null;

      // «La misma unidad»: lo que harían juntos, lo que queda propio y si esa unidad puede hacerlo.
      const propiosDeUnidad = ok
        ? this.propiosConLaUnidad(
            ok.sinPareja,
            evaluados,
            excluir,
            invitado,
            conductor,
            vehiculo.id,
            fecha,
            dia,
          )
        : [];
      const noViable = propiosDeUnidad.find((p) => !p.asignado);
      const completo = ok ? sentidoCompleto(tramosInvitado, ok.pares) : null;
      // Lo que se muestra dentro de un «completo» es del GRUPO entero.
      const grupo = ok
        ? dia.tramosHoy.filter((t) => ok.grupo.includes(t.id))
        : [];

      anfitriones.push({
        operativoId: otro.id,
        identificador: otro.identificador,
        formulario: `${otro.formulario.numero}. ${otro.formulario.nombre}`,
        horaInicio: otro.horaInicio,
        horaFin: otro.horaFin,
        conductor: { id: conductor.id, nombre: conductor.nombreCompleto },
        vehiculo: {
          id: vehiculo.id,
          placa: vehiculo.placa,
          asientos: vehiculo.asientos,
        },
        asientosLibres:
          vehiculo.asientos === null
            ? null
            : Math.max(
                0,
                vehiculo.asientos -
                  contexto.ocupadosEnLaUnidad(
                    unidad,
                    parametros.compartirVentanaMin,
                    invitado.id,
                  ),
              ),
        solicitado,
        compatible,
        motivo: ok
          ? null
          : (fueraDelGrupo ?? (resultado.compatible ? null : resultado.motivo)),
        // Juntos en un traslado DEL MISMO TIPO (dejar con dejar); lo que va dentro de un
        // «completo» se dice en `contiene`, no aquí.
        comparte: ok
          ? palabrasDeTramos(
              ok.pares
                .filter(
                  (par) =>
                    tramosInvitado.find((t) => t.id === par.tramoId)?.tipo ===
                    par.anfitrion.tipo,
                )
                .map((par) => par.anfitrion.tipo),
            )
          : [],
        contiene: ok
          ? contenidosDelCompleto(completo, tramosInvitado, grupo, contexto)
          : [],
        propios: ok ? palabrasDeTramos(ok.sinPareja.map((sp) => sp.tipo)) : [],
        propiosViables:
          propiosDeUnidad.length === 0 ? null : noViable === undefined,
        motivoPropios: noViable?.motivo ?? null,
        personasConInvitado: ok?.personas ?? null,
        asientosPorMomento: ok
          ? ok.momentos.map((m) => ({
              tipo: m.tipo,
              hora: aHora(m.inicio),
              ocupados: m.personas,
            }))
          : [],
        completo,
        distancia,
      });
    }
    anfitriones.sort(
      (a, b) =>
        Number(b.solicitado) - Number(a.solicitado) ||
        Number(b.compatible) - Number(a.compatible) ||
        a.distancia - b.distancia ||
        a.identificador.localeCompare(b.identificador),
    );
    return {
      operativoId: invitado.id,
      identificador: invitado.identificador,
      solicitado: invitado.compartirCon
        ? {
            operativoId: invitado.compartirCon.id,
            identificador: invitado.compartirCon.identificador,
          }
        : null,
      // Una fila por UNIDAD (conductor + placa): A y B en la misma unidad son la misma opción; queda
      // la primera tras ordenar (el pedido de quien registró, si es de esa unidad).
      anfitriones: anfitriones
        .filter(
          (a, i, todos) =>
            todos.findIndex(
              (b) =>
                b.conductor.id === a.conductor.id &&
                b.vehiculo.id === a.vehiculo.id,
            ) === i,
        )
        .slice(0, MAXIMO_COMPARTIBLES)
        .map((a) => sinDistancia(a)),
    };
  }

  /** Los dos operativos de un «compartir», activos y de la misma jornada; si no, 404. */
  private async exigirParaCompartir(
    invitadoId: number,
    anfitrionId: number,
  ): Promise<
    [
      OperativoDePlanificacion & { cuadro: { fecha: Date } },
      OperativoDePlanificacion & { cuadro: { fecha: Date } },
    ]
  > {
    const operativos = await this.repositorio.operativosPorId([
      invitadoId,
      anfitrionId,
    ]);
    const invitado = operativos.find((o) => o.id === invitadoId);
    const anfitrion = operativos.find((o) => o.id === anfitrionId);
    if (
      !invitado ||
      !anfitrion ||
      invitado.cuadro.fecha.getTime() !== anfitrion.cuadro.fecha.getTime()
    ) {
      throw new RecursoNoEncontradoError(
        'Alguno de los dos operativos no existe, fue retirado o no es de la misma jornada.',
        { operativoId: invitadoId, anfitrionOperativoId: anfitrionId },
      );
    }
    return [invitado, anfitrion];
  }

  /**
   * Lo que hace falta para evaluar «compartir» sobre un día ya cargado: el lugar y la franja de
   * cada tramo, sus personas y las de quienes ya viajan con él, los asientos de cada placa y los
   * tramos ANFITRIONES de cada operativo (los suyos con conductor y placa; si alguno ya viaja con
   * otro, su anfitrión raíz).
   */
  contextoCompartir(
    dia: DatosDelDia,
    operativos: readonly OperativoDePlanificacion[],
  ): ContextoCompartir {
    const inicio = dia.parametros.inicioJornada;
    const porOperativo = new Map(operativos.map((o) => [o.id, o]));
    const porTramo = new Map(dia.tramosHoy.map((t) => [t.id, t]));
    const asientos = new Map(dia.vehiculos.map((v) => [v.id, v.asientos]));
    const sectores = new Map<number, string | null>();
    for (const o of operativos)
      for (const z of o.zonales) sectores.set(z.zonal.id, z.zonal.sector);
    const funcionariosDe = (operativoId: number | null): number[] =>
      operativoId === null
        ? []
        : [
            ...new Set(
              (porOperativo.get(operativoId)?.personal ?? []).map(
                (p) => p.funcionarioId,
              ),
            ),
          ];
    const personasDe = (operativoId: number | null): number =>
      funcionariosDe(operativoId).length;
    const raiz = (t: TramoCompleto): TramoCompleto =>
      (t.compartidoConTramoId
        ? porTramo.get(t.compartidoConTramoId)
        : undefined) ?? t;
    const lugarDeTramo = (t: TramoCompleto): Lugar | null =>
      t.zonalOrigen
        ? { zonalId: t.zonalOrigen.id, sector: t.zonalOrigen.sector }
        : null;
    const puntoDe = (t: TramoCompleto): number | null =>
      t.operativoId === null
        ? null
        : (porOperativo.get(t.operativoId)?.puntoEncuentroId ?? null);
    // ASIENTOS POR MOMENTO (2026-10-21): lo que la unidad de esos tramos lleva en su momento más lleno.
    const ocupadosEnLaUnidad = (
      tramos: readonly TramoCompleto[],
      ventanaMin: number,
      excluirOperativoId?: number,
    ): number =>
      maximoAbordo(
        dia.tramosHoy
          .filter(
            (t) =>
              t.operativoId !== excluirOperativoId &&
              tramos.some(
                (u) =>
                  u.conductorId === t.conductorId &&
                  u.vehiculoId === t.vehiculoId,
              ),
          )
          .map((t) => ({
            id: t.id,
            tipo: t.tipo,
            ...franjaDe(t.horaInicio, t.horaFin, inicio),
            operativoId: t.operativoId,
          })),
        {
          ventanaMin,
          personasDe: (id) => personasDe(id),
          funcionariosDe: (id) => funcionariosDe(id),
        },
      );
    const esMacroDe = (t: TramoCompleto): boolean =>
      t.operativoId === null
        ? false
        : (porOperativo.get(t.operativoId)?.esMacrooperativo ??
          t.operativo?.esMacrooperativo ??
          false);

    return {
      franjaDe: (t) => franjaDe(t.horaInicio, t.horaFin, inicio),
      lugarDe: (zonalId) =>
        zonalId === null
          ? null
          : { zonalId, sector: sectores.get(zonalId) ?? null },
      lugarDeTramo,
      comoCompartible: (t, operativo) => ({
        id: t.id,
        tipo: t.tipo,
        franja: franjaDe(t.horaInicio, t.horaFin, inicio),
        origen: lugarDeTramo(t),
        esMacrooperativo: operativo.esMacrooperativo,
        puntoId: puntoDe(t),
      }),
      anfitrionesDe: (operativoId) => {
        const vistos = new Map<number, TramoCompleto>();
        for (const t of dia.tramosHoy) {
          if (t.operativoId !== operativoId) continue;
          if (t.conductorId === null || t.vehiculoId === null) continue;
          const anfitrion = raiz(t);
          if (anfitrion.conductorId === null || anfitrion.vehiculoId === null)
            continue;
          vistos.set(anfitrion.id, anfitrion);
        }
        return [...vistos.values()];
      },
      unidadDe: (operativoId, excluirOperativoId) => {
        let conductorId: number | null = null;
        let vehiculoId: number | null = null;
        for (const t of dia.tramosHoy) {
          if (t.operativoId !== operativoId) continue;
          const anfitrion = raiz(t);
          if (anfitrion.conductorId === null || anfitrion.vehiculoId === null)
            continue;
          conductorId = anfitrion.conductorId;
          vehiculoId = anfitrion.vehiculoId;
          break;
        }
        if (conductorId === null) return [];
        const deLaUnidad = (t: TramoCompleto): boolean =>
          t.conductorId === conductorId && t.vehiculoId === vehiculoId;
        // EL GRUPO: el anfitrión, quienes piden viajar con él y quienes ya comparten un tramo con
        // alguien del grupo (hasta que no se sume nadie). Otro operativo que ese conductor haga ese
        // día NO es del grupo: si choca, lo dice la política completa (`propiosConLaUnidad`).
        const grupo = new Set<number>([operativoId]);
        for (let cambio = true; cambio; ) {
          cambio = false;
          for (const o of operativos) {
            if (grupo.has(o.id) || o.id === excluirOperativoId) continue;
            if (o.compartirConId !== null && grupo.has(o.compartirConId)) {
              grupo.add(o.id);
              cambio = true;
            }
          }
          for (const t of dia.tramosHoy) {
            if (t.operativoId === null || grupo.has(t.operativoId)) continue;
            if (t.operativoId === excluirOperativoId || !deLaUnidad(t))
              continue;
            const anfitrion = raiz(t);
            if (
              anfitrion.id !== t.id &&
              anfitrion.operativoId !== null &&
              grupo.has(anfitrion.operativoId)
            ) {
              grupo.add(t.operativoId);
              cambio = true;
            }
          }
        }
        const vistos = new Map<number, TramoCompleto>();
        for (const t of dia.tramosHoy) {
          if (t.operativoId === null || !grupo.has(t.operativoId)) continue;
          if (!deLaUnidad(t)) continue;
          const anfitrion = raiz(t);
          if (anfitrion.operativoId === excluirOperativoId) continue;
          vistos.set(anfitrion.id, anfitrion);
        }
        return [...vistos.values()];
      },
      deLaUnidad: (conductorId, vehiculoId) =>
        dia.tramosHoy.filter(
          (t) => t.conductorId === conductorId && t.vehiculoId === vehiculoId,
        ),
      ocupadosEnLaUnidad,
      puntoDe,
      personasDe,
      funcionariosDe,
      esMacroDe,
      asientosDe: (vehiculoId) =>
        vehiculoId === null ? null : (asientos.get(vehiculoId) ?? null),
    };
  }

  /**
   * La regla pura aplicada a una unidad del día (2026-10-19, «la misma unidad»; contención
   * 2026-10-20; regla única `encajarEnUnidad` 2026-10-21). Cada tramo del invitado frente a la unidad
   * del anfitrión es:
   *   · COMPARTIDO o CONTENIDO DENTRO (`pares`): viaja con el grupo de ese traslado o del «completo»
   *     que lo contiene;
   *   · CONTENIDO ABARCA (`pares` y `raices`): el «completo» del invitado cubre lo que la unidad hace
   *     en su horario y PASA A SER LA RAÍZ; lo cubierto se re-enraíza a él (`reraizar`);
   *   · SECUENCIAL (`sinPareja`): no se cruza con la unidad; la misma unidad lo hace después (lo
   *     decide `propiosConLaUnidad` con la política completa);
   *   · CONFLICTO: se cruza y no puede ir con ella → incompatible, con su motivo.
   * LO QUE EL «COMPLETO» ABARCA ENTRA AL GRUPO AUNQUE HAYA LLEGADO SIN MARCA (2026-10-21): un
   * «solo retirar» que la misma unidad hace después de un «solo dejar» no lleva marca de grupo; si
   * después llega el «completo» de ese punto, ese retiro también va con él. `grupo` son los tramos de
   * la unidad contra los que se evaluó (lo que `choqueFueraDelGrupo` no cuenta como ajeno).
   * LOS ASIENTOS SE CUENTAN POR MOMENTO (2026-10-21): en cada momento en que viaja el invitado, las
   * personas distintas a bordo (`personasPorMomento`).
   * El exclusivo (macrooperativo) no comparte unidad aunque no se crucen.
   */
  emparejar(
    tramos: readonly TramoParaCompartir[],
    invitado: Pick<OperativoDePlanificacion, 'id'>,
    anfitriones: readonly TramoCompleto[],
    contexto: ContextoCompartir,
    ventanaMin: number,
    anfitrionEsMacro: boolean,
  ):
    | {
        compatible: true;
        pares: { tramoId: number; anfitrion: TramoCompleto }[];
        sinPareja: { tramoId: number; tipo: string; motivo: string }[];
        /** Los «completos» del invitado que pasan a ser la raíz de la unidad (se asignan sin marca). */
        raices: number[];
        /** Tramos de la unidad que pasan al grupo de un «completo» invitado. */
        reraizar: { tramoId: number; raizId: number }[];
        /** Los tramos de la unidad contra los que se evaluó. */
        grupo: number[];
        /** Las personas del momento más lleno con el invitado (lo que se compara con los asientos). */
        personas: number;
        /** Cada momento en que viaja el invitado, con las personas a bordo. */
        momentos: MomentoDeLaUnidad[];
      }
    | { compatible: false; codigo: string; motivo: string } {
    // El exclusivo es del OPERATIVO: el invitado o el anfitrión pedido. Otro tramo exclusivo de la
    // unidad solo impide lo que se cruza con él (lo dice la clasificación).
    if (tramos.some((t) => t.esMacrooperativo) || anfitrionEsMacro)
      return {
        compatible: false,
        codigo: 'EXCLUSIVO',
        motivo:
          'Uno de los dos operativos pide vehículo exclusivo (macrooperativo): no comparte unidad.',
      };
    if (tramos.length === 0 || anfitriones.length === 0)
      return {
        compatible: false,
        codigo: 'SIN_TRAMOS',
        motivo:
          'Ese operativo no tiene un traslado asignado con el que compartir.',
      };
    const { conductorId, vehiculoId } = anfitriones[0];
    const deLaUnidad = contexto
      .deLaUnidad(conductorId as number, vehiculoId)
      .filter((t) => t.operativoId !== invitado.id);
    const comoPura = (t: TramoCompleto): TramoDeLaUnidad => {
      const franja = contexto.franjaDe(t);
      return {
        id: t.id,
        tipo: t.tipo,
        inicio: franja.inicio,
        fin: franja.fin,
        origen: contexto.lugarDeTramo(t),
        esMacrooperativo: contexto.esMacroDe(t),
        puntoId: contexto.puntoDe(t),
        operativoId: t.operativoId,
        compartidoConTramoId: t.compartidoConTramoId ?? null,
      };
    };
    const invitadoPuro: TramoQueSeSuma[] = tramos.map((t) => ({
      id: t.id,
      tipo: t.tipo,
      inicio: t.franja.inicio,
      fin: t.franja.fin,
      origen: t.origen,
      esMacrooperativo: t.esMacrooperativo,
      puntoId: t.puntoId ?? null,
    }));

    // El grupo: los tramos de la unidad cuyo grupo es el de los anfitriones, más los dejar y retirar
    // que un «completo» del invitado abarca en el mismo sitio (con su propio grupo). Otro «completo»
    // del conductor no se absorbe: si choca, lo dice la política completa (`choqueFueraDelGrupo`).
    const claves = new Set(anfitriones.map((a) => a.id));
    const completos = invitadoPuro.filter((t) => t.tipo === 'COMPLETO');
    for (const t of deLaUnidad)
      if (
        (t.tipo === 'DEJAR' || t.tipo === 'RETIRAR') &&
        completos.some((c) => contiene(c, comoPura(t), ventanaMin))
      )
        claves.add(claveDeUnidad(t));
    const grupo = deLaUnidad.filter((t) => claves.has(claveDeUnidad(t)));

    const resultado = encajarEnUnidad(
      { operativoId: invitado.id, tramos: invitadoPuro },
      grupo.map(comoPura),
      {
        ventanaMin,
        asientos: contexto.asientosDe(vehiculoId),
        personasDe: (id) => contexto.personasDe(id),
        funcionariosDe: (id) => contexto.funcionariosDe(id),
        aBordo: deLaUnidad.map(comoPura),
      },
    );
    if (!resultado.compatible) return resultado;
    const porId = new Map(deLaUnidad.map((t) => [t.id, t]));
    return {
      compatible: true,
      pares: [
        ...resultado.pares.map((par) => ({
          tramoId: par.tramoId,
          anfitrion: porId.get(par.raizId) ?? anfitriones[0],
        })),
        // El «completo» que abarca va con la unidad (para lo que se muestra); se escribe como raíz.
        ...resultado.raices.map((tramoId) => ({
          tramoId,
          anfitrion: anfitriones[0],
        })),
      ],
      sinPareja: resultado.sinPareja.map((s) => ({
        ...s,
        motivo: 'Lo hace la misma unidad después, si su agenda lo permite.',
      })),
      raices: resultado.raices,
      reraizar: resultado.reraizar,
      grupo: grupo.map((t) => t.id),
      personas: resultado.personas,
      momentos: resultado.momentos,
    };
  }

  /** La traza de los invitados que quedaron sin conductor al cambiar su anfitrión. */
  private async trazarLiberados(
    invitados: InvitadoLiberado[],
    autor: Autor,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    if (invitados.length === 0) return;
    await this.auditoria.registrarVarios(
      invitados.map((t) => ({
        entidad: 't_tramo_transporte',
        entidadId: t.id,
        accion: AccionAuditoria.ACTUALIZAR,
        operativoId: t.operativoId ?? undefined,
        cambios: [
          {
            campo: 'trtr_compartido_con_id',
            valorAnterior: String(t.compartidoConTramoId ?? ''),
            valorNuevo: '',
          },
          {
            campo: 'cond_id',
            valorAnterior: String(t.conductorId ?? ''),
            valorNuevo: '',
          },
          {
            campo: 'vehi_id',
            valorAnterior: String(t.vehiculoId ?? ''),
            valorNuevo: '',
          },
          {
            campo: 'compartir_unidad',
            valorNuevo: 'su anfitrión cambió de conductor o se quitó',
          },
        ],
        usuario: autor.usuarioId,
        rol: autor.rol,
      })),
      cliente,
    );
  }

  /** Tras soltar invitados: su reflejo vuelve a PENDIENTE y se devuelven para el aviso. */
  private async despuesDeLiberar(
    invitados: InvitadoLiberado[],
    autor: Autor,
  ): Promise<OperativoLiberado[]> {
    const ids = [
      ...new Set(
        invitados
          .map((t) => t.operativoId)
          .filter((id): id is number => id !== null),
      ),
    ];
    if (ids.length === 0) return [];
    await this.sincronizarOperativos(ids, autor);
    const operativos = await this.repositorio.operativosPorId(ids);
    return operativos
      .map((o) => ({ operativoId: o.id, identificador: o.identificador }))
      .sort((a, b) => a.identificador.localeCompare(b.identificador));
  }

  // ─────────────────────────── Apoyo ───────────────────────────

  private async asegurarTramos(
    fecha: Date,
    operativoIds: number[],
    autor: Autor,
  ): Promise<void> {
    const [operativos, existentes, parametros] = await Promise.all([
      this.exigirOperativosDe(fecha, operativoIds),
      this.repositorio.tramosDeOperativos(operativoIds),
      this.parametros.leer(),
    ]);
    const conTramos = new Set(existentes.map((t) => t.operativoId));
    const nuevos = operativos
      .filter((o) => !conTramos.has(o.id))
      .flatMap((o) => this.planDeOperativo(o, fecha, parametros, autor));
    if (nuevos.length === 0) return;
    await this.repositorio.ejecutarEnTransaccion((cliente) =>
      this.repositorio.crearTramos(nuevos, cliente),
    );
  }

  private planDeOperativo(
    operativo: OperativoDePlanificacion,
    fecha: Date,
    parametros: ParametrosPlanificacion,
    autor: Autor,
  ): NuevoTramo[] {
    // Lo que la DAF ya declaró «propios medios» tampoco pide transporte.
    if (operativo.estadoTransporte === EstadoTransporte.PROPIOS_MEDIOS)
      return [];
    const zonalId = operativo.zonales[0]?.zonal.id ?? null;
    return planificarTramos(
      {
        horaInicio: operativo.horaInicio,
        horaFin: operativo.horaFin,
        tipoTransporte: operativo.tipoTransporte,
        zonalId,
      },
      parametros.duracionTramo,
    ).map((t) => ({
      operativoId: operativo.id,
      fecha,
      tipo: t.tipo as TipoTramo,
      horaInicio: t.horaInicio,
      horaFin: t.horaFin,
      cruzaMedianoche: t.cruzaMedianoche,
      zonalOrigenId: t.zonalOrigenId,
      zonalDestinoId: t.zonalDestinoId,
      creadoPor: autor.usuarioId,
    }));
  }

  /**
   * Lo que `talento-operativo` necesita saber del bloque para RN-44 y RN-25: si es de patrulla, si
   * es nocturno (`oper_es_nocturno`, que ya decidió la franja al registrar) y qué operativos lleva.
   */
  conduccionDe(
    operativos: readonly Pick<
      OperativoDePlanificacion,
      'id' | 'esNocturno' | 'formulario'
    >[],
  ): BloqueDeConduccion {
    return {
      esPatrulla: operativos.some((o) => o.formulario.esPatrulla),
      esNocturno: operativos.some((o) => o.esNocturno),
      operativoIds: operativos.map((o) => o.id),
    };
  }

  /**
   * RN-44 y RN-25 para un conductor y un bloque, como motivos DUROS de la política de tramos. Los
   * decide `talento-operativo` (`dia.restriccion`); aquí solo se les pone el código de la política.
   */
  restriccionesDe(
    dia: DatosDelDia,
    conductorId: number,
    conduccion: BloqueDeConduccion,
  ): Motivo[] {
    return dia.restriccion(conductorId, conduccion).map((veredicto) => ({
      codigo: codigoDeRestriccion(veredicto.codigo),
      mensaje: veredicto.motivo ?? 'El conductor no puede tomar el bloque.',
    }));
  }

  /** Las cadenas del día (lo usa también el optimizador). */
  bloquesDe(
    operativos: OperativoDePlanificacion[],
    inicioJornada: string,
  ): BloqueTransporte[] {
    return agruparCadenas(
      operativos.map((o) => ({
        id: o.id,
        horaInicio: o.horaInicio,
        horaFin: o.horaFin,
        funcionarioIds: o.personal.map((p) => p.funcionarioId),
      })),
      inicioJornada,
    );
  }

  /** El bloque a evaluar: tramos existentes (los libres, o los indicados) o, si no hay, el plan. */
  private bloqueEvaluado(
    operativos: OperativoDePlanificacion[],
    existentes: TramoCompleto[],
    tramoIds: number[] | undefined,
    parametros: ParametrosPlanificacion,
  ): {
    evaluado: { tramos: TramoEvaluado[]; personas: number };
    idsTramos: number[];
  } {
    const personas = new Set<number>();
    operativos.forEach((o) =>
      o.personal.forEach((p) => personas.add(p.funcionarioId)),
    );

    let tramos: TramoEvaluado[];
    let ids: number[] = [];
    if (existentes.length > 0) {
      const elegidos = tramoIds
        ? existentes.filter((t) => tramoIds.includes(t.id))
        : porAsignar(existentes);
      ids = elegidos.map((t) => t.id);
      tramos = elegidos.map((t) =>
        this.tramoEvaluado(t, parametros.inicioJornada),
      );
    } else {
      tramos = operativos.flatMap((o) =>
        planificarTramos(
          {
            horaInicio: o.horaInicio,
            horaFin: o.horaFin,
            tipoTransporte: o.tipoTransporte,
            zonalId: o.zonales[0]?.zonal.id ?? null,
          },
          parametros.duracionTramo,
        ).map((t) => {
          const zonal = o.zonales[0]?.zonal ?? null;
          const lugar = zonal
            ? { zonalId: zonal.id, sector: zonal.sector }
            : null;
          return {
            franja: franjaDe(t.horaInicio, t.horaFin, parametros.inicioJornada),
            origen: lugar,
            destino: lugar,
            etiqueta: `${o.identificador} (${NOMBRE_TIPO[t.tipo as TipoTramo]})`,
          };
        }),
      );
    }
    return { evaluado: { tramos, personas: personas.size }, idsTramos: ids };
  }

  /**
   * Si un conductor (con su vehículo) puede tomar un bloque: la política de tramos con RN-44/RN-25
   * y, aparte, RN-DAF-01 (la misma placa con OTRO conductor en una franja que se cruza). La usan
   * `asignarBloque` y la herencia del adicional, para que las dos apliquen las mismas reglas.
   */
  private viabilidad(
    conductor: DatosDelDia['conductores'][number],
    vehiculoId: number | null,
    bloque: {
      tramos: TramoEvaluado[];
      personas: number;
      conduccion: BloqueDeConduccion;
    },
    excluir: Set<number>,
    fecha: Date,
    dia: DatosDelDia,
  ): { evaluacion: EvaluacionConductor; choque: TramoCompleto | undefined } {
    const evaluacion = this.evaluarConductor(
      conductor,
      vehiculoId,
      bloque,
      excluir,
      fecha,
      dia,
    );
    const choque =
      vehiculoId === null
        ? undefined
        : dia.tramosHoy.find(
            (t) =>
              !excluir.has(t.id) &&
              t.vehiculoId === vehiculoId &&
              t.conductorId !== conductor.id &&
              bloque.tramos.some((b) =>
                seSolapan(
                  b.franja,
                  franjaDe(
                    t.horaInicio,
                    t.horaFin,
                    dia.parametros.inicioJornada,
                  ),
                ),
              ),
          );
    return { evaluacion, choque };
  }

  /**
   * La placa que se PROPONE a un conductor en la lista de candidatos: la que ya usa ese día (su
   * primer tramo con vehículo, sin contar `excluir`) o, si no, su habitual. Solo una placa ACTIVA
   * del día; si no hay ninguna, `null` (se le propone sin vehículo).
   *
   * Es una sugerencia, no una regla (PV-33): `evaluarConductor` ya no la deduce por su cuenta.
   */
  vehiculoPropuesto(
    conductor: DatosDelDia['conductores'][number],
    excluir: Set<number>,
    dia: DatosDelDia,
  ): number | null {
    const activo = (id: number | null | undefined): id is number =>
      id !== null && id !== undefined && dia.vehiculos.some((v) => v.id === id);
    const deHoy = dia.tramosHoy.find(
      (t) =>
        t.conductorId === conductor.id &&
        !excluir.has(t.id) &&
        t.vehiculoId !== null,
    )?.vehiculoId;
    if (activo(deHoy)) return deHoy;
    return activo(conductor.vehiculoHabitualId)
      ? conductor.vehiculoHabitualId
      : null;
  }

  /**
   * Evalúa a un conductor con EXACTAMENTE ese vehículo (2026-10-15). `null` es «sin vehículo»: no
   * se aplican taller, asientos ni arranque lejos, porque el tramo se guardará sin placa. Antes,
   * con `null`, se evaluaba contra la placa del día o la habitual —que no se guardaba— y daba
   * bloqueos y avisos falsos. Quien quiera proponer una placa la pide a `vehiculoPropuesto`.
   */
  evaluarConductor(
    conductor: DatosDelDia['conductores'][number],
    vehiculoId: number | null,
    bloque: {
      tramos: TramoEvaluado[];
      personas: number;
      esTareaTaller?: boolean;
      /** Qué operativos lleva el bloque (RN-44/RN-25). Ausente = una TAREA: sin restricción. */
      conduccion?: BloqueDeConduccion;
    },
    excluir: Set<number>,
    fecha: Date,
    dia: DatosDelDia,
  ): EvaluacionConductor {
    const restricciones = bloque.conduccion
      ? this.restriccionesDe(dia, conductor.id, bloque.conduccion)
      : [];
    // Compartir unidad (2026-10-19): lo que viaja en la MISMA unidad que un tramo excluido es el
    // mismo viaje (no «otro tramo del día»), y cada unidad compartida cuenta como UN intervalo.
    const excluidos = conSuUnidad(excluir, dia.tramosHoy);
    const suyosHoy = dia.tramosHoy.filter(
      (t) => t.conductorId === conductor.id && !excluidos.has(t.id),
    );
    const vehiculoFila =
      vehiculoId !== null
        ? dia.vehiculos.find((v) => v.id === vehiculoId)
        : undefined;
    const vehiculo: VehiculoEvaluado | null = vehiculoFila
      ? {
          id: vehiculoFila.id,
          asientos: vehiculoFila.asientos,
          enTaller: dia.enTaller.has(vehiculoFila.id),
          amaneceEn: dia.amaneceEn.get(vehiculoFila.id) ?? null,
        }
      : null;
    const turno = dia.turnos.get(conductor.id) ?? null;
    const evaluado: ConductorEvaluado = {
      id: conductor.id,
      nombre: conductor.nombreCompleto,
      tipoContrato:
        (conductor.tipoContrato as ConductorEvaluado['tipoContrato']) ?? null,
      turno,
      activado: dia.activados.has(conductor.id),
      ausente: dia.ausentes.has(conductor.id),
      ultimoFinAyer: this.ultimoFinAyer(conductor.id, dia),
    };
    const ventanaTurno =
      turno === 'DIA' || turno === 'NOCHE' || turno === 'ECU_NOCHE'
        ? dia.parametros.ventanasTurno[turno]
        : null;

    const resultado = evaluar(
      evaluado,
      vehiculo,
      {
        tramos: bloque.tramos,
        personas: bloque.personas,
        esTareaTaller: bloque.esTareaTaller,
        restricciones,
      },
      this.agendaDe(suyosHoy, dia.parametros.inicioJornada),
      {
        esFinDeSemana: [0, 6].includes(fecha.getUTCDay()),
        ventanaNombramiento: dia.parametros.ventanaNombramiento,
        ventanaTurno,
      },
      dia.asignacion,
    );
    // G2 (2026-10-15): sin placa se asigna igual, pero se dice. Una TAREA siempre lleva la suya.
    const sinVehiculo = vehiculoId === null && !bloque.esTareaTaller;
    const avisos = sinVehiculo
      ? [...resultado.avisos, AVISO_SIN_VEHICULO]
      : resultado.avisos;
    return {
      conductorId: conductor.id,
      nombre: conductor.nombreCompleto,
      estado:
        resultado.estado === 'OK' && sinVehiculo ? 'AVISO' : resultado.estado,
      motivos: [
        ...resultado.duros.map((m) => ({ ...m, tipo: 'DURO' as const })),
        ...avisos.map((m) => ({ ...m, tipo: 'AVISO' as const })),
      ],
      costo: resultado.costo + (sinVehiculo ? dia.asignacion.costoAviso : 0),
      vehiculoId,
    };
  }

  ultimoFinAyer(conductorId: number, dia: DatosDelDia): number | null {
    const suyos = dia.tramosAyer.filter((t) => t.conductorId === conductorId);
    if (suyos.length === 0) return null;
    const fin = Math.max(
      ...suyos.map(
        (t) =>
          franjaDe(t.horaInicio, t.horaFin, dia.parametros.inicioJornada).fin,
      ),
    );
    return finDeAyerEnHoy(fin);
  }

  /**
   * La agenda de un conductor para la política: sus tramos con cada unidad compartida fundida en UN
   * intervalo (`agendaPorUnidad`). La usan la asignación, las horas libres y los avisos.
   */
  agendaDe(
    tramos: readonly TramoCompleto[],
    inicioJornada: string,
  ): TramoEvaluado[] {
    return agendaPorUnidad(
      tramos.map((t) => ({
        clave: claveDeUnidad(t),
        tramo: this.tramoEvaluado(t, inicioJornada),
      })),
    );
  }

  tramoEvaluado(t: TramoCompleto, inicioJornada: string): TramoEvaluado {
    const origen = t.zonalOrigen
      ? { zonalId: t.zonalOrigen.id, sector: t.zonalOrigen.sector }
      : null;
    const destino = t.zonalDestino
      ? { zonalId: t.zonalDestino.id, sector: t.zonalDestino.sector }
      : origen;
    return {
      franja: franjaDe(t.horaInicio, t.horaFin, inicioJornada),
      origen,
      destino,
      etiqueta: t.operativo
        ? `${t.operativo.identificador} (${NOMBRE_TIPO[t.tipo]})`
        : (t.descripcion ?? 'tarea'),
    };
  }

  private tramoDto(t: TramoCompleto) {
    return {
      id: t.id,
      operativoId: t.operativoId,
      identificador: t.operativo?.identificador ?? null,
      departamento: nombreDeUnidad(t.operativo?.creadoPorRol),
      departamentoCodigo: t.operativo?.creadoPorRol ?? null,
      tipo: t.tipo,
      horaInicio: t.horaInicio,
      horaFin: t.horaFin,
      cruzaMedianoche: t.cruzaMedianoche,
      conductorId: t.conductorId,
      conductor: t.conductor?.nombreCompleto ?? null,
      vehiculoId: t.vehiculoId,
      placa: t.vehiculo?.placa ?? null,
      zonalOrigen: t.zonalOrigen,
      zonalDestino: t.zonalDestino,
      compartidoConTramoId: t.compartidoConTramoId,
      /** Compartir unidad (2026-10-19): el operativo del anfitrión con el que viaja, o null. */
      compartidoCon: t.compartidoCon?.operativo?.identificador ?? null,
      descripcion: t.descripcion,
      /** La cita de taller que originó esta TAREA (Fase 5), o null. */
      mantenimientoId: t.mantenimientoId,
    };
  }

  async datosDelDia(fecha: Date): Promise<DatosDelDia> {
    const ayer = new Date(fecha.getTime() - MINUTOS_DIA * 60_000);
    const [
      parametros,
      traslados,
      conductores,
      vehiculos,
      tramosHoy,
      tramosAyer,
      turnos,
      activaciones,
      ausentes,
      enTaller,
      destinosAyer,
    ] = await Promise.all([
      this.parametros.leer(),
      this.repositorio.traslados(),
      this.repositorio.conductoresActivos(),
      this.repositorio.vehiculosActivos(),
      this.repositorio.tramosDeFecha(fecha),
      this.repositorio.tramosAsignadosEnFechas([ayer]),
      // Solo un mes PUBLICADO alimenta la asignación (2026-10-07): en borrador no hay turno.
      this.repositorio.turnosPublicadosEnRango(fecha, fecha),
      this.repositorio.activacionesDe(fecha),
      this.repositorio.conductoresAusentes(fecha),
      this.repositorio.vehiculosEnTaller(fecha),
      this.repositorio.destinosDe(ayer),
    ]);

    const restriccion = await this.elegibilidad.evaluadorDeConduccion(
      conductores.map((c) => c.id),
      fecha,
    );

    const tabla = new Map<string, number>();
    for (const t of traslados)
      tabla.set(claveTraslado(t.zonalOrigenId, t.zonalDestinoId), t.minutos);

    // Dónde amanece cada vehículo = dónde quedó ayer (guarda final). En el domicilio: el sector del
    // conductor que se lo llevó (su habitual), que es lo único que se sabe del lugar.
    const amaneceEn = new Map<number, Lugar>();
    const llevadoPor = new Map<number, number>();
    for (const destino of destinosAyer) {
      if (destino.ubicacion?.zonal) {
        amaneceEn.set(destino.vehiculoId, {
          zonalId: destino.ubicacion.zonal.id,
          sector: destino.ubicacion.zonal.sector,
        });
      } else if (destino.ubicacion && !destino.domicilio) {
        // Garaje sin zonal («Matriz», 2026-10-06): lugar conocido sin sector → regla de otro sector.
        amaneceEn.set(destino.vehiculoId, {
          zonalId: null,
          sector: null,
          sinSector: true,
        });
      } else if (destino.domicilio) {
        // Quién se lo llevó: el registrado en la guarda (Fase 5) o, si no, su habitual.
        const conductor =
          conductores.find((c) => c.id === destino.conductorId) ??
          conductores.find((c) => c.vehiculoHabitualId === destino.vehiculoId);
        if (conductor) llevadoPor.set(destino.vehiculoId, conductor.id);
        if (conductor?.sector)
          amaneceEn.set(destino.vehiculoId, {
            zonalId: null,
            sector: conductor.sector,
          });
      }
    }

    return {
      parametros,
      asignacion: { ...parametros.asignacion, tablaTraslados: tabla },
      conductores,
      vehiculos,
      tramosHoy,
      tramosAyer,
      turnos: new Map(turnos.map((t) => [t.conductorId, t.turno])),
      activados: new Set(activaciones.map((a) => a.conductorId)),
      ausentes,
      enTaller,
      amaneceEn,
      llevadoPor,
      restriccion,
    };
  }

  private async exigirOperativosDe(
    fecha: Date,
    operativoIds: number[],
  ): Promise<OperativoDePlanificacion[]> {
    const operativos = await this.repositorio.operativosPorId(operativoIds);
    const claveFecha = fecha.toISOString().slice(0, 10);
    const validos = operativos.filter(
      (o) => o.cuadro.fecha.toISOString().slice(0, 10) === claveFecha,
    );
    if (validos.length !== new Set(operativoIds).size) {
      throw new RecursoNoEncontradoError(
        'Alguno de los operativos indicados no existe, fue retirado o no es de esa jornada.',
        { operativoIds },
      );
    }
    return validos;
  }

  private async exigirTramo(id: number): Promise<TramoCompleto> {
    const tramo = await this.repositorio.buscarTramo(id);
    if (!tramo) {
      throw new RecursoNoEncontradoError('El tramo indicado no existe.', {
        tramoId: id,
      });
    }
    return tramo;
  }
}

/**
 * Los tramos que se asignan cuando la DAF no elige cuáles (2026-10-19, «la misma unidad»). Si el
 * operativo ya viaja COMPARTIDO en un traslado y le queda otro sin conductor (p. ej. dejó al
 * personal en la unidad de otro operativo y falta el retiro), «Asignar conductor» completa SOLO lo
 * que falta: reasignar todo soltaría la unidad compartida sin que nadie lo pidiera. En cualquier
 * otro caso —nada compartido, o todo cubierto («Cambiar conductor»)— son todos sus tramos, como
 * siempre.
 */
export function porAsignar<
  T extends {
    conductorId: number | null;
    compartidoConTramoId?: number | null;
  },
>(existentes: readonly T[]): T[] {
  const hayCompartido = existentes.some(
    (t) => (t.compartidoConTramoId ?? null) !== null,
  );
  const pendientes = existentes.filter((t) => t.conductorId === null);
  return hayCompartido && pendientes.length > 0 ? pendientes : [...existentes];
}

/** El traslado como sujeto de una frase: «El retiro», «El traslado de dejar». */
const SUJETO_TRAMO: Record<string, string> = {
  DEJAR: 'El traslado de dejar',
  RETIRAR: 'El retiro',
  COMPLETO: 'El acompañamiento',
};

/** El aviso de los traslados propios que no pudo hacer la misma unidad (quedan pendientes). */
export function avisoPropiosPendientes(
  pendientes: readonly { tipo: string; motivo?: string }[],
): string | null {
  if (pendientes.length === 0) return null;
  return pendientes
    .map(
      (p) =>
        `${SUJETO_TRAMO[p.tipo] ?? 'Un traslado'} quedó pendiente: ${conPunto(p.motivo ?? 'la misma unidad no puede hacerlo')} Asígnelo con «Asignar conductor».`,
    )
    .join(' ');
}

function conPunto(texto: string): string {
  return /[.!?]$/.test(texto.trim()) ? texto.trim() : `${texto.trim()}.`;
}

/** Los traslados en una palabra, sin repetir: «dejar», «retirar», «todo el operativo». */
function palabrasDeTramos(tipos: readonly string[]): string[] {
  return [...new Set(tipos.map((t) => palabraDeTramo(t)))];
}

/** El anfitrión sin la distancia con que se ordenó (no viaja en la respuesta). */
function sinDistancia(
  anfitrion: AnfitrionCompartible & { distancia: number },
): AnfitrionCompartible {
  const copia: Partial<typeof anfitrion> = { ...anfitrion };
  delete copia.distancia;
  return copia as AnfitrionCompartible;
}

const ORDEN_ESTADO: Record<Evaluacion['estado'], number> = {
  OK: 0,
  AVISO: 1,
  DURO: 2,
};

/** ¿Hay un «completo» de por medio? ABARCA si es el del invitado; DENTRO si es el de la unidad. */
function sentidoCompleto(
  tramosInvitado: readonly TramoParaCompartir[],
  pares: readonly { tramoId: number; anfitrion: TramoCompleto }[],
): 'ABARCA' | 'DENTRO' | null {
  for (const par of pares) {
    const tramo = tramosInvitado.find((t) => t.id === par.tramoId);
    if (!tramo || tramo.tipo === par.anfitrion.tipo) continue;
    if (tramo.tipo === 'COMPLETO') return 'ABARCA';
    if (par.anfitrion.tipo === 'COMPLETO') return 'DENTRO';
  }
  return null;
}

/** Qué traslados van dentro del «completo» (ver `AnfitrionCompartible.contiene`). */
function contenidosDelCompleto(
  completo: 'ABARCA' | 'DENTRO' | null,
  tramosInvitado: readonly TramoParaCompartir[],
  unidad: readonly TramoCompleto[],
  contexto: ContextoCompartir,
): string[] {
  if (completo === 'ABARCA') {
    const completos = tramosInvitado.filter((t) => t.tipo === 'COMPLETO');
    return palabrasDeTramos(
      unidad
        .filter(
          (u) =>
            u.tipo !== 'COMPLETO' &&
            completos.some((c) => seSolapan(c.franja, contexto.franjaDe(u))),
        )
        .map((u) => u.tipo),
    );
  }
  if (completo === 'DENTRO') {
    const completos = unidad.filter((u) => u.tipo === 'COMPLETO');
    return palabrasDeTramos(
      tramosInvitado
        .filter(
          (t) =>
            t.tipo !== 'COMPLETO' &&
            completos.some((c) => seSolapan(contexto.franjaDe(c), t.franja)),
        )
        .map((t) => t.tipo),
    );
  }
  return [];
}
