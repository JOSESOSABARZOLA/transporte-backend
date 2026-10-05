/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Políticas de descanso
 * Archivo: descanso-personal.policy.spec.ts
 * Responsabilidad: Verificar las seis reglas que protegen el descanso del personal.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * Es la prueba más importante del sistema. Cada caso que falla aquí es un funcionario
 * que el día de mañana sale dos veces seguidas en patrulla o encadena dieciséis horas.
 */

import { EstadoTurno, TipoContrato } from '@prisma/client';

import { CODIGOS_ERROR } from '../../../../common/errors/codigos-error';
import { RangoHorario } from '../../../operativos/domain/rango-horario';
import {
  verificarDescanso,
  type AntecedentesPersona,
  type ContextoAsignacion,
  type UmbralesDescanso,
} from './descanso-personal.policy';

const dia = (texto: string): Date => new Date(`${texto}T00:00:00.000Z`);

/** Los umbrales sembrados en `t_parametro_politica`. */
const UMBRALES: UmbralesDescanso = {
  diasDescansoPatrulla: 1,
  topeSalidasPesadas: 3,
  jornadaMaximaHoras: 12,
  ventanaDiurna: { inicio: '08:00', fin: '16:30' },
  ventanaNocturna: { inicio: '17:30', fin: '02:00' },
  ventanaNombramiento: { inicio: '08:00', fin: '16:00' },
};

const MIERCOLES = dia('2026-08-05');
const SABADO = dia('2026-08-08');

const persona = (
  parcial: Partial<AntecedentesPersona> = {},
): AntecedentesPersona => ({
  nombre: 'BENAVIDES FERNANDO',
  tipoContrato: TipoContrato.OCASIONAL,
  ultimaPatrulla: null,
  salidasPesadas: 0,
  asignacionesDelDia: [],
  ...parcial,
});

const contexto = (
  parcial: Partial<ContextoAsignacion> = {},
): ContextoAsignacion => ({
  fecha: MIERCOLES,
  rango: RangoHorario.de('08:00', '16:00'),
  esPatrulla: false,
  esNocturno: false,
  esFinDeSemana: false,
  ...parcial,
});

const asignacion = (identificador: string, inicio: string, fin: string) => {
  const rango = RangoHorario.de(inicio, fin);
  return { identificador, rango, horas: rango.duracionHoras };
};

describe('verificarDescanso · el camino feliz', () => {
  it('una persona sin antecedentes es elegible', () => {
    expect(verificarDescanso(persona(), contexto(), UMBRALES)).toEqual({
      elegible: true,
    });
  });
});

describe('1 · Disponibilidad (RN-30)', () => {
  it('caso 1 del plan · quien está de vacaciones no es elegible, con la fecha de retorno', () => {
    const veredicto = verificarDescanso(
      persona({ ausencia: { estado: 'VACACIONES', hasta: dia('2026-08-15') } }),
      contexto(),
      UMBRALES,
    );

    expect(veredicto.elegible).toBe(false);
    expect(veredicto.codigo).toBe(CODIGOS_ERROR.PERSONA_NO_DISPONIBLE);
    expect(veredicto.motivo).toContain('BENAVIDES FERNANDO');
    expect(veredicto.motivo).toContain('vacaciones');
    expect(veredicto.motivo).toContain('2026-08-15');
  });

  it('el motivo escribe el estado en palabras, no el enumerado', () => {
    const veredicto = verificarDescanso(
      persona({
        ausencia: { estado: 'REPOSO_MEDICO', hasta: dia('2026-08-10') },
      }),
      contexto(),
      UMBRALES,
    );

    expect(veredicto.motivo).toContain('reposo médico');
    expect(veredicto.motivo).not.toContain('REPOSO_MEDICO');
  });
});

describe('1·bis · Descanso de la cobertura de Instrucción', () => {
  it('el turno DESCANSO ese día excluye a la persona', () => {
    const veredicto = verificarDescanso(
      persona({ turnoCobertura: EstadoTurno.DESCANSO }),
      contexto(),
      UMBRALES,
    );

    expect(veredicto.elegible).toBe(false);
    expect(veredicto.codigo).toBe(CODIGOS_ERROR.PERSONA_EN_DESCANSO);
    expect(veredicto.motivo).toContain('BENAVIDES FERNANDO');
    expect(veredicto.motivo).toContain('descanso');
  });

  it('sin turno (undefined) la persona sigue siendo elegible', () => {
    // Una celda vacía en la cobertura llega como `turnoCobertura` ausente.
    expect(verificarDescanso(persona(), contexto(), UMBRALES).elegible).toBe(
      true,
    );
  });

  it('la ausencia manda sobre el descanso: informa el retorno', () => {
    const veredicto = verificarDescanso(
      persona({
        ausencia: { estado: 'VACACIONES', hasta: dia('2026-08-15') },
        turnoCobertura: EstadoTurno.DESCANSO,
      }),
      contexto(),
      UMBRALES,
    );

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.PERSONA_NO_DISPONIBLE);
  });
});

describe('1·ter · Ventana del turno de la cobertura', () => {
  it('turno DIURNO: un operativo dentro de 08:00–16:30 es elegible', () => {
    const veredicto = verificarDescanso(
      persona({ turnoCobertura: EstadoTurno.DIURNO }),
      contexto({ rango: RangoHorario.de('08:00', '16:00') }),
      UMBRALES,
    );

    expect(veredicto.elegible).toBe(true);
  });

  it('turno DIURNO: un operativo fuera de la ventana se rechaza con su motivo', () => {
    const veredicto = verificarDescanso(
      persona({ turnoCobertura: EstadoTurno.DIURNO }),
      contexto({ rango: RangoHorario.de('17:00', '19:00') }),
      UMBRALES,
    );

    expect(veredicto.elegible).toBe(false);
    expect(veredicto.codigo).toBe(CODIGOS_ERROR.TURNO_FUERA_DE_RANGO);
    expect(veredicto.motivo).toContain('diurno');
    expect(veredicto.motivo).toContain('08H00 a 16H30');
  });

  it('turno NOCTURNO: un operativo que cruza la medianoche dentro de 17:30–02:00 es elegible', () => {
    const veredicto = verificarDescanso(
      persona({ turnoCobertura: EstadoTurno.NOCTURNO }),
      contexto({ rango: RangoHorario.de('22:00', '01:00') }),
      UMBRALES,
    );

    expect(veredicto.elegible).toBe(true);
  });

  it('turno NOCTURNO: un operativo diurno queda fuera de la ventana', () => {
    const veredicto = verificarDescanso(
      persona({ turnoCobertura: EstadoTurno.NOCTURNO }),
      contexto({ rango: RangoHorario.de('08:00', '16:00') }),
      UMBRALES,
    );

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.TURNO_FUERA_DE_RANGO);
    expect(veredicto.motivo).toContain('nocturno');
  });

  it('sin ventana configurada la regla se abstiene, no bloquea', () => {
    const veredicto = verificarDescanso(
      persona({ turnoCobertura: EstadoTurno.DIURNO }),
      contexto({ rango: RangoHorario.de('22:00', '23:00') }),
      { ...UMBRALES, ventanaDiurna: undefined },
    );

    expect(veredicto.elegible).toBe(true);
  });
});

describe('2 · Tipo de contrato (RN-26 y RN-33)', () => {
  it('caso 2 del plan · nombramiento en turno nocturno', () => {
    const veredicto = verificarDescanso(
      persona({ tipoContrato: TipoContrato.NOMBRAMIENTO }),
      contexto({ rango: RangoHorario.de('22:00', '01:00'), esNocturno: true }),
      UMBRALES,
    );

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.CONTRATO_NO_ADMITE_TURNO);
    expect(veredicto.motivo).toContain('nocturno');
  });

  it('VENTANA ESTRICTA (2026-09-22) · nombramiento en horas extra de día laborable se bloquea', () => {
    // Antes (VAL-13) un operativo de 17H00 a 19H00 en día laborable SÍ se permitía. Ahora cae
    // fuera de la jornada del nombramiento (08H00–16H00) y se rechaza, sin ser noche ni fin de
    // semana. Es la reversa que pidió el negocio.
    const veredicto = verificarDescanso(
      persona({ tipoContrato: TipoContrato.NOMBRAMIENTO }),
      contexto({ rango: RangoHorario.de('17:00', '19:00') }),
      UMBRALES,
    );

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.CONTRATO_NO_ADMITE_TURNO);
    expect(veredicto.motivo).toContain('fuera de su horario');
    expect(veredicto.motivo).toContain('08H00 a 16H00');
  });

  it('caso 3 del plan · nombramiento en sábado', () => {
    const veredicto = verificarDescanso(
      persona({ tipoContrato: TipoContrato.NOMBRAMIENTO }),
      contexto({ fecha: SABADO, esFinDeSemana: true }),
      UMBRALES,
    );

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.CONTRATO_NO_ADMITE_TURNO);
    expect(veredicto.motivo).toContain('fin de semana');
  });

  it('caso 4 del plan · ocasional en turno nocturno SÍ es elegible', () => {
    const veredicto = verificarDescanso(
      persona({ tipoContrato: TipoContrato.OCASIONAL }),
      contexto({ esNocturno: true }),
      UMBRALES,
    );

    expect(veredicto.elegible).toBe(true);
  });

  it('el nombramiento en turno diurno de día laborable es elegible', () => {
    const veredicto = verificarDescanso(
      persona({ tipoContrato: TipoContrato.NOMBRAMIENTO }),
      contexto(),
      UMBRALES,
    );

    expect(veredicto.elegible).toBe(true);
  });
});

describe('3 · Patrulla consecutiva (RN-24)', () => {
  it('caso 5 del plan · quien salió ayer en patrulla, a patrulla diurna, CON EL NOMBRE', () => {
    const veredicto = verificarDescanso(
      persona({ ultimaPatrulla: dia('2026-08-04') }),
      contexto({ esPatrulla: true }),
      UMBRALES,
    );

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.PATRULLA_CONSECUTIVA);
    expect(veredicto.motivo).toContain('BENAVIDES FERNANDO');
    expect(veredicto.motivo).toContain('el día anterior');
  });

  it('caso 6 del plan · lo mismo en patrulla nocturna: la regla no distingue', () => {
    const veredicto = verificarDescanso(
      persona({
        tipoContrato: TipoContrato.OCASIONAL,
        ultimaPatrulla: dia('2026-08-04'),
      }),
      contexto({ esPatrulla: true, esNocturno: true }),
      UMBRALES,
    );

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.PATRULLA_CONSECUTIVA);
  });

  it('no aplica si el operativo NO es de patrulla', () => {
    const veredicto = verificarDescanso(
      persona({ ultimaPatrulla: dia('2026-08-04') }),
      contexto({ esPatrulla: false }),
      UMBRALES,
    );

    expect(veredicto.elegible).toBe(true);
  });

  it('con dos días de por medio ya puede repetir', () => {
    const veredicto = verificarDescanso(
      persona({ ultimaPatrulla: dia('2026-08-03') }),
      contexto({ esPatrulla: true }),
      UMBRALES,
    );

    expect(veredicto.elegible).toBe(true);
  });

  it('el umbral es un parámetro: con dos días de descanso, el 3 de agosto todavía bloquea', () => {
    const veredicto = verificarDescanso(
      persona({ ultimaPatrulla: dia('2026-08-03') }),
      contexto({ esPatrulla: true }),
      { ...UMBRALES, diasDescansoPatrulla: 2 },
    );

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.PATRULLA_CONSECUTIVA);
    expect(veredicto.motivo).toContain('hace 2 días');
  });

  it('una patrulla el mismo día también bloquea', () => {
    const veredicto = verificarDescanso(
      persona({ ultimaPatrulla: MIERCOLES }),
      contexto({ esPatrulla: true }),
      UMBRALES,
    );

    expect(veredicto.motivo).toContain('ese mismo día');
  });

  it('una patrulla posterior a la fecha evaluada no descansa a nadie', () => {
    const veredicto = verificarDescanso(
      persona({ ultimaPatrulla: dia('2026-08-20') }),
      contexto({ esPatrulla: true }),
      UMBRALES,
    );

    expect(veredicto.elegible).toBe(true);
  });
});

describe('4 · Tope de salidas pesadas (RN-25)', () => {
  it('caso 7 del plan · quien alcanzó el tope, a turno nocturno', () => {
    const veredicto = verificarDescanso(
      persona({ salidasPesadas: 3 }),
      contexto({ esNocturno: true }),
      UMBRALES,
    );

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.TOPE_SALIDAS_PESADAS);
    expect(veredicto.motivo).toContain('repartir la carga');
  });

  it('el tope no aplica a un turno diurno de día laborable', () => {
    const veredicto = verificarDescanso(
      persona({ salidasPesadas: 9 }),
      contexto(),
      UMBRALES,
    );

    expect(veredicto.elegible).toBe(true);
  });

  it('con una salida menos que el tope todavía es elegible', () => {
    const veredicto = verificarDescanso(
      persona({ salidasPesadas: 2 }),
      contexto({ esNocturno: true }),
      UMBRALES,
    );

    expect(veredicto.elegible).toBe(true);
  });

  it('también aplica en fin de semana', () => {
    const veredicto = verificarDescanso(
      persona({ salidasPesadas: 3 }),
      contexto({ fecha: SABADO, esFinDeSemana: true }),
      UMBRALES,
    );

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.TOPE_SALIDAS_PESADAS);
  });
});

describe('5 · Solapamiento horario (RN-28)', () => {
  it('caso 8 del plan · 22:00–02:00 contra 01:00–05:00, con el operativo en conflicto', () => {
    const veredicto = verificarDescanso(
      persona({
        asignacionesDelDia: [asignacion('OCPMO-004', '22:00', '02:00')],
      }),
      contexto({ rango: RangoHorario.de('01:00', '05:00') }),
      UMBRALES,
    );

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.SOLAPAMIENTO_HORARIO);
    expect(veredicto.motivo).toContain('OCPMO-004');
    expect(veredicto.motivo).toContain('22H00 A 02H00');
  });

  it('dos operativos encadenados no se solapan', () => {
    const veredicto = verificarDescanso(
      persona({
        asignacionesDelDia: [asignacion('OCF-001', '08:00', '12:00')],
      }),
      contexto({ rango: RangoHorario.de('12:00', '16:00') }),
      UMBRALES,
    );

    expect(veredicto.elegible).toBe(true);
  });

  it('detecta el solapamiento parcial', () => {
    const veredicto = verificarDescanso(
      persona({
        asignacionesDelDia: [asignacion('OCF-001', '08:00', '12:00')],
      }),
      contexto({ rango: RangoHorario.de('11:00', '15:00') }),
      UMBRALES,
    );

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.SOLAPAMIENTO_HORARIO);
  });
});

describe('6 · Jornada máxima diaria (RN-36)', () => {
  it('caso 9 del plan · la suma supera la jornada', () => {
    const veredicto = verificarDescanso(
      persona({
        asignacionesDelDia: [asignacion('OCF-001', '00:00', '08:00')],
      }),
      contexto({ rango: RangoHorario.de('09:00', '16:00') }),
      UMBRALES,
    );

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.JORNADA_MAXIMA_SUPERADA);
    expect(veredicto.motivo).toContain('15 horas');
    expect(veredicto.motivo).toContain('12 horas');
  });

  it('justo en el umbral todavía es elegible', () => {
    const veredicto = verificarDescanso(
      persona({
        asignacionesDelDia: [asignacion('OCF-001', '00:00', '04:00')],
      }),
      contexto({ rango: RangoHorario.de('08:00', '16:00') }),
      UMBRALES,
    );

    expect(veredicto.elegible).toBe(true);
  });

  it('caso 10 del plan · bajar el umbral a 8 cambia el resultado sin tocar código', () => {
    const antecedentes = persona();
    const asignacionNueva = contexto({
      rango: RangoHorario.de('08:00', '18:00'),
    });

    expect(
      verificarDescanso(antecedentes, asignacionNueva, UMBRALES).elegible,
    ).toBe(true);

    expect(
      verificarDescanso(antecedentes, asignacionNueva, {
        ...UMBRALES,
        jornadaMaximaHoras: 8,
      }).codigo,
    ).toBe(CODIGOS_ERROR.JORNADA_MAXIMA_SUPERADA);
  });

  it('suma las medias horas sin arrastrar el error de la coma flotante', () => {
    const veredicto = verificarDescanso(
      persona({
        asignacionesDelDia: [
          asignacion('OCF-001', '00:00', '02:30'),
          asignacion('OCF-002', '03:00', '05:30'),
        ],
      }),
      contexto({ rango: RangoHorario.de('08:00', '10:30') }),
      UMBRALES,
    );

    expect(veredicto.elegible).toBe(true);
  });
});

describe('el orden de las reglas', () => {
  it('caso 11 del plan · con dos motivos devuelve SOLO el primero', () => {
    // De vacaciones, de nombramiento, en turno nocturno y con el tope alcanzado.
    // Gana la disponibilidad, que es la regla 1.
    const veredicto = verificarDescanso(
      persona({
        tipoContrato: TipoContrato.NOMBRAMIENTO,
        ausencia: { estado: 'VACACIONES', hasta: dia('2026-08-15') },
        salidasPesadas: 9,
        ultimaPatrulla: dia('2026-08-04'),
      }),
      contexto({ esPatrulla: true, esNocturno: true }),
      UMBRALES,
    );

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.PERSONA_NO_DISPONIBLE);
  });

  it('el contrato pesa más que la patrulla consecutiva', () => {
    const veredicto = verificarDescanso(
      persona({
        tipoContrato: TipoContrato.NOMBRAMIENTO,
        ultimaPatrulla: dia('2026-08-04'),
      }),
      contexto({
        esPatrulla: true,
        rango: RangoHorario.de('22:00', '01:00'),
        esNocturno: true,
      }),
      UMBRALES,
    );

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.CONTRATO_NO_ADMITE_TURNO);
  });

  it('la patrulla consecutiva pesa más que el tope', () => {
    const veredicto = verificarDescanso(
      persona({ ultimaPatrulla: dia('2026-08-04'), salidasPesadas: 9 }),
      contexto({ esPatrulla: true, esNocturno: true }),
      UMBRALES,
    );

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.PATRULLA_CONSECUTIVA);
  });

  it('el solapamiento pesa más que la jornada máxima', () => {
    const veredicto = verificarDescanso(
      persona({
        asignacionesDelDia: [asignacion('OCF-001', '00:00', '10:00')],
      }),
      contexto({ rango: RangoHorario.de('09:00', '16:00') }),
      UMBRALES,
    );

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.SOLAPAMIENTO_HORARIO);
  });
});

describe('caso 12 del plan · contenido del veredicto', () => {
  it('solo lleva elegible, codigo y motivo', () => {
    const veredicto = verificarDescanso(
      persona({ ausencia: { estado: 'PERMISO', hasta: dia('2026-08-06') } }),
      contexto(),
      UMBRALES,
    );

    expect(Object.keys(veredicto).sort()).toEqual([
      'codigo',
      'elegible',
      'motivo',
    ]);
  });

  it('el veredicto favorable no lleva ni código ni motivo', () => {
    expect(
      Object.keys(verificarDescanso(persona(), contexto(), UMBRALES)),
    ).toEqual(['elegible']);
  });

  it('NINGÚN dato estructurado del funcionario sale en el veredicto', () => {
    const veredicto = verificarDescanso(
      persona({ ausencia: { estado: 'VACACIONES', hasta: dia('2026-08-15') } }),
      contexto(),
      UMBRALES,
    );

    const serializado = JSON.stringify(veredicto);
    for (const campo of [
      'cedula',
      'telefono',
      'area',
      'tipoContrato',
      'funcionarioId',
      'direccion',
    ]) {
      expect(serializado).not.toContain(campo);
    }
  });
});
