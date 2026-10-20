/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Órdenes de servicio
 * Archivo: resolver-tokens.spec.ts
 * Responsabilidad: Verificar la ÚNICA resolución de tokens y faltantes (D12/D14/D15/D16/F22).
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-02
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * `resolverTokens(apartados, fuente)` es la única verdad para los datos y los faltantes. Aquí se
 * fijan sus reglas: un token es obligatorio solo si la plantilla lo usa (D15), salvo los
 * estructurales (dependencia del destinatario y la tabla de control) y el firmante (F22); el cargo
 * del destinatario nunca falta (sale de su ficha, en blanco si no lo tiene); `numeroOrden`/`ciudadFecha`/
 * `fechaEmision` NUNCA son faltantes (D14/D16); un dato vacío o en blanco cuenta como faltante.
 *
 * Y cada faltante ya NO es una cadena sino `{ token, etiqueta, origen }` (D16): hay una prueba POR
 * TOKEN que fija de qué fuente sale y con qué `origen` se agrupa (persona/configuración/plantilla).
 * El FIRMANTE (nombre, cargo y dependencia) vive ahora en los datos generales de la plantilla
 * (2026-10-02), así que su origen es «plantilla» y es estructural (el bloque de firma siempre va).
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  resolverTokens,
  tokensUsados,
  type ApartadoConTokens,
  type Faltante,
  type FuenteTokens,
  type OrigenFaltante,
} from './resolver-tokens';

/** Una plantilla que usa `numeroMemorando` y `fechaEmision`, y nada más. */
const PLANTILLA: ApartadoConTokens[] = [
  {
    titulo: 'APARTADO SEGUNDO',
    contenido:
      'Mediante Memorando Nro. {{numeroMemorando}} del {{fechaEmision}}.',
  },
];

/** Una plantilla que usa un token concreto, para probarlo aislado. */
function plantillaCon(token: string): ApartadoConTokens[] {
  return [{ titulo: 'APARTADO', contenido: `Usa {{${token}}}.` }];
}

const FUENTE_LLENA: FuenteTokens = {
  nombre: 'PÉREZ JUAN',
  cargo: 'Agente',
  dependencia: 'DMIP',
  fechaEmision: '25/06/2026',
  ciudadFecha: 'Quito, D.M., 25 de junio de 2026',
  direccionResponsable: 'Dirección Metropolitana de Inspección',
  siglasUnidad: 'AMC',
  numeroMemorando: 'MEM-001',
  fechaMemorando: '17 de junio de 2026',
  designado: 'Mgs. PÉREZ JUAN (Director)',
  elaboradoPor: 'Analista',
  firmante: 'DIRECTOR X',
  firmanteCargo: 'DIRECTOR',
  firmanteDependencia: 'AMC',
  numeroOrden: null,
};

/** La fuente con algunos campos sobreescritos. */
function fuente(parcial: Partial<FuenteTokens>): FuenteTokens {
  return { ...FUENTE_LLENA, ...parcial };
}

describe('tokensUsados', () => {
  it('lee los tokens de título, etiqueta y contenido de todos los apartados', () => {
    const usados = tokensUsados([
      {
        titulo: '{{siglasUnidad}}',
        etiqueta: '{{elaboradoPor}}',
        contenido: '{{numeroMemorando}}',
      },
    ]);
    expect(usados).toEqual(
      new Set(['siglasUnidad', 'elaboradoPor', 'numeroMemorando']),
    );
  });
});

/**
 * UNA PRUEBA POR TOKEN (D16). Cada fila dice de dónde sale el dato (`campo` de la fuente), con qué
 * `etiqueta` y `origen` se reporta, y si es estructural (obligatorio aunque la plantilla no lo use).
 */
const TOKENS_DEL_CUERPO: {
  token: string;
  campo: keyof FuenteTokens;
  etiqueta: string;
  origen: OrigenFaltante;
  estructural: boolean;
}[] = [
  {
    token: 'nombre',
    campo: 'nombre',
    etiqueta: 'Nombre',
    origen: 'persona',
    estructural: false,
  },
  // El cargo del destinatario ya no está aquí (2026-10-08): sale de su ficha y, si no lo tiene, va
  // en blanco; nunca es faltante. Lo fija su propia prueba más abajo.
  {
    token: 'dependencia',
    campo: 'dependencia',
    etiqueta: 'Dependencia del destinatario',
    origen: 'persona',
    estructural: true,
  },
  {
    token: 'numeroMemorando',
    campo: 'numeroMemorando',
    etiqueta: 'Número de memorando',
    origen: 'plantilla',
    estructural: false,
  },
  {
    token: 'fechaMemorando',
    campo: 'fechaMemorando',
    etiqueta: 'Fecha del memorando',
    origen: 'plantilla',
    estructural: false,
  },
  {
    token: 'designado',
    campo: 'designado',
    etiqueta: 'Funcionario designado',
    origen: 'plantilla',
    estructural: false,
  },
  // TABLA DE CONTROL (2026-10-08): de la plantilla y estructurales —la tabla siempre se imprime—.
  {
    token: 'elaboradoPor',
    campo: 'elaboradoPor',
    etiqueta: 'Elaborado por',
    origen: 'plantilla',
    estructural: true,
  },
  {
    token: 'direccionResponsable',
    campo: 'direccionResponsable',
    etiqueta: 'Dirección responsable',
    origen: 'plantilla',
    estructural: false,
  },
  {
    token: 'siglasUnidad',
    campo: 'siglasUnidad',
    etiqueta: 'Siglas de la unidad',
    origen: 'plantilla',
    estructural: true,
  },
  {
    token: 'firmante',
    campo: 'firmante',
    etiqueta: 'Firmante',
    origen: 'firmante',
    estructural: true,
  },
  {
    token: 'firmanteCargo',
    campo: 'firmanteCargo',
    etiqueta: 'Cargo del firmante',
    origen: 'firmante',
    estructural: true,
  },
  {
    token: 'firmanteDependencia',
    campo: 'firmanteDependencia',
    etiqueta: 'Dependencia del firmante',
    origen: 'firmante',
    estructural: true,
  },
];

describe('resolverTokens · un faltante por token, con su origen (D16)', () => {
  it.each(TOKENS_DEL_CUERPO)(
    '«$token» vacío, usado por la plantilla, falta como {etiqueta:$etiqueta, origen:$origen}',
    ({ token, campo, etiqueta, origen }) => {
      const { faltantes } = resolverTokens(
        plantillaCon(token),
        fuente({ [campo]: '' } as Partial<FuenteTokens>),
      );
      expect(faltantes).toContainEqual<Faltante>({ token, etiqueta, origen });
    },
  );

  it.each(TOKENS_DEL_CUERPO.filter((t) => t.estructural))(
    '«$token» es estructural: falta aunque la plantilla NO lo nombre',
    ({ token, campo, etiqueta, origen }) => {
      const sinPlantilla: ApartadoConTokens[] = [
        { titulo: 'APARTADO', contenido: 'Texto sin tokens.' },
      ];
      const { faltantes } = resolverTokens(
        sinPlantilla,
        fuente({ [campo]: '' } as Partial<FuenteTokens>),
      );
      expect(faltantes).toContainEqual<Faltante>({ token, etiqueta, origen });
    },
  );

  it.each(TOKENS_DEL_CUERPO.filter((t) => !t.estructural))(
    '«$token» NO estructural: con la plantilla que no lo usa, no falta aunque esté vacío (D15)',
    ({ token, campo }) => {
      const sinPlantilla: ApartadoConTokens[] = [
        { titulo: 'APARTADO', contenido: 'Texto sin tokens.' },
      ];
      const { faltantes } = resolverTokens(
        sinPlantilla,
        fuente({ [campo]: '' } as Partial<FuenteTokens>),
      );
      expect(faltantes.map((f) => f.token)).not.toContain(token);
    },
  );

  it('el cargo del firmante sale de los datos generales de la plantilla (grupo «firmante», F22)', () => {
    const { faltantes } = resolverTokens(
      PLANTILLA,
      fuente({ firmanteCargo: '' }),
    );
    expect(faltantes).toContainEqual<Faltante>({
      token: 'firmanteCargo',
      etiqueta: 'Cargo del firmante',
      origen: 'firmante',
    });
  });

  it('la dependencia del firmante sale de los datos generales de la plantilla (grupo «firmante», F22)', () => {
    const { faltantes } = resolverTokens(
      PLANTILLA,
      fuente({ firmanteDependencia: '' }),
    );
    expect(faltantes).toContainEqual<Faltante>({
      token: 'firmanteDependencia',
      etiqueta: 'Dependencia del firmante',
      origen: 'firmante',
    });
  });
});

describe('resolverTokens · faltantes', () => {
  it('con todo completo y los tokens de la plantilla presentes, no falta nada', () => {
    expect(resolverTokens(PLANTILLA, FUENTE_LLENA).faltantes).toEqual([]);
  });

  it('D14: `numeroOrden` NUNCA es faltante, aunque sea null o vacío', () => {
    const tokens = (parcial: Partial<FuenteTokens>) =>
      resolverTokens(
        plantillaCon('numeroOrden'),
        fuente(parcial),
      ).faltantes.map((f) => f.token);
    expect(tokens({ numeroOrden: null })).not.toContain('numeroOrden');
    expect(tokens({ numeroOrden: '' })).not.toContain('numeroOrden');
  });

  it('D16: `ciudadFecha` y `fechaEmision` se calculan, NUNCA faltan (ni usados ni vacíos)', () => {
    const plantilla: ApartadoConTokens[] = [
      {
        titulo: 'APARTADO',
        contenido: '{{ciudadFecha}} · {{fechaEmision}}',
      },
    ];
    const tokens = resolverTokens(
      plantilla,
      fuente({ ciudadFecha: '', fechaEmision: '' }),
    ).faltantes.map((f) => f.token);
    expect(tokens).not.toContain('ciudadFecha');
    expect(tokens).not.toContain('fechaEmision');
  });

  it('D15: un token que la plantilla NO usa y no es estructural, no cuenta como faltante', () => {
    // `designado`, `ciudadFecha`, `direccionResponsable` no están en PLANTILLA.
    const faltantes = resolverTokens(
      PLANTILLA,
      fuente({
        designado: '',
        ciudadFecha: '',
        direccionResponsable: '',
      }),
    ).faltantes;
    expect(faltantes).toEqual([]);
  });

  it('D15: un token vacío SÍ cuenta como faltante si la plantilla lo usa', () => {
    const faltantes = resolverTokens(
      PLANTILLA,
      fuente({ numeroMemorando: '' }),
    ).faltantes;
    expect(faltantes).toEqual<Faltante[]>([
      {
        token: 'numeroMemorando',
        etiqueta: 'Número de memorando',
        origen: 'plantilla',
      },
    ]);
  });

  it('el cargo del destinatario vacío NUNCA es faltante, aunque la plantilla use {{cargo}} (2026-10-08)', () => {
    const conCargo: ApartadoConTokens[] = [
      { titulo: 'PARA', contenido: 'Cargo: {{cargo}}' },
    ];
    const { valores, faltantes } = resolverTokens(
      conCargo,
      fuente({ cargo: '' }),
    );
    expect(faltantes.map((f) => f.token)).not.toContain('cargo');
    expect(valores.cargo).toBe('');
  });

  it('los estructurales (dependencia y la tabla de control) faltan aunque la plantilla no los nombre', () => {
    const sinPlantilla: ApartadoConTokens[] = [
      { titulo: 'APARTADO', contenido: 'Texto sin tokens.' },
    ];
    const faltantes = resolverTokens(
      sinPlantilla,
      fuente({
        cargo: '',
        dependencia: '',
        elaboradoPor: '',
        siglasUnidad: '',
      }),
    ).faltantes;
    expect(faltantes).toEqual<Faltante[]>([
      {
        token: 'dependencia',
        etiqueta: 'Dependencia del destinatario',
        origen: 'persona',
      },
      {
        token: 'siglasUnidad',
        etiqueta: 'Siglas de la unidad',
        origen: 'plantilla',
      },
      { token: 'elaboradoPor', etiqueta: 'Elaborado por', origen: 'plantilla' },
    ]);
  });

  it('cuenta como faltante lo vacío o en blanco, no solo lo ausente', () => {
    const faltantes = resolverTokens(
      PLANTILLA,
      fuente({ elaboradoPor: '   ', numeroMemorando: '' }),
    ).faltantes;
    expect(faltantes).toEqual<Faltante[]>([
      {
        token: 'numeroMemorando',
        etiqueta: 'Número de memorando',
        origen: 'plantilla',
      },
      { token: 'elaboradoPor', etiqueta: 'Elaborado por', origen: 'plantilla' },
    ]);
  });

  it('F22: si el firmante no tiene cargo/dependencia, ambos faltan (aunque la plantilla no los use)', () => {
    const faltantes = resolverTokens(
      PLANTILLA,
      fuente({ firmanteCargo: '', firmanteDependencia: '' }),
    ).faltantes;
    expect(faltantes).toEqual<Faltante[]>([
      {
        token: 'firmanteCargo',
        etiqueta: 'Cargo del firmante',
        origen: 'firmante',
      },
      {
        token: 'firmanteDependencia',
        etiqueta: 'Dependencia del firmante',
        origen: 'firmante',
      },
    ]);
  });

  it('recién emitida (todo vacío), lista los requeridos y el firmante, agrupables por origen', () => {
    const faltantes = resolverTokens(
      PLANTILLA,
      fuente({
        cargo: '',
        dependencia: '',
        numeroMemorando: '',
        fechaEmision: '',
        firmanteCargo: '',
        firmanteDependencia: '',
      }),
    ).faltantes;
    // `fechaEmision` NO aparece: se calcula (D16). `numeroOrden` tampoco (D14). El firmante (cargo y
    // dependencia) vive en la plantilla del Director, pero se agrupa aparte como «firmante» (2026-10-05).
    expect(faltantes).toEqual<Faltante[]>([
      {
        token: 'dependencia',
        etiqueta: 'Dependencia del destinatario',
        origen: 'persona',
      },
      {
        token: 'numeroMemorando',
        etiqueta: 'Número de memorando',
        origen: 'plantilla',
      },
      {
        token: 'firmanteCargo',
        etiqueta: 'Cargo del firmante',
        origen: 'firmante',
      },
      {
        token: 'firmanteDependencia',
        etiqueta: 'Dependencia del firmante',
        origen: 'firmante',
      },
    ]);

    // Y se pueden AGRUPAR por origen para el aviso de borrador (E21): persona / plantilla / firmante /
    // configuración. El origen «cuadro» se retiró con el NUT (2026-10-08).
    const porOrigen = (origen: OrigenFaltante) =>
      faltantes.filter((f) => f.origen === origen).map((f) => f.token);
    expect(porOrigen('persona')).toEqual(['dependencia']);
    expect(porOrigen('plantilla')).toEqual(['numeroMemorando']);
    expect(porOrigen('firmante')).toEqual([
      'firmanteCargo',
      'firmanteDependencia',
    ]);
    expect(porOrigen('configuracion')).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
   SIN NUT Y CON LA TABLA DE CONTROL EN LA PLANTILLA (2026-10-08)
   ═══════════════════════════════════════════════════════════════════════════════ */

describe('resolverTokens · tabla de control (2026-10-08)', () => {
  const SIN_TOKENS: ApartadoConTokens[] = [
    { titulo: 'APARTADO', contenido: 'Texto sin tokens.' },
  ];

  it('el NUT ya no existe: un {{nut}} en la plantilla no es faltante ni tiene valor', () => {
    const { valores, faltantes } = resolverTokens(
      plantillaCon('nut'),
      FUENTE_LLENA,
    );

    expect(faltantes).toEqual([]);
    expect(valores).not.toHaveProperty('nut');
  });

  it('sin «elaborado por» o sin siglas en la plantilla, faltan con origen «plantilla»', () => {
    const faltantes = resolverTokens(
      SIN_TOKENS,
      fuente({ elaboradoPor: '', siglasUnidad: '' }),
    ).faltantes;

    expect(faltantes).toEqual<Faltante[]>([
      {
        token: 'siglasUnidad',
        etiqueta: 'Siglas de la unidad',
        origen: 'plantilla',
      },
      { token: 'elaboradoPor', etiqueta: 'Elaborado por', origen: 'plantilla' },
    ]);
  });

  it('con una versión de plantilla ANTERIOR, solo se exigen si la plantilla los usa (como entonces)', () => {
    const legada = fuente({
      elaboradoPor: '',
      siglasUnidad: '',
      tablaControlLegada: true,
    });

    expect(resolverTokens(SIN_TOKENS, legada).faltantes).toEqual([]);
    expect(
      resolverTokens(plantillaCon('elaboradoPor'), legada).faltantes.map(
        (f) => f.token,
      ),
    ).toEqual(['elaboradoPor']);
  });
});

describe('resolverTokens · valores', () => {
  it('devuelve el valor de cada token, con `numeroOrden` nulo mientras es Borrador', () => {
    const { valores } = resolverTokens(PLANTILLA, FUENTE_LLENA);
    expect(valores.numeroMemorando).toBe('MEM-001');
    expect(valores.nombre).toBe('PÉREZ JUAN');
    expect(valores.numeroOrden).toBeNull();
  });
});

describe('resolverTokens · trámite de Inspección (2026-10-07)', () => {
  const USA_TRAMITE: ApartadoConTokens[] = [
    {
      titulo: 'Trámite',
      contenido:
        'Atender {{tramiteCodigo}} ({{tramiteSitra}}), {{tramiteMateria}}.',
    },
  ];

  it('con trámite, sus tokens toman el valor de la copia guardada', () => {
    const { valores } = resolverTokens(USA_TRAMITE, {
      ...FUENTE_LLENA,
      tramiteCodigo: 'DENUNCIA-26-3415',
      tramiteSitra: 'AMC-ECU9500',
      tramiteMateria: 'Espacio público',
    });

    expect(valores.tramiteCodigo).toBe('DENUNCIA-26-3415');
    expect(valores.tramiteSitra).toBe('AMC-ECU9500');
    expect(valores.tramiteMateria).toBe('Espacio público');
  });

  it('sin trámite, la plantilla que lo usa NO deja la orden en borrador', () => {
    const { valores, faltantes } = resolverTokens(USA_TRAMITE, FUENTE_LLENA);

    expect(valores.tramiteCodigo).toBe('');
    expect(faltantes.map((faltante) => faltante.token)).not.toContain(
      'tramiteCodigo',
    );
  });
});
