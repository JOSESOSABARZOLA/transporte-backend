/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · planificar el día (flujo guiado en 4 pasos)
 * Archivo: jornada-daf.spec.ts
 * Responsabilidad: Verificar los requisitos del paso 1, la derivación del paso, la sugerencia de libres y la huella de la hoja.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-08
 */

import {
  estadoHojaRuta,
  huellaDeTramos,
  type TramoDeHuella,
} from './hoja-ruta-emision';
import {
  armarRequisitos,
  derivarPaso,
  horaInstitucional,
  type EntradaPaso,
  type EntradaRequisitos,
} from './jornada-daf';
import { sugerirLibres } from './sugerencia-libres';

const LISTO: EntradaRequisitos = {
  cuadro: {
    existe: true,
    estado: 'APROBADO',
    operativosConTransporte: 8,
    formulariosConTransporte: 7,
  },
  turnos: { cargados: true, publicados: true, dia: 3, noche: 1, libre: 1 },
  conductoresIncompletos: [],
  vehiculos: { flota: 6, enTaller: ['PMA7058'], confirmados: 5 },
  ventana: { abierta: true, horaApertura: '15:55', horaCierre: '16:50' },
};

const con = (cambios: Partial<EntradaRequisitos>): EntradaRequisitos => ({
  ...LISTO,
  ...cambios,
});

const requisito = (entrada: EntradaRequisitos, clave: string) =>
  armarRequisitos(entrada).requisitos.find((r) => r.clave === clave);

describe('jornada DAF · requisitos del paso 1', () => {
  it('todo listo: cinco filas en OK y el texto del prototipo', () => {
    const r = armarRequisitos(LISTO);

    expect(r.listos).toBe(true);
    expect(r.pendientes).toBe(0);
    expect(r.requisitos.map((x) => [x.clave, x.estado])).toEqual([
      ['CUADRO', 'OK'],
      ['TURNOS', 'OK'],
      ['CONDUCTORES', 'OK'],
      ['VEHICULOS', 'OK'],
      ['VENTANA', 'OK'],
    ]);
    expect(r.requisitos[0].detalle).toBe(
      '8 operativos de 7 formularios necesitan transporte.',
    );
    expect(r.requisitos[1].detalle).toBe(
      '3 conductores de día, 1 de noche y 1 de libre.',
    );
    expect(r.requisitos[3].titulo).toBe('Vehículos confirmados: 5 salen hoy');
    expect(r.requisitos[3].detalle).toBe('PMA7058 queda en taller.');
    expect(r.requisitos[4].detalle).toBe('Abierta hasta las 16H50.');
  });

  it('cuadro sin aprobar: ofrece ver la matriz', () => {
    const fila = requisito(
      con({ cuadro: { ...LISTO.cuadro, estado: 'BORRADOR' } }),
      'CUADRO',
    );
    expect(fila?.accion).toEqual({ tipo: 'VER_MATRIZ' });
  });

  it('sin operativos que pidan transporte: pendiente', () => {
    const r = armarRequisitos(
      con({ cuadro: { ...LISTO.cuadro, operativosConTransporte: 0 } }),
    );
    expect(r.listos).toBe(false);
    expect(r.requisitos[0].estado).toBe('PENDIENTE');
  });

  it('turnos en borrador: pendiente, con la acción de ir a los turnos', () => {
    const fila = requisito(
      con({ turnos: { ...LISTO.turnos, publicados: false } }),
      'TURNOS',
    );
    expect(fila?.estado).toBe('PENDIENTE');
    expect(fila?.accion).toEqual({ tipo: 'IR_TURNOS' });
  });

  it('nombra al conductor incompleto y qué le falta, con su acción', () => {
    const fila = requisito(
      con({
        conductoresIncompletos: [
          { id: 9, nombre: 'Jorge Quishpe', faltan: ['parqueadero'] },
          { id: 10, nombre: 'Otro', faltan: ['sector', 'contrato'] },
        ],
      }),
      'CONDUCTORES',
    );
    expect(fila?.detalle).toBe(
      'Falta el acta de parqueadero vigente de Jorge Quishpe (y 1 conductor más).',
    );
    expect(fila?.accion).toEqual({
      tipo: 'COMPLETAR_CONDUCTOR',
      conductorId: 9,
    });
  });

  it('vehículos sin confirmar: pregunta cuántos salen, con la flota y el taller', () => {
    const fila = requisito(
      con({ vehiculos: { ...LISTO.vehiculos, confirmados: null } }),
      'VEHICULOS',
    );
    expect(fila?.estado).toBe('PENDIENTE');
    expect(fila?.titulo).toBe('¿Salen hoy estos 5 vehículos?');
    expect(fila?.detalle).toBe('Flota 6 · 1 en taller (PMA7058).');
    expect(fila?.accion).toEqual({ tipo: 'CONFIRMAR_VEHICULOS' });
  });

  it('con un solo vehículo disponible pregunta en singular', () => {
    const fila = requisito(
      con({ vehiculos: { flota: 1, enTaller: [], confirmados: null } }),
      'VEHICULOS',
    );
    expect(fila?.titulo).toBe('¿Sale hoy este vehículo?');
  });

  it('la ventana cerrada queda en ESPERA y NO impide estar listo', () => {
    const r = armarRequisitos(
      con({ ventana: { ...LISTO.ventana, abierta: false } }),
    );
    expect(r.listos).toBe(true);
    expect(r.requisitos[4].estado).toBe('ESPERA');
    expect(r.requisitos[4].titulo).toBe('La asignación abre a las 15H55');
  });

  it('las horas se escriben 08H00', () => {
    expect(horaInstitucional('08:00')).toBe('08H00');
    expect(horaInstitucional(null)).toBe('');
  });
});

describe('jornada DAF · paso inicial', () => {
  const base: EntradaPaso = {
    requisitosListos: true,
    operativos: 10,
    cubiertos: 0,
    vehiculosEnUso: 0,
    vehiculosConGuarda: 0,
    hojasEmitidas: false,
  };

  it('falta un requisito → 1', () => {
    expect(derivarPaso({ ...base, requisitosListos: false }).pasoInicial).toBe(
      1,
    );
  });

  it('requisitos listos y nada cubierto → 2', () => {
    expect(derivarPaso(base).pasoInicial).toBe(2);
  });

  it('cubriendo, con pendientes y ninguna guarda declarada → sigue en 2', () => {
    expect(
      derivarPaso({ ...base, cubiertos: 8, vehiculosEnUso: 5 }).pasoInicial,
    ).toBe(2);
  });

  it('todo cubierto y faltan guardas → 3', () => {
    expect(
      derivarPaso({ ...base, cubiertos: 10, vehiculosEnUso: 5 }).pasoInicial,
    ).toBe(3);
  });

  it('con alguna guarda ya declarada, aunque queden pendientes → 3', () => {
    expect(
      derivarPaso({
        ...base,
        cubiertos: 8,
        vehiculosEnUso: 5,
        vehiculosConGuarda: 2,
      }).pasoInicial,
    ).toBe(3);
  });

  it('asignaciones hechas aunque falte confirmar vehículos → 3, no 1', () => {
    const r = derivarPaso({
      ...base,
      requisitosListos: false,
      cubiertos: 10,
      vehiculosEnUso: 5,
    });
    expect(r.pasoInicial).toBe(3);
    expect(r.completos[1]).toBe(false);
  });

  it('algo cubierto con requisitos pendientes → 2', () => {
    expect(
      derivarPaso({ ...base, requisitosListos: false, cubiertos: 3 })
        .pasoInicial,
    ).toBe(2);
  });

  it('hojas emitidas → 4 aunque falte alguna guarda', () => {
    const r = derivarPaso({
      ...base,
      cubiertos: 10,
      vehiculosEnUso: 5,
      vehiculosConGuarda: 3,
      hojasEmitidas: true,
    });
    expect(r.pasoInicial).toBe(4);
    expect(r.completos[4]).toBe(true);
  });

  it('garajes confirmados → 4 con las hojas todavía pendientes', () => {
    const r = derivarPaso({
      ...base,
      cubiertos: 10,
      vehiculosEnUso: 5,
      vehiculosConGuarda: 5,
    });
    expect(r.pasoInicial).toBe(4);
    expect(r.completos[4]).toBe(false);
  });

  it('todos los vehículos en uso con guarda → 4, y marca los completos', () => {
    const r = derivarPaso({
      ...base,
      cubiertos: 7,
      vehiculosEnUso: 5,
      vehiculosConGuarda: 5,
      hojasEmitidas: true,
    });
    expect(r.pasoInicial).toBe(4);
    expect(r.completos).toEqual({ 1: true, 2: true, 3: true, 4: true });
  });
});

describe('sugerencia de libres', () => {
  const nombres = new Map([
    [7, 'Jorge Quishpe'],
    [8, 'Ana Pérez'],
  ]);

  it('solo aplica si con libres se cubren MÁS operativos, y los nombra', () => {
    const s = sugerirLibres(
      { cubiertos: 7, total: 10, activaciones: [] },
      { cubiertos: 9, total: 10, activaciones: [{ conductorId: 7 }] },
      nombres,
    );
    expect(s).toEqual({
      aplica: true,
      pendientesSinLibres: 3,
      operativosExtra: 2,
      libres: [{ conductorId: 7, nombre: 'Jorge Quishpe' }],
    });
  });

  it('si cubren lo mismo, no se sugiere gastar horas extra', () => {
    const s = sugerirLibres(
      { cubiertos: 7, total: 10, activaciones: [] },
      { cubiertos: 7, total: 10, activaciones: [{ conductorId: 8 }] },
      nombres,
    );
    expect(s.aplica).toBe(false);
    expect(s.libres).toEqual([]);
    expect(s.pendientesSinLibres).toBe(3);
  });
});

describe('hoja de ruta · huella y estado', () => {
  const t = (id: number, cambios: Partial<TramoDeHuella> = {}) => ({
    id,
    tipo: 'COMPLETO',
    horaInicio: '08:00',
    horaFin: '12:00',
    vehiculoId: 11,
    compartidoConTramoId: null,
    ...cambios,
  });

  it('la huella no depende del orden y cambia si cambia un tramo', () => {
    const a = huellaDeTramos([t(1), t(2)]);
    expect(huellaDeTramos([t(2), t(1)])).toBe(a);
    expect(huellaDeTramos([t(1), t(2, { horaFin: '13:00' })])).not.toBe(a);
    expect(huellaDeTramos([t(1)])).not.toBe(a);
    expect(a).toHaveLength(64);
  });

  it('sin emisión, pendiente; misma huella, emitida; otra, pendiente por cambio', () => {
    const h = huellaDeTramos([t(1)]);
    expect(estadoHojaRuta(h, null)).toBe('PENDIENTE');
    expect(estadoHojaRuta(h, { huella: h })).toBe('EMITIDA');
    expect(estadoHojaRuta(h, { huella: 'otra' })).toBe('PENDIENTE_CAMBIO');
  });
});
