/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Objetos de valor del dominio
 * Archivo: ubicacion-operativa.spec.ts
 * Responsabilidad: Verificar las zonales y la dualidad catálogo/captura libre.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 */

import { ValidacionError } from '../../../common/errors/errores-dominio';
import { UbicacionOperativa } from './ubicacion-operativa';

describe('UbicacionOperativa · punto del catálogo', () => {
  it('se construye con una zonal y un punto', () => {
    const ubicacion = UbicacionOperativa.enPuntoDelCatalogo([7], 42);

    expect(ubicacion.puntoId).toBe(42);
    expect(ubicacion.puntoLibre).toBeNull();
    expect(ubicacion.origenDelPunto).toBe('CATALOGO');
  });

  it('RN-19 · admite varias zonales cuando la jornada se reparte', () => {
    const ubicacion = UbicacionOperativa.enPuntoDelCatalogo([7, 3], 42);

    expect(ubicacion.abarcaVariasZonales).toBe(true);
    expect(ubicacion.incluyeZonal(3)).toBe(true);
    expect(ubicacion.incluyeZonal(9)).toBe(false);
  });

  it('caso 13 del plan · sin ninguna zonal se rechaza', () => {
    expect(() => UbicacionOperativa.enPuntoDelCatalogo([], 42)).toThrow(
      ValidacionError,
    );
  });

  it('rechaza un identificador de zonal que no puede existir', () => {
    expect(() => UbicacionOperativa.enPuntoDelCatalogo([0], 42)).toThrow(
      ValidacionError,
    );
    expect(() => UbicacionOperativa.enPuntoDelCatalogo([-1], 42)).toThrow(
      ValidacionError,
    );
  });

  it('rechaza un punto que no puede existir', () => {
    expect(() => UbicacionOperativa.enPuntoDelCatalogo([7], 0)).toThrow(
      ValidacionError,
    );
  });
});

describe('UbicacionOperativa · captura libre (RN-20)', () => {
  it('se construye con el texto del punto adicional', () => {
    const ubicacion = UbicacionOperativa.enPuntoLibre(
      [7],
      '  Redondel del Ciclista  ',
    );

    expect(ubicacion.puntoId).toBeNull();
    expect(ubicacion.puntoLibre).toBe('Redondel del Ciclista');
    expect(ubicacion.origenDelPunto).toBe('CAPTURA_LIBRE');
  });

  it('rechaza el texto vacío: elegir ADICIONALES obliga a escribir cuál', () => {
    expect(() => UbicacionOperativa.enPuntoLibre([7], '   ')).toThrow(
      ValidacionError,
    );
  });
});

describe('UbicacionOperativa · construcción desde datos sueltos', () => {
  it('caso 12 del plan · con punto de catálogo y punto libre a la vez se rechaza', () => {
    expect(() =>
      UbicacionOperativa.de({
        zonalIds: [7],
        puntoId: 42,
        puntoLibre: 'Otro sitio',
        capturaLibrePermitida: true,
      }),
    ).toThrow(ValidacionError);
  });

  it('sin ninguno de los dos también se rechaza: lo exige ck_operativo_punto', () => {
    expect(() =>
      UbicacionOperativa.de({ zonalIds: [7], capturaLibrePermitida: true }),
    ).toThrow(ValidacionError);
    expect(() =>
      UbicacionOperativa.de({
        zonalIds: [7],
        puntoId: null,
        puntoLibre: '  ',
        capturaLibrePermitida: true,
      }),
    ).toThrow(ValidacionError);
  });

  it('resuelve al catálogo cuando llega el identificador', () => {
    const ubicacion = UbicacionOperativa.de({
      zonalIds: [7],
      puntoId: 42,
      capturaLibrePermitida: true,
    });
    expect(ubicacion.origenDelPunto).toBe('CATALOGO');
  });

  it('resuelve a captura libre cuando llega el texto', () => {
    const ubicacion = UbicacionOperativa.de({
      zonalIds: [7],
      puntoLibre: 'Redondel del Ciclista',
      capturaLibrePermitida: true,
    });
    expect(ubicacion.origenDelPunto).toBe('CAPTURA_LIBRE');
  });

  /**
   * RN-20, AGREGADA EL 2026-08-11. `ClasificacionControl` comprobaba esto desde M-14 y
   * este objeto no, así que el servidor aceptaba un punto de encuentro capturado
   * libremente en cualquiera de los nueve formularios. La interfaz lo tapaba; una
   * petición directa entraba sin obstáculo.
   */
  describe('el punto libre solo donde el catálogo lo prevé', () => {
    it('se rechaza si el formulario no admite ADICIONALES en el punto', () => {
      expect(() =>
        UbicacionOperativa.de({
          zonalIds: [7],
          puntoLibre: 'Redondel del Ciclista',
          capturaLibrePermitida: false,
        }),
      ).toThrow(ValidacionError);
    });

    it('el mensaje remite al catálogo, que es la salida que le queda', () => {
      try {
        UbicacionOperativa.de({
          zonalIds: [7],
          puntoLibre: 'Redondel del Ciclista',
          capturaLibrePermitida: false,
        });
        fail('debió rechazarlo');
      } catch (error) {
        expect((error as ValidacionError).message).toContain(
          'elija uno del catálogo',
        );
      }
    });

    it('un punto del catálogo no se ve afectado por la bandera', () => {
      const ubicacion = UbicacionOperativa.de({
        zonalIds: [7],
        puntoId: 42,
        capturaLibrePermitida: false,
      });

      expect(ubicacion.origenDelPunto).toBe('CATALOGO');
    });
  });

  it('el mensaje del rechazo dice qué hacer', () => {
    try {
      UbicacionOperativa.de({
        zonalIds: [7],
        puntoId: 42,
        puntoLibre: 'X',
        capturaLibrePermitida: true,
      });
      fail('debió rechazarlo');
    } catch (error) {
      expect((error as ValidacionError).message).toContain('no las dos cosas');
    }
  });
});

describe('UbicacionOperativa · comportamiento de objeto de valor', () => {
  it('las zonales repetidas se colapsan y quedan ordenadas', () => {
    const ubicacion = UbicacionOperativa.enPuntoDelCatalogo([7, 3, 7], 42);
    expect(ubicacion.zonalIds).toEqual([3, 7]);
  });

  it('el orden en que se indicaron las zonales no cambia la identidad', () => {
    const uno = UbicacionOperativa.enPuntoDelCatalogo([3, 7], 42);
    const otro = UbicacionOperativa.enPuntoDelCatalogo([7, 3], 42);

    expect(uno.equivaleA(otro)).toBe(true);
  });

  it('distingue dos ubicaciones con puntos distintos', () => {
    const uno = UbicacionOperativa.enPuntoDelCatalogo([7], 42);
    const otro = UbicacionOperativa.enPuntoDelCatalogo([7], 43);

    expect(uno.equivaleA(otro)).toBe(false);
  });
});
