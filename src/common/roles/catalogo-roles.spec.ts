/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Catálogo de roles
 * Archivo: catalogo-roles.spec.ts
 * Responsabilidad: Que el catálogo no se quede atrás del enumerado ni ofrezca lo retirado.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-01
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ES LA FUENTE ÚNICA, Y POR ESO HAY QUE VIGILARLA.
 *
 * Había tres copias de este mapa. La de `reglas-matriz` estaba tipada `Record<string,
 * string>` con `?? rol` de respaldo, así que al crecer el enumerado **no falló nada**: la
 * matriz habría impreso el código interno dentro de un documento oficial.
 *
 * Ahora el tipo obliga a completarlo, pero el tipo no puede decir si el catálogo **ofrece**
 * un rol que no debe ofrecerse. Eso lo dice esta prueba.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { RolDepartamental } from '@prisma/client';

import { NOMBRE_ROL, catalogoDeRoles } from './catalogo-roles';

describe('el catálogo de roles', () => {
  it('nombra todos los del enumerado, sin faltar ninguno', () => {
    const codigos = catalogoDeRoles().map((rol) => rol.codigo);

    expect(codigos.sort()).toEqual(
      (Object.keys(RolDepartamental) as RolDepartamental[]).sort(),
    );
  });

  /**
   * NINGUNO SE QUEDA SIN NOMBRE. El tipo `Record<RolDepartamental, string>` ya lo exige,
   * pero un nombre vacío o igual al código pasaría el compilador y saldría en pantalla
   * como lo que este archivo existe para evitar.
   */
  it('y ninguno se llama como su propio código', () => {
    for (const rol of catalogoDeRoles()) {
      expect(rol.nombre.trim()).not.toBe('');
      expect(rol.nombre).not.toBe(rol.codigo);
    }
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * ES LA QUE DISCRIMINA: SE NOMBRA TODO, NO SE ASIGNA TODO.
   *
   * `FUNCIONARIO` se retiró el 2026-09-10: el personal de campo ya no inicia sesión. Se
   * sigue nombrando porque hay filas de histórico que lo llevan; ofrecerlo dejaría crear
   * cuentas que entran y no pueden hacer nada, y eso no se ve al guardarlas sino días
   * después.
   *
   * `ADMINISTRADOR` **vuelve a ofrecerse** el mismo día: es el administrador general del
   * sistema. Los administradores departamentales siguen ofreciéndose.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  it('el rol retirado se nombra pero no se ofrece', () => {
    const asignables = catalogoDeRoles()
      .filter((rol) => rol.asignable)
      .map((rol) => rol.codigo);

    expect(NOMBRE_ROL[RolDepartamental.FUNCIONARIO]).toBeTruthy();
    expect(asignables).not.toContain(RolDepartamental.FUNCIONARIO);

    expect(asignables).toContain(RolDepartamental.ADMINISTRADOR);
    expect(asignables).toContain(RolDepartamental.ADMINISTRADOR_DMIT);
    expect(asignables).toContain(RolDepartamental.ADMINISTRADOR_DAF);
  });
});
