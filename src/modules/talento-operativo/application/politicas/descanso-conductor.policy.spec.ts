/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Políticas de descanso
 * Archivo: descanso-conductor.policy.spec.ts
 * Responsabilidad: Verificar las cuatro reglas que protegen a quien conduce.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 */

import { CODIGOS_ERROR } from '../../../../common/errors/codigos-error';
import { RangoHorario } from '../../../operativos/domain/rango-horario';
import { verificarDescansoConductor } from './descanso-conductor.policy';

const dia = (texto: string): Date => new Date(`${texto}T00:00:00.000Z`);
const MIERCOLES = dia('2026-08-05');

const contexto = (esPatrulla = true) => ({
  fecha: MIERCOLES,
  esPatrulla,
  diasDescansoPatrulla: 1,
});

/** Contexto con horario, para las dos reglas que M-17 incorporó. */
const conHorario = (
  horaInicio: string,
  horaFin: string,
  jornadaMaximaHoras = 12,
) => ({
  ...contexto(false),
  rango: RangoHorario.de(horaInicio, horaFin),
  jornadaMaximaHoras,
});

const conduccion = (
  identificador: string,
  horaInicio: string,
  horaFin: string,
) => ({
  identificador,
  rango: RangoHorario.de(horaInicio, horaFin),
  horas: RangoHorario.de(horaInicio, horaFin).duracionHoras,
});

describe('verificarDescansoConductor', () => {
  it('un conductor sin antecedentes es elegible', () => {
    expect(
      verificarDescansoConductor({ nombre: 'VIVANCO JORGE' }, contexto()),
    ).toEqual({ elegible: true });
  });

  it('el conductor ausente no es elegible, con la fecha de retorno', () => {
    const veredicto = verificarDescansoConductor(
      {
        nombre: 'VIVANCO JORGE',
        ausencia: { estado: 'VACACIONES', hasta: dia('2026-08-15') },
      },
      contexto(),
    );

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.PERSONA_NO_DISPONIBLE);
    expect(veredicto.motivo).toContain('VIVANCO JORGE');
    expect(veredicto.motivo).toContain('2026-08-15');
  });

  it('RN-44 · quien condujo en patrulla el día anterior no repite', () => {
    const veredicto = verificarDescansoConductor(
      { nombre: 'VIVANCO JORGE', ultimaPatrulla: dia('2026-08-04') },
      contexto(),
    );

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.CONDUCTOR_PATRULLA_CONSECUTIVA);
    expect(veredicto.motivo).toContain('el día anterior');
  });

  it('la regla solo aplica si el operativo es de patrulla', () => {
    const veredicto = verificarDescansoConductor(
      { nombre: 'VIVANCO JORGE', ultimaPatrulla: dia('2026-08-04') },
      contexto(false),
    );

    expect(veredicto.elegible).toBe(true);
  });

  it('con dos días de por medio ya puede conducir en patrulla', () => {
    const veredicto = verificarDescansoConductor(
      { nombre: 'VIVANCO JORGE', ultimaPatrulla: dia('2026-08-03') },
      contexto(),
    );

    expect(veredicto.elegible).toBe(true);
  });

  it('la ausencia pesa más que la patrulla consecutiva', () => {
    const veredicto = verificarDescansoConductor(
      {
        nombre: 'VIVANCO JORGE',
        ausencia: { estado: 'PERMISO', hasta: dia('2026-08-06') },
        ultimaPatrulla: dia('2026-08-04'),
      },
      contexto(),
    );

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.PERSONA_NO_DISPONIBLE);
  });
});

describe('VAL-21 · el conductor no conduce dos operativos cruzados', () => {
  it('caso 7 del plan · el horario cruzado se rechaza nombrando el operativo', () => {
    const veredicto = verificarDescansoConductor(
      {
        nombre: 'VIVANCO JORGE',
        conduccionesDelDia: [
          conduccion('PMO-001-05-AGO-2026', '08:00', '14:00'),
        ],
      },
      conHorario('12:00', '16:00'),
    );

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.SOLAPAMIENTO_HORARIO);
    expect(veredicto.motivo).toContain('PMO-001-05-AGO-2026');
    expect(veredicto.motivo).toContain('08H00 A 14H00');
  });

  it('encadenar sin cruzarse sí se admite', () => {
    // Intervalos semiabiertos: terminar a las 12H00 y empezar a las 12H00 es encadenar.
    const veredicto = verificarDescansoConductor(
      {
        nombre: 'VIVANCO JORGE',
        conduccionesDelDia: [
          conduccion('PMO-001-05-AGO-2026', '08:00', '12:00'),
        ],
      },
      conHorario('12:00', '16:00'),
    );

    expect(veredicto.elegible).toBe(true);
  });

  it('el cruce de medianoche se resuelve con la misma aritmética', () => {
    const veredicto = verificarDescansoConductor(
      {
        nombre: 'VIVANCO JORGE',
        conduccionesDelDia: [
          conduccion('INSP-001-05-AGO-2026', '22:00', '02:00'),
        ],
      },
      conHorario('01:00', '05:00'),
    );

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.SOLAPAMIENTO_HORARIO);
  });

  it('sin horario en el contexto, la regla no se aplica', () => {
    const veredicto = verificarDescansoConductor(
      {
        nombre: 'VIVANCO JORGE',
        conduccionesDelDia: [
          conduccion('PMO-001-05-AGO-2026', '08:00', '14:00'),
        ],
      },
      contexto(false),
    );

    expect(veredicto.elegible).toBe(true);
  });
});

describe('VAL-22 · la jornada máxima al volante', () => {
  it('la suma que supera el umbral se rechaza', () => {
    const veredicto = verificarDescansoConductor(
      {
        nombre: 'VIVANCO JORGE',
        conduccionesDelDia: [
          conduccion('PMO-001-05-AGO-2026', '00:00', '06:00'),
          conduccion('PMO-002-05-AGO-2026', '06:00', '12:00'),
        ],
      },
      conHorario('12:00', '15:00', 12),
    );

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.JORNADA_MAXIMA_SUPERADA);
    expect(veredicto.motivo).toContain('15 horas');
    expect(veredicto.motivo).toContain('12');
  });

  it('justo en el umbral todavía se admite', () => {
    const veredicto = verificarDescansoConductor(
      {
        nombre: 'VIVANCO JORGE',
        conduccionesDelDia: [
          conduccion('PMO-001-05-AGO-2026', '00:00', '06:00'),
        ],
      },
      conHorario('06:00', '12:00', 12),
    );

    expect(veredicto.elegible).toBe(true);
  });

  it('el umbral llega como parámetro: bajarlo cambia el veredicto', () => {
    const antecedentes = {
      nombre: 'VIVANCO JORGE',
      conduccionesDelDia: [conduccion('PMO-001-05-AGO-2026', '00:00', '06:00')],
    };

    expect(
      verificarDescansoConductor(antecedentes, conHorario('06:00', '12:00', 12))
        .elegible,
    ).toBe(true);
    expect(
      verificarDescansoConductor(antecedentes, conHorario('06:00', '12:00', 8))
        .elegible,
    ).toBe(false);
  });

  it('el solapamiento se responde antes que la jornada', () => {
    const veredicto = verificarDescansoConductor(
      {
        nombre: 'VIVANCO JORGE',
        conduccionesDelDia: [
          conduccion('PMO-001-05-AGO-2026', '00:00', '11:00'),
        ],
      },
      conHorario('10:00', '20:00', 12),
    );

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.SOLAPAMIENTO_HORARIO);
  });

  it('un conductor sin conducciones ese día siempre cabe', () => {
    const veredicto = verificarDescansoConductor(
      { nombre: 'VIVANCO JORGE', conduccionesDelDia: [] },
      conHorario('06:00', '12:00', 12),
    );

    expect(veredicto.elegible).toBe(true);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LAS DOS QUE FALTABAN, incorporadas el 2026-08-31.
 *
 * Desde M-17 la cabecera de la política decía que el tipo de contrato y el tope de
 * salidas pesadas «siguen sin poder aplicarse». Ya se pueden: el contrato es una columna
 * del conductor y el tope se cuenta desde los operativos que condujo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('RN-26 y RN-33 · el conductor de nombramiento', () => {
  const nocturno = { ...contexto(false), esNocturno: true };

  it('no puede conducir de noche', () => {
    const veredicto = verificarDescansoConductor(
      { nombre: 'MERA CARLOS', tipoContrato: 'NOMBRAMIENTO' },
      nocturno,
    );

    expect(veredicto.elegible).toBe(false);
    expect(veredicto.codigo).toBe(CODIGOS_ERROR.CONTRATO_NO_ADMITE_TURNO);
    expect(veredicto.motivo).toContain('MERA CARLOS');
  });

  it('tampoco en fin de semana', () => {
    const veredicto = verificarDescansoConductor(
      { nombre: 'MERA CARLOS', tipoContrato: 'NOMBRAMIENTO' },
      { ...contexto(false), esFinDeSemana: true },
    );

    expect(veredicto.elegible).toBe(false);
    expect(veredicto.codigo).toBe(CODIGOS_ERROR.CONTRATO_NO_ADMITE_TURNO);
  });

  /**
   * Sin ventana configurada (aquí `contexto(false)` no la trae), la regla cae al criterio
   * antiguo: solo bloquea noche y fin de semana. En producción SÍ llega la ventana y gobierna
   * (ver la prueba de abajo).
   */
  it('sí puede conducir un diurno de día laborable', () => {
    const veredicto = verificarDescansoConductor(
      { nombre: 'MERA CARLOS', tipoContrato: 'NOMBRAMIENTO' },
      contexto(false),
    );

    expect(veredicto.elegible).toBe(true);
  });

  /**
   * VENTANA ESTRICTA (2026-09-22). Con la ventana del nombramiento (08H00–16H00) configurada, un
   * operativo de día laborable FUERA de ella —17H00 a 19H00— se rechaza aunque no sea noche ni fin
   * de semana. Antes se permitía (horas extra); el negocio pidió endurecerlo.
   */
  it('con la ventana, un diurno FUERA de horario ya no puede', () => {
    const veredicto = verificarDescansoConductor(
      { nombre: 'MERA CARLOS', tipoContrato: 'NOMBRAMIENTO' },
      {
        ...contexto(false),
        rango: RangoHorario.de('17:00', '19:00'),
        ventanaNombramiento: { inicio: '08:00', fin: '16:00' },
      },
    );

    expect(veredicto.elegible).toBe(false);
    expect(veredicto.codigo).toBe(CODIGOS_ERROR.CONTRATO_NO_ADMITE_TURNO);
    expect(veredicto.motivo).toContain('fuera de su horario');
  });

  it('el de contrato ocasional sí conduce de noche', () => {
    const veredicto = verificarDescansoConductor(
      { nombre: 'VIVANCO JORGE', tipoContrato: 'CONTRATO' },
      nocturno,
    );

    expect(veredicto.elegible).toBe(true);
  });

  /**
   * LA QUE DE VERDAD DISCRIMINA. Sin contrato registrado la regla NO se aplica, y eso es
   * parte de la regla: `cond_tipo_contrato` es nulable porque la flota se carga a mano, y
   * suponer «nombramiento» impediría asignar de noche a medio catálogo.
   */
  it('sin contrato registrado, la regla no se aplica', () => {
    const veredicto = verificarDescansoConductor(
      { nombre: 'SIN FICHA', tipoContrato: null },
      nocturno,
    );

    expect(veredicto.elegible).toBe(true);
  });
});

describe('RN-25 · el tope de salidas pesadas del conductor', () => {
  const nocturno = {
    ...contexto(false),
    esNocturno: true,
    topeSalidasPesadas: 3,
  };

  it('rechaza a quien ya alcanzó el tope', () => {
    const veredicto = verificarDescansoConductor(
      { nombre: 'VIVANCO JORGE', salidasPesadas: 3 },
      nocturno,
    );

    expect(veredicto.elegible).toBe(false);
    expect(veredicto.codigo).toBe(CODIGOS_ERROR.TOPE_SALIDAS_PESADAS);
    expect(veredicto.motivo).toContain('otro conductor');
  });

  it('admite a quien va por debajo', () => {
    const veredicto = verificarDescansoConductor(
      { nombre: 'VIVANCO JORGE', salidasPesadas: 2 },
      nocturno,
    );

    expect(veredicto.elegible).toBe(true);
  });

  /** Sumar un martes diurno al tope no tendría sentido: la regla reparte las guardias. */
  it('un diurno de día laborable no cuenta, aunque esté en el tope', () => {
    const veredicto = verificarDescansoConductor(
      { nombre: 'VIVANCO JORGE', salidasPesadas: 9 },
      { ...contexto(false), topeSalidasPesadas: 3 },
    );

    expect(veredicto.elegible).toBe(true);
  });

  it('sin tope configurado la regla no se aplica', () => {
    const veredicto = verificarDescansoConductor(
      { nombre: 'VIVANCO JORGE', salidasPesadas: 9 },
      { ...contexto(false), esNocturno: true },
    );

    expect(veredicto.elegible).toBe(true);
  });
});
