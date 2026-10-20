/**
 * Microservicio: transporte
 * Módulo: Talento operativo
 * Feature: Cobertura por turnos (Instrucción)
 * Archivo: cobertura-politicas.spec.ts
 * Responsabilidad: Verificar las políticas puras de avisos entre días y de propuesta de rotación.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-05
 */

import {
  avisosConfigurados,
  calcularAvisosCobertura,
  comoValorNocturnoADiurno,
  type DiaAviso,
} from './cobertura-alertas.policy';
import {
  proponerRotacion,
  type DiaRotacion,
} from './cobertura-rotacion.policy';

const APAGADOS = {
  maxDiasSinDescanso: 0,
  permiteNocturnoADiurno: 'SIN_CONFIGURAR' as const,
};

describe('cobertura-alertas.policy', () => {
  it('con los parámetros apagados no avisa nada', () => {
    const dias: DiaAviso[] = Array.from(
      { length: 12 },
      (): DiaAviso => 'DIURNO',
    );
    expect(calcularAvisosCobertura(dias, APAGADOS).every((a) => !a)).toBe(true);
    expect(avisosConfigurados(APAGADOS)).toBe(false);
  });

  it('avisa cada día que excede la racha máxima', () => {
    const dias: DiaAviso[] = ['DIURNO', 'NOCTURNO', 'DIURNO', 'DIURNO'];
    const avisos = calcularAvisosCobertura(dias, {
      ...APAGADOS,
      maxDiasSinDescanso: 2,
    });
    expect(avisos[1]).toBeUndefined();
    expect(avisos[2]).toContain('3 días seguidos');
    expect(avisos[3]).toContain('4 días seguidos');
  });

  it('la ausencia, la celda vacía y el descanso cortan la racha', () => {
    for (const corte of ['AUSENCIA', 'VACIA', 'DESCANSO'] as DiaAviso[]) {
      const dias: DiaAviso[] = ['DIURNO', 'DIURNO', corte, 'DIURNO', 'DIURNO'];
      const avisos = calcularAvisosCobertura(dias, {
        ...APAGADOS,
        maxDiasSinDescanso: 2,
      });
      expect(avisos.every((a) => !a)).toBe(true);
    }
  });

  it('con NO, avisa de un diurno al día siguiente de un nocturno; con SI no', () => {
    const dias: DiaAviso[] = ['NOCTURNO', 'DIURNO'];
    expect(
      calcularAvisosCobertura(dias, {
        ...APAGADOS,
        permiteNocturnoADiurno: 'NO',
      })[1],
    ).toContain('diurno');
    expect(
      calcularAvisosCobertura(dias, {
        ...APAGADOS,
        permiteNocturnoADiurno: 'SI',
      })[1],
    ).toBeUndefined();
  });

  it('un valor desconocido del parámetro equivale a SIN_CONFIGURAR', () => {
    expect(comoValorNocturnoADiurno('quizá')).toBe('SIN_CONFIGURAR');
    expect(comoValorNocturnoADiurno(' no ')).toBe('NO');
  });
});

describe('cobertura-rotacion.policy', () => {
  it('continúa un ciclo 5D+2— sobre los huecos', () => {
    const ciclo: DiaRotacion[] = [
      'DIURNO',
      'DIURNO',
      'DIURNO',
      'DIURNO',
      'DIURNO',
      'DESCANSO',
      'DESCANSO',
    ];
    const previos = [...ciclo, ...ciclo]; // 14 días anteriores al mes
    const mes: DiaRotacion[] = Array.from(
      { length: 7 },
      (): DiaRotacion => null,
    );

    const { propuestas } = proponerRotacion([...previos, ...mes], 14);

    expect(propuestas.map((p) => p.estado)).toEqual(ciclo);
  });

  it('nunca propone sobre ausencias ni sobre lo ya planificado, y cuenta las ausencias', () => {
    const previos: DiaRotacion[] = ['DIURNO', 'DESCANSO', 'DIURNO', 'DESCANSO'];
    const mes: DiaRotacion[] = [null, 'AUSENCIA', null, 'DESCANSO'];

    const resultado = proponerRotacion([...previos, ...mes], 4);

    expect(resultado.propuestas.map((p) => p.indice)).toEqual([4, 6]);
    expect(resultado.omitidas).toBe(1);
  });

  it('sin datos suficientes para un ciclo no inventa nada', () => {
    // Un solo día conocido no alcanza para ninguna fase completa de un período ≥ 2.
    const secuencia: DiaRotacion[] = ['DIURNO', null, null];
    expect(proponerRotacion(secuencia, 1).propuestas).toEqual([]);
  });

  it('sin huecos en el mes no hay nada que proponer', () => {
    expect(
      proponerRotacion(['DIURNO', 'DESCANSO', 'DIURNO', 'DESCANSO'], 2)
        .propuestas,
    ).toEqual([]);
  });
});
