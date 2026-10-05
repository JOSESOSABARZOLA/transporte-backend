/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Historial de jornada
 * Archivo: reglas-historial.spec.ts
 * Responsabilidad: Verificar la consolidación de una jornada en una fila por persona.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 */

import { aFechaUtc } from './reglas-personal';
import {
  consolidar,
  esFinDeSemana,
  type AporteOperativo,
} from './reglas-historial';

const dia = (texto: string): Date => aFechaUtc(texto) as Date;

const aporte = (parcial: Partial<AporteOperativo> = {}): AporteOperativo => ({
  funcionarioId: 1,
  horas: 8,
  esPatrulla: false,
  esNocturno: false,
  ...parcial,
});

describe('esFinDeSemana', () => {
  it('reconoce el sábado y el domingo', () => {
    // 2026-08-08 es sábado y 2026-08-09 domingo.
    expect(esFinDeSemana(dia('2026-08-08'))).toBe(true);
    expect(esFinDeSemana(dia('2026-08-09'))).toBe(true);
  });

  it('no confunde el resto de la semana', () => {
    for (const fecha of [
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
    ]) {
      expect(esFinDeSemana(dia(fecha))).toBe(false);
    }
  });

  it('SE CALCULA EN UTC: un sábado no se convierte en viernes', () => {
    // La fecha llega como medianoche UTC. Preguntarle su día en Guayaquil —UTC-5—
    // devolvería las 19H00 del viernes, y la salida de fin de semana no se contaría.
    const sabado = new Date('2026-08-08T00:00:00.000Z');
    expect(esFinDeSemana(sabado)).toBe(true);
  });
});

describe('consolidar', () => {
  it('caso 1 del plan · tres operativos de una persona dan UNA fila con las horas sumadas', () => {
    const jornadas = consolidar(
      [aporte({ horas: 4 }), aporte({ horas: 3.5 }), aporte({ horas: 2 })],
      dia('2026-08-05'),
    );

    expect(jornadas).toHaveLength(1);
    expect(jornadas[0].horasJornada).toBe(9.5);
    expect(jornadas[0].operativos).toBe(3);
  });

  it('separa a las personas', () => {
    const jornadas = consolidar(
      [
        aporte({ funcionarioId: 1, horas: 8 }),
        aporte({ funcionarioId: 2, horas: 4 }),
        aporte({ funcionarioId: 1, horas: 2 }),
      ],
      dia('2026-08-05'),
    );

    expect(jornadas).toHaveLength(2);
    expect(jornadas.find((j) => j.funcionarioId === 1)?.horasJornada).toBe(10);
    expect(jornadas.find((j) => j.funcionarioId === 2)?.horasJornada).toBe(4);
  });

  it('caso 2 del plan · patrulla nocturna marca las dos banderas', () => {
    const [jornada] = consolidar(
      [aporte({ esPatrulla: true, esNocturno: true })],
      dia('2026-08-05'),
    );

    expect(jornada.fuePatrulla).toBe(true);
    expect(jornada.fueNocturna).toBe(true);
  });

  it('caso 3 del plan · un operativo en sábado marca el fin de semana', () => {
    const [jornada] = consolidar([aporte()], dia('2026-08-08'));
    expect(jornada.fueFinSemana).toBe(true);
  });

  it('UNA sola salida en patrulla basta para que el día cuente como patrulla', () => {
    // RN-24 pregunta si salió, no cuántas veces.
    const [jornada] = consolidar(
      [aporte({ esPatrulla: false }), aporte({ esPatrulla: true })],
      dia('2026-08-05'),
    );

    expect(jornada.fuePatrulla).toBe(true);
    expect(jornada.operativos).toBe(2);
  });

  it('lo mismo con la salida nocturna', () => {
    const [jornada] = consolidar(
      [aporte({ esNocturno: true }), aporte({ esNocturno: false })],
      dia('2026-08-05'),
    );

    expect(jornada.fueNocturna).toBe(true);
  });

  it('el fin de semana es de la jornada, no de cada operativo', () => {
    const jornadas = consolidar(
      [aporte({ funcionarioId: 1 }), aporte({ funcionarioId: 2 })],
      dia('2026-08-09'),
    );

    expect(jornadas.every((jornada) => jornada.fueFinSemana)).toBe(true);
  });

  it('redondea a una cifra decimal, que es lo que admite la columna', () => {
    // 2,8 + 2,8 + 2,8 en coma flotante da 8.399999999999999.
    const [jornada] = consolidar(
      [aporte({ horas: 2.8 }), aporte({ horas: 2.8 }), aporte({ horas: 2.8 })],
      dia('2026-08-05'),
    );

    expect(jornada.horasJornada).toBe(8.4);
  });

  it('una jornada sin operativos no produce filas', () => {
    expect(consolidar([], dia('2026-08-05'))).toEqual([]);
  });

  it('nunca supera las 24 horas que admite ck_historial_horas con una jornada real', () => {
    // Cuatro operativos de seis horas es el extremo que el negocio describe como
    // situación a evitar; aun así debe caber en la columna.
    const [jornada] = consolidar(
      [
        aporte({ horas: 6 }),
        aporte({ horas: 6 }),
        aporte({ horas: 6 }),
        aporte({ horas: 6 }),
      ],
      dia('2026-08-05'),
    );

    expect(jornada.horasJornada).toBeLessThanOrEqual(24);
  });
});
