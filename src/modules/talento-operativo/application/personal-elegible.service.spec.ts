/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Personal elegible
 * Archivo: personal-elegible.service.spec.ts
 * Responsabilidad: Verificar el caso 4 del plan y lo que la respuesta NO contiene.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 */

import {
  AreaPersonal,
  RolDepartamental,
  TipoContrato,
  type Funcionario,
} from '@prisma/client';

import type { FormulariosService } from '../../configuracion/application/formularios.service';
import type { DisponibilidadService } from './disponibilidad.service';
import type { ElegibilidadService } from './elegibilidad.service';
import type { FuncionariosService } from './funcionarios.service';
import { PersonalElegibleService } from './personal-elegible.service';
import { aFechaUtc } from './reglas-personal';

const dia = (texto: string): Date => aFechaUtc(texto) as Date;

const persona = (
  id: number,
  area: AreaPersonal,
  apellidos: string,
): Funcionario =>
  ({
    id,
    cedula: `171003406${id}`,
    apellidos,
    nombres: 'NOMBRE',
    telefono: '98 514 4231',
    cargo: 'Inspector',
    area,
    tipoContrato: TipoContrato.NOMBRAMIENTO,
    direccion: RolDepartamental.DMIP_INSPECCIONES,
    activo: true,
    creadoEn: new Date(),
    actualizadoEn: new Date(),
  }) as Funcionario;

const CANDIDATOS = [
  persona(1, AreaPersonal.GENERAL, 'BENAVIDES'),
  persona(2, AreaPersonal.TECNICO, 'SEGOVIA'),
  persona(3, AreaPersonal.GENERAL, 'YUNDA'),
];

const armar = (
  opciones: {
    areas?: AreaPersonal[];
    candidatos?: Funcionario[];
    ausentes?: number[];
    /** Identificadores en DESCANSO en la cobertura de Instrucción para la fecha. */
    enDescanso?: number[];
    /** `form_filtra_personal_por_rol`. Falso solo en el formulario de eventuales. */
    filtraPersonalPorRol?: boolean;
    /** Índice de carga/fatiga por persona, para las pruebas de sugerencia (advisory). */
    cargas?: Map<
      number,
      { indiceCarga: number; nivelFatiga: string; factores: string[] }
    >;
    /** Banda relativa de la cuota justa para la señal de equidad (`EQUIDAD_MARGEN`). */
    margen?: number;
    /** Veredictos por lote, cuando la consulta lleva horario. */
    veredictos?: {
      funcionarioId: number;
      veredicto: { elegible: boolean; motivo?: string };
    }[];
  } = {},
) => {
  const {
    areas = [AreaPersonal.GENERAL, AreaPersonal.TECNICO],
    candidatos = CANDIDATOS,
    ausentes = [],
    enDescanso = [],
    filtraPersonalPorRol = true,
    cargas = new Map(),
    margen = 0.25,
    veredictos = [],
  } = opciones;

  const listarPorAreas = jest.fn().mockResolvedValue(candidatos);
  const calcularCargas = jest.fn().mockResolvedValue(cargas);
  const margenEquidad = jest.fn().mockResolvedValue(margen);
  const verificarVarios = jest.fn().mockResolvedValue(veredictos);

  const servicio = new PersonalElegibleService(
    {
      obtenerDefinicion: jest.fn().mockResolvedValue({
        id: 8,
        codigo: 'INSP',
        esPatrulla: false,
        filtraPersonalPorRol,
        areas: areas.map((area) => ({ area, esCompartida: false })),
      }),
    } as unknown as FormulariosService,
    { listarPorAreas } as unknown as FuncionariosService,
    {
      ausentesEntre: jest.fn().mockResolvedValue(new Set(ausentes)),
    } as unknown as DisponibilidadService,
    {
      descansosEnFecha: jest.fn().mockResolvedValue(new Set(enDescanso)),
      calcularCargas,
      margenEquidad,
      verificarVarios,
    } as unknown as ElegibilidadService,
  );

  return { servicio, listarPorAreas, calcularCargas };
};

const CONSULTA = {
  formularioCodigo: 'INSP',
  desde: dia('2026-08-06'),
  hasta: dia('2026-08-06'),
};

describe('PersonalElegibleService', () => {
  it('devuelve el personal de las áreas que admite el formulario', async () => {
    const { servicio, listarPorAreas } = armar();

    const elegibles = await servicio.consultar(CONSULTA);

    expect(listarPorAreas).toHaveBeenCalledWith([
      AreaPersonal.GENERAL,
      AreaPersonal.TECNICO,
    ]);
    expect(elegibles).toHaveLength(3);
  });

  /**
   * PV-37, RESUELTO EL 2026-08-11. Esta prueba afirmaba lo contrario —«quien está de
   * vacaciones NO aparece en la lista»— y esa era precisamente la pérdida registrada: la
   * persona desaparecía sin explicación y había que llamar por teléfono para saber por
   * qué. Se conserva invertida para que conste que el cambio fue deliberado.
   */
  it('caso 4 del plan · quien está ausente aparece, marcado y con motivo', async () => {
    const { servicio } = armar({ ausentes: [2] });

    const candidatos = await servicio.consultar(CONSULTA);

    expect(candidatos.map((persona) => persona.id)).toEqual([1, 2, 3]);

    const ausente = candidatos.find((persona) => persona.id === 2);
    expect(ausente?.elegible).toBe(false);
    expect(ausente?.motivo).toContain('no está disponible');
  });

  it('el motivo de una ausencia NO dice cuál es: eso no se publica', async () => {
    // `ausentesEntre` entrega solo identificadores a propósito, para no exponer que
    // alguien está de reposo médico o de calamidad doméstica. El motivo aquí dice que
    // hay una ausencia, nunca su causa.
    const { servicio } = armar({ ausentes: [2] });

    const candidatos = await servicio.consultar(CONSULTA);
    const ausente = candidatos.find((persona) => persona.id === 2);

    for (const estado of [
      'VACACIONES',
      'PERMISO',
      'CALAMIDAD',
      'REPOSO',
      'MEDICO',
    ]) {
      expect(ausente?.motivo).not.toContain(estado);
    }
  });

  it('quien tiene descanso en la cobertura aparece, marcado y con motivo, sin horario', async () => {
    // El descanso es disponibilidad por día: se dice aunque la consulta no traiga horario.
    const { servicio } = armar({ enDescanso: [3] });

    const candidatos = await servicio.consultar(CONSULTA);
    const enDescanso = candidatos.find((persona) => persona.id === 3);

    expect(enDescanso?.elegible).toBe(false);
    expect(enDescanso?.motivo).toContain('descanso');
  });

  it('quien sí puede llega sin motivo, no con uno vacío', async () => {
    const { servicio } = armar();

    const [primero] = await servicio.consultar(CONSULTA);

    expect(primero.elegible).toBe(true);
    expect(primero.motivo).toBeNull();
  });

  it('LA RESPUESTA NO LLEVA CÉDULA NI TELÉFONO', async () => {
    const { servicio } = armar();

    const [primero] = await servicio.consultar(CONSULTA);

    expect(Object.keys(primero).sort()).toEqual([
      'apellidos',
      'area',
      'cargo',
      'elegible',
      'id',
      'motivo',
      'nombres',
      'zonalId',
    ]);
    expect(JSON.stringify(primero)).not.toContain('98 514');
  });

  it('un formulario sin áreas declaradas devuelve lista vacía, no todo el personal', async () => {
    // Mismo criterio que los catálogos de M-07: devolverlo todo «mientras llega la
    // delimitación» ofrecería gente de otro departamento sin que nadie lo notara.
    const { servicio, listarPorAreas } = armar({ areas: [] });

    expect(await servicio.consultar(CONSULTA)).toEqual([]);
    expect(listarPorAreas).not.toHaveBeenCalled();
  });

  it('sin candidatos no consulta las ausencias', async () => {
    const { servicio } = armar({ candidatos: [] });

    expect(await servicio.consultar(CONSULTA)).toEqual([]);
  });

  it('si todos están ausentes, se devuelven todos con su motivo', async () => {
    // Antes la lista quedaba vacía y parecía que el formulario no tuviera personal. La
    // diferencia entre «no hay nadie» y «hoy no puede nadie» importa a quien arma el
    // cuadro: la primera es un error de configuración y la segunda, del calendario.
    const { servicio } = armar({ ausentes: [1, 2, 3] });

    const candidatos = await servicio.consultar(CONSULTA);

    expect(candidatos).toHaveLength(3);
    expect(candidatos.every((persona) => !persona.elegible)).toBe(true);
    expect(candidatos.every((persona) => persona.motivo !== null)).toBe(true);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LA LISTA SE ACOTA TAMBIÉN AL DEPARTAMENTO QUE PREGUNTA. 2026-08-27.
 *
 * Hasta hoy esta consulta no sabía quién la hacía, y eso dejaba un hueco que se veía en
 * el 6 · REACN: el DMIT —que solo aporta personal de Instrucción— recibía en la lista a
 * inspectores generales y técnicos que el servidor le rechazaba al asignarlos. Ofrecer
 * lo que se va a rechazar es peor que no ofrecer nada: parece un fallo del sistema.
 *
 * SOLO SE ACOTA LA LISTA. Las reglas de escritura no cambian, así que lo ofrecido pasa a
 * ser un subconjunto de lo permitido y nadie se encuentra un 403 por algo que vio.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('PersonalElegibleService · el rol acota la lista', () => {
  const MIXTO = [AreaPersonal.INSTRUCCION, AreaPersonal.OPERATIVOS];

  it('la Unidad de Operativos solo recibe personal de su área', async () => {
    const { servicio, listarPorAreas } = armar({ areas: MIXTO });

    await servicio.consultar({
      ...CONSULTA,
      roles: [RolDepartamental.DMIP_OPERATIVOS],
    });

    expect(listarPorAreas).toHaveBeenCalledWith([AreaPersonal.OPERATIVOS]);
  });

  /**
   * ES LA QUE DISCRIMINA. La anterior pasaría con un filtro que devolviera siempre
   * `OPERATIVOS`; esta exige que lo devuelto dependa de **quién pregunta**, sobre el
   * mismo formulario y con las mismas áreas admitidas.
   */
  it('y el DMIT, sobre el mismo formulario, recibe la suya', async () => {
    const { servicio, listarPorAreas } = armar({ areas: MIXTO });

    await servicio.consultar({
      ...CONSULTA,
      roles: [RolDepartamental.DMIT_INSTRUCTOR],
    });

    expect(listarPorAreas).toHaveBeenCalledWith([AreaPersonal.INSTRUCCION]);
  });

  it('Inspecciones dispone de dos áreas, y recibe las dos', async () => {
    // TECNICO y GENERAL son los dos cuerpos de inspectores de la DMIP: el mapa no es
    // uno a uno, y un filtro que devolviera una sola área rompería aquí.
    const { servicio, listarPorAreas } = armar();

    await servicio.consultar({
      ...CONSULTA,
      roles: [RolDepartamental.DMIP_INSPECCIONES],
    });

    expect(listarPorAreas).toHaveBeenCalledWith([
      AreaPersonal.GENERAL,
      AreaPersonal.TECNICO,
    ]);
  });

  it('el formulario de eventuales no se acota, aunque venga el rol', async () => {
    // 7 · OPERATIVO DMIT. Su razón de ser es reunir gente de donde haga falta, y lo dice
    // el dato del formulario, no un código escrito en el servicio.
    const { servicio, listarPorAreas } = armar({
      areas: MIXTO,
      filtraPersonalPorRol: false,
    });

    await servicio.consultar({
      ...CONSULTA,
      roles: [RolDepartamental.DMIT_INSTRUCTOR],
    });

    expect(listarPorAreas).toHaveBeenCalledWith(MIXTO);
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * ESTA PRUEBA EXISTE POR UN DEFECTO EN PRODUCCIÓN. 2026-08-27.
   *
   * El filtro nació tomando **un solo rol**, `usuario.rol`, que la cadena de guardas
   * estrecha… salvo en este endpoint, que no declara `@Roles` y por tanto no lo estrecha
   * nadie: se queda en el primero que devolvió Auth.
   *
   * A quien tiene DMIT Instrucción **y** Administrador le llegaba a veces el segundo, que
   * no tiene área propia, y **el selector de personal aparecía vacío sin decir por qué**.
   * Se reportó desde la pantalla, no desde una prueba.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  it('un rol sin área no anula a los que sí la tienen', async () => {
    const { servicio, listarPorAreas } = armar({ areas: MIXTO });

    await servicio.consultar({
      ...CONSULTA,
      roles: [
        RolDepartamental.ADMINISTRADOR_DMIP,
        RolDepartamental.DMIT_INSTRUCTOR,
      ],
    });

    expect(listarPorAreas).toHaveBeenCalledWith([AreaPersonal.INSTRUCCION]);
  });

  it('y da igual el orden en que Auth los devuelva', async () => {
    // El orden de `sesion.roles` no lo decide este sistema. Si el filtro dependiera de
    // él, fallaría de forma intermitente, que es como se manifestó.
    const { servicio, listarPorAreas } = armar({ areas: MIXTO });

    await servicio.consultar({
      ...CONSULTA,
      roles: [
        RolDepartamental.DMIT_INSTRUCTOR,
        RolDepartamental.ADMINISTRADOR_DMIP,
      ],
    });

    expect(listarPorAreas).toHaveBeenCalledWith([AreaPersonal.INSTRUCCION]);
  });

  it('sin rol no se acota, que es como se comportaba antes', async () => {
    const { servicio, listarPorAreas } = armar({ areas: MIXTO });

    await servicio.consultar(CONSULTA);

    expect(listarPorAreas).toHaveBeenCalledWith(MIXTO);
  });

  it('sin área en común la lista sale vacía, y no se consulta al maestro', async () => {
    // Un formulario de solo Instrucción consultado por Inspecciones. La lista vacía se
    // ve y se pregunta; devolver a todo el mundo pasaría por buena.
    const { servicio, listarPorAreas } = armar({
      areas: [AreaPersonal.INSTRUCCION],
    });

    const elegibles = await servicio.consultar({
      ...CONSULTA,
      roles: [RolDepartamental.DMIP_INSPECCIONES],
    });

    expect(elegibles).toEqual([]);
    expect(listarPorAreas).not.toHaveBeenCalled();
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * DOS SEÑALES ADVISORY DISTINTAS (FRMS / ISO 45001 + equidad de reparto). NINGUNA cambia `elegible`.
 *
 *   1) FATIGA (seguridad): `indiceCarga` + `nivelFatiga`, por umbrales ABSOLUTOS. El servicio COPIA
 *      el nivel que ya resolvió la política; no lo recalcula ni depende del grupo.
 *   2) EQUIDAD (reparto): `cuotaJusta` (media del grupo de elegibles), `desviacionCarga` y
 *      `nivelEquidad` (DEBAJO/EQUILIBRADO/ENCIMA). `sugerido` marca a los elegibles por DEBAJO de su
 *      parte. Un no elegible nunca se sugiere. Sin cargas, el contrato anterior queda intacto.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('PersonalElegibleService · señales de fatiga y equidad', () => {
  const carga = (indiceCarga: number, nivelFatiga: string) => ({
    indiceCarga,
    nivelFatiga,
    factores: [],
  });

  it('la señal de FATIGA es ABSOLUTA: se respeta el nivel que trae la política, no se recalcula', async () => {
    // Cada quien conserva el nivel que `calcularCargas` resolvió por sus umbrales; el grupo no lo
    // altera. Es lo contrario al viejo semáforo por tercios, que lo recalculaba por posición.
    const { servicio } = armar({
      cargas: new Map([
        [1, carga(2, 'VERDE')],
        [2, carga(8, 'ROJO')],
        [3, carga(4, 'AMBAR')],
      ]),
    });

    const candidatos = await servicio.consultar(CONSULTA);
    const nivel = (id: number) =>
      candidatos.find((persona) => persona.id === id)?.nivelFatiga;

    expect(nivel(1)).toBe('VERDE');
    expect(nivel(2)).toBe('ROJO');
    expect(nivel(3)).toBe('AMBAR');
    expect(candidatos.find((persona) => persona.id === 2)?.indiceCarga).toBe(8);
  });

  it('la señal de EQUIDAD sitúa a cada persona frente a la cuota justa (media del grupo)', async () => {
    // Cargas {2, 8, 4} → cuota justa = 14/3 ≈ 4.7. Con margen 0.25 (banda [0.75, 1.25]·cuota):
    // 2 muy por debajo → DEBAJO; 8 muy por encima → ENCIMA; 4 dentro de la banda → EQUILIBRADO.
    const { servicio } = armar({
      cargas: new Map([
        [1, carga(2, 'VERDE')],
        [2, carga(8, 'VERDE')],
        [3, carga(4, 'VERDE')],
      ]),
    });

    const candidatos = await servicio.consultar(CONSULTA);
    const persona = (id: number) => candidatos.find((quien) => quien.id === id);

    expect(persona(1)?.nivelEquidad).toBe('DEBAJO');
    expect(persona(2)?.nivelEquidad).toBe('ENCIMA');
    expect(persona(3)?.nivelEquidad).toBe('EQUILIBRADO');
    // La cuota es la misma para todos; la desviación es carga − cuota.
    expect(persona(1)?.cuotaJusta).toBe(4.7);
    expect(persona(2)?.desviacionCarga).toBe(3.3);
  });

  it('sugiere a los elegibles por DEBAJO de su cuota justa, no a los equilibrados ni a los de encima', async () => {
    // Cargas {0, 10, 20} → cuota = 10. 0 por debajo → sugerido; 10 en su parte → no; 20 encima → no.
    const { servicio } = armar({
      cargas: new Map([
        [1, carga(0, 'VERDE')],
        [2, carga(10, 'AMBAR')],
        [3, carga(20, 'ROJO')],
      ]),
    });

    const candidatos = await servicio.consultar(CONSULTA);
    const sugerido = (id: number) =>
      candidatos.find((persona) => persona.id === id)?.sugerido;

    expect(sugerido(1)).toBe(true);
    expect(sugerido(2)).toBe(false);
    expect(sugerido(3)).toBe(false);
  });

  it('si todos cargan lo mismo, todos quedan EQUILIBRADO y no se sugiere a nadie', async () => {
    // Cargas iguales → cada uno está en su cuota (ratio 1). No hay desbalance que repartir.
    const { servicio } = armar({
      cargas: new Map([
        [1, carga(5, 'VERDE')],
        [2, carga(5, 'VERDE')],
        [3, carga(5, 'VERDE')],
      ]),
    });

    const candidatos = await servicio.consultar(CONSULTA);

    expect(
      candidatos.every((persona) => persona.nivelEquidad === 'EQUILIBRADO'),
    ).toBe(true);
    expect(candidatos.every((persona) => persona.sugerido === false)).toBe(
      true,
    );
  });

  it('un NO elegible nunca es sugerido, aunque esté por debajo de su cuota', async () => {
    // El ausente 1 está muy por debajo de la cuota, pero no puede salir: no se sugiere.
    const { servicio } = armar({
      ausentes: [1],
      cargas: new Map([
        [1, carga(0, 'VERDE')],
        [2, carga(10, 'VERDE')],
        [3, carga(20, 'ROJO')],
      ]),
    });

    const candidatos = await servicio.consultar(CONSULTA);
    const ausente = candidatos.find((persona) => persona.id === 1);

    expect(ausente?.elegible).toBe(false);
    expect(ausente?.sugerido).not.toBe(true);
  });

  it('un elegible con fatiga ROJA sigue siendo elegible (no bloquea)', async () => {
    const { servicio } = armar({
      cargas: new Map([
        [1, carga(2, 'VERDE')],
        [2, carga(3, 'VERDE')],
        [3, carga(12, 'ROJO')],
      ]),
    });

    const candidatos = await servicio.consultar(CONSULTA);
    const rojo = candidatos.find((persona) => persona.id === 3);

    expect(rojo?.nivelFatiga).toBe('ROJO');
    expect(rojo?.elegible).toBe(true);
  });
});
