/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Configuración
 * Archivo: validar-entorno.spec.ts
 * Responsabilidad: Que el arranque se detenga por lo crítico y solo advierta por lo demás.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-17
 */

import type { AppConfig } from './app.config';
import { validarEntorno } from './validar-entorno';

/** Un entorno completo y válido; cada prueba estropea lo justo que quiere comprobar. */
const configBase = (parcial: Partial<AppConfig> = {}): AppConfig => ({
  produccion: false,
  server: { port: 3003, prefijoApi: 'api/v1' },
  baseDatos: {
    url: 'postgresql://app:clave@localhost:5434/transportedb?schema=public',
    registroConsultas: false,
  },
  zonaHoraria: 'America/Guayaquil',
  sesion: {
    urlCanjeAuth: 'http://localhost:10004/auth/exchange',
    urlApiAuth: 'http://localhost:10004',
    secretoAuth: 'clave_de_auth_central_para_las_pruebas',
    subsistemaIdAuth: 11,
    secretoPropio: 'una_clave_de_sesion_suficientemente_larga_2026',
    vigenciaSegundos: 28800,
    emisor: 'transporte-backend',
    destinatario: 'TRANSPORTE',
    cookie: { nombre: 'cuadro_colores_sesion', segura: false, sameSite: 'lax' },
  },
  limitePeticiones: { ventanaMs: 60000, maximo: 300, maximoIngreso: 10 },
  ...parcial,
});

describe('validarEntorno · lo crítico detiene el arranque', () => {
  it('sin DATABASE_URL, es un error', () => {
    const { errores } = validarEntorno(
      configBase({
        baseDatos: { url: '', registroConsultas: false },
      }),
    );

    expect(errores.some((e) => e.includes('DATABASE_URL'))).toBe(true);
  });

  it('sin clave de sesión, es un error', () => {
    const base = configBase();
    const { errores } = validarEntorno({
      ...base,
      sesion: { ...base.sesion, secretoPropio: '' },
    });

    expect(errores.some((e) => e.includes('SESSION_JWT_SECRET'))).toBe(true);
  });

  it('con la clave de sesión corta, es un error', () => {
    const base = configBase();
    const { errores } = validarEntorno({
      ...base,
      sesion: { ...base.sesion, secretoPropio: 'corta' },
    });

    expect(errores.some((e) => e.includes('SESSION_JWT_SECRET'))).toBe(true);
  });

  it('un entorno completo y válido no da ningún error', () => {
    expect(validarEntorno(configBase()).errores).toEqual([]);
  });
});

describe('validarEntorno · la integración con Auth central solo advierte', () => {
  it('sin AUTH_JWT_SECRET, advierte pero no detiene', () => {
    const base = configBase();
    const { errores, advertencias } = validarEntorno({
      ...base,
      sesion: { ...base.sesion, secretoAuth: '' },
    });

    expect(errores).toEqual([]);
    expect(advertencias.some((a) => a.includes('AUTH_JWT_SECRET'))).toBe(true);
  });

  it('con AUTH_SUBSYSTEM_ID en cero, advierte pero no detiene', () => {
    const base = configBase();
    const { errores, advertencias } = validarEntorno({
      ...base,
      sesion: { ...base.sesion, subsistemaIdAuth: 0 },
    });

    expect(errores).toEqual([]);
    expect(advertencias.some((a) => a.includes('AUTH_SUBSYSTEM_ID'))).toBe(
      true,
    );
  });
});

describe('validarEntorno · producción endurece', () => {
  const corsPrevio = process.env.CORS_ORIGINS;
  afterEach(() => {
    if (corsPrevio === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = corsPrevio;
  });

  it('en producción, sin CORS_ORIGINS es un error', () => {
    delete process.env.CORS_ORIGINS;

    const { errores } = validarEntorno(configBase({ produccion: true }));

    expect(errores.some((e) => e.includes('CORS_ORIGINS'))).toBe(true);
  });

  it('en producción, la cookie sin Secure es un error', () => {
    process.env.CORS_ORIGINS = 'http://172.20.136.127:5180';
    const base = configBase({ produccion: true });

    const { errores } = validarEntorno({
      ...base,
      sesion: {
        ...base.sesion,
        cookie: { ...base.sesion.cookie, segura: false },
      },
    });

    expect(errores.some((e) => e.includes('AUTH_COOKIE_SECURE'))).toBe(true);
  });

  it('en producción bien configurada, no hay errores', () => {
    process.env.CORS_ORIGINS = 'http://172.20.136.127:5180';
    const base = configBase({ produccion: true });

    const { errores } = validarEntorno({
      ...base,
      sesion: {
        ...base.sesion,
        cookie: { ...base.sesion.cookie, segura: true },
      },
    });

    expect(errores).toEqual([]);
  });
});
