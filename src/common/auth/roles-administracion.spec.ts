/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Autorización
 * Archivo: roles-administracion.spec.ts
 * Responsabilidad: Fijar el reparto de la administración en tres roles.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-01
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * UN ROL VACÍO NO SE LLENA SIN QUERER.
 *
 * Es fácil sumar un rol a un `@Roles` «ya que estamos». Esta prueba obliga a que ese día
 * sea deliberado: hay que venir aquí y cambiar la lista, no solo tocar un controlador.
 *
 * YA HA SERVIDO DOS VECES, y en sentidos opuestos. Cuando `ADMINISTRADOR_DMIT` y
 * `ADMINISTRADOR_DAF` recibieron el maestro de su dirección, cayó señalando el
 * controlador y hubo que declararlo aquí. Y cuando `ADMINISTRADOR` se vació, entró en la
 * lista para que nadie se lo devolviera.
 *
 * Hoy solo queda `FUNCIONARIO`, retirado el 2026-09-10: el personal de campo dejó de
 * iniciar sesión. Devolverle un endpoint no rompería nada visible —ya casi nadie tiene ese
 * rol— y dejaría una puerta abierta a quien ya no debe entrar. `ADMINISTRADOR`, que estuvo
 * aquí desde el 2026-09-01, salió ese mismo día al reactivarse como administrador general.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * NO SUSTITUYE A LA AUTORIZACIÓN. Quien decide es `RolesGuard` contra el decorador de
 * cada endpoint; esto es un inventario que se compara con el código.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { RolDepartamental } from '@prisma/client';

import { SEMILLA_ROL_PERMISO } from '../roles/matriz-permisos';

/** Los roles que hoy no abren ningún endpoint del módulo. */
const SIN_ACCESOS: RolDepartamental[] = [
  /*
   * ═══════════════════════════════════════════════════════════════════════════════
   * `ADMINISTRADOR_DMIT` Y `ADMINISTRADOR_DAF` SALIERON Y VOLVIERON EL MISMO 2026-09-01.
   *
   * Nacieron vacíos. Por la mañana recibieron `administracion/personal` acotada a su
   * dirección —el reparto existe porque Inspecciones, Instrucción y Vehículos manejan
   * cada una su personal— y esta prueba cayó señalando ese controlador, obligando a
   * declararlo aquí. Por la tarde el negocio, viendo la pantalla en marcha, decidió que
   * P-07 la abre **solo** `ADMINISTRADOR_DMIP`, y volvieron a quedarse sin accesos.
   *
   * LAS DOS VECES LA PRUEBA HIZO SU TRABAJO: obligó a que el cambio fuera deliberado y a
   * dejarlo escrito, en lugar de que un decorador se moviera en silencio. Su reparto
   * sigue declarado en `t_rol_direccion`, así que devolverles trabajo es una ruta y una
   * línea de esta lista.
   *
   * ─────────────────────────────────────────────────────────────────────────────────
   * Y `ADMINISTRADOR_DAF` SALIÓ DE LA LISTA ESA MISMA TARDE, esta vez para quedarse.
   *
   * El negocio le dio las dos pantallas de la flota —**Conductores y vehículos** y
   * **Mantenimiento de vehículos**— como único rol que las ve. Es el primer trabajo real
   * del reparto, y la prueba volvió a caer señalando los dos controladores: exactamente
   * para lo que está.
   *
   * ─────────────────────────────────────────────────────────────────────────────────
   * Y `ADMINISTRADOR_DMIT` SALIÓ POCO DESPUÉS, con lo que la lista se queda sin ninguno
   * de los dos.
   *
   * El negocio repartió el maestro de personal por áreas: el de la DMIP administra Unidad
   * de Operativos, Inspector General e Inspector Técnico; **Personal de Instrucción es
   * solo del DMIT**. P-07 vuelve a abrirse a dos roles, y esta prueba cayó por tercera vez
   * en el día señalando el mismo controlador.
   *
   * LAS TRES VECES ERA LO QUE TENÍA QUE PASAR. Ninguno de esos tres movimientos fue un
   * descuido: fueron decisiones, y esta lista obligó a que cada una quedara escrita.
   * ─────────────────────────────────────────────────────────────────────────────────
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  /*
   * ═══════════════════════════════════════════════════════════════════════════════
   * `FUNCIONARIO` SE SUMÓ AQUÍ AL RETIRARSE, EL 2026-09-10.
   *
   * El personal de campo dejó de iniciar sesión: sus órdenes se generan desde la Dirección
   * (P-05) y se entregan por otro canal, así que ningún endpoint debe abrirse a este rol.
   * Su presencia en la lista impide que un `@Roles(..., FUNCIONARIO)` reaparezca —al copiar
   * un controlador viejo como plantilla o al resolver un conflicto de fusión— y deje una
   * puerta abierta a un rol que ya no debe entrar a ninguna parte.
   *
   * `ADMINISTRADOR` SALIÓ DE ESTA LISTA EL MISMO DÍA: vuelve a estar activo como
   * administrador general del sistema, así que ahora sí aparece en los `@Roles` del módulo.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  RolDepartamental.FUNCIONARIO,
];

describe('el enumerado de roles', () => {
  it('tiene los tres administradores departamentales', () => {
    expect(RolDepartamental.ADMINISTRADOR_DMIP).toBe('ADMINISTRADOR_DMIP');
    expect(RolDepartamental.ADMINISTRADOR_DMIT).toBe('ADMINISTRADOR_DMIT');
    expect(RolDepartamental.ADMINISTRADOR_DAF).toBe('ADMINISTRADOR_DAF');
  });

  /**
   * `ADMINISTRADOR` volvió a estar ACTIVO el 2026-09-10 como administrador general. Sigue
   * en el enumerado, como siempre; lo que cambió es que ahora sí abre endpoints.
   */
  it('conserva ADMINISTRADOR, ahora activo', () => {
    expect(RolDepartamental.ADMINISTRADOR).toBe('ADMINISTRADOR');
  });

  /**
   * `FUNCIONARIO` se retiró el 2026-09-10 pero se conserva en el enumerado: retirarlo
   * obligaría a una migración destructiva sobre las columnas que lo referencian.
   */
  it('conserva FUNCIONARIO, retirado pero presente', () => {
    expect(RolDepartamental.FUNCIONARIO).toBe('FUNCIONARIO');
  });

  it('son diez en total, con los dos conservados', () => {
    expect(Object.keys(RolDepartamental)).toHaveLength(10);
  });
});

describe('los roles sin accesos', () => {
  /**
   * ES LA QUE DE VERDAD PROTEGE. Recorre el código de los controladores y comprueba que
   * ninguno de los tres aparece en un decorador `@Roles`.
   *
   * Se lee el fuente en lugar de montar la aplicación porque lo que se quiere fijar es
   * una **decisión declarada**, no un comportamiento en ejecución: el día que alguien
   * escriba `@Roles(..., RolDepartamental.ADMINISTRADOR_DAF)` esta prueba cae, aunque el
   * endpoint funcione perfectamente.
   */
  it('no aparecen en ningún decorador de los controladores', () => {
    const controladores: string[] = [];

    const recorrer = (carpeta: string): void => {
      for (const entrada of readdirSync(carpeta)) {
        const ruta = join(carpeta, entrada);
        if (statSync(ruta).isDirectory()) {
          recorrer(ruta);
        } else if (entrada.endsWith('.controller.ts')) {
          controladores.push(ruta);
        }
      }
    };

    recorrer(join(__dirname, '..', '..', 'modules'));

    // Si esto fuera cero, la prueba pasaría sin comprobar nada.
    expect(controladores.length).toBeGreaterThan(10);

    // 1) La migración a RBAC retiró los `@Roles`: el acceso vive en la matriz
    //    `t_rol_permiso`, no en decoradores de rol. Si un controlador vuelve a importar el
    //    decorador `@Roles`, alguien clavó el acceso en código de nuevo.
    const conRolesViejos = controladores.filter((ruta) =>
      /from '[^']*\/roles\.decorator'/.test(readFileSync(ruta, 'utf8')),
    );
    expect(conRolesViejos).toEqual([]);

    // 2) Los roles retirados no tienen NINGÚN permiso en la semilla: quien no debe entrar a
    //    ninguna parte tampoco recibe accesos por la matriz.
    const conPermiso = SIN_ACCESOS.filter((rol) =>
      Object.values(SEMILLA_ROL_PERMISO).some((roles) => roles.includes(rol)),
    );
    expect(conPermiso).toEqual([]);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * EL ALTA DE PERSONAL EMPIEZA EN EL DIRECTORIO, ASÍ QUE LOS DOS TIENEN QUE ADMITIR LO
 * MISMO. Añadida el 2026-09-02, después de que no lo hicieran.
 *
 * EL DEFECTO. El día anterior el maestro de personal se repartió y P-07 se abrió a
 * `ADMINISTRADOR_DMIT`. El directorio de Auth **se quedó en `ADMINISTRADOR_DMIP`**, y como
 * «Nuevo funcionario» abre el directorio, el primer clic del administrador de Instrucción
 * recibía un 403 con el mensaje genérico «su rol no tiene permiso»: la pantalla que se le
 * acababa de abrir era, en la práctica, de solo lectura.
 *
 * NINGUNA PRUEBA LO VIO, y por eso existe ésta. Las dos piezas estaban bien por separado
 * —el controlador de personal admitía a los dos, el del directorio a uno— y lo que estaba
 * roto era la **relación** entre ellas. Un cruce entre controladores no lo detecta una
 * prueba que mira un controlador.
 *
 * SE COMPARAN CONJUNTOS, NO LISTAS: lo que importa es quién entra, no en qué orden se
 * escribió. Y se lee el fuente, como sus vecinas, porque lo que se fija es una decisión
 * declarada y no un comportamiento en ejecución.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('el directorio de Auth y el maestro de personal', () => {
  /** El permiso que el controlador exige a nivel de clase (`@RequierePermiso('...')`). */
  const permisoDeClase = (ruta: string): string | undefined => {
    const fuente = readFileSync(ruta, 'utf8');
    const decorador =
      /@RequierePermiso\('([^']+)'\)\s*(?:export\s+)?class/.exec(fuente);
    return decorador?.[1];
  };

  it('los abren los MISMOS roles, ahora vía permisos otorgados al mismo conjunto', () => {
    const modulos = join(__dirname, '..', '..', 'modules');

    const permDirectorio = permisoDeClase(
      join(modulos, 'identidad', 'presentation', 'directorio.controller.ts'),
    );
    const permPersonal = permisoDeClase(
      join(
        modulos,
        'talento-operativo',
        'presentation',
        'administracion-personal.controller.ts',
      ),
    );

    expect(permDirectorio).toBe('personal:directorio:ver');
    expect(permPersonal).toBe('personal:administrar');

    // LA GARANTÍA NO CAMBIÓ: ambos permisos los tienen los MISMOS roles. Si divergieran,
    // «Nuevo funcionario» abriría el directorio con un 403 (el defecto del 2026-09-02).
    const rolesDirectorio = [...SEMILLA_ROL_PERMISO[permDirectorio!]].sort();
    const rolesPersonal = [...SEMILLA_ROL_PERMISO[permPersonal!]].sort();

    expect(rolesPersonal.length).toBeGreaterThan(0);
    expect(rolesDirectorio).toEqual(rolesPersonal);
  });
});
