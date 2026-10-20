/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · optimizador, fin del día e insumo de movilización
 * Archivo: optimizacion-transporte.service.ts
 * Responsabilidad: Proponer y confirmar «Cubrir al máximo», pedir priorización y cerrar el día.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ORQUESTA LO QUE DECIDEN LAS FUNCIONES PURAS. La lógica vive en `politicas/optimizador-transporte`,
 * `politicas/guarda-final` y `politicas/hoja-ruta`; aquí solo se leen los datos EN LOTE (los mismos
 * que la asignación a mano, `PlanificacionTransporteService.datosDelDia`) y se escriben las
 * decisiones confirmadas.
 *
 * LA PROPUESTA NO GUARDA ASIGNACIONES. Antes de proponer se GENERAN los tramos que falten (lo mismo
 * que «Generar tramos», idempotente): sin tramos no hay qué proponer. Al CONFIRMAR, cada asignación
 * se RE-EVALÚA contra el estado del momento (alguien pudo asignar a mano entre medias); las que ya no
 * sean viables se omiten y se informan.
 *
 * LA ORDEN DE MOVILIZACIÓN OFICIAL (con número, Art. 5) la emite el sistema de órdenes de
 * movilización de la DAF (decisión del usuario, 2026-10-06). Aquí solo se arma su INSUMO.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { AccionAuditoria, TipoTramo, TurnoConductor } from '@prisma/client';
import type {
  Content,
  TableCell,
  TDocumentDefinitions,
} from 'pdfmake/interfaces';

import {
  AuditoriaService,
  type DatosAuditoria,
} from '../../../common/auditoria/auditoria.service';
import {
  ejecutarConContexto,
  obtenerContexto,
} from '../../../common/contexto/contexto-peticion';
import {
  RecursoNoEncontradoError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import {
  generarDocumento,
  HAY_LOGOTIPO,
  RUTA_LOGOTIPO,
} from '../../documentos/application/motor-documento';
import type { Autor } from '../../operativos/application/operativos.service';
import { SolicitudApoyoService } from '../../operativos/application/solicitud-apoyo.service';
import {
  PlanificacionTransporteRepository,
  type OperativoDePlanificacion,
  type TramoCompleto,
} from '../infrastructure/planificacion-transporte.repository';
import { DestinoVehiculoService } from './destino-vehiculo.service';
import { ParametrosTransporteService } from './parametros-transporte.service';
import {
  PlanificacionTransporteService,
  type DatosDelDia,
} from './planificacion-transporte.service';
import { actaVigente } from './politicas/acta-parqueadero';
import {
  encajarEnUnidad,
  type TramoDeLaUnidad,
} from './politicas/compartir-tramo';
import type {
  ConductorEvaluado,
  Motivo,
} from './politicas/asignacion-conductor.policy';
import {
  sugerirGuarda,
  type Garaje,
  type GuardaSugerida,
} from './politicas/guarda-final';
import {
  nombreTipoTramo,
  ordenarHojaRuta,
  type FilaHojaRuta,
} from './politicas/hoja-ruta';
import {
  franjaDe,
  MINUTOS_DIA,
  minutoDeJornada,
  seSolapan,
} from './politicas/linea-de-tiempo';
import { nombreDeUnidad } from './politicas/nombre-unidad';
import {
  MOTIVO_VEHICULO_EXCLUSIVO,
  optimizar,
  type BloqueOptimizable,
  type ConductorOptimizable,
  type TramoFijo,
} from './politicas/optimizador-transporte';
import {
  sugerirLibres,
  type SugerenciaLibres,
} from './politicas/sugerencia-libres';

/** Lo que el front confirma (lo mismo que devolvió la propuesta, quizá recortado). */
export interface PropuestaAConfirmar {
  asignaciones: {
    tramoIds: number[];
    conductorId: number;
    vehiculoId: number | null;
  }[];
  activaciones: { conductorId: number; motivo: string }[];
  compartidos: { tramoId: number; compartidoConTramoId: number }[];
  /** La estrategia de la propuesta, solo para la traza (2026-10-14). */
  estrategia?: string | null;
}

export interface ResultadoConfirmacion {
  /**
   * La correlación de ESTA confirmación (2026-10-14): todas sus filas de `t_auditoria` —una por
   * tramo asignado, compartido o libre activado, más el resumen y la sincronización de cada
   * operativo— la llevan, así que el historial la reconstruye entera.
   */
  correlacionId: string;
  aplicadas: number;
  omitidas: { tramoIds: number[]; conductorId: number; motivo: string }[];
  activados: number[];
  compartidos: number;
  compartidosOmitidos: { tramoId: number; motivo: string }[];
}

/** Una guarda del fin del día, tal como se declara. */
export interface GuardaDeclarada {
  vehiculoId: number;
  tipo: 'GARAJE' | 'DOMICILIO' | 'TALLER';
  ubicacionId: number | null;
  conductorId: number | null;
  observacion?: string | null;
  /** N.º de acta (DOMICILIO, 2026-10-08): se valida contra el acta vigente del conductor. */
  actaNumero?: string | null;
}

export const LEYENDA_MOVILIZACION =
  'La orden de movilización oficial y su número se emiten en el sistema de órdenes de movilización.';

const VENTANAS: TurnoConductor[] = ['DIA', 'NOCHE', 'ECU_NOCHE'];

@Injectable()
export class OptimizacionTransporteService {
  constructor(
    private readonly planificacion: PlanificacionTransporteService,
    private readonly repositorio: PlanificacionTransporteRepository,
    private readonly parametros: ParametrosTransporteService,
    private readonly destinos: DestinoVehiculoService,
    private readonly solicitudes: SolicitudApoyoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ─────────────────────────── Optimizador ───────────────────────────

  /** «Cubrir al máximo»: propuesta del día. NO guarda asignaciones (sí genera los tramos que falten). */
  async proponer(
    fecha: Date,
    opciones: { activarLibres: boolean; compartirCarro: boolean },
    autor: Autor,
  ) {
    await this.planificacion.generarTramosDelDia(fecha, autor);
    const [dia, operativos, extra] = await Promise.all([
      this.planificacion.datosDelDia(fecha),
      this.repositorio.operativosDeFecha(fecha),
      this.parametros.leerOptimizacion(),
    ]);
    const entrada = this.entradaDe(
      dia,
      operativos,
      fecha,
      opciones,
      extra.compartirVentanaMin,
    );
    const propuesta = optimizar(entrada);
    const nombres = new Map(
      dia.conductores.map((c) => [c.id, c.nombreCompleto]),
    );
    const placas = new Map(dia.vehiculos.map((v) => [v.id, v.placa]));
    const identificadores = new Map(
      operativos.map((o) => [o.id, o.identificador]),
    );

    return {
      estrategia: propuesta.estrategia,
      cubiertos: propuesta.cubiertos,
      total: propuesta.total,
      asignaciones: propuesta.asignaciones.map((a) => ({
        tramoIds: a.tramoIds,
        operativoIds: a.operativoIds,
        identificadores: a.operativoIds.map(
          (id) => identificadores.get(id) ?? '',
        ),
        conductorId: a.conductorId,
        conductor: nombres.get(a.conductorId) ?? '',
        vehiculoId: a.vehiculoId,
        placa:
          a.vehiculoId === null ? null : (placas.get(a.vehiculoId) ?? null),
        avisos: a.avisos,
      })),
      activaciones: propuesta.activaciones.map((a) => ({
        ...a,
        conductor: nombres.get(a.conductorId) ?? '',
      })),
      compartidos: propuesta.compartidos,
      sinRecurso: propuesta.sinRecurso.flatMap<{
        operativoId: number | null;
        identificador: string | null;
        tramoIds: number[];
        motivo: string;
      }>((s) =>
        s.operativoIds.length > 0
          ? s.operativoIds.map((operativoId) => ({
              operativoId,
              identificador: identificadores.get(operativoId) ?? '',
              tramoIds: s.tramoIds,
              motivo: s.motivo,
            }))
          : [
              {
                operativoId: null,
                identificador: null,
                tramoIds: s.tramoIds,
                motivo: s.motivo,
              },
            ],
      ),
      avisos: propuesta.avisos,
    };
  }

  /**
   * SIMULACIÓN (2026-10-08, «Planificar el día», paso 2): corre el optimizador puro EN MEMORIA dos
   * veces —sin libres y con libres— sobre los tramos que YA existen, y dice si con libres se
   * cubrirían más operativos y con quiénes. NO genera tramos, NO audita y NO escribe nada: un
   * operativo que aún no tiene tramos no cuenta (los tramos se generan al primer «Asignar» o al
   * proponer).
   */
  async simular(
    fecha: Date,
    opciones: { compartirCarro: boolean },
  ): Promise<{
    simulacion: true;
    total: number;
    cubiertosSinLibres: number;
    cubiertosConLibres: number;
    sugerencia: SugerenciaLibres;
  }> {
    const [dia, operativos, extra] = await Promise.all([
      this.planificacion.datosDelDia(fecha),
      this.repositorio.operativosDeFecha(fecha),
      this.parametros.leerOptimizacion(),
    ]);
    const correr = (activarLibres: boolean) =>
      optimizar(
        this.entradaDe(
          dia,
          operativos,
          fecha,
          { activarLibres, compartirCarro: opciones.compartirCarro },
          extra.compartirVentanaMin,
        ),
      );
    const sinLibres = correr(false);
    const conLibres = correr(true);
    return {
      simulacion: true,
      total: sinLibres.total,
      cubiertosSinLibres: sinLibres.cubiertos,
      cubiertosConLibres: conLibres.cubiertos,
      sugerencia: sugerirLibres(
        sinLibres,
        conLibres,
        new Map(dia.conductores.map((c) => [c.id, c.nombreCompleto])),
      ),
    };
  }

  /**
   * Aplica la propuesta en UNA transacción, re-evaluando cada asignación contra el estado actual
   * (y lo ya aplicado en esta misma confirmación). Lo que ya no sea viable se omite e informa.
   *
   * TRAZABILIDAD (2026-10-14). Toda la confirmación corre con una correlación PROPIA, que se
   * devuelve: el historial guarda una fila por tramo asignado, compartido o libre activado —con el
   * conductor y la placa de antes y de después— y un resumen con la estrategia y cada omitida con
   * su motivo. Antes quedaba una sola fila con los totales.
   */
  async confirmar(
    fecha: Date,
    propuesta: PropuestaAConfirmar,
    autor: Autor,
  ): Promise<ResultadoConfirmacion> {
    const correlacionId = randomUUID();
    const contexto = obtenerContexto();
    return ejecutarConContexto(
      {
        metodo: contexto?.metodo ?? 'POST',
        ruta: contexto?.ruta ?? '/transporte/optimizar/confirmar',
        usuarioId: contexto?.usuarioId,
        rol: contexto?.rol,
        correlacionId,
      },
      () => this.confirmarCon(correlacionId, fecha, propuesta, autor),
    );
  }

  private async confirmarCon(
    correlacionId: string,
    fecha: Date,
    propuesta: PropuestaAConfirmar,
    autor: Autor,
  ): Promise<ResultadoConfirmacion> {
    const [dia, operativos, extra] = await Promise.all([
      this.planificacion.datosDelDia(fecha),
      this.repositorio.operativosDeFecha(fecha),
      this.parametros.leerOptimizacion(),
    ]);
    const personasDe = new Map(
      operativos.map((o) => [o.id, o.personal.map((p) => p.funcionarioId)]),
    );
    const operativoPorId = new Map(operativos.map((o) => [o.id, o]));
    const porId = new Map(dia.tramosHoy.map((t) => [t.id, t]));

    // Activaciones primero: un libre activado ya puede tomar sus bloques.
    const activados: number[] = [];
    for (const a of propuesta.activaciones) {
      const conductor = dia.conductores.find((c) => c.id === a.conductorId);
      if (!conductor || dia.activados.has(a.conductorId)) continue;
      if (dia.turnos.get(a.conductorId) !== TurnoConductor.LIBRE) continue;
      dia.activados.add(a.conductorId);
      activados.push(a.conductorId);
    }

    const aplicadas: {
      ids: number[];
      conductorId: number;
      vehiculoId: number | null;
    }[] = [];
    // Conductor y placa ANTES de esta confirmación, para la traza (en memoria se van pisando).
    const antes = new Map(
      dia.tramosHoy.map((t) => [
        t.id,
        { conductorId: t.conductorId, vehiculoId: t.vehiculoId },
      ]),
    );
    const omitidas: ResultadoConfirmacion['omitidas'] = [];
    for (const a of propuesta.asignaciones) {
      const tramos = a.tramoIds.map((id) => porId.get(id));
      if (
        tramos.length === 0 ||
        tramos.some((t) => !t || t.conductorId !== null)
      ) {
        omitidas.push({
          tramoIds: a.tramoIds,
          conductorId: a.conductorId,
          motivo:
            'Algún tramo ya no está pendiente (se asignó o se borró entre medias).',
        });
        continue;
      }
      const conductor = dia.conductores.find((c) => c.id === a.conductorId);
      if (!conductor) {
        omitidas.push({
          tramoIds: a.tramoIds,
          conductorId: a.conductorId,
          motivo: 'El conductor ya no está activo.',
        });
        continue;
      }
      const lista = tramos as TramoCompleto[];
      const esTarea = lista.every((t) => t.tipo === TipoTramo.TAREA);
      const personas = new Set<number>();
      lista.forEach((t) =>
        (personasDe.get(t.operativoId ?? -1) ?? []).forEach((p) =>
          personas.add(p),
        ),
      );
      const vehiculoId = esTarea ? lista[0].vehiculoId : a.vehiculoId;
      const operativosDelBloque = [...new Set(lista.map((t) => t.operativoId))]
        .map((id) => (id === null ? undefined : operativoPorId.get(id)))
        .filter((o): o is OperativoDePlanificacion => o !== undefined);
      const evaluacion = this.planificacion.evaluarConductor(
        conductor,
        vehiculoId,
        {
          tramos: lista.map((t) =>
            this.planificacion.tramoEvaluado(t, dia.parametros.inicioJornada),
          ),
          personas: personas.size,
          esTareaTaller: esTarea,
          conduccion: esTarea
            ? undefined
            : this.planificacion.conduccionDe(operativosDelBloque),
        },
        new Set(a.tramoIds),
        fecha,
        dia,
      );
      const choque =
        vehiculoId === null
          ? undefined
          : this.placaOcupada(vehiculoId, a.conductorId, lista, dia);
      if (evaluacion.estado === 'DURO' || choque) {
        omitidas.push({
          tramoIds: a.tramoIds,
          conductorId: a.conductorId,
          motivo: choque
            ? `La placa ya está con otro conductor de ${choque.horaInicio} a ${choque.horaFin}.`
            : evaluacion.motivos
                .filter((m) => m.tipo === 'DURO')
                .map((m) => m.mensaje)
                .join(' '),
        });
        continue;
      }
      // Se refleja en memoria para que la siguiente asignación se evalúe con esta ya puesta.
      for (const t of lista) {
        t.conductorId = a.conductorId;
        t.vehiculoId = vehiculoId;
      }
      aplicadas.push({
        ids: a.tramoIds,
        conductorId: a.conductorId,
        vehiculoId,
      });
    }

    const compartidos: { tramoId: number; anfitrion: TramoCompleto }[] = [];
    const compartidosOmitidos: ResultadoConfirmacion['compartidosOmitidos'] =
      [];
    for (const c of propuesta.compartidos) {
      const tramo = porId.get(c.tramoId);
      const anfitrion = porId.get(c.compartidoConTramoId);
      if (!tramo || tramo.conductorId !== null) {
        compartidosOmitidos.push({
          tramoId: c.tramoId,
          motivo: 'El tramo ya no está pendiente.',
        });
        continue;
      }
      if (!anfitrion || anfitrion.conductorId === null) {
        compartidosOmitidos.push({
          tramoId: c.tramoId,
          motivo: 'El tramo con el que iba a compartir ya no tiene conductor.',
        });
        continue;
      }
      // Macrooperativo (2026-10-07): pide vehículo EXCLUSIVO. El servidor no confía en el par que
      // manda el cliente: si alguno de los dos lo es, no se comparte.
      if (
        tramo.operativo?.esMacrooperativo === true ||
        anfitrion.operativo?.esMacrooperativo === true
      ) {
        compartidosOmitidos.push({
          tramoId: c.tramoId,
          motivo: MOTIVO_VEHICULO_EXCLUSIVO,
        });
        continue;
      }
      // Compartir unidad (2026-10-19): el servidor tampoco confía en que el par sea compatible.
      // La MISMA regla pura que el optimizador y la DAF a mano (`encajarEnUnidad`, 2026-10-21), con
      // los asientos de cada momento y lo que ya viaja en la unidad (también lo compartido en
      // esta misma confirmación, que se refleja en memoria).
      const veredicto = this.compatibleAlConfirmar(
        tramo,
        anfitrion,
        dia,
        personasDe,
        operativoPorId,
        extra.compartirVentanaMin,
      );
      if (!veredicto.compatible) {
        compartidosOmitidos.push({
          tramoId: c.tramoId,
          motivo: veredicto.motivo,
        });
        continue;
      }
      const raiz = porId.get(veredicto.raizId) ?? anfitrion;
      tramo.conductorId = raiz.conductorId;
      tramo.vehiculoId = raiz.vehiculoId;
      tramo.compartidoConTramoId = raiz.id;
      compartidos.push({ tramoId: c.tramoId, anfitrion: raiz });
    }

    // Se escribe también si TODO se omitió: el resumen con los motivos es justamente lo que queda.
    const hayAlgo =
      activados.length +
        aplicadas.length +
        compartidos.length +
        omitidas.length +
        compartidosOmitidos.length >
      0;
    if (hayAlgo) {
      await this.repositorio.ejecutarEnTransaccion(async (cliente) => {
        const trazas: DatosAuditoria[] = [];
        const traza = (
          entidad: string,
          entidadId: number,
          cambios: DatosAuditoria['cambios'],
          operativoId?: number | null,
        ) =>
          trazas.push({
            entidad,
            entidadId,
            accion: AccionAuditoria.ACTUALIZAR,
            operativoId: operativoId ?? undefined,
            cambios,
            usuario: autor.usuarioId,
            rol: autor.rol,
          });
        const comoTexto = (valor: number | null | undefined): string =>
          valor === null || valor === undefined ? '' : String(valor);

        for (const conductorId of activados) {
          const motivo =
            propuesta.activaciones
              .find((a) => a.conductorId === conductorId)
              ?.motivo?.trim() || 'Activado al confirmar «Cubrir al máximo».';
          const fila = await this.repositorio.activar(
            conductorId,
            fecha,
            motivo,
            autor.usuarioId,
            cliente,
          );
          trazas.push({
            entidad: 't_activacion_conductor',
            entidadId: fila.id,
            accion: AccionAuditoria.CREAR,
            cambios: [
              { campo: 'cond_id', valorNuevo: String(conductorId) },
              { campo: 'acco_motivo', valorNuevo: motivo },
            ],
            usuario: autor.usuarioId,
            rol: autor.rol,
          });
        }
        for (const a of aplicadas) {
          await this.repositorio.asignarTramos(
            a.ids,
            a.conductorId,
            a.vehiculoId,
            cliente,
          );
          for (const id of a.ids) {
            const previo = antes.get(id);
            traza(
              't_tramo_transporte',
              id,
              [
                {
                  campo: 'cond_id',
                  valorAnterior: comoTexto(previo?.conductorId),
                  valorNuevo: String(a.conductorId),
                },
                {
                  campo: 'vehi_id',
                  valorAnterior: comoTexto(previo?.vehiculoId),
                  valorNuevo: comoTexto(a.vehiculoId),
                },
              ],
              porId.get(id)?.operativoId,
            );
          }
        }
        for (const c of compartidos) {
          await this.repositorio.compartirTramo(
            c.tramoId,
            {
              id: c.anfitrion.id,
              conductorId: c.anfitrion.conductorId as number,
              vehiculoId: c.anfitrion.vehiculoId,
            },
            cliente,
          );
          traza(
            't_tramo_transporte',
            c.tramoId,
            [
              {
                campo: 'trtr_compartido_con_id',
                valorNuevo: String(c.anfitrion.id),
              },
              {
                campo: 'cond_id',
                valorAnterior: comoTexto(antes.get(c.tramoId)?.conductorId),
                valorNuevo: comoTexto(c.anfitrion.conductorId),
              },
              {
                campo: 'vehi_id',
                valorAnterior: comoTexto(antes.get(c.tramoId)?.vehiculoId),
                valorNuevo: comoTexto(c.anfitrion.vehiculoId),
              },
            ],
            porId.get(c.tramoId)?.operativoId,
          );
        }
        // El RESUMEN de la confirmación: qué estrategia, cuánto se aplicó y qué se omitió y por qué.
        traza('t_tramo_transporte', 0, [
          {
            campo: 'optimizador_estrategia',
            valorNuevo: propuesta.estrategia?.trim() || 'sin indicar',
          },
          {
            campo: 'optimizador_asignaciones',
            valorNuevo: String(aplicadas.length),
          },
          {
            campo: 'optimizador_compartidos',
            valorNuevo: String(compartidos.length),
          },
          {
            campo: 'optimizador_activados',
            valorNuevo: activados.join(','),
          },
          {
            campo: 'optimizador_omitidas',
            valorNuevo: String(omitidas.length + compartidosOmitidos.length),
          },
          ...omitidas.map((o) => ({
            campo: 'optimizador_omitida',
            valorNuevo: `Tramos ${o.tramoIds.join(',')} · conductor ${o.conductorId}: ${o.motivo}`,
          })),
          ...compartidosOmitidos.map((o) => ({
            campo: 'optimizador_omitida',
            valorNuevo: `Compartir el tramo ${o.tramoId}: ${o.motivo}`,
          })),
        ]);
        await this.auditoria.registrarVarios(trazas, cliente);
      });
    }

    // Regla 10: el operativo refleja su primer tramo asignado (fuera de la transacción, idempotente).
    const operativosTocados = new Set<number>();
    for (const id of [
      ...aplicadas.flatMap((a) => a.ids),
      ...compartidos.map((c) => c.tramoId),
    ]) {
      const operativoId = porId.get(id)?.operativoId;
      if (operativoId) operativosTocados.add(operativoId);
    }
    if (operativosTocados.size > 0)
      await this.planificacion.sincronizarOperativos(
        [...operativosTocados],
        autor,
      );

    return {
      correlacionId,
      aplicadas: aplicadas.length,
      omitidas,
      activados,
      compartidos: compartidos.length,
      compartidosOmitidos,
    };
  }

  /** «Pedir priorización» para un operativo sin recurso: solicitud a quien lo registró. */
  async pedirPriorizacion(
    operativoId: number,
    opciones: readonly string[],
    motivo: string | null,
    autor: Autor,
  ) {
    const { solicitud, creada } = await this.solicitudes.solicitarPriorizacion(
      operativoId,
      opciones,
      motivo,
      autor,
    );
    return {
      solicitudId: solicitud.id,
      creada,
      rolRequerido: solicitud.rolRequerido,
      estado: solicitud.estado,
      observacion: solicitud.observacion,
    };
  }

  // ─────────────────────────── Fin del día ───────────────────────────

  /** Sugerencia de guarda final por vehículo con tramos ese día (puntos 17 y 18). */
  async finDelDia(fecha: Date) {
    const manana = new Date(fecha.getTime() + MINUTOS_DIA * 60_000);
    const [dia, extra, garajesFilas, turnosManana, tramosManana, declaradas] =
      await Promise.all([
        this.planificacion.datosDelDia(fecha),
        this.parametros.leerOptimizacion(),
        this.repositorio.garajesAutorizados(),
        this.repositorio.turnosPublicadosEnRango(manana, manana),
        this.repositorio.tramosDeFecha(manana),
        this.repositorio.destinosDe(fecha),
      ]);
    const inicio = dia.parametros.inicioJornada;
    const garajes: Garaje[] = garajesFilas.map((g) => ({
      ubicacionId: g.id,
      nombre: g.nombre,
      // Un garaje sin zonal (p. ej. «Matriz», 2026-10-06) es un lugar conocido sin sector: los
      // traslados hacia él usan la regla de otro sector, no 0.
      lugar: g.zonal
        ? { zonalId: g.zonal.id, sector: g.zonal.sector }
        : { zonalId: null, sector: null, sinSector: true },
    }));
    const trabajaManana = new Set(
      turnosManana
        .filter((t) => t.turno !== TurnoConductor.LIBRE)
        .map((t) => t.conductorId),
    );
    const saleManana = new Set(
      tramosManana
        .filter((t) => t.vehiculoId !== null)
        .map((t) => t.vehiculoId as number),
    );

    const porVehiculo = new Map<number, TramoCompleto[]>();
    for (const t of dia.tramosHoy) {
      if (t.vehiculoId === null || t.conductorId === null) continue;
      const lista = porVehiculo.get(t.vehiculoId) ?? [];
      lista.push(t);
      porVehiculo.set(t.vehiculoId, lista);
    }

    const sugerencias: (GuardaSugerida & {
      declarada: {
        tipo: string | null;
        ubicacion: string | null;
        ubicacionId: number | null;
        conductorId: number | null;
        actaNumero: string | null;
      } | null;
      avisoCombustible: boolean;
      /** Nombre del conductor del último tramo (2026-10-08, paso 3 de «Planificar el día»). */
      conductor: string | null;
      /** «Último operativo: ID · termina 17H00 en Centro». */
      ultimoOperativo: {
        identificador: string | null;
        horaFin: string;
        lugar: string | null;
      };
      /** Si el conductor puede dejarlo en su domicilio (Art. 8). El número de acta NO viaja. */
      parqueadero: { autorizado: boolean; actaVigente: boolean };
    })[] = [];
    for (const [vehiculoId, tramos] of porVehiculo) {
      const ultimo = [...tramos].sort(
        (a, b) =>
          franjaDe(b.horaInicio, b.horaFin, inicio).fin -
          franjaDe(a.horaInicio, a.horaFin, inicio).fin,
      )[0];
      const conductor = dia.conductores.find(
        (c) => c.id === ultimo.conductorId,
      );
      const vehiculo = dia.vehiculos.find((v) => v.id === vehiculoId);
      const destino = ultimo.zonalDestino ?? ultimo.zonalOrigen;
      const sugerida = sugerirGuarda(
        {
          vehiculoId,
          placa: vehiculo?.placa ?? '',
          ultimoFin: franjaDe(ultimo.horaInicio, ultimo.horaFin, inicio).fin,
          ultimoPunto: destino
            ? { zonalId: destino.id, sector: destino.sector }
            : null,
          conductor: conductor
            ? {
                id: conductor.id,
                nombre: conductor.nombreCompleto,
                sector: conductor.sector,
                actaVigente: actaVigente(conductor, fecha),
              }
            : null,
          conductorTrabajaManana: conductor
            ? trabajaManana.has(conductor.id)
            : false,
        },
        garajes,
        {
          horaTarde: minutoDeJornada(extra.guardaHoraTarde, inicio),
          tabla: dia.asignacion.tablaTraslados,
          traslado: dia.asignacion.traslado,
        },
      );
      const yaDeclarada = declaradas.find((d) => d.vehiculoId === vehiculoId);
      sugerencias.push({
        ...sugerida,
        declarada: yaDeclarada
          ? {
              tipo:
                yaDeclarada.tipo ??
                (yaDeclarada.domicilio ? 'DOMICILIO' : 'GARAJE'),
              ubicacion: yaDeclarada.ubicacion?.nombre ?? null,
              ubicacionId: yaDeclarada.ubicacion?.id ?? null,
              conductorId: yaDeclarada.conductorId,
              actaNumero: yaDeclarada.actaNumero ?? null,
            }
          : null,
        avisoCombustible:
          saleManana.has(vehiculoId) ||
          sugerida.continuidad.includes('mismo conductor'),
        conductor: conductor?.nombreCompleto ?? null,
        ultimoOperativo: {
          identificador:
            ultimo.operativo?.identificador ?? ultimo.descripcion ?? null,
          horaFin: ultimo.horaFin,
          lugar: destino?.nombre ?? null,
        },
        parqueadero: {
          autorizado: conductor?.parqueaderoAutorizado ?? false,
          actaVigente: conductor ? actaVigente(conductor, fecha) : false,
        },
      });
    }
    return sugerencias.sort((a, b) => a.placa.localeCompare(b.placa));
  }

  /**
   * Declara la guarda final de cada vehículo. Cada una pasa por `DestinoVehiculoService` (que exige
   * acta vigente para DOMICILIO): una que falle no impide las demás y se informa.
   */
  async guardarFinDelDia(
    fecha: Date,
    guardas: readonly GuardaDeclarada[],
    usuarioId: number,
  ): Promise<{
    guardadas: number;
    errores: { vehiculoId: number; motivo: string }[];
  }> {
    let guardadas = 0;
    const errores: { vehiculoId: number; motivo: string }[] = [];
    for (const g of guardas) {
      try {
        await this.destinos.declarar(
          g.vehiculoId,
          fecha,
          {
            tipo: g.tipo,
            domicilio: g.tipo === 'DOMICILIO',
            ubicacionId: g.tipo === 'DOMICILIO' ? null : g.ubicacionId,
            conductorId: g.conductorId ?? undefined,
            observacion: g.observacion ?? null,
            actaNumero: g.actaNumero ?? null,
            exigirNumeroActa: g.tipo === 'DOMICILIO',
          },
          usuarioId,
        );
        guardadas += 1;
      } catch (error) {
        if (
          error instanceof ValidacionError ||
          error instanceof RecursoNoEncontradoError
        ) {
          errores.push({ vehiculoId: g.vehiculoId, motivo: error.message });
        } else {
          throw error;
        }
      }
    }
    return { guardadas, errores };
  }

  // ─────────────────────────── Insumo de la orden de movilización ───────────────────────────

  /** La hoja de ruta de un vehículo en un día: sus tramos en orden y la guarda final. */
  async hojaRuta(fecha: Date, vehiculoId: number) {
    const [vehiculo, tramos, parametros, destinos] = await Promise.all([
      this.repositorio.buscarVehiculo(vehiculoId),
      this.repositorio.tramosDeVehiculo(vehiculoId, fecha),
      this.parametros.leer(),
      this.repositorio.destinosDe(fecha),
    ]);
    if (!vehiculo) {
      throw new RecursoNoEncontradoError('El vehículo indicado no existe.', {
        vehiculoId,
      });
    }
    const filas = ordenarHojaRuta(
      tramos
        .filter((t) => t.conductorId !== null)
        .map((t) => ({
          id: t.id,
          tipo: t.tipo,
          horaInicio: t.horaInicio,
          horaFin: t.horaFin,
          identificador: t.operativo?.identificador ?? null,
          descripcion: t.descripcion,
          conductor: t.conductor?.nombreCompleto ?? null,
          origen: t.zonalOrigen?.nombre ?? null,
          destino: t.zonalDestino?.nombre ?? t.zonalOrigen?.nombre ?? null,
          unidad: nombreDeUnidad(t.operativo?.creadoPorRol),
          unidadCodigo: t.operativo?.creadoPorRol ?? null,
        })),
      parametros.inicioJornada,
    );
    const guarda = destinos.find((d) => d.vehiculoId === vehiculoId);
    return {
      fecha: fecha.toISOString().slice(0, 10),
      vehiculo: { id: vehiculo.id, placa: vehiculo.placa, tipo: vehiculo.tipo },
      conductores: [
        ...new Set(
          filas.map((f) => f.conductor).filter((c): c is string => !!c),
        ),
      ],
      tramos: filas,
      guardaFinal: guarda
        ? {
            tipo: guarda.tipo ?? (guarda.domicilio ? 'DOMICILIO' : 'GARAJE'),
            lugar: guarda.domicilio
              ? 'Domicilio del conductor (acta de parqueadero)'
              : (guarda.ubicacion?.nombre ?? null),
            observacion: guarda.observacion,
          }
        : null,
      leyenda: LEYENDA_MOVILIZACION,
    };
  }

  async hojaRutaPdf(fecha: Date, vehiculoId: number): Promise<Buffer> {
    const datos = await this.hojaRuta(fecha, vehiculoId);
    return generarDocumento(definicionHojaRuta(datos));
  }

  // ─────────────────────────── Apoyo ───────────────────────────

  private entradaDe(
    dia: DatosDelDia,
    operativos: OperativoDePlanificacion[],
    fecha: Date,
    opciones: { activarLibres: boolean; compartirCarro: boolean },
    compartirVentanaMin: number,
  ) {
    const inicio = dia.parametros.inicioJornada;
    const porOperativo = new Map(operativos.map((o) => [o.id, o]));
    const personasDe = (ids: number[]): number => {
      const set = new Set<number>();
      ids.forEach((id) =>
        porOperativo.get(id)?.personal.forEach((p) => set.add(p.funcionarioId)),
      );
      return set.size;
    };
    const esMacro = (ids: number[]): boolean =>
      ids.some((id) => porOperativo.get(id)?.esMacrooperativo);
    const puntoDe = (operativoId: number | null): number | null =>
      operativoId === null
        ? null
        : (porOperativo.get(operativoId)?.puntoEncuentroId ?? null);

    const pendientes = dia.tramosHoy.filter((t) => t.conductorId === null);
    const fijosFilas = dia.tramosHoy.filter((t) => t.conductorId !== null);
    const bloques: BloqueOptimizable[] = [];

    this.planificacion
      .bloquesDe(operativos, inicio)
      .forEach((cadena, indice) => {
        const ids = new Set(cadena.operativoIds);
        const tramos = pendientes
          .filter((t) => t.operativoId !== null && ids.has(t.operativoId))
          .sort(
            (a, b) =>
              franjaDe(a.horaInicio, a.horaFin, inicio).inicio -
              franjaDe(b.horaInicio, b.horaFin, inicio).inicio,
          );
        if (tramos.length === 0) return;
        const operativoIds = [
          ...new Set(tramos.map((t) => t.operativoId as number)),
        ];
        const conduccion = this.planificacion.conduccionDe(
          operativoIds
            .map((id) => porOperativo.get(id))
            .filter((o): o is OperativoDePlanificacion => o !== undefined),
        );
        const restricciones = new Map(
          dia.conductores
            .map(
              (c) =>
                [
                  c.id,
                  this.planificacion.restriccionesDe(dia, c.id, conduccion),
                ] as const,
            )
            .filter(([, motivos]) => motivos.length > 0),
        );
        bloques.push({
          clave: `c${indice}`,
          tramoIds: tramos.map((t) => t.id),
          tramos: tramos.map((t) =>
            this.planificacion.tramoEvaluado(t, inicio),
          ),
          tipos: tramos.map((t) => t.tipo),
          operativoIds,
          personas: personasDe(operativoIds),
          esMacrooperativo: esMacro(operativoIds),
          esTareaTaller: false,
          vehiculoFijoId: null,
          restricciones,
          // Compartir unidad (2026-10-19): el pedido de quien registró, si alguno lo hizo.
          compartirConOperativoId:
            operativoIds
              .map((id) => porOperativo.get(id)?.compartirConId ?? null)
              .find((id) => id !== null) ?? null,
          // El «completo» deja y retira en su punto (2026-10-21): el punto de cada tramo.
          puntoIds: tramos.map((t) => puntoDe(t.operativoId)),
        });
      });
    for (const t of pendientes.filter((p) => p.operativoId === null)) {
      bloques.push({
        clave: `t${t.id}`,
        tramoIds: [t.id],
        tramos: [this.planificacion.tramoEvaluado(t, inicio)],
        tipos: [t.tipo],
        operativoIds: [],
        personas: 0,
        esMacrooperativo: false,
        esTareaTaller: true,
        vehiculoFijoId: t.vehiculoId,
      });
    }

    const fijos: TramoFijo[] = fijosFilas.map((t) => ({
      tramoId: t.id,
      operativoId: t.operativoId,
      conductorId: t.conductorId as number,
      vehiculoId: t.vehiculoId,
      tramo: this.planificacion.tramoEvaluado(t, inicio),
      tipo: t.tipo,
      personas: t.operativoId === null ? 0 : personasDe([t.operativoId]),
      esMacrooperativo:
        t.operativoId === null ? false : esMacro([t.operativoId]),
      puntoId: puntoDe(t.operativoId),
      compartidoConTramoId: t.compartidoConTramoId ?? null,
    }));

    const conTramos = new Set(
      dia.tramosHoy
        .filter((t) => t.operativoId !== null)
        .map((t) => t.operativoId as number),
    );
    const conPendientes = new Set(
      pendientes
        .filter((t) => t.operativoId !== null)
        .map((t) => t.operativoId as number),
    );
    const yaCubiertos = [...conTramos].filter(
      (id) => !conPendientes.has(id),
    ).length;

    const llevado = new Map<number, number>();
    for (const [vehiculoId, conductorId] of dia.llevadoPor)
      llevado.set(conductorId, vehiculoId);

    const conductores: ConductorOptimizable[] = dia.conductores.map((c) => {
      const turno = dia.turnos.get(c.id) ?? null;
      const conductor: ConductorEvaluado = {
        id: c.id,
        nombre: c.nombreCompleto,
        tipoContrato:
          (c.tipoContrato as ConductorEvaluado['tipoContrato']) ?? null,
        turno,
        activado: dia.activados.has(c.id),
        ausente: dia.ausentes.has(c.id),
        ultimoFinAyer: this.planificacion.ultimoFinAyer(c.id, dia),
      };
      return {
        conductor,
        ventanaTurno:
          turno && VENTANAS.includes(turno)
            ? dia.parametros.ventanasTurno[
                turno as 'DIA' | 'NOCHE' | 'ECU_NOCHE'
              ]
            : null,
        vehiculoLlevadoId: llevado.get(c.id) ?? null,
        vehiculoHabitualId: c.vehiculoHabitualId,
      };
    });

    return {
      bloques,
      conductores,
      vehiculos: dia.vehiculos.map((v) => ({
        id: v.id,
        asientos: v.asientos,
        enTaller: dia.enTaller.has(v.id),
        amaneceEn: dia.amaneceEn.get(v.id) ?? null,
      })),
      fijos,
      contexto: {
        esFinDeSemana: [0, 6].includes(fecha.getUTCDay()),
        ventanaNombramiento: dia.parametros.ventanaNombramiento,
      },
      parametros: { ...dia.asignacion, compartirVentanaMin },
      opciones,
      operativosYaCubiertos: yaCubiertos,
    };
  }

  /**
   * ¿Puede el tramo viajar en la unidad del anfitrión (su conductor con su placa)? La regla única
   * `encajarEnUnidad` (2026-10-21) contra TODO lo que esa unidad hace hoy —lo ya asignado y lo
   * aplicado antes en esta confirmación—, con los asientos de cada momento: un dejar del mismo tipo
   * que el anfitrión, o un dejar o retirar dentro de su «completo». Devuelve la raíz del grupo al que
   * entra, o el motivo.
   */
  private compatibleAlConfirmar(
    tramo: TramoCompleto,
    anfitrion: TramoCompleto,
    dia: DatosDelDia,
    personasDe: Map<number, number[]>,
    operativoPorId: Map<number, OperativoDePlanificacion>,
    ventanaMin: number,
  ):
    | { compatible: true; raizId: number }
    | { compatible: false; motivo: string } {
    const inicio = dia.parametros.inicioJornada;
    const comoPura = (t: TramoCompleto): TramoDeLaUnidad => {
      const franja = franjaDe(t.horaInicio, t.horaFin, inicio);
      const operativo =
        t.operativoId === null ? undefined : operativoPorId.get(t.operativoId);
      return {
        id: t.id,
        tipo: t.tipo,
        inicio: franja.inicio,
        fin: franja.fin,
        origen: t.zonalOrigen
          ? { zonalId: t.zonalOrigen.id, sector: t.zonalOrigen.sector }
          : null,
        esMacrooperativo:
          operativo?.esMacrooperativo ?? t.operativo?.esMacrooperativo ?? false,
        puntoId: operativo?.puntoEncuentroId ?? null,
        operativoId: t.operativoId,
        compartidoConTramoId: t.compartidoConTramoId ?? null,
      };
    };
    const unidad = dia.tramosHoy.filter(
      (t) =>
        t.id !== tramo.id &&
        t.conductorId === anfitrion.conductorId &&
        t.vehiculoId === anfitrion.vehiculoId &&
        (tramo.operativoId === null || t.operativoId !== tramo.operativoId),
    );
    const vehiculo = dia.vehiculos.find((v) => v.id === anfitrion.vehiculoId);
    const resultado = encajarEnUnidad(
      {
        operativoId: tramo.operativoId ?? -tramo.id,
        tramos: [comoPura(tramo)],
      },
      unidad.map(comoPura),
      {
        ventanaMin,
        asientos: vehiculo?.asientos ?? null,
        personasDe: (id) => personasDe.get(id)?.length ?? 0,
        funcionariosDe: (id) => personasDe.get(id) ?? [],
      },
    );
    if (!resultado.compatible)
      return { compatible: false, motivo: resultado.motivo };
    const par = resultado.pares.find((p) => p.tramoId === tramo.id);
    return par
      ? { compatible: true, raizId: par.raizId }
      : {
          compatible: false,
          motivo:
            'El traslado no viaja con esa unidad: no se cruza con ninguno de sus traslados.',
        };
  }

  /** La misma placa con OTRO conductor en una franja que se cruza (RN-DAF-01). */
  private placaOcupada(
    vehiculoId: number,
    conductorId: number,
    bloque: readonly TramoCompleto[],
    dia: DatosDelDia,
  ): TramoCompleto | undefined {
    const inicio = dia.parametros.inicioJornada;
    const ids = new Set(bloque.map((t) => t.id));
    return dia.tramosHoy.find(
      (t) =>
        !ids.has(t.id) &&
        t.vehiculoId === vehiculoId &&
        t.conductorId !== null &&
        t.conductorId !== conductorId &&
        bloque.some((b) =>
          seSolapan(
            franjaDe(b.horaInicio, b.horaFin, inicio),
            franjaDe(t.horaInicio, t.horaFin, inicio),
          ),
        ),
    );
  }
}

/** Motivos en texto plano (para los avisos de la propuesta). */
export function enTexto(motivos: readonly Motivo[]): string {
  return motivos.map((m) => m.mensaje).join(' ');
}

type DatosHojaRuta = Awaited<
  ReturnType<OptimizacionTransporteService['hojaRuta']>
>;

/** La definición pdfmake de la hoja de ruta (sobria; la orden oficial la emite otro sistema). */
export function definicionHojaRuta(datos: DatosHojaRuta): TDocumentDefinitions {
  const encabezado = (texto: string): TableCell => ({
    text: texto,
    bold: true,
    fillColor: '#eef2f8',
  });
  const filas: TableCell[][] = datos.tramos.map((f: FilaHojaRuta) => [
    String(f.orden),
    `${f.horaInicio.replace(':', 'H')} – ${f.horaFin.replace(':', 'H')}`,
    nombreTipoTramo(f.tipo),
    f.identificador ?? f.descripcion ?? '—',
    f.unidad ?? '—',
    f.lugares,
    f.conductor ?? '—',
  ]);
  const cuerpo: Content[] = [
    ...(HAY_LOGOTIPO()
      ? [
          {
            image: RUTA_LOGOTIPO,
            width: 150,
            alignment: 'center' as const,
            margin: [0, 0, 0, 8] as [number, number, number, number],
          },
        ]
      : []),
    {
      text: 'Hoja de ruta para orden de movilización',
      bold: true,
      fontSize: 13,
      alignment: 'center',
      margin: [0, 0, 0, 4],
    },
    {
      text: datos.leyenda,
      italics: true,
      fontSize: 8,
      alignment: 'center',
      margin: [0, 0, 0, 12],
    },
    {
      columns: [
        { text: [{ text: 'Fecha: ', bold: true }, datos.fecha] },
        {
          text: [
            { text: 'Vehículo: ', bold: true },
            `${datos.vehiculo.placa}${datos.vehiculo.tipo ? ` (${datos.vehiculo.tipo})` : ''}`,
          ],
        },
      ],
      margin: [0, 0, 0, 4],
    },
    {
      text: [
        { text: 'Conductor(es): ', bold: true },
        datos.conductores.join(', ') || '—',
      ],
      margin: [0, 0, 0, 10],
    },
    {
      table: {
        headerRows: 1,
        widths: [18, 62, 62, '*', 80, '*', 80],
        body: [
          [
            'N.º',
            'Horario',
            'Tipo',
            'Operativo / tarea',
            'Unidad',
            'Sectores o lugares de movilización',
            'Conductor',
          ].map(encabezado),
          ...(filas.length > 0
            ? filas
            : [
                [
                  {
                    text: 'Sin tramos asignados este día.',
                    colSpan: 7,
                    italics: true,
                  },
                  '',
                  '',
                  '',
                  '',
                  '',
                  '',
                ],
              ]),
        ],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 0, 0, 12],
    },
    {
      text: [
        { text: 'Guarda final: ', bold: true },
        datos.guardaFinal
          ? `${datos.guardaFinal.lugar ?? datos.guardaFinal.tipo}${datos.guardaFinal.observacion ? ` — ${datos.guardaFinal.observacion}` : ''}`
          : 'sin declarar.',
      ],
    },
  ];
  return {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 40],
    defaultStyle: { font: 'Roboto', fontSize: 9 },
    info: { title: `Hoja de ruta ${datos.vehiculo.placa} ${datos.fecha}` },
    content: cuerpo,
  };
}
