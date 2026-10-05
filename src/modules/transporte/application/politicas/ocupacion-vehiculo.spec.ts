/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Asignación de transporte
 * Archivo: ocupacion-vehiculo.spec.ts
 * Responsabilidad: Verificar RN-DAF-01, incluido el cruce de medianoche.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-28
 *
 * LOS DOS CASOS QUE DE VERDAD PROTEGEN son el encadenado y el de medianoche.
 *
 * El primero, porque es la jornada que la DAF practica todos los días: un operativo
 * termina a las 14H00 y el siguiente empieza a las 14H00 con el mismo carro. Si la regla
 * lo tratara como cruce, RN-DAF-01 impediría exactamente el encadenamiento que el
 * levantamiento describió como el corazón del proceso, y el sistema sería inservible.
 *
 * El segundo, porque es donde fallan las implementaciones ingenuas: con 22H00 a 02H00 la
 * hora de fin es MENOR que la de inicio, y cualquier comparación directa de cadenas da un
 * resultado incorrecto en silencio.
 */

import { RangoHorario } from '../../../operativos/domain/rango-horario';
import {
  verificarOcupacionVehiculo,
  type OcupacionVigente,
} from './ocupacion-vehiculo';

const PLACA = 'PMA7056';

const ocupacion = (
  identificador: string,
  horaInicio: string,
  horaFin: string,
): OcupacionVigente => ({
  identificador,
  rango: RangoHorario.de(horaInicio, horaFin),
});

const rango = (horaInicio: string, horaFin: string) =>
  RangoHorario.de(horaInicio, horaFin);

describe('RN-DAF-01 · el vehículo está libre', () => {
  it('sin ninguna asignación previa, la placa se puede usar', () => {
    const veredicto = verificarOcupacionVehiculo(
      PLACA,
      [],
      rango('08:00', '16:30'),
    );

    expect(veredicto.libre).toBe(true);
    expect(veredicto.conflicto).toBeUndefined();
    expect(veredicto.motivo).toBeUndefined();
  });

  /**
   * EL CASO QUE SOSTIENE TODO EL ENCADENAMIENTO. Los intervalos de `RangoHorario` son
   * semiabiertos: terminar y empezar a la misma hora es encadenar, no coincidir.
   */
  it('un operativo que empieza donde termina el anterior NO se cruza', () => {
    const veredicto = verificarOcupacionVehiculo(
      PLACA,
      [ocupacion('OCFPMO-0031', '12:00', '14:00')],
      rango('14:00', '16:00'),
    );

    expect(veredicto.libre).toBe(true);
  });

  it('y tampoco al revés: el nuevo termina donde el existente empieza', () => {
    const veredicto = verificarOcupacionVehiculo(
      PLACA,
      [ocupacion('OCFPMO-0031', '14:00', '16:00')],
      rango('12:00', '14:00'),
    );

    expect(veredicto.libre).toBe(true);
  });

  it('dos operativos del mismo día que no se tocan dejan la placa libre', () => {
    const veredicto = verificarOcupacionVehiculo(
      PLACA,
      [
        ocupacion('OCFPMO-0031', '08:00', '10:00'),
        ocupacion('OCFPMO-0032', '17:00', '19:00'),
      ],
      rango('12:00', '14:00'),
    );

    expect(veredicto.libre).toBe(true);
  });
});

describe('RN-DAF-01 · el vehículo ya está ocupado', () => {
  it('un cruce parcial lo rechaza', () => {
    const veredicto = verificarOcupacionVehiculo(
      PLACA,
      [ocupacion('OCFPMO-0031', '12:00', '15:00')],
      rango('14:00', '16:00'),
    );

    expect(veredicto.libre).toBe(false);
    expect(veredicto.conflicto?.identificador).toBe('OCFPMO-0031');
  });

  it('un horario contenido en otro lo rechaza', () => {
    const veredicto = verificarOcupacionVehiculo(
      PLACA,
      [ocupacion('OCFPMO-0031', '08:00', '18:00')],
      rango('12:00', '14:00'),
    );

    expect(veredicto.libre).toBe(false);
  });

  /** El mensaje llega íntegro a la DAF: debe nombrar el operativo y su horario. */
  it('el motivo nombra la placa, el operativo en conflicto y sus horas', () => {
    const veredicto = verificarOcupacionVehiculo(
      PLACA,
      [ocupacion('OCFPMO-0031', '12:00', '15:00')],
      rango('14:00', '16:00'),
    );

    expect(veredicto.motivo).toBe(
      'El vehículo de placa PMA7056 ya está asignado al operativo OCFPMO-0031, de 12H00 A 15H00, que se cruza con este horario.',
    );
  });

  it('con varios cruces devuelve el primero, no una lista', () => {
    const veredicto = verificarOcupacionVehiculo(
      PLACA,
      [
        ocupacion('OCFPMO-0031', '13:00', '15:00'),
        ocupacion('OCFPMO-0032', '14:30', '16:30'),
      ],
      rango('14:00', '16:00'),
    );

    expect(veredicto.libre).toBe(false);
    expect(veredicto.conflicto?.identificador).toBe('OCFPMO-0031');
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * EL CRUCE DE MEDIANOCHE. FASE3 §OV-02 lo llama la fuente de error más probable del
 * sistema, y estas cuatro pruebas son la razón de que la política delegue en
 * `RangoHorario` en lugar de comparar horas por su cuenta.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('RN-DAF-01 · el horario cruza la medianoche', () => {
  it('un nocturno de 22H00 a 02H00 choca con otro de 01H00 a 03H00', () => {
    const veredicto = verificarOcupacionVehiculo(
      PLACA,
      [ocupacion('OCFPMO-0031', '22:00', '02:00')],
      rango('01:00', '03:00'),
    );

    expect(veredicto.libre).toBe(false);
    expect(veredicto.conflicto?.identificador).toBe('OCFPMO-0031');
  });

  it('y también con uno de la tarde que se le mete por el otro extremo', () => {
    const veredicto = verificarOcupacionVehiculo(
      PLACA,
      [ocupacion('OCFPMO-0031', '22:00', '02:00')],
      rango('21:00', '23:00'),
    );

    expect(veredicto.libre).toBe(false);
  });

  it('pero un diurno de 08H00 a 16H30 convive con el nocturno', () => {
    const veredicto = verificarOcupacionVehiculo(
      PLACA,
      [ocupacion('OCFPMO-0031', '22:00', '02:00')],
      rango('08:00', '16:30'),
    );

    expect(veredicto.libre).toBe(true);
  });

  /**
   * Es el caso real de las 42 filas del Excel de agosto en las que la misma placa
   * sirve de día y de noche: el turno de día termina a las 16H30 y el nocturno arranca
   * a las 17H30, con el cambio de custodio de por medio.
   */
  it('el día y la noche de la misma placa no se estorban', () => {
    const veredicto = verificarOcupacionVehiculo(
      PLACA,
      [ocupacion('OCFPMO-0031', '08:00', '16:30')],
      rango('17:30', '02:00'),
    );

    expect(veredicto.libre).toBe(true);
  });
});
