/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · planificar el día (paso 2)
 * Archivo: candidatos.spec.ts
 * Responsabilidad: Verificar la categoría, el motivo en palabras y el orden de los candidatos.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-08
 */

import {
  clasificarCandidato,
  ordenarCandidatos,
  type EntradaCandidato,
} from './candidatos';
import { franjaDe } from './linea-de-tiempo';

const INICIO = '05:00';

const entrada = (
  conductorId: number,
  cambios: Partial<EntradaCandidato> = {},
): EntradaCandidato => ({
  conductorId,
  nombre: `CONDUCTOR ${conductorId}`,
  turno: 'DIA',
  ventanaTurno: franjaDe('06:00', '18:00', INICIO),
  vehiculoId: 10 + conductorId,
  placa: `PMA00${conductorId}`,
  estado: 'OK',
  motivos: [],
  actual: false,
  choque: null,
  zonasComunes: [],
  ...cambios,
});

describe('candidatos · categoría y motivo', () => {
  it('sin bloqueos ni avisos de turno: disponible en ese horario', () => {
    const c = clasificarCandidato(entrada(1));

    expect(c.categoria).toBe('DISPONIBLE');
    expect(c.motivo).toBe('Disponible en ese horario');
    expect(c.asignable).toBe(true);
  });

  it('si ya trabaja hoy en la misma zonal, lo dice', () => {
    const c = clasificarCandidato(entrada(1, { zonasComunes: ['Calderón'] }));

    expect(c.motivo).toBe('Disponible · ya trabaja en Calderón');
  });

  it('fuera de su turno: «Asignar igual», con el turno y su horario en 08H00', () => {
    const c = clasificarCandidato(
      entrada(2, {
        turno: 'NOCHE',
        ventanaTurno: franjaDe('18:00', '07:00', INICIO),
        estado: 'AVISO',
        motivos: [
          {
            codigo: 'FUERA_DE_TURNO',
            mensaje: 'Fuera de su turno (18H00 a 07H00): horas extra.',
            tipo: 'AVISO',
          },
        ],
      }),
    );

    expect(c.categoria).toBe('FUERA_TURNO');
    expect(c.motivo).toBe('Fuera de su turno (Noche 18H00–07H00)');
    expect(c.asignable).toBe(true);
    expect(c.avisos).toEqual([]);
  });

  it('se pisa con otro operativo: ocupado, con el horario y el identificador', () => {
    const c = clasificarCandidato(
      entrada(3, {
        estado: 'DURO',
        motivos: [
          {
            codigo: 'SOLAPAMIENTO',
            mensaje: 'Se pisa con OCPMO-001 (completo) (08H00 a 16H30).',
            tipo: 'DURO',
          },
        ],
        choque: {
          etiqueta: 'OCPMO-001',
          franja: franjaDe('08:00', '16:30', INICIO),
        },
      }),
    );

    expect(c.categoria).toBe('OCUPADO');
    expect(c.motivo).toBe('Ocupado 08H00–16H30 con OCPMO-001');
    expect(c.asignable).toBe(false);
  });

  it('otro bloqueo: ocupado con el motivo de la política tal cual', () => {
    const c = clasificarCandidato(
      entrada(3, {
        estado: 'DURO',
        motivos: [
          {
            codigo: 'JORNADA_MAXIMA',
            mensaje: 'La jornada quedaría en 15 h: supera el máximo de 14 h.',
            tipo: 'DURO',
          },
        ],
      }),
    );

    expect(c.categoria).toBe('OCUPADO');
    expect(c.motivo).toBe(
      'La jornada quedaría en 15 h: supera el máximo de 14 h.',
    );
  });

  it('de libre sin activar: no disponible, con la opción que lo habilita', () => {
    const c = clasificarCandidato(
      entrada(4, {
        turno: 'LIBRE',
        ventanaTurno: null,
        estado: 'DURO',
        motivos: [
          {
            codigo: 'LIBRE_NO_ACTIVADO',
            mensaje: 'Está libre ese día.',
            tipo: 'DURO',
          },
        ],
      }),
    );

    expect(c.categoria).toBe('LIBRE_INACTIVO');
    expect(c.motivo).toBe('De libre hoy · active «Usar conductores de libre»');
    expect(c.asignable).toBe(false);
  });

  it('los demás avisos viajan aparte y no cambian la categoría', () => {
    const c = clasificarCandidato(
      entrada(1, {
        estado: 'AVISO',
        motivos: [
          {
            codigo: 'JORNADA_LARGA',
            mensaje: 'La jornada quedaría en 13 h (más de 12 h).',
            tipo: 'AVISO',
          },
        ],
      }),
    );

    expect(c.categoria).toBe('DISPONIBLE');
    expect(c.avisos).toEqual(['La jornada quedaría en 13 h (más de 12 h).']);
  });
});

describe('candidatos · orden', () => {
  it('disponibles → fuera de turno → ocupados → libres sin activar → asignado actual', () => {
    const lista = ordenarCandidatos([
      entrada(1, {
        estado: 'DURO',
        motivos: [
          { codigo: 'LIBRE_NO_ACTIVADO', mensaje: 'Libre.', tipo: 'DURO' },
        ],
      }),
      entrada(2, {
        estado: 'DURO',
        motivos: [{ codigo: 'SOLAPAMIENTO', mensaje: 'Pisa.', tipo: 'DURO' }],
      }),
      entrada(3, { actual: true }),
      entrada(4, {
        estado: 'AVISO',
        motivos: [
          { codigo: 'FUERA_DE_TURNO', mensaje: 'Fuera.', tipo: 'AVISO' },
        ],
      }),
      entrada(5),
      entrada(6),
    ]);

    expect(lista.map((c) => c.conductorId)).toEqual([5, 6, 4, 2, 1, 3]);
    expect(lista.at(-1)?.actual).toBe(true);
  });
});

describe('candidatos · comparte unidad (2026-10-21)', () => {
  const solapa = {
    estado: 'DURO' as const,
    motivos: [
      {
        codigo: 'SOLAPAMIENTO' as const,
        mensaje: 'Se pisa con OCPMO-001 (completo)',
        tipo: 'DURO' as const,
      },
    ],
    choque: {
      etiqueta: 'OCPMO-001',
      franja: franjaDe('08:00', '16:30', INICIO),
    },
  };
  const conUnidad = { operativoId: 66, identificador: 'OCPMO-001' };

  it('ocupado SOLO por la unidad que puede compartir: «Comparte unidad con X», no «Ocupado»', () => {
    const c = clasificarCandidato(
      entrada(53, { ...solapa, compartirCon: conUnidad }),
    );

    expect(c.categoria).toBe('COMPARTE');
    expect(c.motivo).toBe('Comparte unidad con OCPMO-001');
    expect(c.asignable).toBe(false);
    expect(c.compartirCon).toEqual(conUnidad);
  });

  it('con otro motivo duro además del solapamiento, sigue ocupado', () => {
    const c = clasificarCandidato(
      entrada(53, {
        ...solapa,
        motivos: [
          ...solapa.motivos,
          { codigo: 'ASIENTOS', mensaje: 'No caben', tipo: 'DURO' },
        ],
        compartirCon: conUnidad,
      }),
    );

    expect(c.categoria).toBe('OCUPADO');
    expect(c.compartirCon).toBeNull();
  });

  it('va después de los disponibles y antes de los ocupados', () => {
    const lista = ordenarCandidatos([
      entrada(1, { ...solapa }),
      entrada(53, { ...solapa, compartirCon: conUnidad }),
      entrada(2),
    ]);

    expect(lista.map((c) => c.categoria)).toEqual([
      'DISPONIBLE',
      'COMPARTE',
      'OCUPADO',
    ]);
  });
});
