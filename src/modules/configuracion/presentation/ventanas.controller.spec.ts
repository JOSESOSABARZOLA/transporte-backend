/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Ventanas de carga
 * Archivo: ventanas.controller.spec.ts
 * Responsabilidad: Verificar de qué rol se devuelve la ventana, y de cuál no.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-20
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ESTA SUITE EXISTE POR UN DEFECTO REAL, reportado el 2026-08-20 con una cuenta que
 * tenía los seis roles.
 *
 * La DAF entraba a P-03 y leía «La ventana de asignación ya cerró», con el mensaje de
 * cierre del DMIP pegado detrás. La bandeja quedaba en solo lectura **justo durante la
 * hora y media en que la DAF debe trabajar**: a las 15H00 su ventana abre y la del DMIP
 * cierra.
 *
 * Este endpoint no declara `@Roles` —lo consultan los seis—, así que `RolesGuard` no
 * estrecha el rol efectivo y `usuario.rol` se quedaba en `roles[0]`. Con seis roles, ese
 * primero casi nunca era el de la pantalla.
 *
 * NO FALLABA NADA VISIBLE EN EL SERVIDOR: `PATCH /transporte/operativos/:id` sí declara
 * `@Roles(DAF)`, así que la escritura se evaluaba contra la ventana correcta y habría
 * funcionado. Era la pantalla bloqueándose contra sí misma con un dato equivocado, y por
 * eso es exactamente la clase de defecto que necesita una prueba: no da error.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { RolDepartamental } from '@prisma/client';

import { AutorizacionError } from '../../../common/errors/errores-dominio';
import type { VentanaCargaService } from '../application/ventana-carga.service';
import { VentanasController } from './ventanas.controller';

/** El orden es el del defecto: DMIP primero, DAF cuarta. */
const LOS_SEIS = [
  RolDepartamental.DMIP_OPERATIVOS,
  RolDepartamental.ADMINISTRADOR_DMIP,
  RolDepartamental.DIRECTOR,
  RolDepartamental.DAF,
  RolDepartamental.DMIT_INSTRUCTOR,
  RolDepartamental.DMIP_INSPECCIONES,
];

const armar = () => {
  const obtenerEstado = jest.fn().mockImplementation((rol: RolDepartamental) =>
    Promise.resolve({
      rol,
      abierta: false,
      activo: true,
      zonaHoraria: 'America/Guayaquil',
      horaApertura: rol === RolDepartamental.DAF ? '15:00' : null,
      horaCierre: rol === RolDepartamental.DAF ? '16:30' : '15:00',
      diaApertura: null,
      diaCierre: null,
      mensaje: `mensaje de ${rol}`,
      evaluadoEn: new Date(),
    }),
  );

  return {
    controlador: new VentanasController({
      obtenerEstado,
    } as unknown as VentanaCargaService),
    obtenerEstado,
  };
};

/** Quien tiene los seis roles, con el efectivo sin estrechar: el primero de la lista. */
const conLosSeis = () => ({
  id: '5',
  usuarioId: 5,
  nombre: 'Navarrete Jungal Franklin Fernando',
  rol: LOS_SEIS[0],
  roles: LOS_SEIS,
  usuarioAuth: 'ffnavarrete',
  // La ventana no consulta a Auth central: la calcula con los parámetros de la base.
  tokenAuth: null,
});

describe('VentanasController · de qué rol es la ventana', () => {
  /** El caso reportado, con los roles exactos de la cuenta que lo encontró. */
  it('devuelve la ventana de la DAF cuando la pantalla pregunta por la DAF', async () => {
    const { controlador, obtenerEstado } = armar();

    const estado = await controlador.estado(
      { rol: RolDepartamental.DAF },
      conLosSeis(),
    );

    expect(obtenerEstado).toHaveBeenCalledWith(RolDepartamental.DAF);
    // Y no la del primero de su lista, que es donde nacía el defecto.
    expect(estado.rol).toBe(RolDepartamental.DAF);
    expect(estado.horaApertura).toBe('15:00');
    expect(estado.mensaje).not.toContain('DMIP');
  });

  it('cada rol propio se puede consultar, no solo el primero', async () => {
    const { controlador } = armar();

    for (const rol of LOS_SEIS) {
      const estado = await controlador.estado({ rol }, conLosSeis());
      expect(estado.rol).toBe(rol);
    }
  });

  /**
   * FALLA CERRADA. Un rol ajeno no se ignora en silencio para responder con el propio:
   * eso devolvería un horario que no es el pedido y la pantalla lo pintaría como si lo
   * fuera, que es la misma clase de mentira que originó todo esto.
   */
  it('rechaza la ventana de un departamento que no es suyo', async () => {
    const { controlador, obtenerEstado } = armar();
    const soloDaf = {
      ...conLosSeis(),
      rol: RolDepartamental.DAF,
      roles: [RolDepartamental.DAF],
    };

    await expect(
      controlador.estado({ rol: RolDepartamental.DMIP_OPERATIVOS }, soloDaf),
    ).rejects.toBeInstanceOf(AutorizacionError);

    expect(obtenerEstado).not.toHaveBeenCalled();
  });

  it('el rechazo explica que no es su departamento, sin nombrar horarios ajenos', async () => {
    const { controlador } = armar();
    const soloDaf = {
      ...conLosSeis(),
      rol: RolDepartamental.DAF,
      roles: [RolDepartamental.DAF],
    };

    const fallo: unknown = await controlador
      .estado({ rol: RolDepartamental.DMIP_OPERATIVOS }, soloDaf)
      .catch((error: unknown) => error);

    expect((fallo as AutorizacionError).code).toBe('ROL_NO_AUTORIZADO');
    expect((fallo as AutorizacionError).message).toContain('no es el suyo');
  });

  /** Compatibilidad: sin parámetro, lo de siempre. Ningún consumidor viejo se rompe. */
  it('sin rol indicado conserva el comportamiento anterior', async () => {
    const { controlador, obtenerEstado } = armar();

    await controlador.estado({}, conLosSeis());

    expect(obtenerEstado).toHaveBeenCalledWith(LOS_SEIS[0]);
  });
});
