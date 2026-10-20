/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · compartir unidad
 * Archivo: compartir-tramo.spec.ts
 * Responsabilidad: Fijar cuándo un traslado puede viajar en la misma unidad que otro.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-19
 */

import {
  agendaPorUnidad,
  clasificarTramo,
  claveDeUnidad,
  conSuUnidad,
  mismoLugar,
  palabraDeTramo,
  puedeCompartirOperativo,
  puedeCompartirTramo,
  seCruzan,
  contiene,
  mismoSitio,
  encajarEnUnidad,
  type TramoDeLaUnidad,
  type TramoQueSeSuma,
  type TramoCompartible,
} from './compartir-tramo';

const CALDERON = { zonalId: 7, sector: 'NORTE' };
const LA_DELICIA = { zonalId: 8, sector: 'NORTE' };
const QUITUMBE = { zonalId: 3, sector: 'SUR' };

const tramo = (
  tipo: string,
  inicio: number,
  extra: Partial<TramoCompartible> = {},
): TramoCompartible => ({
  tipo,
  inicio,
  origen: CALDERON,
  esMacrooperativo: false,
  ...extra,
});

const OCHO = 8 * 60;
const VENTANA = { ventanaMin: 30 };

describe('puedeCompartirTramo', () => {
  it('mismo tipo, misma hora y misma zonal: se comparte', () => {
    expect(
      puedeCompartirTramo(tramo('DEJAR', OCHO), tramo('DEJAR', OCHO), VENTANA),
    ).toEqual({ compatible: true });
  });

  it('un tipo distinto no se comparte (dejar con retirar)', () => {
    const r = puedeCompartirTramo(
      tramo('DEJAR', OCHO),
      tramo('RETIRAR', OCHO),
      VENTANA,
    );
    expect(r).toMatchObject({ compatible: false, codigo: 'TIPO_DISTINTO' });
  });

  it('fuera de la ventana de minutos no se comparte; en el borde sí', () => {
    expect(
      puedeCompartirTramo(
        tramo('DEJAR', OCHO),
        tramo('DEJAR', OCHO + 30),
        VENTANA,
      ).compatible,
    ).toBe(true);
    expect(
      puedeCompartirTramo(
        tramo('DEJAR', OCHO),
        tramo('DEJAR', OCHO + 31),
        VENTANA,
      ),
    ).toMatchObject({ compatible: false, codigo: 'FUERA_DE_VENTANA' });
  });

  it('otra zonal del mismo sector se comparte; de otro sector, no', () => {
    expect(
      puedeCompartirTramo(
        tramo('DEJAR', OCHO),
        tramo('DEJAR', OCHO, { origen: LA_DELICIA }),
        VENTANA,
      ).compatible,
    ).toBe(true);
    expect(
      puedeCompartirTramo(
        tramo('DEJAR', OCHO),
        tramo('DEJAR', OCHO, { origen: QUITUMBE }),
        VENTANA,
      ),
    ).toMatchObject({ compatible: false, codigo: 'OTRO_LUGAR' });
  });

  it('sin lugar conocido no se comparte', () => {
    expect(mismoLugar(null, CALDERON)).toBe(false);
  });

  it('el macrooperativo nunca comparte, sea anfitrión o invitado', () => {
    expect(
      puedeCompartirTramo(
        tramo('DEJAR', OCHO, { esMacrooperativo: true }),
        tramo('DEJAR', OCHO),
        VENTANA,
      ),
    ).toMatchObject({ compatible: false, codigo: 'EXCLUSIVO' });
    expect(
      puedeCompartirTramo(
        tramo('DEJAR', OCHO),
        tramo('DEJAR', OCHO, { esMacrooperativo: true }),
        VENTANA,
      ),
    ).toMatchObject({ compatible: false, codigo: 'EXCLUSIVO' });
  });

  it('con capacidad: sin asientos registrados no se comparte a ciegas', () => {
    expect(
      puedeCompartirTramo(tramo('DEJAR', OCHO), tramo('DEJAR', OCHO), {
        ...VENTANA,
        capacidad: { asientos: null, ocupados: 1, personasInvitado: 1 },
      }),
    ).toMatchObject({ compatible: false, codigo: 'SIN_ASIENTOS' });
  });

  it('con capacidad: cabe justo; una persona más, no', () => {
    expect(
      puedeCompartirTramo(tramo('DEJAR', OCHO), tramo('DEJAR', OCHO), {
        ...VENTANA,
        capacidad: { asientos: 4, ocupados: 3, personasInvitado: 1 },
      }).compatible,
    ).toBe(true);
    const r = puedeCompartirTramo(tramo('DEJAR', OCHO), tramo('DEJAR', OCHO), {
      ...VENTANA,
      capacidad: { asientos: 4, ocupados: 3, personasInvitado: 2 },
    });
    expect(r).toMatchObject({ compatible: false, codigo: 'SIN_CUPO' });
    expect(r.compatible === false && r.motivo).toContain('4 asientos');
  });
});

describe('puedeCompartirOperativo', () => {
  const op = (
    tramos: TramoCompartible[],
    extra: { esMacrooperativo?: boolean; esTareaTaller?: boolean } = {},
  ) => ({ esMacrooperativo: false, ...extra, tramos });

  it('dos «dejar y retirar» comparten los dos traslados', () => {
    const anfitrion = op([tramo('DEJAR', OCHO), tramo('RETIRAR', 16 * 60)]);
    const invitado = op([tramo('DEJAR', OCHO), tramo('RETIRAR', 16 * 60)]);
    const r = puedeCompartirOperativo(anfitrion, invitado, VENTANA);
    expect(r.compatible).toBe(true);
    expect(r.compatible && r.tramosCompartidos.map((t) => t.tipo)).toEqual([
      'DEJAR',
      'RETIRAR',
    ]);
    expect(r.compatible && r.tramosPropios).toEqual([]);
  });

  // Con los fines: desde el 2026-10-19 la regla necesita saber que el retiro de las 16:00 no se
  // cruza con el dejar de las 08:00 (sin fin, se supone que sí y sería un conflicto).
  it('«la misma unidad»: un «dejar y retirar» comparte el dejar con un «solo dejar» y el retiro queda PROPIO', () => {
    const soloDeja = op([tramo('DEJAR', OCHO, { fin: OCHO + 30 })]);
    const invitado = op([
      tramo('DEJAR', OCHO, { fin: OCHO + 30 }),
      tramo('RETIRAR', 16 * 60, { fin: 16 * 60 + 30 }),
    ]);
    const r = puedeCompartirOperativo(soloDeja, invitado, VENTANA);
    expect(r.compatible).toBe(true);
    expect(r.compatible && r.tramosCompartidos.map((t) => t.tipo)).toEqual([
      'DEJAR',
    ]);
    expect(r.compatible && r.tramosPropios.map((t) => t.tipo)).toEqual([
      'RETIRAR',
    ]);
  });

  it('ningún traslado en común: incompatible con el motivo', () => {
    const soloDeja = op([tramo('DEJAR', OCHO)]);
    expect(
      puedeCompartirOperativo(soloDeja, op([tramo('RETIRAR', OCHO)]), VENTANA),
    ).toMatchObject({ compatible: false, codigo: 'TIPO_DISTINTO' });
    expect(
      puedeCompartirOperativo(
        soloDeja,
        op([tramo('DEJAR', 10 * 60), tramo('RETIRAR', 16 * 60)]),
        VENTANA,
      ),
    ).toMatchObject({ compatible: false, codigo: 'FUERA_DE_VENTANA' });
  });

  it('palabraDeTramo nombra cada traslado en una palabra', () => {
    expect(palabraDeTramo('DEJAR')).toBe('dejar');
    expect(palabraDeTramo('RETIRAR')).toBe('retirar');
    expect(palabraDeTramo('COMPLETO')).toBe('todo el operativo');
  });

  it('un «solo dejar» comparte con el «dejar» de un «dejar y retirar»', () => {
    const anfitrion = op([tramo('DEJAR', OCHO), tramo('RETIRAR', 16 * 60)]);
    expect(
      puedeCompartirOperativo(anfitrion, op([tramo('DEJAR', OCHO)]), VENTANA)
        .compatible,
    ).toBe(true);
  });

  it('el motivo es el del tramo del mismo tipo, no el del primero que encuentre', () => {
    const anfitrion = op([tramo('RETIRAR', OCHO), tramo('DEJAR', 12 * 60)]);
    expect(
      puedeCompartirOperativo(anfitrion, op([tramo('DEJAR', OCHO)]), VENTANA),
    ).toMatchObject({ compatible: false, codigo: 'FUERA_DE_VENTANA' });
  });

  describe('tres clases de traslado: compartido, secuencial y conflicto (2026-10-19)', () => {
    /** Con fin: ahora la regla sabe si dos traslados se cruzan. Tramos de 30 minutos. */
    const t = (
      tipo: string,
      inicio: number,
      extra: Partial<TramoCompartible> = {},
    ) => tramo(tipo, inicio, { fin: inicio + 30, ...extra });
    const soloDejaOcho = op([t('DEJAR', OCHO)]);

    it('el caso del 20-oct: un «solo retirar» de las 16:00 usa la misma unidad después del «dejar» de las 08:00', () => {
      const r = puedeCompartirOperativo(
        soloDejaOcho,
        op([t('RETIRAR', 16 * 60)]),
        VENTANA,
      );
      expect(r).toEqual({
        compatible: true,
        tramosCompartidos: [],
        tramosPropios: [expect.objectContaining({ tipo: 'RETIRAR' })],
        tramosContenidos: [],
      });
    });

    /*
      CAMBIO DE REGLA (2026-10-20, «completo comparte unidad»). Hasta ayer un «completo» que se cruzaba con
      el «dejar» de la unidad era un conflicto (TIPO_DISTINTO). Ahora, en el mismo sitio, el «completo»
      ABARCA ese dejar: la unidad que lo acompaña todo el día deja al otro personal sin moverse. Sigue
      siendo conflicto en otra zonal (abajo, «contención»).
    */
    it('un «completo» en el mismo sitio abarca el «dejar» de la unidad (2026-10-20)', () => {
      const r = puedeCompartirOperativo(
        soloDejaOcho,
        op([tramo('COMPLETO', OCHO, { fin: 16 * 60 + 30 })]),
        VENTANA,
      );
      expect(r).toMatchObject({
        compatible: true,
        tramosContenidos: [
          {
            tramo: expect.objectContaining({ tipo: 'COMPLETO' }) as unknown,
            sentido: 'ABARCA',
          },
        ],
      });
    });

    it('un «dejar y retirar» comparte el dejar y hace el retiro después', () => {
      const r = puedeCompartirOperativo(
        soloDejaOcho,
        op([t('DEJAR', OCHO), t('RETIRAR', 16 * 60)]),
        VENTANA,
      );
      expect(r.compatible && r.tramosCompartidos.map((x) => x.tipo)).toEqual([
        'DEJAR',
      ]);
      expect(r.compatible && r.tramosPropios.map((x) => x.tipo)).toEqual([
        'RETIRAR',
      ]);
    });

    it('un «dejar» de las 09:00 no se cruza con el de 08:00–08:30: la misma unidad lo hace después', () => {
      const r = puedeCompartirOperativo(
        soloDejaOcho,
        op([t('DEJAR', 9 * 60)]),
        VENTANA,
      );
      expect(r).toMatchObject({ compatible: true, tramosCompartidos: [] });
      expect(r.compatible && r.tramosPropios.map((x) => x.tipo)).toEqual([
        'DEJAR',
      ]);
    });

    it('un «dejar» a las 08:15 de otra zonal se cruza y no puede ir: conflicto con su motivo', () => {
      expect(
        puedeCompartirOperativo(
          soloDejaOcho,
          op([t('DEJAR', OCHO + 15, { origen: QUITUMBE })]),
          VENTANA,
        ),
      ).toMatchObject({ compatible: false, codigo: 'OTRO_LUGAR' });
    });

    it('el exclusivo sigue sin compartir, aunque no se crucen', () => {
      expect(
        puedeCompartirOperativo(
          op([t('DEJAR', OCHO)], { esMacrooperativo: true }),
          op([t('RETIRAR', 16 * 60)]),
          VENTANA,
        ),
      ).toMatchObject({ compatible: false, codigo: 'EXCLUSIVO' });
    });

    it('clasificarTramo: compartido, secuencial o conflicto', () => {
      const unidad = [t('DEJAR', OCHO)];
      expect(clasificarTramo(t('DEJAR', OCHO), unidad, VENTANA).clase).toBe(
        'COMPARTIDO',
      );
      expect(
        clasificarTramo(t('RETIRAR', 16 * 60), unidad, VENTANA).clase,
      ).toBe('SECUENCIAL');
      expect(clasificarTramo(t('RETIRAR', OCHO), unidad, VENTANA).clase).toBe(
        'CONFLICTO',
      );
    });

    it('seCruzan: sin el fin de alguno se supone que sí', () => {
      expect(seCruzan(tramo('DEJAR', OCHO), t('DEJAR', 16 * 60))).toBe(true);
      expect(seCruzan(t('DEJAR', OCHO), t('DEJAR', OCHO + 30))).toBe(false);
    });
  });

  it('macrooperativo, tarea de taller o sin transporte: no comparte', () => {
    const normal = op([tramo('DEJAR', OCHO)]);
    expect(
      puedeCompartirOperativo(
        op([tramo('DEJAR', OCHO)], { esMacrooperativo: true }),
        normal,
        VENTANA,
      ),
    ).toMatchObject({ codigo: 'EXCLUSIVO' });
    expect(
      puedeCompartirOperativo(
        op([tramo('TAREA', OCHO)], { esTareaTaller: true }),
        normal,
        VENTANA,
      ),
    ).toMatchObject({ codigo: 'TAREA_TALLER' });
    expect(puedeCompartirOperativo(normal, op([]), VENTANA)).toMatchObject({
      codigo: 'SIN_TRAMOS',
    });
  });
});

describe('la unidad compartida como UN intervalo (2026-10-19)', () => {
  const franja = (inicio: number, fin: number) => ({ inicio, fin });

  it('claveDeUnidad: el anfitrión, o el propio tramo si no comparte', () => {
    expect(claveDeUnidad({ id: 5, compartidoConTramoId: 2 })).toBe(2);
    expect(claveDeUnidad({ id: 5, compartidoConTramoId: null })).toBe(5);
    expect(claveDeUnidad({ id: 5 })).toBe(5);
  });

  it('conSuUnidad suma a quienes viajan en la misma unidad que un excluido', () => {
    const tramos = [
      { id: 1, compartidoConTramoId: null },
      { id: 2, compartidoConTramoId: 1 },
      { id: 3, compartidoConTramoId: null },
    ];
    expect([...conSuUnidad(new Set([2]), tramos)].sort()).toEqual([1, 2]);
    expect([...conSuUnidad(new Set([3]), tramos)]).toEqual([3]);
  });

  it('agendaPorUnidad funde anfitrión e invitado en un intervalo y deja el resto igual', () => {
    const agenda = agendaPorUnidad([
      { clave: 1, tramo: { franja: franja(180, 210), etiqueta: 'A' } },
      { clave: 1, tramo: { franja: franja(190, 220), etiqueta: 'B' } },
      { clave: 9, tramo: { franja: franja(300, 330), etiqueta: 'C' } },
    ]);
    expect(agenda).toEqual([
      { franja: franja(180, 220), etiqueta: 'A', destino: undefined },
      { franja: franja(300, 330), etiqueta: 'C' },
    ]);
  });
});

describe('contención en un «completo» (2026-10-20)', () => {
  const t = (
    tipo: string,
    inicio: number,
    fin: number,
    extra: Partial<TramoCompartible> = {},
  ): TramoCompartible => tramo(tipo, inicio, { fin, puntoId: 327, ...extra });
  const completo = t('COMPLETO', OCHO, 16 * 60 + 30);
  const dejar = t('DEJAR', OCHO, OCHO + 30);
  const retirar = t('RETIRAR', 16 * 60, 16 * 60 + 30);
  const op = (tramos: TramoCompartible[]) => ({
    esMacrooperativo: false,
    tramos,
  });

  it('contiene: dentro del horario, mismo sitio, sin exclusivo', () => {
    expect(contiene(completo, dejar, 30)).toBe(true);
    expect(contiene(completo, retirar, 30)).toBe(true);
    expect(contiene(dejar, completo, 30)).toBe(false);
    expect(contiene(completo, t('DEJAR', 7 * 60, 7 * 60 + 30), 30)).toBe(false);
    expect(
      contiene(completo, t('DEJAR', OCHO, OCHO + 30, { puntoId: 328 }), 30),
    ).toBe(false);
    expect(
      contiene(
        completo,
        t('DEJAR', OCHO, OCHO + 30, { origen: LA_DELICIA }),
        30,
      ),
    ).toBe(false);
    expect(
      contiene(
        completo,
        t('DEJAR', OCHO, OCHO + 30, { esMacrooperativo: true }),
        30,
      ),
    ).toBe(false);
  });

  it('mismoSitio: la zonal estricta (el sector no basta) y el punto si los dos lo tienen', () => {
    expect(mismoSitio(dejar, retirar)).toBe(true);
    expect(
      mismoSitio(dejar, t('DEJAR', OCHO, OCHO + 30, { origen: LA_DELICIA })),
    ).toBe(false);
    expect(
      mismoSitio(dejar, t('DEJAR', OCHO, OCHO + 30, { puntoId: null })),
    ).toBe(true);
    expect(
      mismoSitio(dejar, t('DEJAR', OCHO, OCHO + 30, { puntoId: 328 })),
    ).toBe(false);
  });

  it('DENTRO: un «solo dejar» y un «solo retirar» caen en el «completo» de la unidad', () => {
    expect(clasificarTramo(dejar, [completo], VENTANA)).toMatchObject({
      clase: 'CONTENIDO',
      sentido: 'DENTRO',
      pareja: completo,
    });
    expect(
      puedeCompartirOperativo(op([completo]), op([dejar, retirar]), VENTANA),
    ).toMatchObject({
      compatible: true,
      tramosCompartidos: [],
      tramosPropios: [],
    });
  });

  it('ABARCA: el «completo» del invitado cubre el dejar y el retiro de la unidad (005 con 001/002)', () => {
    const clase = clasificarTramo(completo, [dejar, retirar], VENTANA);
    expect(clase).toMatchObject({ clase: 'CONTENIDO', sentido: 'ABARCA' });
    expect(clase.clase === 'CONTENIDO' && clase.cruzados).toEqual([
      dejar,
      retirar,
    ]);
  });

  it('otro punto o fuera del horario: conflicto con el motivo de la contención', () => {
    // Un «completo» en el punto 328 que se cruza con el dejar del 327: la unidad no está en los dos.
    expect(
      puedeCompartirOperativo(
        op([dejar]),
        op([t('COMPLETO', OCHO, 16 * 60 + 30, { puntoId: 328 })]),
        VENTANA,
      ),
    ).toMatchObject({ compatible: false, codigo: 'OTRO_LUGAR' });
    // Como 003 (09:30–14:30 en el 328): no se cruza con el dejar de las 08:00, la misma unidad lo
    // haría después (SECUENCIAL), no es un conflicto.
    expect(
      puedeCompartirOperativo(
        op([dejar]),
        op([t('COMPLETO', 9 * 60 + 30, 14 * 60 + 30, { puntoId: 328 })]),
        VENTANA,
      ),
    ).toMatchObject({ compatible: true, tramosContenidos: [] });
    const parcial = clasificarTramo(
      t('DEJAR', 16 * 60 + 15, 17 * 60 + 30),
      [completo],
      VENTANA,
    );
    expect(parcial).toMatchObject({
      clase: 'CONFLICTO',
      motivo: { codigo: 'FUERA_DE_VENTANA' },
    });
  });

  it('el exclusivo no se contiene', () => {
    expect(
      puedeCompartirOperativo(
        {
          esMacrooperativo: true,
          tramos: [{ ...completo, esMacrooperativo: true }],
        },
        op([dejar]),
        VENTANA,
      ),
    ).toMatchObject({ compatible: false, codigo: 'EXCLUSIVO' });
  });

  it('«completo» con «completo» en la misma ventana sigue siendo COMPARTIDO', () => {
    expect(clasificarTramo(completo, [completo], VENTANA)).toMatchObject({
      clase: 'COMPARTIDO',
    });
  });
});

describe('encajarEnUnidad: el «completo» deja y retira en su punto (caso 21-OCT, 2026-10-21)', () => {
  const ZONA3 = { zonalId: 3, sector: 'CENTRO' };
  const PUNTO = 327;
  const DIECISEIS = 16 * 60;
  // Tramos del 21-OCT: 46 COMPLETO de 66; 47 DEJAR de 67; 48 RETIRAR de 68; 49 DEJAR + 50 RETIRAR de 69.
  const plan: Record<
    number,
    { operativoId: number; tipo: string; inicio: number; fin: number }
  > = {
    46: {
      operativoId: 66,
      tipo: 'COMPLETO',
      inicio: OCHO,
      fin: DIECISEIS + 30,
    },
    47: { operativoId: 67, tipo: 'DEJAR', inicio: OCHO, fin: OCHO + 30 },
    48: {
      operativoId: 68,
      tipo: 'RETIRAR',
      inicio: DIECISEIS,
      fin: DIECISEIS + 30,
    },
    49: { operativoId: 69, tipo: 'DEJAR', inicio: OCHO, fin: OCHO + 30 },
    50: {
      operativoId: 69,
      tipo: 'RETIRAR',
      inicio: DIECISEIS,
      fin: DIECISEIS + 30,
    },
  };
  const deOperativo = (operativoId: number) =>
    Object.keys(plan)
      .map(Number)
      .filter((id) => plan[id].operativoId === operativoId);
  const comoTramo = (id: number, extra: Partial<TramoCompartible> = {}) => ({
    id,
    tipo: plan[id].tipo,
    inicio: plan[id].inicio,
    fin: plan[id].fin,
    origen: ZONA3,
    esMacrooperativo: false,
    puntoId: PUNTO,
    ...extra,
  });
  const personasDe = () => 1;

  /** Simula la DAF: suma cada operativo a la unidad en el orden dado y aplica lo que dice la regla. */
  function enOrden(operativos: number[], asientos = 4) {
    let unidad: TramoDeLaUnidad[] = [];
    for (const operativoId of operativos) {
      const tramos: TramoQueSeSuma[] = deOperativo(operativoId).map((id) =>
        comoTramo(id),
      );
      if (unidad.length === 0) {
        unidad = tramos.map((t) => ({
          ...t,
          operativoId,
          compartidoConTramoId: null,
        }));
        continue;
      }
      const r = encajarEnUnidad({ operativoId, tramos }, unidad, {
        ventanaMin: 30,
        asientos,
        personasDe,
      });
      if (!r.compatible) return { unidad, fallo: r };
      const marca = new Map<number, number | null>();
      for (const p of r.pares) marca.set(p.tramoId, p.raizId);
      for (const id of r.raices) marca.set(id, null);
      for (const s of r.sinPareja) marca.set(s.tramoId, null);
      unidad = unidad.map((t) => {
        const nueva = r.reraizar.find((x) => x.tramoId === t.id);
        return nueva ? { ...t, compartidoConTramoId: nueva.raizId } : t;
      });
      unidad.push(
        ...tramos.map((t) => ({
          ...t,
          operativoId,
          compartidoConTramoId: marca.get(t.id) ?? null,
        })),
      );
    }
    return { unidad, fallo: null };
  }
  const raices = (unidad: TramoDeLaUnidad[]) =>
    Object.fromEntries(unidad.map((t) => [t.id, t.compartidoConTramoId]));

  it.each([
    ['el completo primero', [66, 67, 68, 69]],
    ['dejar, retirar y después el completo', [67, 68, 66, 69]],
    ['dejar, el completo y después el retirar', [67, 66, 68, 69]],
    ['el dejar y retirar primero', [69, 67, 66, 68]],
  ])(
    '%s: los cinco traslados en la unidad, con el «completo» como raíz',
    (_, orden) => {
      const { unidad, fallo } = enOrden(orden);
      expect(fallo).toBeNull();
      expect(raices(unidad)).toEqual({
        46: null,
        47: 46,
        48: 46,
        49: 46,
        50: 46,
      });
    },
  );

  it('cuenta los asientos POR MOMENTO: a las 08:00 van 3 y a las 16:00 van 3', () => {
    const { unidad } = enOrden([66, 67, 68]);
    const r = encajarEnUnidad(
      { operativoId: 69, tramos: deOperativo(69).map((id) => comoTramo(id)) },
      unidad,
      { ventanaMin: 30, asientos: 4, personasDe },
    );
    expect(r).toMatchObject({
      compatible: true,
      personas: 3,
      momentos: [
        { tipo: 'DEJAR', inicio: OCHO, personas: 3 },
        { tipo: 'RETIRAR', inicio: DIECISEIS, personas: 3 },
      ],
    });
  });

  it('con 3 asientos (PMA-3370) caben los cuatro operativos, en cualquier orden', () => {
    for (const orden of [
      [66, 67, 68, 69],
      [67, 68, 66, 69],
      [69, 67, 66, 68],
    ])
      expect(enOrden(orden, 3).fallo).toBeNull();
  });

  it('con 2 asientos no caben: el motivo dice a qué hora', () => {
    const { fallo } = enOrden([66, 67, 68, 69], 2);
    expect(fallo).toEqual({
      compatible: false,
      codigo: 'SIN_CUPO',
      motivo:
        'No caben a las 08:00: la unidad llevaría 3 personas y el vehículo tiene 2 asientos.',
    });
  });

  it('cuenta personas DISTINTAS: quien va en dos operativos ocupa un asiento', () => {
    const { unidad } = enOrden([66, 67, 68], 2);
    const r = encajarEnUnidad(
      { operativoId: 69, tramos: deOperativo(69).map((id) => comoTramo(id)) },
      unidad,
      {
        ventanaMin: 30,
        asientos: 2,
        personasDe,
        // La persona de 69 es la misma del «completo» (66).
        funcionariosDe: (id) => [id === 69 ? 66 : id],
      },
    );
    expect(r).toMatchObject({ compatible: true, personas: 2 });
  });

  it('un retiro SECUENCIAL cuenta solo lo que va a bordo a su hora', () => {
    const unidad: TramoDeLaUnidad[] = [
      { ...comoTramo(47), operativoId: 67, compartidoConTramoId: null },
      { ...comoTramo(49), operativoId: 69, compartidoConTramoId: 47 },
    ];
    const r = encajarEnUnidad(
      { operativoId: 68, tramos: [comoTramo(48)] },
      unidad,
      { ventanaMin: 30, personasDe, asientos: 1 },
    );
    expect(r).toMatchObject({ compatible: true, personas: 1 });
  });

  it('otro punto de encuentro: conflicto', () => {
    const unidad: TramoDeLaUnidad[] = [
      { ...comoTramo(46), operativoId: 66, compartidoConTramoId: null },
    ];
    const r = encajarEnUnidad(
      { operativoId: 67, tramos: [comoTramo(47, { puntoId: 328 })] },
      unidad,
      { ventanaMin: 30, asientos: 4, personasDe },
    );
    expect(r).toMatchObject({ compatible: false, codigo: 'OTRO_LUGAR' });
  });

  it('un traslado que se cruza solo en parte con el completo: conflicto', () => {
    const unidad: TramoDeLaUnidad[] = [
      { ...comoTramo(46), operativoId: 66, compartidoConTramoId: null },
    ];
    const r = encajarEnUnidad(
      {
        operativoId: 68,
        tramos: [
          comoTramo(48, { inicio: DIECISEIS + 20, fin: DIECISEIS + 90 }),
        ],
      },
      unidad,
      { ventanaMin: 30, asientos: 4, personasDe },
    );
    expect(r).toMatchObject({ compatible: false });
  });

  it('el exclusivo (macrooperativo) no comparte', () => {
    const unidad: TramoDeLaUnidad[] = [
      { ...comoTramo(46), operativoId: 66, compartidoConTramoId: null },
    ];
    const r = encajarEnUnidad(
      { operativoId: 67, tramos: [comoTramo(47, { esMacrooperativo: true })] },
      unidad,
      { ventanaMin: 30, asientos: 4, personasDe },
    );
    expect(r).toMatchObject({ compatible: false, codigo: 'EXCLUSIVO' });
  });

  it('lo que la unidad lleva a la misma hora fuera del grupo también ocupa asientos (aBordo)', () => {
    const unidad: TramoDeLaUnidad[] = [
      { ...comoTramo(46), operativoId: 66, compartidoConTramoId: null },
    ];
    const r = encajarEnUnidad(
      { operativoId: 67, tramos: [comoTramo(47)] },
      unidad,
      {
        ventanaMin: 30,
        asientos: 2,
        personasDe,
        aBordo: [
          ...unidad,
          { ...comoTramo(49), operativoId: 69, compartidoConTramoId: null },
        ],
      },
    );
    expect(r).toMatchObject({ compatible: false, codigo: 'SIN_CUPO' });
  });
});
