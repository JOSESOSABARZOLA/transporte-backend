/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Asignación de personal y alertas
 * Archivo: composicion-personal.spec.ts
 * Responsabilidad: Verificar VAL-10, VAL-18, INV-09, INV-10 y PER-06.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 */

import { AreaPersonal, RolDepartamental } from '@prisma/client';

import {
  estadoDeComposicion,
  verificarComposicion,
  type AsignacionExistente,
  type FormularioParaComposicion,
  type PersonaParaAsignar,
} from './composicion-personal';

const DUENO = RolDepartamental.DMIP_INSPECCIONES;
const COMPARTIDO = RolDepartamental.DMIT_INSTRUCTOR;

/** El formulario 6: dueño Inspecciones, DMIT con cupo de una persona (PV-09). */
const FORMULARIO: FormularioParaComposicion = {
  nombre: 'PATRULLA NOCTURNA',
  rolDueno: DUENO,
  // Desde el 2026-08-25 la participación son filas. El cupo cuelga de la del que aporta,
  // no del formulario: dos departamentos que aportan pueden tener topes distintos.
  roles: [
    { rol: DUENO, acceso: 'ESCRITURA', cupo: null },
    { rol: COMPARTIDO, acceso: 'APORTA', cupo: 1 },
  ],
  esPatrulla: true,
  areas: [
    { area: AreaPersonal.GENERAL, esCompartida: false },
    { area: AreaPersonal.TECNICO, esCompartida: false },
    { area: AreaPersonal.INSTRUCCION, esCompartida: true },
  ],
};

const persona = (
  parcial: Partial<PersonaParaAsignar> = {},
): PersonaParaAsignar => ({
  funcionarioId: 100,
  nombre: 'BENAVIDES FERNANDO',
  area: AreaPersonal.GENERAL,
  activo: true,
  ...parcial,
});

const asignada = (
  funcionarioId: number,
  area: AreaPersonal,
  asignadoPorRol: RolDepartamental = DUENO,
): AsignacionExistente => ({ funcionarioId, area, asignadoPorRol });

describe('verificarComposicion · el caso admitido', () => {
  it('el dueño asigna a alguien de un área admitida', () => {
    const veredicto = verificarComposicion(persona(), FORMULARIO, [], DUENO);

    expect(veredicto.admitida).toBe(true);
    expect(veredicto.codigo).toBeUndefined();
  });
});

describe('la persona dada de baja', () => {
  it('no recibe asignaciones, y el mensaje la nombra', () => {
    const veredicto = verificarComposicion(
      persona({ activo: false }),
      FORMULARIO,
      [],
      DUENO,
    );

    expect(veredicto.admitida).toBe(false);
    expect(veredicto.codigo).toBe('PERSONA_NO_DISPONIBLE');
    expect(veredicto.motivo).toContain('BENAVIDES FERNANDO');
  });
});

describe('INV-10 · nadie figura dos veces', () => {
  it('caso 2 del plan · la misma persona se rechaza', () => {
    const veredicto = verificarComposicion(
      persona(),
      FORMULARIO,
      [asignada(100, AreaPersonal.GENERAL)],
      DUENO,
    );

    expect(veredicto.admitida).toBe(false);
    expect(veredicto.codigo).toBe('SOLAPAMIENTO_HORARIO');
    expect(veredicto.motivo).toContain('ya figura en este operativo');
  });

  it('otra persona de la misma área sí se admite', () => {
    const veredicto = verificarComposicion(
      persona({ funcionarioId: 101 }),
      FORMULARIO,
      [asignada(100, AreaPersonal.GENERAL)],
      DUENO,
    );

    expect(veredicto.admitida).toBe(true);
  });

  it('se comprueba antes que el área: el mensaje útil es el de la repetición', () => {
    const veredicto = verificarComposicion(
      persona({ area: AreaPersonal.OPERATIVOS }),
      FORMULARIO,
      [asignada(100, AreaPersonal.OPERATIVOS)],
      DUENO,
    );

    expect(veredicto.codigo).toBe('SOLAPAMIENTO_HORARIO');
  });
});

describe('VAL-10 e INV-09 · área admitida por el formulario', () => {
  it('caso 3 del plan · un área ajena se rechaza ENUMERANDO las admitidas', () => {
    const veredicto = verificarComposicion(
      persona({ area: AreaPersonal.OPERATIVOS }),
      FORMULARIO,
      [],
      DUENO,
    );

    expect(veredicto.admitida).toBe(false);
    expect(veredicto.codigo).toBe('AREA_NO_ADMITIDA');
    expect(veredicto.motivo).toContain('GENERAL');
    expect(veredicto.motivo).toContain('TECNICO');
    expect(veredicto.motivo).toContain('INSTRUCCION');
  });

  it('el dueño puede asignar también el área compartida', () => {
    const veredicto = verificarComposicion(
      persona({ area: AreaPersonal.INSTRUCCION }),
      FORMULARIO,
      [],
      DUENO,
    );

    expect(veredicto.admitida).toBe(true);
  });

  it('un formulario sin áreas configuradas no admite a nadie', () => {
    const veredicto = verificarComposicion(
      persona(),
      { ...FORMULARIO, areas: [] },
      [],
      DUENO,
    );

    expect(veredicto.admitida).toBe(false);
    expect(veredicto.motivo).toContain('ninguna área configurada');
  });
});

describe('PER-06 y VAL-18 · el cupo del rol compartido', () => {
  it('caso 4 del plan · dentro del cupo, se admite', () => {
    const veredicto = verificarComposicion(
      persona({ area: AreaPersonal.INSTRUCCION }),
      FORMULARIO,
      [asignada(1, AreaPersonal.GENERAL), asignada(2, AreaPersonal.TECNICO)],
      COMPARTIDO,
    );

    expect(veredicto.admitida).toBe(true);
  });

  it('caso 5 del plan · excedido el cupo, se rechaza', () => {
    const veredicto = verificarComposicion(
      persona({ funcionarioId: 200, area: AreaPersonal.INSTRUCCION }),
      FORMULARIO,
      [asignada(1, AreaPersonal.INSTRUCCION, COMPARTIDO)],
      COMPARTIDO,
    );

    expect(veredicto.admitida).toBe(false);
    expect(veredicto.codigo).toBe('CUPO_COMPARTIDO_SUPERADO');
    expect(veredicto.motivo).toContain('1 de 1');
  });

  it('caso 6 del plan · con personal que no es del área compartida, se rechaza', () => {
    const veredicto = verificarComposicion(
      persona({ area: AreaPersonal.GENERAL }),
      FORMULARIO,
      [],
      COMPARTIDO,
    );

    expect(veredicto.admitida).toBe(false);
    expect(veredicto.codigo).toBe('CUPO_COMPARTIDO_SUPERADO');
    expect(veredicto.motivo).toContain('INSTRUCCION');
  });

  it('el cupo cuenta SOLO lo que asignó el rol compartido', () => {
    // Tres personas ya asignadas por el dueño, incluida una de Instrucción: el cupo del
    // DMIT sigue intacto. Contarlas todas dejaría al rol compartido sin poder asignar.
    const veredicto = verificarComposicion(
      persona({ funcionarioId: 200, area: AreaPersonal.INSTRUCCION }),
      FORMULARIO,
      [
        asignada(1, AreaPersonal.GENERAL),
        asignada(2, AreaPersonal.TECNICO),
        asignada(3, AreaPersonal.INSTRUCCION),
      ],
      COMPARTIDO,
    );

    expect(veredicto.admitida).toBe(true);
  });

  it('sin cupo declarado, el rol compartido no asigna', () => {
    const veredicto = verificarComposicion(
      persona({ area: AreaPersonal.INSTRUCCION }),
      {
        ...FORMULARIO,
        roles: [
          { rol: DUENO, acceso: 'ESCRITURA', cupo: null },
          { rol: COMPARTIDO, acceso: 'APORTA', cupo: null },
        ],
      },
      [],
      COMPARTIDO,
    );

    expect(veredicto.admitida).toBe(false);
    expect(veredicto.motivo).toContain('no tiene cupo configurado');
  });

  it('el dueño NO tiene cupo: asigna cuantas personas admita el formulario', () => {
    const veredicto = verificarComposicion(
      persona({ funcionarioId: 200 }),
      FORMULARIO,
      [
        asignada(1, AreaPersonal.GENERAL),
        asignada(2, AreaPersonal.GENERAL),
        asignada(3, AreaPersonal.TECNICO),
      ],
      DUENO,
    );

    expect(veredicto.admitida).toBe(true);
  });

  it('un formulario sin rol compartido no aplica la regla a nadie', () => {
    const veredicto = verificarComposicion(
      persona(),
      {
        ...FORMULARIO,
        roles: [{ rol: DUENO, acceso: 'ESCRITURA', cupo: null }],
      },
      [],
      DUENO,
    );

    expect(veredicto.admitida).toBe(true);
  });
});

describe('RN-31 y RN-32 · la composición se informa, no bloquea', () => {
  it('un operativo vacío tiene todas las áreas pendientes', () => {
    const estado = estadoDeComposicion(FORMULARIO, []);

    expect(estado.completa).toBe(false);
    expect(estado.areasPendientes).toEqual([
      AreaPersonal.GENERAL,
      AreaPersonal.TECNICO,
      AreaPersonal.INSTRUCCION,
    ]);
  });

  it('RN-31 · con el inspector general y el técnico, falta Instrucción', () => {
    const estado = estadoDeComposicion(FORMULARIO, [
      asignada(1, AreaPersonal.GENERAL),
      asignada(2, AreaPersonal.TECNICO),
    ]);

    expect(estado.areasPendientes).toEqual([AreaPersonal.INSTRUCCION]);
    expect(estado.completa).toBe(false);
  });

  it('RN-32 · sumada la persona de Instrucción, la composición se completa', () => {
    const estado = estadoDeComposicion(FORMULARIO, [
      asignada(1, AreaPersonal.GENERAL),
      asignada(2, AreaPersonal.TECNICO),
      asignada(3, AreaPersonal.INSTRUCCION, COMPARTIDO),
    ]);

    expect(estado.completa).toBe(true);
    expect(estado.areasPendientes).toHaveLength(0);
  });

  it('la primera asignación NO se rechaza por dejar la composición incompleta', () => {
    // Es la razón de que RN-31 y RN-32 se informen en vez de bloquear: aplicarlas al
    // asignar rechazaría siempre a la primera persona.
    const veredicto = verificarComposicion(persona(), FORMULARIO, [], DUENO);

    expect(veredicto.admitida).toBe(true);
    expect(estadoDeComposicion(FORMULARIO, []).completa).toBe(false);
  });
});
