/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · planificar el día (flujo guiado en 4 pasos)
 * Archivo: jornada-daf.service.ts
 * Responsabilidad: Resumen de la jornada DAF, candidatos por operativo, vehículos que salen y emisión de hojas de ruta.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-08
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * COMPONE, NO DECIDE. El resumen junta en UNA llamada lo que la pantalla pedía en seis
 * (preparación, plan del día, capacidad, ventana, fin del día y hojas de ruta) reutilizando los
 * servicios y políticas que ya existían. Las decisiones nuevas son políticas puras:
 * `jornada-daf.ts` (requisitos y paso inicial), `candidatos.ts` (el diálogo de asignar) y
 * `hoja-ruta-emision.ts` (huella y estado de la hoja).
 *
 * Los avisos de cada conductor salen de la MISMA política de asignación
 * (`asignacion-conductor.policy.ts`): cada tramo suyo se evalúa contra el resto de su día, así que
 * «jornada de 13 h», «fuera de turno» o «no llega por el traslado» se ven en su carril sin un
 * cálculo paralelo.
 *
 * ESCRITURAS (con su auditoría dentro de la transacción, regla 5):
 *   · confirmar los vehículos que salen → `t_vehiculo_jornada` + el conteo en `t_capacidad_flota`
 *     (RN-46, por el servicio de capacidad: misma auditoría y mismo aviso que antes);
 *   · emitir hojas de ruta → `t_hoja_ruta_emision` con la huella de los tramos.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Injectable } from '@nestjs/common';
import {
  AccionAuditoria,
  EstadoTransporte,
  RolDepartamental,
  TipoTramo,
  TipoTransporte,
} from '@prisma/client';

import { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import {
  RecursoNoEncontradoError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import { VentanaCargaService } from '../../configuracion/application/ventana-carga.service';
import { CuadroDiarioService } from '../../cuadro-diario/application/cuadro-diario.service';
import type { Autor } from '../../operativos/application/operativos.service';
import { JornadaDafRepository } from '../infrastructure/jornada-daf.repository';
import {
  PlanificacionTransporteRepository,
  type TramoCompleto,
} from '../infrastructure/planificacion-transporte.repository';
import { CapacidadFlotaService } from './capacidad-flota.service';
import { OptimizacionTransporteService } from './optimizacion-transporte.service';
import {
  PlanificacionTransporteService,
  type DatosDelDia,
} from './planificacion-transporte.service';
import { PreparacionTransporteService } from './preparacion-transporte.service';
import type {
  CodigoMotivo,
  TurnoDelConductor,
} from './politicas/asignacion-conductor.policy';
import {
  ordenarCandidatos,
  type Candidato,
  type EntradaCandidato,
} from './politicas/candidatos';
import {
  estadoHojaRuta,
  huellaDeTramos,
  type EstadoHojaRuta,
} from './politicas/hoja-ruta-emision';
import {
  armarRequisitos,
  derivarPaso,
  type EstadoPasos,
  type Requisito,
} from './politicas/jornada-daf';
import { conSuUnidad } from './politicas/compartir-tramo';
import { huecosLibres, type HuecoLibre } from './politicas/huecos-libres';
import {
  aEscalaDeLinea,
  aHora,
  franjaDe,
  seSolapan,
  type Franja,
} from './politicas/linea-de-tiempo';

/** Un aviso en el carril de un conductor. */
export interface AvisoConductor {
  codigo: CodigoMotivo;
  mensaje: string;
  tipo: 'DURO' | 'AVISO';
}

const TURNOS_CON_VENTANA = ['DIA', 'NOCHE', 'ECU_NOCHE'] as const;

@Injectable()
export class JornadaDafService {
  constructor(
    private readonly planificacion: PlanificacionTransporteService,
    private readonly optimizacion: OptimizacionTransporteService,
    private readonly preparacion: PreparacionTransporteService,
    private readonly capacidad: CapacidadFlotaService,
    private readonly cuadros: CuadroDiarioService,
    private readonly ventanas: VentanaCargaService,
    private readonly repositorio: PlanificacionTransporteRepository,
    private readonly jornada: JornadaDafRepository,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ─────────────────────────── Resumen ───────────────────────────

  /** Todo lo que el flujo de 4 pasos necesita, en una llamada. No escribe nada. */
  async resumen(fecha: Date) {
    const [
      preparacion,
      dia,
      operativos,
      ventana,
      filasJornada,
      emisiones,
      finDelDia,
      garajes,
    ] = await Promise.all([
      this.preparacion.preparar(fecha),
      this.planificacion.datosDelDia(fecha),
      this.repositorio.operativosDeFecha(fecha),
      this.ventanas.obtenerEstado(RolDepartamental.DAF),
      this.jornada.vehiculosDeJornada(fecha),
      this.jornada.emisionesDe(fecha),
      this.optimizacion.finDelDia(fecha),
      this.repositorio.garajesAutorizados(),
    ]);
    const inicio = dia.parametros.inicioJornada;
    const placaDe = new Map(dia.vehiculos.map((v) => [v.id, v.placa]));

    // ── Operativos que piden transporte, con su asignación ──
    const conTransporte = operativos.filter(
      (o) =>
        o.tipoTransporte !== TipoTransporte.PROPIOS_MEDIOS &&
        o.estadoTransporte !== EstadoTransporte.PROPIOS_MEDIOS,
    );
    const tramosDe = new Map<number, TramoCompleto[]>();
    for (const t of dia.tramosHoy) {
      if (t.operativoId === null) continue;
      const lista = tramosDe.get(t.operativoId) ?? [];
      lista.push(t);
      tramosDe.set(t.operativoId, lista);
    }
    const listaOperativos = conTransporte.map((o) => {
      const tramos = (tramosDe.get(o.id) ?? []).sort(
        (a, b) =>
          franjaDe(a.horaInicio, a.horaFin, inicio).inicio -
          franjaDe(b.horaInicio, b.horaFin, inicio).inicio,
      );
      const asignados = tramos.filter((t) => t.conductorId !== null);
      const cubierto = tramos.length > 0 && asignados.length === tramos.length;
      return {
        id: o.id,
        identificador: o.identificador,
        formulario: `${o.formulario.numero}. ${o.formulario.nombre}`,
        horaInicio: o.horaInicio,
        horaFin: o.horaFin,
        zonal: o.zonales[0]?.zonal.nombre ?? null,
        zonalId: o.zonales[0]?.zonal.id ?? null,
        tipoTransporte: o.tipoTransporte,
        esMacrooperativo: o.esMacrooperativo,
        /**
         * Compartir unidad (2026-10-19): lo que pidió quien registró —viajar con otro operativo, o
         * vehículo exclusivo con su justificación—. La DAF lo ejecuta (RN-40).
         */
        compartirCon: o.compartirCon
          ? {
              id: o.compartirCon.id,
              identificador: o.compartirCon.identificador,
            }
          : null,
        justificacionExclusivo: o.justificacionExclusivo ?? null,
        transporteLiberado: Boolean(o.transporteLiberadoEn),
        personas: o.personal.length,
        cubierto,
        parcial: !cubierto && asignados.length > 0,
        tramos: tramos.map((t) => ({
          id: t.id,
          tipo: t.tipo,
          horaInicio: t.horaInicio,
          horaFin: t.horaFin,
          conductorId: t.conductorId,
          conductor: t.conductor?.nombreCompleto ?? null,
          vehiculoId: t.vehiculoId,
          placa: t.vehiculo?.placa ?? null,
          /** Viaja en la unidad de otro operativo (compartir unidad): su identificador, o null. */
          compartidoCon: t.compartidoCon?.operativo?.identificador ?? null,
        })),
        conductores: unicos(
          asignados.map((t) => ({
            id: t.conductorId as number,
            nombre: t.conductor?.nombreCompleto ?? '',
          })),
        ),
        placas: [
          ...new Set(
            asignados
              .map((t) => t.vehiculo?.placa)
              .filter((p): p is string => !!p),
          ),
        ],
      };
    });
    const cubiertos = listaOperativos.filter((o) => o.cubierto).length;

    // ── Conductores: turno, placa, avisos y hoja de ruta ──
    const emisionDe = new Map(emisiones.map((e) => [e.conductorId, e]));
    const listaConductores = dia.conductores.map((c) => {
      const suyos = dia.tramosHoy.filter((t) => t.conductorId === c.id);
      const vehiculosHoy = [
        ...new Set(
          suyos
            .map((t) => t.vehiculoId)
            .filter((id): id is number => id !== null),
        ),
      ];
      const vehiculoId = vehiculosHoy[0] ?? c.vehiculoHabitualId ?? null;
      const huella = huellaDeTramos(suyos);
      const emision = emisionDe.get(c.id) ?? null;
      return {
        id: c.id,
        nombre: c.nombreCompleto,
        turno: (dia.turnos.get(c.id) ?? null) as TurnoDelConductor | null,
        activado: dia.activados.has(c.id),
        ausente: dia.ausentes.has(c.id),
        vehiculoId,
        placa: vehiculoId !== null ? (placaDe.get(vehiculoId) ?? null) : null,
        vehiculoIds: vehiculosHoy,
        tramoIds: suyos.map((t) => t.id),
        avisos: this.avisosDelConductor(c, suyos, operativos, fecha, dia),
        hojaRuta:
          suyos.length > 0
            ? {
                estado: estadoHojaRuta(huella, emision),
                emitidaEn: emision?.emitidaEn.toISOString() ?? null,
              }
            : null,
      };
    });
    const enUso = listaConductores.filter((c) => c.tramoIds.length > 0);
    const totalAvisos = listaConductores.reduce(
      (suma, c) => suma + c.avisos.length,
      0,
    );

    // ── Vehículos ──
    const salePor = new Map(filasJornada.map((f) => [f.vehiculoId, f]));
    const enTaller = dia.vehiculos.filter((v) => dia.enTaller.has(v.id));
    const confirmada = filasJornada.length > 0;
    const salen = dia.vehiculos.filter((v) => salePor.get(v.id)?.sale === true);
    const vehiculosEnUso = new Set(
      dia.tramosHoy
        .filter((t) => t.conductorId !== null && t.vehiculoId !== null)
        .map((t) => t.vehiculoId as number),
    );

    // ── Requisitos y paso ──
    const turnos = [...dia.turnos.values()];
    const { requisitos, listos, pendientes } = armarRequisitos({
      cuadro: {
        existe: preparacion.cuadro.existe,
        estado: preparacion.cuadro.estado,
        operativosConTransporte: conTransporte.length,
        formulariosConTransporte: new Set(
          conTransporte.map((o) => o.formulario.numero),
        ).size,
      },
      turnos: {
        cargados: preparacion.turnos.cargados,
        publicados: preparacion.turnos.publicados,
        dia: turnos.filter((t) => t === 'DIA').length,
        noche: turnos.filter((t) => t === 'NOCHE' || t === 'ECU_NOCHE').length,
        libre: turnos.filter((t) => t === 'LIBRE').length,
      },
      conductoresIncompletos: preparacion.conductoresIncompletos,
      vehiculos: {
        flota: dia.vehiculos.length,
        enTaller: enTaller.map((v) => v.placa),
        confirmados: confirmada ? salen.length : null,
      },
      ventana: {
        abierta: ventana.abierta,
        horaApertura: ventana.horaApertura,
        horaCierre: ventana.horaCierre,
      },
    });
    const hojas = enUso.map((c) => c.hojaRuta?.estado);
    const pasos: EstadoPasos = derivarPaso({
      requisitosListos: listos,
      operativos: conTransporte.length,
      cubiertos,
      vehiculosEnUso: finDelDia.length,
      vehiculosConGuarda: finDelDia.filter((f) => f.declarada !== null).length,
      hojasEmitidas: hojas.length > 0 && hojas.every((e) => e === 'EMITIDA'),
    });

    return {
      fecha: fecha.toISOString().slice(0, 10),
      pasos,
      preparacion: {
        requisitos: requisitos satisfies Requisito[],
        listos,
        pendientes,
        conductoresIncompletos: preparacion.conductoresIncompletos,
      },
      ventana: {
        abierta: ventana.abierta,
        horaApertura: ventana.horaApertura,
        horaCierre: ventana.horaCierre,
        mensaje: ventana.mensaje,
        zonaHoraria: ventana.zonaHoraria,
      },
      totales: {
        operativos: conTransporte.length,
        cubiertos,
        sinConductor: conTransporte.length - cubiertos,
        propiosMedios: operativos.length - conTransporte.length,
        conductoresEnUso: enUso.length,
        libresEnUso: enUso.filter((c) => c.turno === 'LIBRE').length,
        vehiculosDisponibles: confirmada
          ? salen.length
          : dia.vehiculos.length - enTaller.length,
        vehiculosEnUso: vehiculosEnUso.size,
        enTaller: enTaller.length,
        avisos: totalAvisos,
      },
      operativos: listaOperativos,
      conductores: listaConductores,
      vehiculos: {
        flota: dia.vehiculos.length,
        confirmada,
        confirmadaEn: confirmada
          ? new Date(
              Math.max(...filasJornada.map((f) => f.registradoEn.getTime())),
            ).toISOString()
          : null,
        lista: dia.vehiculos.map((v) => ({
          id: v.id,
          placa: v.placa,
          tipo: v.tipo,
          enTaller: dia.enTaller.has(v.id),
          sale: salePor.get(v.id)?.sale ?? null,
          enUso: vehiculosEnUso.has(v.id),
        })),
      },
      finDelDia,
      /**
       * Lo que ofrece «Se guarda en» (2026-10-08): SOLO los garajes autorizados y activos del
       * catálogo de flota, por su nombre. Antes el paso 3 leía el catálogo de administración
       * entero (`/administracion/ubicaciones-flota`), que exige `flota:administrar`.
       */
      garajes: garajes.map((g) => ({ id: g.id, nombre: g.nombre })),
    };
  }

  /**
   * Avisos del carril de un conductor: cada tramo suyo se evalúa contra el resto de su día con la
   * política de asignación. Se quedan los motivos distintos (por código).
   */
  private avisosDelConductor(
    conductor: DatosDelDia['conductores'][number],
    suyos: readonly TramoCompleto[],
    operativos: Awaited<
      ReturnType<PlanificacionTransporteRepository['operativosDeFecha']>
    >,
    fecha: Date,
    dia: DatosDelDia,
  ): AvisoConductor[] {
    const personasDe = new Map(
      operativos.map((o) => [o.id, o.personal.length]),
    );
    const vistos = new Map<CodigoMotivo, AvisoConductor>();
    for (const tramo of suyos) {
      const evaluacion = this.planificacion.evaluarConductor(
        conductor,
        tramo.vehiculoId,
        {
          tramos: [
            this.planificacion.tramoEvaluado(
              tramo,
              dia.parametros.inicioJornada,
            ),
          ],
          personas:
            tramo.operativoId === null
              ? 0
              : (personasDe.get(tramo.operativoId) ?? 0),
          esTareaTaller: tramo.tipo === TipoTramo.TAREA,
          conduccion:
            tramo.operativoId === null
              ? undefined
              : this.planificacion.conduccionDe(
                  operativos.filter((o) => o.id === tramo.operativoId),
                ),
        },
        new Set([tramo.id]),
        fecha,
        dia,
      );
      for (const m of evaluacion.motivos) {
        if (!vistos.has(m.codigo))
          vistos.set(m.codigo, {
            codigo: m.codigo,
            mensaje: m.mensaje,
            tipo: m.tipo,
          });
      }
    }
    return [...vistos.values()];
  }

  // ─────────────────────────── Candidatos ───────────────────────────

  /**
   * Los conductores para un operativo, en categorías y con su motivo en palabras (diálogo «Asignar /
   * Cambiar conductor»). Reutiliza `evaluarBloque`; no escribe nada.
   */
  async candidatos(fecha: Date, operativoId: number) {
    const contexto = await this.planificacion.evaluarConContexto(fecha, [
      operativoId,
    ]);
    const { dia, existentes, bloque } = contexto;
    const operativo = contexto.operativos[0];
    const inicio = dia.parametros.inicioJornada;
    // Compartir unidad (2026-10-19): lo que viaja en su misma unidad no es un choque.
    const ids = conSuUnidad(new Set(bloque.idsTramos), dia.tramosHoy);
    const zonalId = operativo.zonales[0]?.zonal.id ?? null;
    const actuales = new Set(
      existentes
        .filter((t) => t.conductorId !== null)
        .map((t) => t.conductorId as number),
    );
    const placaDe = new Map(dia.vehiculos.map((v) => [v.id, v.placa]));
    // Compartir unidad (2026-10-21): quien está «ocupado» solo porque ya hace un traslado con el que
    // este operativo puede viajar (la unidad del «completo» de su punto) se ofrece como COMPARTE. La
    // decisión es la misma de «Compartir unidad» (`compartibles`): una sola regla.
    const compartiblePorConductor = new Map<
      number,
      { operativoId: number; identificador: string }
    >();
    if (actuales.size === 0)
      for (const a of (await this.planificacion.compartibles(operativoId))
        .anfitriones)
        if (a.compatible && !compartiblePorConductor.has(a.conductor.id))
          compartiblePorConductor.set(a.conductor.id, {
            operativoId: a.operativoId,
            identificador: a.identificador,
          });

    const entradas: EntradaCandidato[] = contexto.evaluaciones.map((e) => {
      const turno = (dia.turnos.get(e.conductorId) ??
        null) as TurnoDelConductor | null;
      const suyos = dia.tramosHoy.filter(
        (t) => t.conductorId === e.conductorId && !ids.has(t.id),
      );
      const choque = suyos.find((t) =>
        bloque.tramos.some((b) =>
          seSolapan(b.franja, franjaDe(t.horaInicio, t.horaFin, inicio)),
        ),
      );
      return {
        conductorId: e.conductorId,
        nombre: e.nombre,
        turno,
        ventanaTurno: TURNOS_CON_VENTANA.some((x) => x === turno)
          ? dia.parametros.ventanasTurno[
              turno as (typeof TURNOS_CON_VENTANA)[number]
            ]
          : null,
        vehiculoId: e.vehiculoId,
        placa:
          e.vehiculoId !== null ? (placaDe.get(e.vehiculoId) ?? null) : null,
        estado: e.estado,
        motivos: e.motivos,
        actual: actuales.has(e.conductorId),
        compartirCon: compartiblePorConductor.get(e.conductorId) ?? null,
        choque: choque
          ? {
              etiqueta:
                choque.operativo?.identificador ??
                choque.descripcion ??
                'tarea',
              franja: franjaDe(choque.horaInicio, choque.horaFin, inicio),
            }
          : null,
        zonasComunes:
          zonalId === null
            ? []
            : [
                ...new Set(
                  suyos
                    .filter(
                      (t) =>
                        t.zonalOrigen?.id === zonalId ||
                        t.zonalDestino?.id === zonalId,
                    )
                    .map((t) =>
                      t.zonalOrigen?.id === zonalId
                        ? t.zonalOrigen.nombre
                        : (t.zonalDestino?.nombre ?? ''),
                    ),
                ),
              ],
      };
    });

    const actual = [...actuales][0];
    return {
      operativo: {
        id: operativo.id,
        identificador: operativo.identificador,
        formulario: `${operativo.formulario.numero}. ${operativo.formulario.nombre}`,
        horaInicio: operativo.horaInicio,
        horaFin: operativo.horaFin,
        zonal: operativo.zonales[0]?.zonal.nombre ?? null,
        tipoTransporte: operativo.tipoTransporte,
        esMacrooperativo: operativo.esMacrooperativo,
        compartirCon: operativo.compartirCon
          ? {
              id: operativo.compartirCon.id,
              identificador: operativo.compartirCon.identificador,
            }
          : null,
        justificacionExclusivo: operativo.justificacionExclusivo ?? null,
      },
      actual:
        actual !== undefined
          ? {
              conductorId: actual,
              nombre:
                dia.conductores.find((c) => c.id === actual)?.nombreCompleto ??
                '',
            }
          : null,
      candidatos: ordenarCandidatos(entradas) satisfies Candidato[],
    };
  }

  // ─────────────────────────── Horas libres ───────────────────────────

  /**
   * Las HORAS LIBRES del día (2026-10-14), por conductor y por vehículo. La resta de intervalos, el
   * tope de jornada, los traslados y las horas extra los decide la política pura
   * `politicas/huecos-libres.ts`; aquí solo se reúne la ventana de cada uno con los datos que
   * `datosDelDia` ya carga en lote (una sola lectura para toda la flota). No escribe nada.
   *
   * VENTANA DEL CONDUCTOR (límite duro): la jornada 05H00 → 05H00, salvo que esté ausente o de LIBRE
   * sin activar (ninguna) o sea de NOMBRAMIENTO (su ventana de lunes a viernes; ninguna el fin de
   * semana). VENTANA DEL TURNO (D9): la de su turno DIA/NOCHE/ECU_NOCHE; un LIBRE activado, un
   * ADMINISTRATIVO o quien no tiene mes publicado no la tienen (D5): sus huecos son horas extra.
   *
   * VENTANA DEL VEHÍCULO: la jornada entera, salvo que esté en taller ese día (ninguna). No tiene
   * tope de jornada: lo tiene quien lo conduce.
   *
   * Filtros: con `conductorId` o `vehiculoId` se devuelve solo lo pedido (404 si no existe o está
   * dado de baja); sin ninguno, todos. Con `zonalId` (404 si no existe), el aprovechable.
   */
  async huecosDelDia(
    fecha: Date,
    filtros: { conductorId?: number; vehiculoId?: number; zonalId?: number },
  ) {
    const [dia, zonales] = await Promise.all([
      this.planificacion.datosDelDia(fecha),
      filtros.zonalId === undefined
        ? Promise.resolve([])
        : this.repositorio.zonalesActivas(),
    ]);
    const inicio = dia.parametros.inicioJornada;
    const enLinea = (franja: Franja) => aEscalaDeLinea(franja, inicio);

    const zonal =
      filtros.zonalId === undefined
        ? null
        : (zonales.find((z) => z.id === filtros.zonalId) ?? null);
    if (filtros.zonalId !== undefined && !zonal) {
      throw new RecursoNoEncontradoError(
        'La zonal indicada no existe o está desactivada.',
        { zonalId: filtros.zonalId },
      );
    }
    const destino = zonal ? { zonalId: zonal.id, sector: zonal.sector } : null;

    const soloUno =
      filtros.conductorId !== undefined || filtros.vehiculoId !== undefined;
    const conductores =
      filtros.conductorId !== undefined
        ? dia.conductores.filter((c) => c.id === filtros.conductorId)
        : soloUno
          ? []
          : dia.conductores;
    if (filtros.conductorId !== undefined && conductores.length === 0) {
      throw new RecursoNoEncontradoError(
        'El conductor indicado no existe o está dado de baja.',
        { conductorId: filtros.conductorId },
      );
    }
    const vehiculos =
      filtros.vehiculoId !== undefined
        ? dia.vehiculos.filter((v) => v.id === filtros.vehiculoId)
        : soloUno
          ? []
          : dia.vehiculos;
    if (filtros.vehiculoId !== undefined && vehiculos.length === 0) {
      throw new RecursoNoEncontradoError(
        'El vehículo indicado no existe o está dado de baja.',
        { vehiculoId: filtros.vehiculoId },
      );
    }

    const jornada = franjaDe(inicio, inicio, inicio);
    const esFinDeSemana = [0, 6].includes(fecha.getUTCDay());
    const comun = {
      traslado: dia.asignacion.traslado,
      tablaTraslados: dia.asignacion.tablaTraslados,
      minimoMin: dia.parametros.huecoMinimoMin,
      destino,
    };
    const dto = (h: HuecoLibre) => ({
      horaInicio: aHora(h.franja.inicio),
      horaFin: aHora(h.franja.fin),
      /** Minutos sobre la línea que empieza en `inicioJornada`, para dibujarlo. */
      franja: enLinea(h.franja),
      brutoMin: h.brutoMin,
      utilMinimoMin: h.utilMinimoMin,
      aprovechableMin: h.aprovechableMin,
      desde: h.desde,
      hacia: h.hacia,
      horasExtra: h.horasExtra,
    });

    return {
      fecha: fecha.toISOString().slice(0, 10),
      inicioJornada: inicio,
      minimoMin: dia.parametros.huecoMinimoMin,
      zonalDestino: zonal
        ? { id: zonal.id, nombre: zonal.nombre, sector: zonal.sector }
        : null,
      conductores: conductores.map((c) => {
        const turno = dia.turnos.get(c.id) ?? null;
        const puede =
          !dia.ausentes.has(c.id) &&
          !(turno === 'LIBRE' && !dia.activados.has(c.id));
        const ventana = !puede
          ? null
          : c.tipoContrato === 'NOMBRAMIENTO'
            ? esFinDeSemana
              ? null
              : dia.parametros.ventanaNombramiento
            : jornada;
        const ventanaTurno =
          turno === 'DIA' || turno === 'NOCHE' || turno === 'ECU_NOCHE'
            ? dia.parametros.ventanasTurno[turno]
            : null;
        const suyos = dia.tramosHoy.filter((t) => t.conductorId === c.id);
        const vehiculoDelDia =
          suyos.find((t) => t.vehiculoId !== null)?.vehiculoId ??
          c.vehiculoHabitualId;
        return {
          conductorId: c.id,
          nombre: c.nombreCompleto,
          turno,
          ventana: ventana ? enLinea(ventana) : null,
          ventanaTurno: ventanaTurno ? enLinea(ventanaTurno) : null,
          huecos: huecosLibres({
            ...comun,
            ventana,
            ventanaTurno,
            ocupados: suyos.map((t) =>
              this.planificacion.tramoEvaluado(t, inicio),
            ),
            amaneceEn:
              vehiculoDelDia === null
                ? null
                : (dia.amaneceEn.get(vehiculoDelDia) ?? null),
            maxJornadaMin: dia.asignacion.maxJornadaHoras * 60,
          }).map(dto),
        };
      }),
      vehiculos: vehiculos.map((v) => {
        const enTaller = dia.enTaller.has(v.id);
        return {
          vehiculoId: v.id,
          placa: v.placa,
          enTaller,
          huecos: huecosLibres({
            ...comun,
            ventana: enTaller ? null : jornada,
            // Un vehículo no tiene turno: sus huecos no son «horas extra».
            ventanaTurno: jornada,
            ocupados: dia.tramosHoy
              .filter((t) => t.vehiculoId === v.id && t.conductorId !== null)
              .map((t) => this.planificacion.tramoEvaluado(t, inicio)),
            amaneceEn: dia.amaneceEn.get(v.id) ?? null,
            maxJornadaMin: null,
          }).map(dto),
        };
      }),
    };
  }

  /** El atajo por conductor: la misma consulta, con lo de ese conductor solo. */
  async huecosDelConductor(fecha: Date, conductorId: number, zonalId?: number) {
    const dia = await this.huecosDelDia(fecha, { conductorId, zonalId });
    return {
      fecha: dia.fecha,
      inicioJornada: dia.inicioJornada,
      minimoMin: dia.minimoMin,
      zonalDestino: dia.zonalDestino,
      ...dia.conductores[0],
    };
  }

  // ─────────────────────────── Vehículos que salen ───────────────────────────

  /** La lista de vehículos activos del día con lo confirmado (o `sale: null` si no se confirmó). */
  async vehiculosDeJornada(fecha: Date) {
    const [vehiculos, enTaller, filas] = await Promise.all([
      this.repositorio.vehiculosActivos(),
      this.repositorio.vehiculosEnTaller(fecha),
      this.jornada.vehiculosDeJornada(fecha),
    ]);
    const salePor = new Map(filas.map((f) => [f.vehiculoId, f.sale]));
    return {
      fecha: fecha.toISOString().slice(0, 10),
      confirmada: filas.length > 0,
      vehiculos: vehiculos.map((v) => ({
        id: v.id,
        placa: v.placa,
        tipo: v.tipo,
        enTaller: enTaller.has(v.id),
        sale: salePor.get(v.id) ?? null,
      })),
    };
  }

  /**
   * Confirma QUÉ vehículos salen. Guarda una fila por vehículo activo y declara el conteo en
   * `t_capacidad_flota` (RN-46) por el servicio de capacidad: si difiere de lo calculado, la
   * observación que exige se compone con las placas que no salen (y la nota de la DAF, si la hay).
   */
  async confirmarVehiculos(
    fecha: Date,
    datos: { saleIds: number[]; observacion?: string | null },
    autor: Autor,
  ) {
    // Sin cuadro no hay jornada que confirmar (404 con frase, antes de escribir nada).
    await this.cuadros.obtenerPorFecha(fecha);
    const [vehiculos, enTaller, anteriores, { calculada }] = await Promise.all([
      this.repositorio.vehiculosActivos(),
      this.repositorio.vehiculosEnTaller(fecha),
      this.jornada.vehiculosDeJornada(fecha),
      this.capacidad.calcular(fecha),
    ]);
    const salen = new Set(datos.saleIds);
    const activos = new Set(vehiculos.map((v) => v.id));
    const ajenos = [...salen].filter((id) => !activos.has(id));
    if (ajenos.length > 0) {
      throw new RecursoNoEncontradoError(
        'Alguno de los vehículos indicados no existe o está dado de baja.',
        { vehiculoIds: ajenos },
      );
    }
    const enTallerQueSalen = vehiculos.filter(
      (v) => salen.has(v.id) && enTaller.has(v.id),
    );
    if (enTallerQueSalen.length > 0) {
      throw new ValidacionError(
        `${enTallerQueSalen.map((v) => v.placa).join(', ')} ${enTallerQueSalen.length === 1 ? 'está' : 'están'} en el taller ese día: no puede salir.`,
        { vehiculoIds: enTallerQueSalen.map((v) => v.id) },
      );
    }

    const noSalen = vehiculos.filter(
      (v) => !salen.has(v.id) && !enTaller.has(v.id),
    );
    const nota = datos.observacion?.trim() ?? '';
    const observacion =
      salen.size !== calculada.vehiculosHabiles
        ? [
            `Vehículos que no salen: ${noSalen.map((v) => v.placa).join(', ')}.`,
            nota,
          ]
            .filter((t) => t !== '')
            .join(' ')
        : nota;

    const antes = anteriores
      .filter((f) => f.sale)
      .map((f) => f.vehiculoId)
      .sort((a, b) => a - b)
      .join(',');
    const ahora = [...salen].sort((a, b) => a - b).join(',');

    await this.jornada.ejecutarEnTransaccion(async (cliente) => {
      for (const v of vehiculos) {
        await this.jornada.guardarVehiculoJornada(
          fecha,
          v.id,
          salen.has(v.id),
          autor.usuarioId,
          cliente,
        );
      }
      await this.auditoria.registrar(
        {
          entidad: 't_vehiculo_jornada',
          entidadId: 0,
          accion:
            anteriores.length > 0
              ? AccionAuditoria.ACTUALIZAR
              : AccionAuditoria.CREAR,
          cambios: [
            {
              campo: 'vehiculos_salen',
              valorAnterior: anteriores.length > 0 ? antes : undefined,
              valorNuevo: ahora,
            },
          ],
          usuario: autor.usuarioId,
          rol: autor.rol,
        },
        cliente,
      );
    });

    const capacidad = await this.capacidad.declarar(
      fecha,
      {
        vehiculosHabiles: salen.size,
        conductoresHabiles: calculada.conductoresHabiles,
        // capa_observacion admite 300 caracteres: una flota muy grande se recorta.
        observacion: observacion === '' ? undefined : observacion.slice(0, 300),
      },
      autor,
    );

    return {
      ...(await this.vehiculosDeJornada(fecha)),
      capacidad: {
        vehiculosHabiles: salen.size,
        conductoresHabiles: calculada.conductoresHabiles,
        vehiculosRequeridos: capacidad.vehiculosRequeridos,
        hayAdvertencia: capacidad.veredicto?.hayAdvertencia ?? false,
      },
    };
  }

  // ─────────────────────────── Hojas de ruta ───────────────────────────

  /**
   * Emite la hoja de ruta de un conductor (o de todos los que tienen tramos asignados ese día):
   * guarda la huella de sus tramos. Si después cambian, el resumen la muestra «pendiente (cambio
   * posterior)». No genera ni guarda el PDF.
   */
  async emitirHojas(
    fecha: Date,
    conductorId: number | undefined,
    autor: Autor,
  ): Promise<{
    emitidas: number;
    hojas: {
      conductorId: number;
      estado: EstadoHojaRuta;
      emitidaEn: string;
    }[];
  }> {
    const [tramos, conductores, anteriores] = await Promise.all([
      this.repositorio.tramosDeFecha(fecha),
      this.repositorio.conductoresActivos(),
      this.jornada.emisionesDe(fecha),
    ]);
    const porConductor = new Map<number, TramoCompleto[]>();
    for (const t of tramos) {
      if (t.conductorId === null) continue;
      if (conductorId !== undefined && t.conductorId !== conductorId) continue;
      const lista = porConductor.get(t.conductorId) ?? [];
      lista.push(t);
      porConductor.set(t.conductorId, lista);
    }
    if (porConductor.size === 0) {
      const nombre = conductores.find(
        (c) => c.id === conductorId,
      )?.nombreCompleto;
      throw new ValidacionError(
        conductorId !== undefined
          ? `${nombre ?? 'El conductor indicado'} no tiene tramos asignados ese día: no hay hoja de ruta que emitir.`
          : 'No hay hojas de ruta que emitir: ningún conductor tiene tramos asignados ese día.',
        { fecha: fecha.toISOString().slice(0, 10), conductorId },
      );
    }
    const yaEmitida = new Map(anteriores.map((e) => [e.conductorId, e]));

    const hojas = await this.jornada.ejecutarEnTransaccion(async (cliente) => {
      const resultado: {
        conductorId: number;
        estado: EstadoHojaRuta;
        emitidaEn: string;
      }[] = [];
      for (const [id, suyos] of porConductor) {
        const huella = huellaDeTramos(suyos);
        const anterior = yaEmitida.get(id);
        const fila = await this.jornada.registrarEmision(
          fecha,
          id,
          huella,
          autor.usuarioId,
          cliente,
        );
        await this.auditoria.registrar(
          {
            entidad: 't_hoja_ruta_emision',
            entidadId: fila.id,
            accion: anterior
              ? AccionAuditoria.ACTUALIZAR
              : AccionAuditoria.CREAR,
            cambios: [
              {
                campo: 'hore_huella',
                valorAnterior: anterior?.huella,
                valorNuevo: huella,
              },
            ],
            usuario: autor.usuarioId,
            rol: autor.rol,
          },
          cliente,
        );
        resultado.push({
          conductorId: id,
          estado: 'EMITIDA',
          emitidaEn: fila.emitidaEn.toISOString(),
        });
      }
      return resultado;
    });
    return { emitidas: hojas.length, hojas };
  }
}

/** Quita repetidos por id, conservando el primero. */
function unicos<T extends { id: number }>(lista: T[]): T[] {
  const vistos = new Set<number>();
  return lista.filter((x) => {
    if (vistos.has(x.id)) return false;
    vistos.add(x.id);
    return true;
  });
}
