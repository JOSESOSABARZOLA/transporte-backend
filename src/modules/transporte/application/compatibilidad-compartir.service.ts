/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · compartir unidad
 * Archivo: compatibilidad-compartir.service.ts
 * Responsabilidad: Implementar el puerto `CompatibilidadCompartir` de `operativos` e inscribirse en su
 *                  registro al iniciar el módulo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-19
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * EL REGISTRO PREGUNTA, TRANSPORTE RESPONDE (plan «compartir unidad»). Para saber si un operativo en
 * captura puede viajar en la unidad de otro hay que partir los dos en TRAMOS —sus duraciones son
 * parámetros DAF (D7)—, ubicarlos por zonal y sector y aplicar la MISMA regla que el optimizador
 * (`politicas/compartir-tramo.ts`). Sin asientos: en el registro todavía no hay vehículo; la DAF
 * vuelve a validar con la placa cuando ejecuta el compartir.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Injectable, type OnModuleInit } from '@nestjs/common';

import {
  RegistroCompatibilidadCompartir,
  type CompatibilidadCompartir,
  type OperativoParaCompartir,
  type VeredictoCompartir,
} from '../../operativos/application/compartir-transporte.puerto';
import { PlanificacionTransporteRepository } from '../infrastructure/planificacion-transporte.repository';
import { ParametrosTransporteService } from './parametros-transporte.service';
import {
  clasificarTramo,
  palabraDeTramo,
  puedeCompartirOperativo,
  type OperativoCompartible,
  type TramoCompartible,
} from './politicas/compartir-tramo';
import { franjaDe } from './politicas/linea-de-tiempo';
import {
  planificarTramos,
  type DuracionesTramo,
} from './politicas/plan-tramos';

@Injectable()
export class CompatibilidadCompartirService
  implements CompatibilidadCompartir, OnModuleInit
{
  constructor(
    private readonly registro: RegistroCompatibilidadCompartir,
    private readonly parametros: ParametrosTransporteService,
    private readonly repositorio: PlanificacionTransporteRepository,
  ) {}

  onModuleInit(): void {
    this.registro.registrar(this);
  }

  async evaluar(
    invitado: OperativoParaCompartir,
    anfitriones: readonly OperativoParaCompartir[],
  ): Promise<VeredictoCompartir[]> {
    if (anfitriones.length === 0) return [];
    const zonales = [
      invitado,
      ...anfitriones,
      ...anfitriones.flatMap((a) => a.miembros ?? []),
    ]
      .map((op) => op.zonalId)
      .filter((id): id is number => id !== null);
    const [{ duracionTramo, ventanaMin, inicioJornada }, sectores] =
      await Promise.all([
        this.parametros.leerCompartir(),
        this.repositorio.sectoresDeZonales(zonales),
      ]);

    const comoCompartible = (
      op: OperativoParaCompartir,
    ): OperativoCompartible =>
      aCompartible(
        op,
        duracionTramo,
        (id) => sectores.get(id) ?? null,
        inicioJornada,
      );
    const deInvitado = comoCompartible(invitado);

    return anfitriones.map((anfitrion) => {
      // LA UNIDAD DEL GRUPO (2026-10-19): los traslados del anfitrión MÁS los de quienes ya piden
      // viajar en ella. Cada uno recuerda de qué operativo es, para decir con quién va el invitado.
      const deQuien = new Map<TramoCompartible, string>();
      const tramosDeUnidad: TramoCompartible[] = [];
      for (const miembro of [anfitrion, ...(anfitrion.miembros ?? [])]) {
        for (const tramo of comoCompartible(miembro).tramos) {
          tramosDeUnidad.push(tramo);
          deQuien.set(tramo, miembro.identificador ?? '');
        }
      }
      const unidad: OperativoCompartible = {
        esMacrooperativo: anfitrion.esMacrooperativo,
        tramos: tramosDeUnidad,
      };
      const resultado = puedeCompartirOperativo(unidad, deInvitado, {
        ventanaMin,
      });
      if (!resultado.compatible)
        return { compatible: false, motivo: resultado.motivo };
      const clases = deInvitado.tramos.map((tramo) => ({
        tramo,
        clase: clasificarTramo(tramo, tramosDeUnidad, { ventanaMin }),
      }));
      const comparteCon = clases.flatMap(({ tramo, clase }) =>
        clase.clase === 'COMPARTIDO'
          ? [
              {
                tipo: palabraDeTramo(tramo.tipo),
                con: deQuien.get(clase.pareja) ?? '',
              },
            ]
          : [],
      );
      // «Completo» (2026-10-20): lo que el «completo» del invitado abarca, o el «completo» de la
      // unidad dentro del que viajan sus traslados.
      const contiene = new Set<string>();
      let contenidoEn: string | null = null;
      for (const { clase } of clases) {
        if (clase.clase !== 'CONTENIDO') continue;
        if (clase.sentido === 'ABARCA')
          for (const c of clase.cruzados) contiene.add(palabraDeTramo(c.tipo));
        else contenidoEn ??= deQuien.get(clase.pareja) ?? null;
      }
      return {
        compatible: true,
        comparte: palabras(resultado.tramosCompartidos),
        propios: palabras(resultado.tramosPropios),
        comparteCon,
        // Solo si hay un «completo» de por medio (las respuestas de siempre no cambian).
        ...(contiene.size > 0 ? { contiene: [...contiene] } : {}),
        ...(contenidoEn !== null ? { contenidoEn } : {}),
      };
    });
  }
}

/** Los traslados en una palabra cada uno, sin repetir («dejar», «retirar»). */
function palabras(tramos: readonly TramoCompartible[]): string[] {
  return [...new Set(tramos.map((t) => palabraDeTramo(t.tipo)))];
}

/** Los tramos que pediría el operativo, ubicados en su zonal y sector. */
function aCompartible(
  op: OperativoParaCompartir,
  duraciones: DuracionesTramo,
  sectorDe: (zonalId: number) => string | null,
  inicioJornada: string,
): OperativoCompartible {
  const origen =
    op.zonalId === null
      ? null
      : { zonalId: op.zonalId, sector: sectorDe(op.zonalId) };
  return {
    esMacrooperativo: op.esMacrooperativo,
    tramos: planificarTramos(
      {
        horaInicio: op.horaInicio,
        horaFin: op.horaFin,
        tipoTransporte: op.tipoTransporte,
        zonalId: op.zonalId,
      },
      duraciones,
    ).map((tramo) => {
      const franja = franjaDe(tramo.horaInicio, tramo.horaFin, inicioJornada);
      return {
        tipo: tramo.tipo,
        inicio: franja.inicio,
        fin: franja.fin,
        origen,
        esMacrooperativo: op.esMacrooperativo,
      };
    }),
  };
}
