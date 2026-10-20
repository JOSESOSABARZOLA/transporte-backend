/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Políticas de descanso
 * Archivo: descanso-conductor.policy.spec.ts
 * Responsabilidad: Verificar RN-44 y RN-25 del conductor sobre la asignación por tramos.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 */

import { CODIGOS_ERROR } from '../../../../common/errors/codigos-error';
import {
  verificarRestriccionesDeConduccion,
  type AntecedentesConduccion,
  type ContextoConduccion,
} from './descanso-conductor.policy';

const dia = (texto: string): Date => new Date(`${texto}T00:00:00.000Z`);
const MIERCOLES = dia('2026-08-05');

const contexto = (
  parcial: Partial<ContextoConduccion> = {},
): ContextoConduccion => ({
  fecha: MIERCOLES,
  esPatrulla: true,
  esPesada: false,
  operativoIds: [100],
  diasDescansoPatrulla: 1,
  topeSalidasPesadas: 3,
  ...parcial,
});

const conductor = (
  parcial: Partial<AntecedentesConduccion> = {},
): AntecedentesConduccion => ({
  nombre: 'VIVANCO JORGE',
  patrullas: [],
  salidasPesadas: [],
  ...parcial,
});

describe('DescansoConductorPolicy · RN-44 patrulla consecutiva', () => {
  it('sin patrullas previas puede conducir la patrulla', () => {
    expect(verificarRestriccionesDeConduccion(conductor(), contexto())).toEqual(
      [],
    );
  });

  it('quien condujo en patrulla el día anterior no repite', () => {
    const [veredicto] = verificarRestriccionesDeConduccion(
      conductor({ patrullas: [{ fecha: dia('2026-08-04'), operativoId: 7 }] }),
      contexto(),
    );

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.CONDUCTOR_PATRULLA_CONSECUTIVA);
    expect(veredicto.motivo).toContain('el día anterior');
  });

  it('otra patrulla ese mismo día también lo impide', () => {
    const [veredicto] = verificarRestriccionesDeConduccion(
      conductor({ patrullas: [{ fecha: MIERCOLES, operativoId: 7 }] }),
      contexto(),
    );

    expect(veredicto.motivo).toContain('ese mismo día');
  });

  it('el otro tramo del MISMO operativo no cuenta como patrulla previa', () => {
    expect(
      verificarRestriccionesDeConduccion(
        conductor({ patrullas: [{ fecha: MIERCOLES, operativoId: 100 }] }),
        contexto(),
      ),
    ).toEqual([]);
  });

  it('fuera de los días de descanso ya puede repetir', () => {
    expect(
      verificarRestriccionesDeConduccion(
        conductor({
          patrullas: [{ fecha: dia('2026-08-03'), operativoId: 7 }],
        }),
        contexto(),
      ),
    ).toEqual([]);
  });

  it('si el bloque no es de patrulla, la regla no aplica', () => {
    expect(
      verificarRestriccionesDeConduccion(
        conductor({
          patrullas: [{ fecha: dia('2026-08-04'), operativoId: 7 }],
        }),
        contexto({ esPatrulla: false }),
      ),
    ).toEqual([]);
  });
});

describe('DescansoConductorPolicy · RN-25 tope de salidas pesadas', () => {
  const tres = [{ operativoId: 1 }, { operativoId: 2 }, { operativoId: 3 }];

  it('con el tope alcanzado no toma otro bloque pesado', () => {
    const [veredicto] = verificarRestriccionesDeConduccion(
      conductor({ salidasPesadas: tres }),
      contexto({ esPatrulla: false, esPesada: true }),
    );

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.TOPE_SALIDAS_PESADAS);
  });

  it('un bloque diurno de día laborable no cuenta para el tope', () => {
    expect(
      verificarRestriccionesDeConduccion(
        conductor({ salidasPesadas: tres }),
        contexto({ esPatrulla: false, esPesada: false }),
      ),
    ).toEqual([]);
  });

  it('cada operativo cuenta una vez aunque tenga dos tramos, y el propio no cuenta', () => {
    expect(
      verificarRestriccionesDeConduccion(
        conductor({
          salidasPesadas: [
            { operativoId: 1 },
            { operativoId: 1 },
            { operativoId: 2 },
            { operativoId: 100 },
          ],
        }),
        contexto({ esPatrulla: false, esPesada: true }),
      ),
    ).toEqual([]);
  });

  it('devuelve las dos restricciones juntas cuando ambas aplican', () => {
    const veredictos = verificarRestriccionesDeConduccion(
      conductor({
        patrullas: [{ fecha: dia('2026-08-04'), operativoId: 7 }],
        salidasPesadas: tres,
      }),
      contexto({ esPesada: true }),
    );

    expect(veredictos.map((v) => v.codigo)).toEqual([
      CODIGOS_ERROR.CONDUCTOR_PATRULLA_CONSECUTIVA,
      CODIGOS_ERROR.TOPE_SALIDAS_PESADAS,
    ]);
  });
});
