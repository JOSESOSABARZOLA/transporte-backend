/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Órdenes de servicio
 * Archivo: director.guard.spec.ts
 * Responsabilidad: Verificar que la Dirección de órdenes exige el rol DIRECTOR (además del permiso).
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-05
 *
 * Dos cosas: la guarda rechaza (403) a quien no tiene el rol DIRECTOR aunque tuviera el permiso, y
 * está puesta en TODOS los endpoints de la Dirección, pero NO en los del destinatario
 * (`/ordenes-servicio/mias` y `/:codigo/documento`), que se rigen por la identidad, no por el rol.
 */

import type { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { RolDepartamental } from '@prisma/client';

import { AutorizacionError } from '../../../common/errors/errores-dominio';
import { DirectorGuard } from './director.guard';
import { OrdenesServicioController } from './ordenes-servicio.controller';

const contextoCon = (roles: RolDepartamental[] | null): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => (roles === null ? {} : { user: { roles } }),
    }),
  }) as unknown as ExecutionContext;

describe('DirectorGuard', () => {
  const guarda = new DirectorGuard();

  it('deja pasar a quien tiene el rol DIRECTOR (aunque tenga otros)', () => {
    expect(
      guarda.canActivate(
        contextoCon([RolDepartamental.DAF, RolDepartamental.DIRECTOR]),
      ),
    ).toBe(true);
  });

  it('rechaza con 403 a quien no es Director, aunque se le hubiera dado el permiso', () => {
    let fallo: unknown;
    try {
      guarda.canActivate(contextoCon([RolDepartamental.ADMINISTRADOR_DMIP]));
    } catch (error) {
      fallo = error;
    }
    expect(fallo).toBeInstanceOf(AutorizacionError);
    expect((fallo as AutorizacionError).statusCode).toBe(403);
  });

  it('sin usuario en la petición también rechaza', () => {
    expect(() => guarda.canActivate(contextoCon(null))).toThrow(
      AutorizacionError,
    );
  });
});

describe('OrdenesServicioController · dónde se exige el rol DIRECTOR', () => {
  const guardasDe = (metodo: keyof OrdenesServicioController): unknown[] =>
    (Reflect.getMetadata(
      GUARDS_METADATA,
      OrdenesServicioController.prototype[metodo],
    ) as unknown[] | undefined) ?? [];

  it.each([
    'emitir',
    'consultarDeOperativo',
    'memorando',
    'datosMemorando',
    'memorandoEditado',
    'obtenerPlantilla',
    'guardarPlantilla',
    'previsualizarPlantilla',
  ] as const)('«%s» exige el rol DIRECTOR', (metodo) => {
    expect(guardasDe(metodo)).toContain(DirectorGuard);
  });

  it.each(['consultarPropias', 'descargar'] as const)(
    '«%s» (del destinatario) NO exige el rol DIRECTOR',
    (metodo) => {
      expect(guardasDe(metodo)).not.toContain(DirectorGuard);
    },
  );
});
