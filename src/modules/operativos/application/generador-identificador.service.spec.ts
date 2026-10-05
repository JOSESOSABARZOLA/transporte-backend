/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Operativos
 * Archivo: generador-identificador.service.spec.ts
 * Responsabilidad: Verificar la elección de prefijo (PV-27) y la fecha del código.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 */

import { AreaPersonal, type FormularioPrefijo } from '@prisma/client';

import { ValidacionError } from '../../../common/errors/errores-dominio';
import type { FormulariosService } from '../../configuracion/application/formularios.service';
import { GeneradorIdentificadorService } from './generador-identificador.service';

const FORMULARIO = { id: 8, nombre: 'INSPECCIONES' };
const JORNADA = new Date(Date.UTC(2026, 6, 31));

const prefijo = (
  texto: string,
  esPredeterminado = false,
  areaAplica: AreaPersonal | null = null,
): FormularioPrefijo =>
  ({
    id: texto.length,
    formularioId: FORMULARIO.id,
    prefijo: texto,
    areaAplica,
    esPredeterminado,
    esAdicional: false,
  }) as FormularioPrefijo;

/** El prefijo con el que se nombran los adicionales del formulario. 2026-08-20. */
const prefijoDeAdicional = (
  texto: string,
  areaAplica: AreaPersonal | null = null,
): FormularioPrefijo =>
  ({
    ...prefijo(texto, false, areaAplica),
    esAdicional: true,
  }) as FormularioPrefijo;

/** La configuración real del PMO tras la migración del 2026-08-20. */
const PMO = [prefijo('OCPMO', true), prefijoDeAdicional('OCAPMO')];

/** La configuración real del formulario 8 desde el 2026-09-08: prefijo por área. */
const FORM8 = [
  prefijo('IG', false, AreaPersonal.GENERAL),
  prefijo('IT', false, AreaPersonal.TECNICO),
  prefijoDeAdicional('IGA', AreaPersonal.GENERAL),
  prefijoDeAdicional('ITA', AreaPersonal.TECNICO),
];

/** El formulario 6 desde el 2026-09-17: prefijo por área, INSTRUCCION deja de ser inerte. */
const FORM6 = [
  prefijo('IGNECU', false, AreaPersonal.GENERAL),
  prefijo('ITNECU', false, AreaPersonal.TECNICO),
  prefijo('INECU', false, AreaPersonal.INSTRUCCION),
];

const armar = (prefijos: FormularioPrefijo[]) => {
  const obtenerPrefijos = jest.fn().mockResolvedValue(prefijos);

  return {
    servicio: new GeneradorIdentificadorService({
      obtenerPrefijos,
    } as unknown as FormulariosService),
    obtenerPrefijos,
  };
};

describe('GeneradorIdentificadorService · composición', () => {
  it('compone el identificador con la forma de los mockups aprobados', async () => {
    const { servicio } = armar([prefijo('ICNECU')]);

    const identificador = await servicio.generar(FORMULARIO, 1, JORNADA);

    expect(identificador).toBe('ICNECU-001-31-JUL-2026');
  });

  it('rellena el secuencial a tres cifras', async () => {
    const { servicio } = armar([prefijo('ICNECU')]);

    expect(await servicio.generar(FORMULARIO, 7, JORNADA)).toContain('-007-');
    expect(await servicio.generar(FORMULARIO, 42, JORNADA)).toContain('-042-');
    expect(await servicio.generar(FORMULARIO, 999, JORNADA)).toContain('-999-');
  });

  it('usa el DÍA DE LA JORNADA y no el día anterior', async () => {
    // `cuad_fecha` es una fecha de calendario en UTC. Leída con los captadores locales
    // en Quito -UTC-5- sería el día anterior, y ese código se imprime en la matriz.
    const { servicio } = armar([prefijo('PMO')]);

    const identificador = await servicio.generar(
      FORMULARIO,
      1,
      new Date(Date.UTC(2026, 7, 1)),
    );

    expect(identificador).toBe('PMO-001-01-AGO-2026');
  });

  it('el primer día del año no se desplaza al año anterior', async () => {
    const { servicio } = armar([prefijo('PMO')]);

    const identificador = await servicio.generar(
      FORMULARIO,
      1,
      new Date(Date.UTC(2027, 0, 1)),
    );

    expect(identificador).toBe('PMO-001-01-ENE-2027');
  });

  it('rechaza un secuencial fuera del rango de tres cifras', async () => {
    const { servicio } = armar([prefijo('PMO')]);

    await expect(servicio.generar(FORMULARIO, 1000, JORNADA)).rejects.toThrow(
      ValidacionError,
    );
    await expect(servicio.generar(FORMULARIO, 0, JORNADA)).rejects.toThrow(
      ValidacionError,
    );
  });
});

describe('GeneradorIdentificadorService · elección del prefijo (PV-27)', () => {
  it('con un solo prefijo, usa ese', async () => {
    const { servicio } = armar([prefijo('ICNECU')]);

    expect(await servicio.generar(FORMULARIO, 1, JORNADA)).toContain('ICNECU-');
  });

  it('con varios SIN área y uno predeterminado, usa el predeterminado', async () => {
    const { servicio } = armar([prefijo('A'), prefijo('B', true)]);

    expect(await servicio.generar(FORMULARIO, 1, JORNADA)).toContain('B-');
  });

  it('con varios SIN área y ninguno predeterminado, se DETIENE nombrando el formulario', async () => {
    // No se elige por orden alfabético: produciría un código institucional que no
    // significa lo que aparenta. Es el caso de los formularios 5, 6 y 7 (PV-27 abierto).
    const { servicio } = armar([prefijo('A'), prefijo('B')]);

    const fallo: unknown = await servicio
      .generar(FORMULARIO, 1, JORNADA)
      .catch((error: unknown) => error);

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect((fallo as ValidacionError).message).toContain('INSPECCIONES');
    expect((fallo as ValidacionError).message).toContain('predeterminado');
  });

  it('sin ningún prefijo configurado, también se detiene', async () => {
    const { servicio } = armar([]);

    const fallo: unknown = await servicio
      .generar(FORMULARIO, 1, JORNADA)
      .catch((error: unknown) => error);

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect((fallo as ValidacionError).message).toContain('administrador');
  });

  it('consulta los prefijos por el identificador del formulario', async () => {
    const { servicio, obtenerPrefijos } = armar([prefijo('PMO')]);

    await servicio.generar(FORMULARIO, 1, JORNADA);

    expect(obtenerPrefijos).toHaveBeenCalledWith(8);
  });

  /**
   * PV-27 SIGUE ABIERTO PARA EL FORMULARIO 7: su prefijo aún no trae `areaAplica` ni
   * predeterminado (el 5, el 6 y el 8 ya lo resolvieron por área). Esta prueba usa un formulario
   * sintético con dos prefijos sin área ni predeterminado —la forma que aún se detiene—, para que
   * no se dé por cerrado mientras falte el criterio del negocio.
   */
  it('un formulario con prefijos sin área ni predeterminado (el 7) sigue deteniéndose', async () => {
    const { servicio } = armar([prefijo('A'), prefijo('B')]);

    const fallo: unknown = await servicio
      .generar(FORMULARIO, 1, JORNADA)
      .catch((error: unknown) => error);

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect((fallo as ValidacionError).message).toContain('predeterminado');
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PV-27 RESUELTO PARA EL FORMULARIO 8 · 2026-09-08. El prefijo se elige por el ÁREA del
 * personal asignado: GENERAL → IG (adicional IGA), TECNICO → IT (adicional ITA). Un
 * operativo corresponde a UNA sola área; la mezcla se rechaza.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('GeneradorIdentificadorService · prefijo por área (formulario 8)', () => {
  it('GENERAL usa el prefijo IG', async () => {
    const { servicio } = armar(FORM8);

    expect(
      await servicio.generar(FORMULARIO, 1, JORNADA, false, [
        AreaPersonal.GENERAL,
      ]),
    ).toBe('IG-001-31-JUL-2026');
  });

  it('TECNICO usa el prefijo IT', async () => {
    const { servicio } = armar(FORM8);

    expect(
      await servicio.generar(FORMULARIO, 1, JORNADA, false, [
        AreaPersonal.TECNICO,
      ]),
    ).toContain('IT-');
  });

  it('el adicional de GENERAL usa IGA y el de TECNICO, ITA', async () => {
    const { servicio } = armar(FORM8);

    expect(
      await servicio.generar(FORMULARIO, 1, JORNADA, true, [
        AreaPersonal.GENERAL,
      ]),
    ).toContain('IGA-');
    expect(
      await servicio.generar(FORMULARIO, 1, JORNADA, true, [
        AreaPersonal.TECNICO,
      ]),
    ).toContain('ITA-');
  });

  it('varias personas de la MISMA área eligen igual', async () => {
    const { servicio } = armar(FORM8);

    expect(
      await servicio.generar(FORMULARIO, 1, JORNADA, false, [
        AreaPersonal.GENERAL,
        AreaPersonal.GENERAL,
      ]),
    ).toContain('IG-');
  });

  it('mezcla de áreas: se rechaza, no se adivina el prefijo', async () => {
    const { servicio } = armar(FORM8);

    const fallo: unknown = await servicio
      .generar(FORMULARIO, 1, JORNADA, false, [
        AreaPersonal.GENERAL,
        AreaPersonal.TECNICO,
      ])
      .catch((error: unknown) => error);

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect((fallo as ValidacionError).message).toContain('mezcla');
  });

  it('sin personal que defina el área, se detiene', async () => {
    const { servicio } = armar(FORM8);

    await expect(
      servicio.generar(FORMULARIO, 1, JORNADA, false, []),
    ).rejects.toBeInstanceOf(ValidacionError);
  });

  it('exigirQueAdmitaAdicionales acepta al 8 aunque el adicional dependa del área', async () => {
    await expect(
      armar(FORM8).servicio.exigirQueAdmitaAdicionales(FORMULARIO),
    ).resolves.toBeUndefined();
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PV-27 RESUELTO PARA EL FORMULARIO 6 · 2026-09-17. Como el 8: prefijo por área —GENERAL →
 * IGNECU, TECNICO → ITNECU, INSTRUCCION → INECU—. `INECU` deja de ser inerte porque el DMIT
 * pasó a REGISTRAR su Instrucción como operativo propio (excepción a PER-08 acotada a este cupo).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('GeneradorIdentificadorService · prefijo por área (formulario 6)', () => {
  it('GENERAL usa IGNECU y TECNICO usa ITNECU', async () => {
    const { servicio } = armar(FORM6);

    expect(
      await servicio.generar(FORMULARIO, 1, JORNADA, false, [
        AreaPersonal.GENERAL,
      ]),
    ).toContain('IGNECU-');
    expect(
      await servicio.generar(FORMULARIO, 1, JORNADA, false, [
        AreaPersonal.TECNICO,
      ]),
    ).toContain('ITNECU-');
  });

  it('INSTRUCCION usa INECU: ya no es inerte, el DMIT lo registra', async () => {
    const { servicio } = armar(FORM6);

    expect(
      await servicio.generar(FORMULARIO, 1, JORNADA, false, [
        AreaPersonal.INSTRUCCION,
      ]),
    ).toBe('INECU-001-31-JUL-2026');
  });

  it('la mezcla de áreas se rechaza (el split la evita en el registro)', async () => {
    const { servicio } = armar(FORM6);

    const fallo: unknown = await servicio
      .generar(FORMULARIO, 1, JORNADA, false, [
        AreaPersonal.INSTRUCCION,
        AreaPersonal.GENERAL,
      ])
      .catch((error: unknown) => error);

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect((fallo as ValidacionError).message).toContain('mezcla');
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * EL PREFIJO DEL ADICIONAL · 2026-08-20
 *
 * Un adicional del PMO no es `OCPMO-007`: es `OCAPMO-001`. Prefijo distinto y serie
 * propia. Lo que aquí se protege es que la elección se haga por la MARCA de la fila y no
 * por el texto del prefijo: la A de `OCAPMO` significa «adicional», pero la I de `IG` e
 * `IT` significa otra cosa, y una regla que acierta por casualidad no es una regla.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('GeneradorIdentificadorService · el prefijo del adicional', () => {
  it('usa el prefijo marcado como de adicional, no el predeterminado', async () => {
    const { servicio } = armar(PMO);

    expect(await servicio.generar(FORMULARIO, 1, JORNADA, true)).toBe(
      'OCAPMO-001-31-JUL-2026',
    );
  });

  it('un operativo ordinario del mismo formulario sigue usando el suyo', async () => {
    const { servicio } = armar(PMO);

    expect(await servicio.generar(FORMULARIO, 1, JORNADA, false)).toBe(
      'OCPMO-001-31-JUL-2026',
    );
  });

  /**
   * LOS DOS CÓDIGOS 001 CONVIVEN, y es exactamente lo que el negocio pidió: el adicional
   * enumera aparte. No se confunden porque el prefijo los separa.
   */
  it('el adicional 001 y el ordinario 001 coexisten sin ambigüedad', async () => {
    const { servicio } = armar(PMO);

    const ordinario = await servicio.generar(FORMULARIO, 1, JORNADA, false);
    const adicional = await servicio.generar(FORMULARIO, 1, JORNADA, true);

    expect(ordinario).not.toBe(adicional);
    expect(adicional).toContain('OCAPMO-');
  });

  /**
   * SIN VALOR DE RESPALDO. Nombrar el adicional con el prefijo ordinario lo haría
   * indistinguible de un operativo planificado en la matriz y en la orden de servicio,
   * que es justo la diferencia que se pidió poder ver.
   */
  it('se detiene si el formulario no declara prefijo de adicional', async () => {
    const { servicio } = armar([prefijo('ICNECU')]);

    const fallo: unknown = await servicio
      .generar(FORMULARIO, 1, JORNADA, true)
      .catch((error: unknown) => error);

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect((fallo as ValidacionError).message).toContain(
      'no admite operativos adicionales',
    );
  });

  it('se detiene si hay más de uno marcado, en lugar de elegir', async () => {
    const { servicio } = armar([
      prefijo('OCPMO', true),
      prefijoDeAdicional('OCAPMO'),
      prefijoDeAdicional('OCXPMO'),
    ]);

    const fallo: unknown = await servicio
      .generar(FORMULARIO, 1, JORNADA, true)
      .catch((error: unknown) => error);

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect((fallo as ValidacionError).message).toContain('INSPECCIONES');
  });

  /** La comprobación anticipada del servicio usa el mismo criterio, no una copia. */
  it('exigirQueAdmitaAdicionales acepta al PMO y rechaza a quien no lo declara', async () => {
    await expect(
      armar(PMO).servicio.exigirQueAdmitaAdicionales(FORMULARIO),
    ).resolves.toBeUndefined();

    await expect(
      armar([prefijo('ICNECU')]).servicio.exigirQueAdmitaAdicionales(
        FORMULARIO,
      ),
    ).rejects.toBeInstanceOf(ValidacionError);
  });
});
