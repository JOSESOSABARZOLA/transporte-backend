/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Flota · mantenimiento
 * Archivo: semana-mantenimiento.ts
 * Responsabilidad: Componer la vista semanal de vehículos parados por mantenimiento.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * Siete días desde `desde`. Cada día de cada vehículo muestra el estado de la cita que lo cubre
 * (PROGRAMADO si la cita aún no lo declara —las paradas anteriores a la Fase 5 no lo tenían—,
 * EN_TALLER o LISTO) con su motivo; un día sin cita, `null`. Si dos citas se pisan, gana la que
 * empezó después (la más reciente). Pura.
 */

export type EstadoDiaTaller = 'PROGRAMADO' | 'EN_TALLER' | 'LISTO';

export interface CitaTaller {
  vehiculoId: number | null;
  desde: Date;
  hasta: Date;
  estadoMantenimiento: string | null;
  motivo: string | null;
}

export interface SemanaDeVehiculo {
  vehiculoId: number;
  placa: string;
  dias: { fecha: string; estado: EstadoDiaTaller | null; motivo?: string }[];
}

const DIA_MS = 24 * 60 * 60 * 1000;
const iso = (fecha: Date): string => fecha.toISOString().slice(0, 10);

/** Los siete días (AAAA-MM-DD) desde `desde`. */
export function diasDeSemana(desde: Date): string[] {
  return Array.from({ length: 7 }, (_, i) =>
    iso(new Date(desde.getTime() + i * DIA_MS)),
  );
}

/** La disponibilidad de un vehículo en la fecha elegida de Flota (2026-10-20, D3). */
export type DisponibilidadVehiculo = 'DISPONIBLE' | 'EN_TALLER' | 'DE_BAJA';

/** Una parada de la semana, tal como la pinta la pestaña Vehículos. */
export interface ParadaDeLaSemana {
  id: number;
  desde: string;
  hasta: string;
  motivo: string | null;
  estado: EstadoDiaTaller;
  taller: string | null;
  hora: string | null;
}

export interface DisponibilidadDeVehiculo {
  vehiculoId: number;
  placa: string;
  activo: boolean;
  disponibilidad: DisponibilidadVehiculo;
  /** La parada que lo tiene en el taller en la fecha (la que termina más tarde), o `null`. */
  enTaller: { hasta: string; motivo: string | null } | null;
  /** Las paradas que tocan los siete días desde la fecha, de la más temprana a la más tardía. */
  paradas: ParadaDeLaSemana[];
}

/**
 * Para cada vehículo, su disponibilidad en `fecha` y sus paradas de [fecha, fecha + 6]. Una cita
 * LISTO ya no lo tiene en el taller (el vehículo volvió), igual que en «Planificar el día»
 * (`vehiculosEnTaller`). Uno dado de baja es DE_BAJA aunque tenga paradas. Pura.
 */
export function disponibilidadDeFlota(
  fecha: Date,
  vehiculos: readonly { id: number; placa: string; activo: boolean }[],
  citas: readonly (CitaTaller & {
    id: number;
    taller: string | null;
    hora: string | null;
  })[],
): DisponibilidadDeVehiculo[] {
  const dia = iso(fecha);
  const fin = diasDeSemana(fecha)[6];
  return vehiculos.map((vehiculo) => {
    const propias = citas
      .filter(
        (c) =>
          c.vehiculoId === vehiculo.id &&
          iso(c.desde) <= fin &&
          iso(c.hasta) >= dia,
      )
      .sort((a, b) => a.desde.getTime() - b.desde.getTime());
    const cubre = propias
      .filter(
        (c) =>
          c.estadoMantenimiento !== 'LISTO' &&
          iso(c.desde) <= dia &&
          iso(c.hasta) >= dia,
      )
      .sort((a, b) => b.hasta.getTime() - a.hasta.getTime())[0];
    const disponibilidad: DisponibilidadVehiculo = !vehiculo.activo
      ? 'DE_BAJA'
      : cubre
        ? 'EN_TALLER'
        : 'DISPONIBLE';
    return {
      vehiculoId: vehiculo.id,
      placa: vehiculo.placa,
      activo: vehiculo.activo,
      disponibilidad,
      enTaller:
        disponibilidad === 'EN_TALLER' && cubre
          ? { hasta: iso(cubre.hasta), motivo: cubre.motivo }
          : null,
      paradas: propias.map((c) => ({
        id: c.id,
        desde: iso(c.desde),
        hasta: iso(c.hasta),
        motivo: c.motivo,
        estado: (c.estadoMantenimiento ?? 'PROGRAMADO') as EstadoDiaTaller,
        taller: c.taller,
        hora: c.hora,
      })),
    };
  });
}

export function componerSemana(
  desde: Date,
  vehiculos: readonly { id: number; placa: string }[],
  citas: readonly CitaTaller[],
): SemanaDeVehiculo[] {
  const dias = diasDeSemana(desde);
  return vehiculos.map((vehiculo) => {
    const propias = citas.filter((c) => c.vehiculoId === vehiculo.id);
    return {
      vehiculoId: vehiculo.id,
      placa: vehiculo.placa,
      dias: dias.map((fecha) => {
        const cubre = propias
          .filter((c) => iso(c.desde) <= fecha && iso(c.hasta) >= fecha)
          .sort((a, b) => b.desde.getTime() - a.desde.getTime())[0];
        if (!cubre) return { fecha, estado: null };
        const estado = (cubre.estadoMantenimiento ??
          'PROGRAMADO') as EstadoDiaTaller;
        return cubre.motivo
          ? { fecha, estado, motivo: cubre.motivo }
          : { fecha, estado };
      }),
    };
  });
}
