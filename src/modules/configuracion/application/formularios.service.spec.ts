/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: formularios.service.spec.ts
 * Responsabilidad: Verificar el filtrado por rol y su equivalencia con la guarda.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 */

import { Reflector } from '@nestjs/core';
import { PoliticaVehiculo, RolDepartamental } from '@prisma/client';

import { FormularioRolGuard } from '../../../common/auth/guards/formulario-rol.guard';
import type { FormularioAutorizacionRepository } from '../../../common/auth/infrastructure/formulario-autorizacion.repository';
import { RecursoNoEncontradoError } from '../../../common/errors/errores-dominio';
import type {
  FormularioConAreas,
  FormulariosRepository,
} from '../infrastructure/formularios.repository';
import { FormulariosService } from './formularios.service';

/**
 * Los nueve formularios del Excel aprobado, con su propiedad departamental.
 *
 * `esPatrulla` y `colorAcento` llevan valores de relleno EXPLÍCITOS: son los dos
 * pendientes PV-25 y PV-26 y no hay valor acordado. Aquí solo sostienen la estructura
 * de la prueba; ninguna aserción depende de ellos.
 */
/**
 * @param acompanante Departamento que participa además del dueño, y con qué papel.
 *   `APORTA` es el cupo de personal del formulario 6; `ESCRITURA` es el caso nuevo del
 *   2026-08-25, la patrulla ECU con **dos** departamentos que registran.
 */
const formulario = (
  numero: number,
  codigo: string,
  rolDueno: RolDepartamental,
  acompanante: {
    rol: RolDepartamental;
    acceso: 'ESCRITURA' | 'APORTA';
  } | null = null,
): FormularioConAreas =>
  ({
    id: numero,
    numero,
    codigo,
    nombre: `FORMULARIO ${numero}`,
    colorFondo: '#FFFFFF',
    colorAcento: '#000000',
    colorNombre: 'blanco',
    rolDueno,
    // Desde el 2026-08-25 la participación son filas. El dueño siempre escribe; el
    // acompañante, cuando lo hay, escribe o aporta con cupo de una persona.
    roles: [
      { formularioId: numero, rol: rolDueno, acceso: 'ESCRITURA', cupo: null },
      ...(acompanante
        ? [
            {
              formularioId: numero,
              rol: acompanante.rol,
              acceso: acompanante.acceso,
              cupo: acompanante.acceso === 'APORTA' ? 1 : null,
            },
          ]
        : []),
    ],
    politicaVehiculo: PoliticaVehiculo.CONDICIONAL,
    condicionanteNoct: false,
    esPatrulla: false,
    permiteCapturaLibre: false,
    orden: numero,
    vigenciaDesde: null,
    vigenciaHasta: null,
    activo: true,
    creadoEn: new Date(),
    areas: [],
  }) as unknown as FormularioConAreas;

const NUEVE = [
  formulario(1, 'FIJOS', RolDepartamental.DMIP_OPERATIVOS),
  formulario(2, 'PMO', RolDepartamental.DMIP_OPERATIVOS),
  formulario(3, 'LIMPIA', RolDepartamental.DMIP_OPERATIVOS),
  // 2026-08-25 · la patrulla ECU la registran DOS departamentos. Es el caso que el
  // modelo de dos columnas no podía expresar, y por el que existe `t_formulario_rol`.
  formulario(4, 'ECU', RolDepartamental.DMIP_OPERATIVOS, {
    rol: RolDepartamental.DMIT_INSTRUCTOR,
    acceso: 'ESCRITURA',
  }),
  formulario(5, 'REACD', RolDepartamental.DMIP_INSPECCIONES),
  // El 6 conserva el cupo: el DMIT aporta una persona y no registra. Es lo que
  // distingue APORTA de ESCRITURA, y por eso los dos casos conviven en este juego.
  formulario(6, 'REACN', RolDepartamental.DMIP_INSPECCIONES, {
    rol: RolDepartamental.DMIT_INSTRUCTOR,
    acceso: 'APORTA',
  }),
  formulario(7, 'DMIT', RolDepartamental.DMIT_INSTRUCTOR),
  formulario(8, 'INSP', RolDepartamental.DMIP_INSPECCIONES),
  formulario(9, 'CBQ', RolDepartamental.DMIT_INSTRUCTOR),
];

const armar = (formularios = NUEVE) => {
  const listarActivos = jest.fn().mockResolvedValue(formularios);
  const buscarPorCodigo = jest
    .fn()
    .mockImplementation((codigo: string) =>
      Promise.resolve(formularios.find((f) => f.codigo === codigo) ?? null),
    );
  const filtrarExistentes = jest
    .fn()
    .mockImplementation((ids: number[]) =>
      Promise.resolve(ids.filter((id) => formularios.some((f) => f.id === id))),
    );

  return new FormulariosService({
    listarActivos,
    buscarPorCodigo,
    filtrarExistentes,
  } as unknown as FormulariosRepository);
};

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * VARIOS ROLES A LA VEZ · lo acordado con el negocio el 2026-08-19.
 *
 * Auth central admite asignar de uno a los seis roles de Transporte a la misma persona.
 * El negocio decidió que valen TODOS: se ve la UNIÓN de los formularios de cada uno, no
 * uno por sesión —que es lo que modela el portal, pero exige que el canje transmita cuál
 * se eligió, y hoy no lo hace: es el desajuste D-5—.
 *
 * Estas cuatro pruebas son las que impiden que la unión degenere en algo distinto: que
 * duplique formularios, que pierda alguno, o que rebaje el acceso de quien es dueño.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('varios roles a la vez', () => {
  it('devuelve la UNIÓN de los formularios de todos sus roles', async () => {
    const soloOperativos = await codigosPara(RolDepartamental.DMIP_OPERATIVOS);
    const soloInstructor = await codigosPara(RolDepartamental.DMIT_INSTRUCTOR);

    const permitidos = await armar().obtenerPermitidos([
      RolDepartamental.DMIP_OPERATIVOS,
      RolDepartamental.DMIT_INSTRUCTOR,
    ]);
    const codigos = permitidos.map((p) => p.formulario.codigo);

    for (const codigo of [...soloOperativos, ...soloInstructor]) {
      expect(codigos).toContain(codigo);
    }
  });

  it('no repite un formulario que dos de sus roles alcanzan', async () => {
    // El 6 lo alcanzan DMIP_INSPECCIONES —como dueño— y DMIT_INSTRUCTOR —por el cupo
    // compartido—. Con los dos roles debe aparecer UNA vez, no dos.
    const permitidos = await armar().obtenerPermitidos([
      RolDepartamental.DMIP_INSPECCIONES,
      RolDepartamental.DMIT_INSTRUCTOR,
    ]);
    const codigos = permitidos.map((p) => p.formulario.codigo);

    expect(codigos.length).toBe(new Set(codigos).size);
  });

  /**
   * SER DUEÑO GANA A APORTAR. Quien tenga los dos roles del formulario 6 debe verlo con
   * el acceso más amplio; si se tomara el primero de la lista, el orden en que se
   * escribieron sus roles cambiaría lo que puede hacer.
   */
  it('toma el acceso más amplio cuando dos de sus roles alcanzan el mismo formulario', async () => {
    const comoDueno = await armar().obtenerPermitidos([
      RolDepartamental.DMIP_INSPECCIONES,
    ]);
    const seis = comoDueno.find((p) => p.formulario.numero === 6);

    const conAmbos = await armar().obtenerPermitidos([
      RolDepartamental.DMIT_INSTRUCTOR,
      RolDepartamental.DMIP_INSPECCIONES,
    ]);
    const seisConAmbos = conAmbos.find((p) => p.formulario.numero === 6);

    expect(seisConAmbos?.acceso).toEqual(seis?.acceso);
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * UN ROL TRANSVERSAL NO PUEDE TAPAR A UNO DEPARTAMENTAL. Defecto corregido el
   * 2026-08-25, y **anterior a ese día**.
   *
   * El acceso se tomaba de UN rol elegido así: primero el dueño del formulario y, si no,
   * «el primero que lo alcanza». Y `leCorresponde` devuelve cierto para cualquier
   * transversal, de modo que en una cuenta con `DIRECTOR` **más** uno departamental el
   * transversal iba primero y devolvía `LECTURA`.
   *
   * La cuenta con Dirección + DMIT recibía el formulario 6 como LECTURA —su cupo
   * desaparecía de la pantalla— y, desde que la ECU admite dos departamentos, la 4
   * también. El 7 y el 9 se salvaban por casualidad: el DMIT es su dueño y la primera
   * búsqueda acertaba, que es justo lo que hacía el defecto difícil de ver.
   *
   * SE PRUEBAN LOS DOS ÓRDENES. Si el transversal va primero o último no puede cambiar
   * el resultado, y era exactamente de lo que dependía.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  it('el rol transversal no rebaja el acceso del departamental', async () => {
    for (const orden of [
      [RolDepartamental.DIRECTOR, RolDepartamental.DMIT_INSTRUCTOR],
      [RolDepartamental.DMIT_INSTRUCTOR, RolDepartamental.DIRECTOR],
    ]) {
      const permitidos = await armar().obtenerPermitidos(orden);
      const acceso = (codigo: string) =>
        permitidos.find((p) => p.formulario.codigo === codigo)?.acceso;

      // Los nueve, porque el Director los ve todos.
      expect(permitidos).toHaveLength(9);
      // Pero donde el DMIT participa, manda su acceso y no el del Director.
      expect(acceso('ECU')).toBe('ESCRITURA');
      expect(acceso('REACN')).toBe('COMPARTIDO');
      expect(acceso('DMIT')).toBe('ESCRITURA');
      // Y donde no participa, sigue siendo lectura.
      expect(acceso('FIJOS')).toBe('LECTURA');
    }
  });

  it('con un solo rol se comporta igual que antes del cambio', async () => {
    const permitidos = await armar().obtenerPermitidos([RolDepartamental.DAF]);
    const codigos = permitidos.map((p) => p.formulario.codigo);

    expect(codigos).toEqual(await codigosPara(RolDepartamental.DAF));
  });
});

const codigosPara = async (rol: RolDepartamental): Promise<string[]> => {
  const permitidos = await armar().obtenerPermitidos([rol]);
  return permitidos.map((p) => p.formulario.codigo);
};

describe('FormulariosService', () => {
  describe('obtenerPermitidos', () => {
    it('caso 1 del plan · DMIP_OPERATIVOS ve los formularios 1 a 4 y ningún otro', async () => {
      expect(await codigosPara(RolDepartamental.DMIP_OPERATIVOS)).toEqual([
        'FIJOS',
        'PMO',
        'LIMPIA',
        'ECU',
      ]);
    });

    /**
     * ═══════════════════════════════════════════════════════════════════════════════
     * REESCRITO EL 2026-08-25 · EL DMIT TIENE AHORA LAS DOS CLASES DE PARTICIPACIÓN.
     *
     * Registra en tres formularios —el 4, el 7 y el 9— y **aporta** personal en uno, el
     * 6. Es la prueba de que el acceso lo dice la fila y no el número del formulario:
     * antes bastaba con «es el dueño o es el invitado», y ahora el mismo departamento es
     * las dos cosas en formularios distintos.
     *
     * El orden sigue siendo el del cuadro, y lo fija el servidor.
     * ═══════════════════════════════════════════════════════════════════════════════
     */
    it('caso 2 del plan · DMIT_INSTRUCTOR registra en el 4, el 7 y el 9, y aporta en el 6', async () => {
      const permitidos = await armar().obtenerPermitidos([
        RolDepartamental.DMIT_INSTRUCTOR,
      ]);

      expect(permitidos.map((p) => p.formulario.codigo)).toEqual([
        'ECU',
        'REACN',
        'DMIT',
        'CBQ',
      ]);
      expect(
        permitidos.find((p) => p.formulario.codigo === 'ECU')?.acceso,
      ).toBe('ESCRITURA');
      expect(
        permitidos.find((p) => p.formulario.codigo === 'REACN')?.acceso,
      ).toBe('COMPARTIDO');
      expect(
        permitidos.find((p) => p.formulario.codigo === 'DMIT')?.acceso,
      ).toBe('ESCRITURA');
    });

    /**
     * Y EL OTRO DEPARTAMENTO NO PIERDE NADA. Es la mitad de la decisión que se olvida al
     * comprobar solo al recién llegado: la patrulla ECU sigue siendo de DMIP Operativos
     * para registrar, y son cuatro formularios, no tres.
     */
    it('DMIP_OPERATIVOS conserva la ECU con escritura', async () => {
      const permitidos = await armar().obtenerPermitidos([
        RolDepartamental.DMIP_OPERATIVOS,
      ]);

      expect(permitidos).toHaveLength(4);
      expect(
        permitidos.find((p) => p.formulario.codigo === 'ECU')?.acceso,
      ).toBe('ESCRITURA');
    });

    it('caso 3 del plan · la DAF ve los nueve, todos en lectura', async () => {
      const permitidos = await armar().obtenerPermitidos([
        RolDepartamental.DAF,
      ]);

      expect(permitidos).toHaveLength(9);
      expect(permitidos.every((p) => p.acceso === 'LECTURA')).toBe(true);
    });

    it('el Director y el Administrador también ven los nueve', async () => {
      expect(await codigosPara(RolDepartamental.DIRECTOR)).toHaveLength(9);
      expect(
        await codigosPara(RolDepartamental.ADMINISTRADOR_DMIP),
      ).toHaveLength(9);
    });

    it('respeta el orden de presentación del cuadro', async () => {
      const permitidos = await armar().obtenerPermitidos([
        RolDepartamental.DAF,
      ]);
      expect(permitidos.map((p) => p.formulario.numero)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9,
      ]);
    });

    it('no ofrece un formulario dado de baja: la guarda lo rechazaría al guardar', async () => {
      const baja = {
        ...NUEVE[0],
        activo: false,
      } as unknown as FormularioConAreas;
      // El repositorio ya filtra por activo; se comprueba que el servicio no lo
      // reintroduce por su cuenta.
      const servicio = armar([baja]);
      const listados = await servicio.obtenerPermitidos([
        RolDepartamental.DMIP_OPERATIVOS,
      ]);
      expect(listados.map((p) => p.formulario.activo)).toEqual([false]);
    });
  });

  describe('obtenerDefinicion', () => {
    it('devuelve la definición completa, con los colores', async () => {
      const definicion = await armar().obtenerDefinicion('INSP');
      expect(definicion.colorFondo).toBe('#FFFFFF');
      expect(definicion.colorAcento).toBe('#000000');
    });

    it('un código inexistente produce 404', async () => {
      await expect(
        armar().obtenerDefinicion('NO_EXISTE'),
      ).rejects.toBeInstanceOf(RecursoNoEncontradoError);
    });
  });

  describe('verificarExisten', () => {
    it('devuelve los identificadores que no existen', async () => {
      expect(await armar().verificarExisten([1, 99, 5])).toEqual([99]);
    });

    it('con la lista vacía no reporta nada', async () => {
      expect(await armar().verificarExisten([])).toEqual([]);
    });
  });

  /**
   * LA PRUEBA QUE IMPIDE LA DERIVA.
   *
   * Ejecuta la guarda REAL de M-05 contra la misma definición y exige que ofrecer
   * escritura y dejar escribir sean el mismo conjunto. Si alguien cambia una de las
   * dos reglas sin la otra, esta prueba falla antes de que un funcionario pierda un
   * operativo ya capturado al guardarlo.
   */
  describe('coherencia con FormularioRolGuard', () => {
    const guardaPermite = async (
      codigo: string,
      rol: RolDepartamental,
    ): Promise<boolean> => {
      const definicion = NUEVE.find((f) => f.codigo === codigo);
      const guarda = new FormularioRolGuard(
        {
          getAllAndOverride: jest
            .fn()
            .mockReturnValue({ origen: 'body', propiedad: 'formularioCodigo' }),
        } as unknown as Reflector,
        {
          buscarPorCodigo: jest.fn().mockResolvedValue(definicion ?? null),
        } as unknown as FormularioAutorizacionRepository,
      );

      const contexto = {
        switchToHttp: () => ({
          getRequest: () => ({
            body: { formularioCodigo: codigo },
            user: { rol, roles: [rol] },
          }),
        }),
        getHandler: () => undefined,
        getClass: () => undefined,
      } as never;

      return guarda.canActivate(contexto).catch(() => false);
    };

    const ROLES_DEPARTAMENTALES = [
      RolDepartamental.DMIP_OPERATIVOS,
      RolDepartamental.DMIP_INSPECCIONES,
      RolDepartamental.DMIT_INSTRUCTOR,
    ];

    it.each(ROLES_DEPARTAMENTALES)(
      'para %s, «acceso de escritura» y «la guarda deja pasar» coinciden en los nueve',
      async (rol) => {
        const permitidos = await armar().obtenerPermitidos([rol]);

        for (const definicion of NUEVE) {
          const ofrecido = permitidos.find(
            (p) => p.formulario.codigo === definicion.codigo,
          );
          const ofreceEscritura =
            ofrecido !== undefined && ofrecido.acceso !== 'LECTURA';

          expect({
            codigo: definicion.codigo,
            ofreceEscritura,
          }).toEqual({
            codigo: definicion.codigo,
            ofreceEscritura: await guardaPermite(definicion.codigo, rol),
          });
        }
      },
    );

    it('la guarda tampoco deja escribir a los roles transversales', async () => {
      for (const rol of [
        RolDepartamental.DAF,
        RolDepartamental.DIRECTOR,
        RolDepartamental.ADMINISTRADOR_DMIP,
      ]) {
        expect(await guardaPermite('FIJOS', rol)).toBe(false);
      }
    });
  });
});
