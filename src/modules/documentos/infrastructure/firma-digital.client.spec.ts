/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Órdenes de servicio · firma digital
 * Archivo: firma-digital.client.spec.ts
 * Responsabilidad: Que la firma sea inerte sin configurar, firme configurada, y falle a la vista.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-22
 */

import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import type { LoggerService } from '../../../common/logger/logger.service';
import { FirmaDigitalClient } from './firma-digital.client';

const logger = {
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
} as unknown as LoggerService;

const PDF = Buffer.from('%PDF-1.4 memorando');
const CLAVES = [
  'FIRMA_URL',
  'FIRMA_P12_PATH',
  'FIRMA_P12_CLAVE',
  'FIRMA_TOKEN',
  'FIRMA_PAGINA',
];

describe('FirmaDigitalClient', () => {
  const certificado = join(tmpdir(), `firma-prueba-${process.pid}.p12`);

  beforeAll(() => writeFileSync(certificado, Buffer.from([1, 2, 3, 4])));
  afterAll(() => {
    try {
      rmSync(certificado);
    } catch {
      /* si no está, no importa */
    }
  });

  beforeEach(() => {
    for (const clave of CLAVES) delete process.env[clave];
  });
  afterEach(() => {
    for (const clave of CLAVES) delete process.env[clave];
    jest.restoreAllMocks();
  });

  it('sin configurar, entrega el PDF SIN firmar y no llama al servicio', async () => {
    const espiaFetch = jest.spyOn(globalThis, 'fetch');
    const cliente = new FirmaDigitalClient(logger);

    const salida = await cliente.firmar(PDF);

    expect(cliente.habilitada).toBe(false);
    expect(salida).toBe(PDF);
    expect(espiaFetch).not.toHaveBeenCalled();
  });

  it('configurada, firma con el servicio y devuelve el PDF firmado', async () => {
    process.env.FIRMA_URL = 'http://firma.local/api/firmas/sign-pdf/upload';
    process.env.FIRMA_P12_PATH = certificado;
    process.env.FIRMA_P12_CLAVE = 'clave-secreta';
    process.env.FIRMA_TOKEN = 'token-de-firma';
    process.env.FIRMA_PAGINA = '1';

    const firmado = new Uint8Array([9, 8, 7, 6]);
    const espiaFetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(firmado, { status: 200 }));

    const cliente = new FirmaDigitalClient(logger);
    const salida = await cliente.firmar(PDF);

    expect(cliente.habilitada).toBe(true);
    expect(Buffer.from(firmado).equals(salida)).toBe(true);
    expect(espiaFetch).toHaveBeenCalledTimes(1);

    const [url, init] = espiaFetch.mock.calls[0];
    expect(url).toBe('http://firma.local/api/firmas/sign-pdf/upload');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeInstanceOf(FormData);
    // El token viaja como Bearer; el multipart lo arma `fetch` al recibir un FormData.
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer token-de-firma',
    );
  });

  it('configurada, si el servicio no responde lanza un 502 con mensaje', async () => {
    process.env.FIRMA_URL = 'http://firma.local/x';
    process.env.FIRMA_P12_PATH = certificado;
    process.env.FIRMA_P12_CLAVE = 'clave';
    process.env.FIRMA_PAGINA = '1';

    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('caído'));

    const cliente = new FirmaDigitalClient(logger);

    await expect(cliente.firmar(PDF)).rejects.toMatchObject({
      statusCode: 502,
      code: CODIGOS_ERROR.SERVICIO_FIRMA_NO_DISPONIBLE,
    });
  });

  it('configurada, si el servicio rechaza (no OK) lanza un 502', async () => {
    process.env.FIRMA_URL = 'http://firma.local/x';
    process.env.FIRMA_P12_PATH = certificado;
    process.env.FIRMA_P12_CLAVE = 'clave';
    process.env.FIRMA_PAGINA = '1';

    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('no', { status: 500 }));

    const cliente = new FirmaDigitalClient(logger);

    await expect(cliente.firmar(PDF)).rejects.toMatchObject({
      statusCode: 502,
      code: CODIGOS_ERROR.SERVICIO_FIRMA_NO_DISPONIBLE,
    });
  });

  it('configurada pero sin certificado en disco, lanza un 502 de configuración', async () => {
    process.env.FIRMA_URL = 'http://firma.local/x';
    process.env.FIRMA_P12_PATH = join(
      tmpdir(),
      'no-existe-este-certificado.p12',
    );
    process.env.FIRMA_P12_CLAVE = 'clave';
    process.env.FIRMA_PAGINA = '1';

    const espiaFetch = jest.spyOn(globalThis, 'fetch');
    const cliente = new FirmaDigitalClient(logger);

    await expect(cliente.firmar(PDF)).rejects.toMatchObject({
      statusCode: 502,
      code: CODIGOS_ERROR.SERVICIO_FIRMA_NO_DISPONIBLE,
    });
    expect(espiaFetch).not.toHaveBeenCalled();
  });
});
