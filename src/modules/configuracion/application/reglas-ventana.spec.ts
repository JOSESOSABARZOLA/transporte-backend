/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Ventanas de carga
 * Archivo: reglas-ventana.spec.ts
 * Responsabilidad: Verificar qué se rechaza, qué se advierte y qué se deja pasar.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 */

import {
  RolDepartamental,
  TipoVentana,
  type VentanaCarga,
} from '@prisma/client';

import {
  advertenciasDe,
  motivoDeRechazo,
  type VentanaPropuesta,
} from './reglas-ventana';

const propuesta = (
  parcial: Partial<VentanaPropuesta> = {},
): VentanaPropuesta => ({
  rol: RolDepartamental.DMIP_OPERATIVOS,
  tipo: TipoVentana.DIARIO,
  diaApertura: null,
  horaApertura: null,
  diaCierre: null,
  horaCierre: '15:00',
  mensajeCierre: 'La ventana cerró a las 15H00. Vuelve a abrirse mañana.',
  activo: true,
  ...parcial,
});

const guardada = (parcial: Partial<VentanaCarga>): VentanaCarga =>
  ({
    id: 1,
    rol: RolDepartamental.DMIP_OPERATIVOS,
    tipo: TipoVentana.DIARIO,
    diaApertura: null,
    horaApertura: null,
    diaCierre: null,
    horaCierre: '15:00',
    zonaHoraria: 'America/Guayaquil',
    mensajeCierre: 'x',
    activo: true,
    ...parcial,
  }) as VentanaCarga;

describe('motivoDeRechazo', () => {
  it('admite la ventana departamental sembrada', () => {
    expect(motivoDeRechazo(propuesta())).toBeUndefined();
  });

  it('admite la ventana de la DAF, con apertura y cierre', () => {
    expect(
      motivoDeRechazo(
        propuesta({
          rol: RolDepartamental.DAF,
          horaApertura: '15:00',
          horaCierre: '16:30',
        }),
      ),
    ).toBeUndefined();
  });

  describe('forma de las horas y los días', () => {
    it('rechaza una hora mal escrita, diciendo cuál', () => {
      const motivo = motivoDeRechazo(propuesta({ horaCierre: '15h00' }));
      expect(motivo).toContain('cierre');
      expect(motivo).toContain('HH:MM');
    });

    it('rechaza una hora fuera del reloj de 24 horas', () => {
      expect(motivoDeRechazo(propuesta({ horaApertura: '25:00' }))).toContain(
        'HH:MM',
      );
    });

    it('rechaza un día fuera de 1 a 7', () => {
      expect(
        motivoDeRechazo(
          propuesta({
            tipo: TipoVentana.SEMANAL,
            diaApertura: 0,
            diaCierre: 2,
            horaApertura: '00:00',
          }),
        ),
      ).toContain('1 a 7');
    });

    it('admite la ventana semanal completa de la planificación zonal', () => {
      expect(
        motivoDeRechazo(
          propuesta({
            tipo: TipoVentana.SEMANAL,
            diaApertura: 5,
            horaApertura: '00:00',
            diaCierre: 2,
            horaCierre: '10:00',
          }),
        ),
      ).toBeUndefined();
    });
  });

  describe('coherencia de la propia ventana', () => {
    it('rechaza una semanal sin días: el evaluador la trataría como diaria', () => {
      expect(
        motivoDeRechazo(propuesta({ tipo: TipoVentana.SEMANAL })),
      ).toContain('DIARIO');
    });

    it('rechaza una ventana activa sin apertura ni cierre', () => {
      expect(
        motivoDeRechazo(propuesta({ horaApertura: null, horaCierre: null })),
      ).toContain('desactívela');
    });

    it('admite la ventana desactivada sin horas: es el caso de Dirección', () => {
      expect(
        motivoDeRechazo(
          propuesta({
            rol: RolDepartamental.DIRECTOR,
            horaApertura: null,
            horaCierre: null,
            activo: false,
          }),
        ),
      ).toBeUndefined();
    });

    it('exige el mensaje que verá el funcionario', () => {
      expect(motivoDeRechazo(propuesta({ mensajeCierre: '   ' }))).toContain(
        'mensaje',
      );
    });
  });
});

describe('advertenciasDe', () => {
  const departamentales = [
    guardada({ rol: RolDepartamental.DMIP_OPERATIVOS, horaCierre: '15:00' }),
    guardada({
      id: 2,
      rol: RolDepartamental.DMIP_INSPECCIONES,
      horaCierre: '15:00',
    }),
  ];

  it('no advierte nada cuando todo encaja', () => {
    const advertencias = advertenciasDe(
      propuesta({
        rol: RolDepartamental.DAF,
        horaApertura: '15:00',
        horaCierre: '16:30',
      }),
      {
        otras: departamentales,
        limiteCuadro: '16:30',
      },
    );
    expect(advertencias).toEqual([]);
  });

  it('RN-56 · avisa si Transportes abre antes de que cierre la departamental', () => {
    const advertencias = advertenciasDe(
      propuesta({
        rol: RolDepartamental.DAF,
        horaApertura: '14:00',
        horaCierre: '16:30',
      }),
      { otras: departamentales, limiteCuadro: '16:30' },
    );

    expect(advertencias).toHaveLength(1);
    expect(advertencias[0]).toContain('RN-56');
    expect(advertencias[0]).toContain('14H00');
    expect(advertencias[0]).toContain('15H00');
  });

  it('RN-57 · avisa si Transportes cierra después de la hora límite del cuadro', () => {
    const advertencias = advertenciasDe(
      propuesta({
        rol: RolDepartamental.DAF,
        horaApertura: '15:00',
        horaCierre: '18:00',
      }),
      { otras: departamentales, limiteCuadro: '16:30' },
    );

    expect(advertencias[0]).toContain('RN-57');
    expect(advertencias[0]).toContain('16H30');
  });

  /**
   * AQUÍ SE COMPARABA LA VENTANA CON `HORA_CIERRE_DEPARTAMENTAL`, Y ESE PARÁMETRO SE
   * RETIRÓ EL 2026-08-25.
   *
   * El dato estaba dos veces —en la fila de la ventana y en el parámetro de política— y
   * solo una de las dos gobernaba: `VentanaCargaGuard` lee `t_ventana_carga` y ninguna
   * otra cosa. Quien movía la hora tenía que acordarse de moverla también en los
   * parámetros, y el sistema solo podía pedírselo por favor.
   *
   * Esta prueba fija que ya no se lo pide, y **caería si alguien reintrodujera** una
   * segunda fuente para la hora de cierre: mover el cierre de un departamento no
   * contradice nada, porque no hay nada con qué contradecirlo.
   */
  it('la hora de cierre departamental no se contrasta con ningún parámetro', () => {
    const advertencias = advertenciasDe(propuesta({ horaCierre: '14:00' }), {
      otras: [],
      limiteCuadro: '16:30',
    });

    expect(advertencias).toEqual([]);
  });

  it('desactivar una ventana se advierte siempre: deja el rol sin horario', () => {
    const advertencias = advertenciasDe(propuesta({ activo: false }), {
      otras: departamentales,
    });

    expect(advertencias).toHaveLength(1);
    expect(advertencias[0]).toContain('cualquier hora');
  });

  it('sin los parámetros configurados, advierte lo que puede y no falla', () => {
    expect(
      advertenciasDe(
        propuesta({ rol: RolDepartamental.DAF, horaApertura: '15:00' }),
        { otras: departamentales },
      ),
    ).toEqual([]);
  });

  it('ignora las ventanas departamentales desactivadas al comparar', () => {
    const advertencias = advertenciasDe(
      propuesta({ rol: RolDepartamental.DAF, horaApertura: '14:00' }),
      {
        otras: [guardada({ horaCierre: '15:00', activo: false })],
      },
    );
    expect(advertencias).toEqual([]);
  });
});
