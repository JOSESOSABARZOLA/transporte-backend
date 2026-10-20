/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Operativos · Trámites de Inspección
 * Archivo: inspeccion-tramites.client.spec.ts
 * Responsabilidad: Fijar cómo se pregunta a Inspección y cómo se lee lo que responde.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 */

import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import { appConfig } from '../../../config/app.config';
import {
  InspeccionNoDisponibleError,
  InspeccionTramitesClient,
} from './inspeccion-tramites.client';

const URL_INSPECCION = 'https://inspeccion.interno/api';

const respuesta = (cuerpo: unknown, ok = true, status = 200): Response =>
  ({
    ok,
    status,
    json: () => Promise.resolve(cuerpo),
  }) as Response;

/** La forma real que entregó el equipo de Inspección (recortada a dos inspectores). */
const CUERPO_REAL = {
  recurso: 'asignaciones',
  registroAsignacion: [
    {
      inspector: 'Montenegro Orozco Karen Michelle',
      cedula: '1700000003',
      usuario: 'kmontenegro',
      asignaciones: [
        {
          codigoTramite: 'ESCRITO-26-0489',
          nroSitra: 'GADDMQ-AMC-SG-2026-18949-E',
          predio: null,
          zonal: 'Eugenio Espejo',
          materia: null,
          fechaAsignacion: null,
          fechaCreacion: null,
          tipoTramite: 'ESCRITOS',
          estado: 'ASIGNADO',
          numeroFap: null,
        },
      ],
    },
    {
      inspector: 'Vizcaino Trujillo Mayra Rocio',
      cedula: '1700000004',
      usuario: 'mvizcaino',
      asignaciones: [
        {
          codigoTramite: 'DENUNCIA-26-1023',
          nroSitra: 'GADDMQ-AMC-SG-2024-04936-E',
          predio: '317883',
          zonal: 'Manuela Sáenz',
          materia: 'Espacio público',
          tipoTramite: 'DENUNCIA',
          estado: 'ASIGNADO',
        },
        // Sin código: no se puede elegir ni volver a comprobar, se descarta.
        { codigoTramite: '', zonal: 'Quitumbe' },
      ],
    },
    // Sin cédula: no se puede cruzar con la ficha, se descarta.
    { inspector: 'Sin cédula', asignaciones: [] },
  ],
};

describe('InspeccionTramitesClient', () => {
  const original = { ...appConfig.inspeccion };
  let peticiones: jest.Mock<Promise<Response>, [string, RequestInit]>;
  let cliente: InspeccionTramitesClient;

  beforeEach(() => {
    appConfig.inspeccion.urlApi = URL_INSPECCION;
    peticiones = jest
      .fn<Promise<Response>, [string, RequestInit]>()
      .mockResolvedValue(respuesta(CUERPO_REAL));
    globalThis.fetch = peticiones as unknown as typeof fetch;
    cliente = new InspeccionTramitesClient();
  });

  afterEach(() => {
    Object.assign(appConfig.inspeccion, original);
  });

  it('pregunta por la fecha con el token de la sesión y prefijo Bearer', async () => {
    await cliente.consultar('2026-09-29', 'abc.def');

    const [destino, opciones] = peticiones.mock.calls[0];
    expect(destino).toBe(`${URL_INSPECCION}/operativos?fecha=2026-09-29`);
    expect((opciones.headers as Record<string, string>).Authorization).toBe(
      'Bearer abc.def',
    );
  });

  it('normaliza la respuesta: descarta inspectores sin cédula y trámites sin código', async () => {
    const registro = await cliente.consultar('2026-09-29', 'abc.def');

    expect(registro.map((fila) => fila.cedula)).toEqual([
      '1700000003',
      '1700000004',
    ]);
    expect(registro[1].tramites).toEqual([
      {
        codigoTramite: 'DENUNCIA-26-1023',
        nroSitra: 'GADDMQ-AMC-SG-2024-04936-E',
        predio: '317883',
        zonal: 'Manuela Sáenz',
        materia: 'Espacio público',
        tipoTramite: 'DENUNCIA',
        estado: 'ASIGNADO',
      },
    ]);
  });

  it('sin URL configurada no pregunta y lo dice', async () => {
    appConfig.inspeccion.urlApi = '';

    await expect(cliente.consultar('2026-09-29', 'abc')).rejects.toThrow(
      'no está configurada',
    );
    expect(peticiones).not.toHaveBeenCalled();
  });

  it('un rechazo arrastra el motivo de Inspección («Token incorrecto o expirado»)', async () => {
    peticiones.mockResolvedValue(
      respuesta({ message: 'Token incorrecto o expirado' }, false, 500),
    );

    const fallo = await cliente
      .consultar('2026-09-29', 'abc')
      .catch((error: unknown) => error);

    expect(fallo).toBeInstanceOf(InspeccionNoDisponibleError);
    expect((fallo as InspeccionNoDisponibleError).message).toContain(
      'Token incorrecto o expirado',
    );
    expect((fallo as InspeccionNoDisponibleError).code).toBe(
      CODIGOS_ERROR.INSPECCION_NO_DISPONIBLE,
    );
  });

  it('si Inspección no responde (tiempo agotado), es un 503 con motivo propio', async () => {
    peticiones.mockRejectedValue(
      new Error('The operation was aborted due to timeout'),
    );

    const fallo = await cliente
      .consultar('2026-09-29', 'abc')
      .catch((error: unknown) => error);

    expect(fallo).toBeInstanceOf(InspeccionNoDisponibleError);
    expect((fallo as InspeccionNoDisponibleError).statusCode).toBe(503);
  });

  it('un cuerpo sin `registroAsignacion` se rechaza como formato inesperado', async () => {
    peticiones.mockResolvedValue(respuesta({ recurso: 'otra cosa' }));

    await expect(cliente.consultar('2026-09-29', 'abc')).rejects.toThrow(
      'formato inesperado',
    );
  });
});
