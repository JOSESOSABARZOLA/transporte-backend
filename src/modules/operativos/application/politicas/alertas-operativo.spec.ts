/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Asignación de personal y alertas
 * Archivo: alertas-operativo.spec.ts
 * Responsabilidad: Verificar POL-06 y las seis alertas de FASE2 §18.1.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 */

import {
  EstadoTransporte,
  PoliticaVehiculo,
  TipoTransporte,
} from '@prisma/client';

import { calcularAlertas, type EstadoParaAlertas } from './alertas-operativo';

/** Operativo completo: sin ninguna alerta. Cada prueba rompe lo que necesita. */
const COMPLETO: EstadoParaAlertas = {
  personasAsignadas: 2,
  politicaVehiculo: PoliticaVehiculo.REQUERIDO,
  estadoTransporte: EstadoTransporte.ASIGNADO,
  condicionanteNocturno: false,
  esNocturno: false,
  puntoLibre: null,
  tipoLibre: null,
  tipoTransporte: TipoTransporte.COMPLETO,
  transporteLiberado: false,
};

const codigos = (estado: EstadoParaAlertas): string[] =>
  calcularAlertas(estado).map((alerta) => alerta.codigo);

describe('POL-06 · el operativo completo no produce alertas', () => {
  it('no devuelve ninguna', () => {
    expect(calcularAlertas(COMPLETO)).toHaveLength(0);
  });
});

describe('ALV-01 · personal sin asignar', () => {
  it('se emite cuando no hay nadie', () => {
    const alertas = calcularAlertas({ ...COMPLETO, personasAsignadas: 0 });

    expect(alertas).toHaveLength(1);
    expect(alertas[0].codigo).toBe('ALV-01');
    expect(alertas[0].campo).toBe('personal');
    expect(alertas[0].critica).toBe(false);
  });

  it('caso 1 del plan · con una sola persona ya no se emite', () => {
    expect(codigos({ ...COMPLETO, personasAsignadas: 1 })).not.toContain(
      'ALV-01',
    );
  });
});

describe('ALV-02 y ALV-03 · transporte pendiente', () => {
  it('se emiten juntas mientras la DAF no asigne', () => {
    const alertas = calcularAlertas({
      ...COMPLETO,
      estadoTransporte: EstadoTransporte.PENDIENTE,
    });

    expect(alertas.map((alerta) => alerta.codigo)).toEqual([
      'ALV-02',
      'ALV-03',
    ]);
    expect(alertas.every((alerta) => !alerta.critica)).toBe(true);
  });

  it('desaparecen al asignar transporte', () => {
    expect(
      codigos({ ...COMPLETO, estadoTransporte: EstadoTransporte.ASIGNADO }),
    ).toHaveLength(0);
  });

  it('PROPIOS_MEDIOS también las retira: la DAF ya decidió', () => {
    expect(
      codigos({
        ...COMPLETO,
        estadoTransporte: EstadoTransporte.PROPIOS_MEDIOS,
      }),
    ).toHaveLength(0);
  });

  it('RN-41 y RN-42 · el formulario que no habilita vehículo no las emite', () => {
    expect(
      codigos({
        ...COMPLETO,
        politicaVehiculo: PoliticaVehiculo.NO_APLICA,
        estadoTransporte: EstadoTransporte.PENDIENTE,
      }),
    ).toHaveLength(0);
  });

  it('el formulario CONDICIONAL sí las emite: la DAF aún no decidió', () => {
    expect(
      codigos({
        ...COMPLETO,
        politicaVehiculo: PoliticaVehiculo.CONDICIONAL,
        estadoTransporte: EstadoTransporte.PENDIENTE,
      }),
    ).toContain('ALV-02');
  });
});

describe('ALV-04 · conductor obligatorio no asignado', () => {
  const nocturnoSinConductor: EstadoParaAlertas = {
    ...COMPLETO,
    estadoTransporte: EstadoTransporte.PENDIENTE,
    condicionanteNocturno: true,
    esNocturno: true,
  };

  it('sustituye a ALV-02 y es crítica', () => {
    const alertas = calcularAlertas(nocturnoSinConductor);
    const conductor = alertas.find((alerta) => alerta.campo === 'conductor');

    expect(conductor?.codigo).toBe('ALV-04');
    expect(conductor?.critica).toBe(true);
    expect(alertas.map((alerta) => alerta.codigo)).not.toContain('ALV-02');
  });

  it('el mensaje explica que sin conductor la jornada no cierra', () => {
    const alertas = calcularAlertas(nocturnoSinConductor);

    expect(alertas[0].mensaje).toContain('no se puede cerrar');
  });

  it('hacen falta las DOS condiciones: condicionante y horario nocturno', () => {
    expect(codigos({ ...nocturnoSinConductor, esNocturno: false })).toContain(
      'ALV-02',
    );
    expect(
      codigos({ ...nocturnoSinConductor, condicionanteNocturno: false }),
    ).toContain('ALV-02');
  });

  it('desaparece al asignar conductor', () => {
    expect(
      codigos({
        ...nocturnoSinConductor,
        estadoTransporte: EstadoTransporte.ASIGNADO,
      }),
    ).toHaveLength(0);
  });
});

describe('ALV-06 · valor capturado como adicional', () => {
  it('marca el punto capturado libremente, nombrándolo', () => {
    const alertas = calcularAlertas({
      ...COMPLETO,
      puntoLibre: 'Frente al mercado',
    });

    expect(alertas).toHaveLength(1);
    expect(alertas[0].codigo).toBe('ALV-06');
    expect(alertas[0].campo).toBe('puntoEncuentro');
    expect(alertas[0].mensaje).toContain('Frente al mercado');
  });

  it('marca el tipo capturado libremente', () => {
    const alertas = calcularAlertas({
      ...COMPLETO,
      tipoLibre: 'Control de escombros',
    });

    expect(alertas[0].campo).toBe('tipoControl');
  });

  it('los dos a la vez producen dos alertas, una por celda', () => {
    const alertas = calcularAlertas({
      ...COMPLETO,
      puntoLibre: 'Frente al mercado',
      tipoLibre: 'Control de escombros',
    });

    expect(alertas).toHaveLength(2);
    expect(alertas.every((alerta) => alerta.codigo === 'ALV-06')).toBe(true);
  });

  it('no es un error: no es crítica', () => {
    const alertas = calcularAlertas({ ...COMPLETO, puntoLibre: 'Adicional' });

    expect(alertas[0].critica).toBe(false);
  });
});

describe('el cálculo es completo, no incremental (RN-55)', () => {
  it('un operativo recién registrado acumula todas las que le faltan', () => {
    const recienRegistrado: EstadoParaAlertas = {
      personasAsignadas: 0,
      politicaVehiculo: PoliticaVehiculo.REQUERIDO,
      estadoTransporte: EstadoTransporte.PENDIENTE,
      condicionanteNocturno: false,
      esNocturno: false,
      puntoLibre: null,
      tipoLibre: null,
      tipoTransporte: TipoTransporte.COMPLETO,
      transporteLiberado: false,
    };

    expect(codigos(recienRegistrado)).toEqual(['ALV-01', 'ALV-02', 'ALV-03']);
  });

  it('la función no recibe las alertas anteriores: no puede dejar residuos', () => {
    // Se llama dos veces con estados distintos; la segunda no conserva nada de la
    // primera. Es la garantía estructural de RN-55.
    const antes = calcularAlertas({ ...COMPLETO, personasAsignadas: 0 });
    const despues = calcularAlertas({ ...COMPLETO, personasAsignadas: 1 });

    expect(antes).toHaveLength(1);
    expect(despues).toHaveLength(0);
  });
});

describe('Transporte requerido (2026-10-07)', () => {
  const pendiente: EstadoParaAlertas = {
    ...COMPLETO,
    estadoTransporte: EstadoTransporte.PENDIENTE,
  };

  it('PROPIOS_MEDIOS no espera conductor: sin ALV-02/03/04', () => {
    expect(
      codigos({ ...pendiente, tipoTransporte: TipoTransporte.PROPIOS_MEDIOS }),
    ).toEqual([]);
    expect(
      codigos({
        ...pendiente,
        tipoTransporte: TipoTransporte.PROPIOS_MEDIOS,
        condicionanteNocturno: true,
        esNocturno: true,
      }),
    ).toEqual([]);
  });

  it('ALV-07 avisa a la DAF de un transporte liberado, primero', () => {
    expect(codigos({ ...pendiente, transporteLiberado: true })).toEqual([
      'ALV-07',
      'ALV-02',
      'ALV-03',
    ]);
  });

  it('ALV-07 desaparece al reasignar (deja de estar pendiente)', () => {
    expect(codigos({ ...COMPLETO, transporteLiberado: true })).toEqual([]);
  });
});
