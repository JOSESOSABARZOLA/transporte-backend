/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Operativos
 * Archivo: operativos.integracion-spec.ts
 * Responsabilidad: Verificar los trece casos del plan contra la base real.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * EXIGE LA BASE LEVANTADA. Se ejecuta con `npm run test:integracion`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SOBRE LAS VENTANAS DE CARGA. `VentanaCargaGuard` protege las tres escrituras de este
 * controlador, así que la suite **desactiva las ventanas mientras corre** y las restituye
 * al terminar: una ventana inactiva significa «sin restricción horaria» y deja escribir a
 * cualquier hora. Sin esto, la prueba pasaría por la mañana y fallaría a las 15H01.
 *
 * Es el mismo criterio de M-08 y M-13: el momento se controla, no se espera.
 *
 * SOBRE LOS DATOS. Los catálogos institucionales no están sembrados —PV-01, PV-03,
 * PV-25, PV-26— así que la suite crea los suyos con el prefijo `PRUEBA_M14` y los borra
 * al terminar. Ninguno es un dato aprobado y ninguno queda en la base.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AccesoFormulario,
  AreaPersonal,
  EstadoCuadro,
  EstadoTransporte,
  PoliticaVehiculo,
  RolDepartamental,
  TipoContrato,
  type VentanaCarga,
} from '@prisma/client';
import type { Server } from 'node:http';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { correlacionMiddleware } from '../src/common/interceptors/correlacion.middleware';
import { LoggerService } from '../src/common/logger/logger.service';
import { OperativosRepository } from '../src/modules/operativos/infrastructure/operativos.repository';
import { PrismaService } from '../src/prisma/prisma.service';
import { como } from './identidad-de-prueba';

const PREFIJO = 'PRUEBA_M14';
const API = '/api/v1';

const INSPECCIONES = '2';
const OPERATIVOS = '1';
const INSTRUCTOR = '3';
const DIRECTOR = '5';
const DAF = '4';

const FECHA = '2026-09-15';
const OTRA_FECHA = '2026-09-16';

interface OperativoRespuesta {
  id: number;
  identificador: string;
  secuencial: number;
  cuadroFecha: string;
  estadoTransporte: string;
  esNocturno: boolean;
  cruzaMedianoche: boolean;
  duracionHoras: number;
  alertaActiva: boolean;
  version: number;
  zonales: { id: number }[];
  instituciones: { id: number }[];
  puntoEncuentro: { id: number } | null;
  puntoLibre: string | null;
  tipoControl: { id: number } | null;
  tipoLibre: string | null;
  formulario: { codigo: string; colorFondo: string };
  observaciones: { texto: string; creadoPorRol: string; creadoEn: string }[];
}

describe('Operativos · integración', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repositorio: OperativosRepository;
  let ventanasIniciales: VentanaCarga[] = [];

  /** Catálogos de la prueba. */
  let formularioInspecciones = 0;
  let formularioOperativos = 0;
  let zonalA = 0;
  let zonalB = 0;
  let puntoDeA = 0;
  let puntoDeB = 0;
  let tipoControl = 0;
  // Los tipos pertenecen a UN formulario (2026-09-07): el de Operativos necesita el suyo,
  // distinto del de Inspecciones, aunque compartan nombre.
  let tipoControlOperativos = 0;
  let institucion = 0;
  let cuadroId = 0;
  // Formulario cuyo prefijo del identificador sale del ÁREA del personal, como el 8 real
  // (2026-09-08): GENERAL -> IG (adicional IGA); TECNICO -> IT (adicional ITA).
  let formularioPorArea = 0;
  let tipoControlPorArea = 0;
  let inspectorGeneralA = 0;
  let inspectorGeneralB = 0;
  let inspectorTecnicoA = 0;
  let inspectorTecnicoB = 0;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = modulo.createNestApplication({ bufferLogs: true });
    app.use(correlacionMiddleware);
    // La identidad viaja en la cookie de sesion: sin esto `request.cookies` es indefinido
    // y toda peticion recibe 401. Lo registra tambien `main.ts`.
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter(app.get(LoggerService)));
    await app.init();

    prisma = app.get(PrismaService);
    repositorio = app.get(OperativosRepository);

    await limpiar();

    ventanasIniciales = await prisma.ventanaCarga.findMany();
    await prisma.ventanaCarga.updateMany({ data: { activo: false } });

    // `ck_formulario_numero` acota el número al rango 1 a 9 y `uq_formulario_numero` lo
    // hace único: la prueba solo puede crear los suyos si la tabla está vacía. Lo está
    // por PV-25 y PV-26. Si deja de estarlo, esto lo dice con claridad.
    const institucionales = await prisma.formulario.count({
      where: { codigo: { not: { startsWith: PREFIJO } } },
    });
    if (institucionales > 0) {
      throw new Error(
        't_formulario ya tiene formularios institucionales. Esta prueba crea los suyos con los números 3 y 4 y chocaría con ellos: revise la estrategia de datos de prueba antes de continuar.',
      );
    }

    formularioInspecciones = await crearFormulario(
      3,
      'INSP',
      RolDepartamental.DMIP_INSPECCIONES,
      RolDepartamental.DMIT_INSTRUCTOR,
      true,
    );
    formularioOperativos = await crearFormulario(
      4,
      'PMO',
      RolDepartamental.DMIP_OPERATIVOS,
      null,
      false,
    );

    const zonales = await prisma.zonal.findMany({ orderBy: { orden: 'asc' } });
    zonalA = zonales[0].id;
    zonalB = zonales[1].id;

    puntoDeA = await crearPunto('PUNTO A', zonalA);
    puntoDeB = await crearPunto('PUNTO B', zonalB);

    // Cada tipo de control pertenece a UN formulario. Se crea uno por formulario —pueden
    // compartir nombre, porque el único es (formulario, nombre)—.
    const tipoInsp = await prisma.tipoControl.create({
      data: {
        nombre: `${PREFIJO} CONTROL DE VENTAS`,
        formularioId: formularioInspecciones,
      },
    });
    tipoControl = tipoInsp.id;
    const tipoOper = await prisma.tipoControl.create({
      data: {
        nombre: `${PREFIJO} CONTROL DE VENTAS`,
        formularioId: formularioOperativos,
      },
    });
    tipoControlOperativos = tipoOper.id;

    const entidad = await prisma.institucion.create({
      data: { sigla: `${PREFIJO}AMT`, nombre: 'Agencia de Tránsito de prueba' },
    });
    institucion = entidad.id;

    // La institución sigue siendo N:M: se delimita a los DOS formularios; los puntos también.
    for (const formularioId of [formularioInspecciones, formularioOperativos]) {
      await prisma.formularioInstitucion.create({
        data: { formularioId, institucionId: institucion },
      });
      await prisma.formularioPunto.createMany({
        data: [
          { formularioId, puntoId: puntoDeA },
          { formularioId, puntoId: puntoDeB },
        ],
      });
    }

    // ── Formulario cuyo prefijo del identificador lo decide el ÁREA del personal (form 8
    //    real): GENERAL -> IG / IGA (adicional); TECNICO -> IT / ITA. Ninguno predeterminado.
    const porArea = await prisma.formulario.create({
      data: {
        numero: 5,
        codigo: `${PREFIJO}_IAREA`,
        nombre: 'FORMULARIO POR ÁREA',
        colorFondo: '#EEEEEE',
        colorAcento: '#000000',
        colorNombre: 'gris',
        rolDueno: RolDepartamental.DMIP_INSPECCIONES,
        politicaVehiculo: PoliticaVehiculo.CONDICIONAL,
        capturaLibrePunto: false,
        capturaLibreTipo: false,
        orden: 5,
        roles: {
          create: [
            {
              rol: RolDepartamental.DMIP_INSPECCIONES,
              acceso: AccesoFormulario.ESCRITURA,
            },
          ],
        },
        areas: {
          create: [
            { area: AreaPersonal.GENERAL, esCompartida: false },
            { area: AreaPersonal.TECNICO, esCompartida: false },
          ],
        },
        prefijos: {
          create: [
            {
              prefijo: 'IG',
              areaAplica: AreaPersonal.GENERAL,
              esAdicional: false,
            },
            {
              prefijo: 'IT',
              areaAplica: AreaPersonal.TECNICO,
              esAdicional: false,
            },
            {
              prefijo: 'IGA',
              areaAplica: AreaPersonal.GENERAL,
              esAdicional: true,
            },
            {
              prefijo: 'ITA',
              areaAplica: AreaPersonal.TECNICO,
              esAdicional: true,
            },
          ],
        },
      },
    });
    formularioPorArea = porArea.id;

    const tipoArea = await prisma.tipoControl.create({
      data: {
        nombre: `${PREFIJO} CONTROL POR AREA`,
        formularioId: formularioPorArea,
      },
    });
    tipoControlPorArea = tipoArea.id;
    await prisma.formularioInstitucion.create({
      data: { formularioId: formularioPorArea, institucionId: institucion },
    });
    await prisma.formularioPunto.create({
      data: { formularioId: formularioPorArea, puntoId: puntoDeA },
    });

    // Dos Inspectores Generales y dos Técnicos, de Inspecciones, para no chocar con el
    // descanso al reutilizar personas entre pruebas.
    const inspectores = await Promise.all(
      [
        { sufijo: 'GENERAL_A', area: AreaPersonal.GENERAL },
        { sufijo: 'GENERAL_B', area: AreaPersonal.GENERAL },
        { sufijo: 'TECNICO_A', area: AreaPersonal.TECNICO },
        { sufijo: 'TECNICO_B', area: AreaPersonal.TECNICO },
      ].map((persona, indice) =>
        prisma.funcionario.create({
          data: {
            cedula: `99${String(indice).padStart(8, '0')}`,
            apellidos: `${PREFIJO}_${persona.sufijo}`,
            nombres: 'INSPECTOR',
            area: persona.area,
            tipoContrato: TipoContrato.NOMBRAMIENTO,
            direccion: RolDepartamental.DMIP_INSPECCIONES,
          },
        }),
      ),
    );
    inspectorGeneralA = inspectores[0].id;
    inspectorGeneralB = inspectores[1].id;
    inspectorTecnicoA = inspectores[2].id;
    inspectorTecnicoB = inspectores[3].id;

    const cuadro = await prisma.cuadroDiario.create({
      data: {
        fecha: comoFecha(FECHA),
        ordenTrabajo: `${PREFIJO}-OT-001`,
        nroSemana: 38,
        anioSemana: 2026,
      },
    });
    cuadroId = cuadro.id;

    await prisma.cuadroDiario.create({
      data: {
        fecha: comoFecha(OTRA_FECHA),
        ordenTrabajo: `${PREFIJO}-OT-002`,
        nroSemana: 38,
        anioSemana: 2026,
      },
    });
  });

  /**
   * LA RESTAURACIÓN VA EN `finally`, Y NO ES UN DETALLE DE ESTILO.
   *
   * Estaba después de `limpiar()` sin protección: el día que `limpiar()` falló —por una
   * orden de servicio con `RESTRICT`— las ventanas quedaron desactivadas en
   * `transportedb_pruebas`, y **la suite de ventanas empezó a fallar sin haber cambiado**.
   * Una suite que puede dejar la base peor de como la encontró contamina a las demás.
   */
  afterAll(async () => {
    try {
      await limpiar();
    } finally {
      for (const original of ventanasIniciales) {
        await prisma.ventanaCarga.update({
          where: { rol: original.rol },
          data: { activo: original.activo },
        });
      }
      await app.close();
    }
  });

  const limpiar = async (): Promise<void> => {
    // Antes que nada las órdenes: `fk_orden_operativo` es `RESTRICT`, y sin esto el
    // borrado en cascada del cuadro se detiene y la suite queda inservible para la
    // siguiente ejecución. Lo descubrió la prueba de la baja con orden emitida.
    await prisma.ordenServicio.deleteMany({
      where: { codigo: { startsWith: 'ORD-BAJA-' } },
    });
    await prisma.funcionario.deleteMany({
      where: { apellidos: 'PRUEBA BAJA' },
    });
    await prisma.cuadroDiario.deleteMany({
      where: { ordenTrabajo: { startsWith: PREFIJO } },
    });
    await prisma.formulario.deleteMany({
      where: { codigo: { startsWith: PREFIJO } },
    });
    await prisma.puntoEncuentro.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.tipoControl.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.institucion.deleteMany({
      where: { sigla: { startsWith: PREFIJO } },
    });
    // Los inspectores del formulario por área. Van al final: sus asignaciones ya se fueron
    // con los operativos al borrar el cuadro (cascada), así que ninguna los retiene.
    await prisma.funcionario.deleteMany({
      where: { apellidos: { startsWith: `${PREFIJO}_` } },
    });
  };

  const crearFormulario = async (
    numero: number,
    sufijo: string,
    rolDueno: RolDepartamental,
    rolCompartido: RolDepartamental | null,
    capturaLibreTipo: boolean,
    tipoControlMultiple = false,
  ): Promise<number> => {
    const formulario = await prisma.formulario.create({
      data: {
        numero,
        codigo: `${PREFIJO}_${sufijo}`,
        nombre: `FORMULARIO DE PRUEBA ${sufijo}`,
        colorFondo: '#EEEEEE',
        colorAcento: '#000000',
        colorNombre: 'gris',
        rolDueno,
        politicaVehiculo: PoliticaVehiculo.CONDICIONAL,
        // RN-20, separada por catálogo el 2026-08-11. Solo el tipo de control ofrece
        // ADICIONALES; el punto no lo hace en ninguno de los nueve del insumo.
        capturaLibrePunto: false,
        capturaLibreTipo,
        // Varios tipos de control a la vez, como el formulario 8 real (2026-09-07).
        tipoControlMultiple,
        orden: numero,
        // La autorización vive en t_formulario_rol (desde el 2026-08-25): el dueño registra
        // (ESCRITURA) y el invitado, si lo hay, solo aporta personal (APORTA, con cupo).
        roles: {
          create: [
            { rol: rolDueno, acceso: AccesoFormulario.ESCRITURA },
            ...(rolCompartido
              ? [
                  {
                    rol: rolCompartido,
                    acceso: AccesoFormulario.APORTA,
                    cupo: 1,
                  },
                ]
              : []),
          ],
        },
        // Un solo prefijo: la elección entre varios es PV-27 y se prueba aparte.
        prefijos: {
          create: [{ prefijo: sufijo, esPredeterminado: true }],
        },
      },
    });

    return formulario.id;
  };

  const crearPunto = async (
    nombre: string,
    zonalId: number,
  ): Promise<number> => {
    const punto = await prisma.puntoEncuentro.create({
      data: { nombre: `${PREFIJO} ${nombre}`, zonalId },
    });
    return punto.id;
  };

  const servidor = (): Server => app.getHttpServer() as Server;

  /** Registro válido de Inspecciones. Cada prueba ajusta lo que necesita. */
  const registroValido = (cambios: Record<string, unknown> = {}) => ({
    cuadroFecha: FECHA,
    formularioCodigo: `${PREFIJO}_INSP`,
    horaInicio: '08:00',
    horaFin: '12:00',
    zonalesIds: [zonalA],
    puntoEncuentroId: puntoDeA,
    tipoControlId: tipoControl,
    institucionesIds: [institucion],
    ...cambios,
  });

  const registrar = (usuario: string, cuerpo: Record<string, unknown>) =>
    request(servidor())
      .post(`${API}/operativos`)
      .set(como(usuario))
      .send(cuerpo);

  describe('horario por persona (turno propio dentro del operativo)', () => {
    // Fecha propia para no cruzarse con FECHA ni OTRA_FECHA de los demas casos, y el
    // formulario con areas configuradas (IAREA), que es el que admite asignar personal.
    // Todo el personal del mismo area (GENERAL) para no caer en la regla de mezcla.
    const FECHA_TURNOS = '2026-10-05';
    // RN-66: fecha aparte para registrar SIN horario de operativo (lo deriva de las personas).
    const FECHA_ENVOLVENTE = '2026-10-06';
    // RN-66 (2026-09-09): fecha aparte para editar el turno de una persona ya asignada.
    const FECHA_EDITA = '2026-10-08';

    beforeAll(async () => {
      // Cuadro propio con `ordenTrabajo` PREFIJO para que `limpiar` lo borre en cascada
      // (y con el sus operativos); sin el, el cuadro autoabierto quedaria y romperia el
      // borrado del formulario por RESTRICT.
      await prisma.cuadroDiario.createMany({
        data: [
          {
            fecha: comoFecha(FECHA_TURNOS),
            ordenTrabajo: `${PREFIJO}-OT-TURNOS`,
            nroSemana: 41,
            anioSemana: 2026,
          },
          {
            fecha: comoFecha(FECHA_ENVOLVENTE),
            ordenTrabajo: `${PREFIJO}-OT-ENVOLV`,
            nroSemana: 41,
            anioSemana: 2026,
          },
          {
            fecha: comoFecha(FECHA_EDITA),
            ordenTrabajo: `${PREFIJO}-OT-EDITA`,
            nroSemana: 41,
            anioSemana: 2026,
          },
        ],
      });
    });

    const registroTurnos = (personal: unknown[]) => ({
      cuadroFecha: FECHA_TURNOS,
      formularioCodigo: `${PREFIJO}_IAREA`,
      horaInicio: '08:00',
      horaFin: '18:00',
      zonalesIds: [zonalA],
      puntoEncuentroId: puntoDeA,
      tipoControlId: tipoControlPorArea,
      institucionesIds: [institucion],
      personal,
    });

    it('acepta turnos propios dentro del horario del operativo y devuelve la ventana efectiva', async () => {
      const respuesta = await registrar(
        INSPECCIONES,
        registroTurnos([
          {
            funcionarioId: inspectorGeneralA,
            horaInicio: '09:00',
            horaFin: '11:00',
          },
          // Sin turno propio: hereda el horario del operativo.
          { funcionarioId: inspectorGeneralB },
        ]),
      ).expect(201);

      const personal = (
        respuesta.body as {
          personal: {
            funcionarioId: number;
            horaInicio: string;
            horaFin: string;
          }[];
        }
      ).personal;
      expect(
        personal.find((p) => p.funcionarioId === inspectorGeneralA),
      ).toMatchObject({ horaInicio: '09:00', horaFin: '11:00' });
      expect(
        personal.find((p) => p.funcionarioId === inspectorGeneralB),
      ).toMatchObject({ horaInicio: '08:00', horaFin: '18:00' });
    });

    it('rechaza un turno que se sale del horario del operativo', async () => {
      const respuesta = await registrar(
        INSPECCIONES,
        registroTurnos([
          {
            funcionarioId: inspectorGeneralA,
            horaInicio: '07:00',
            horaFin: '11:00',
          },
        ]),
      );
      expect(respuesta.status).toBeGreaterThanOrEqual(400);
    });

    it('RN-66 · SIN horario de operativo, lo deriva de las personas (envolvente)', async () => {
      // Dos turnos encadenados 06:00–14:00 y 14:00–18:00: la envolvente es 06:00–18:00.
      const respuesta = await registrar(INSPECCIONES, {
        cuadroFecha: FECHA_ENVOLVENTE,
        formularioCodigo: `${PREFIJO}_IAREA`,
        // Sin horaInicio/horaFin del operativo: los toma de las personas.
        zonalesIds: [zonalA],
        puntoEncuentroId: puntoDeA,
        tipoControlId: tipoControlPorArea,
        institucionesIds: [institucion],
        personal: [
          {
            funcionarioId: inspectorGeneralA,
            horaInicio: '06:00',
            horaFin: '14:00',
          },
          {
            funcionarioId: inspectorGeneralB,
            horaInicio: '14:00',
            horaFin: '18:00',
          },
        ],
      }).expect(201);

      const cuerpo = respuesta.body as {
        horaInicio: string;
        horaFin: string;
        esNocturno: boolean;
      };
      expect(cuerpo.horaInicio).toBe('06:00');
      expect(cuerpo.horaFin).toBe('18:00');
      expect(cuerpo.esNocturno).toBe(false);
    });

    it('RN-66 · SIN horario de operativo, exige el horario de cada persona', async () => {
      const respuesta = await registrar(INSPECCIONES, {
        cuadroFecha: FECHA_ENVOLVENTE,
        formularioCodigo: `${PREFIJO}_IAREA`,
        zonalesIds: [zonalA],
        puntoEncuentroId: puntoDeA,
        tipoControlId: tipoControlPorArea,
        institucionesIds: [institucion],
        // Una persona sin su ventana y sin horario de operativo: no hay hora de la que partir.
        personal: [{ funcionarioId: inspectorTecnicoA }],
      });
      expect(respuesta.status).toBeGreaterThanOrEqual(400);
    });

    it('RN-66 (2026-09-09) · editar el turno de una persona re-deriva la ventana del operativo', async () => {
      // Se registra SIN horario de operativo: la ventana la dan las personas (envolvente
      // 06:00–14:00). Luego se edita el turno de una persona y la ventana debe seguirla.
      const creado = await registrar(INSPECCIONES, {
        cuadroFecha: FECHA_EDITA,
        formularioCodigo: `${PREFIJO}_IAREA`,
        zonalesIds: [zonalA],
        puntoEncuentroId: puntoDeA,
        tipoControlId: tipoControlPorArea,
        institucionesIds: [institucion],
        personal: [
          {
            funcionarioId: inspectorGeneralA,
            horaInicio: '08:00',
            horaFin: '12:00',
          },
          {
            funcionarioId: inspectorGeneralB,
            horaInicio: '10:00',
            horaFin: '14:00',
          },
        ],
      }).expect(201);

      const cuerpoCreado = creado.body as {
        id: number;
        horaInicio: string;
        horaFin: string;
      };
      // Envolvente inicial 08:00–14:00.
      expect(cuerpoCreado.horaInicio).toBe('08:00');
      expect(cuerpoCreado.horaFin).toBe('14:00');

      // Se adelanta el inicio de la primera persona a 06:00: la envolvente pasa a 06:00–14:00.
      const editado = await request(servidor())
        .patch(
          `${API}/operativos/${cuerpoCreado.id}/personal/${inspectorGeneralA}`,
        )
        .set(como(INSPECCIONES))
        .send({ horaInicio: '06:00', horaFin: '12:00' })
        .expect(200);

      const cuerpoEditado = editado.body as {
        horaInicio: string;
        horaFin: string;
        personal: {
          funcionarioId: number;
          horaInicio: string;
          horaFin: string;
        }[];
      };
      // La persona editada lleva su nuevo turno…
      expect(
        cuerpoEditado.personal.find(
          (p) => p.funcionarioId === inspectorGeneralA,
        ),
      ).toMatchObject({ horaInicio: '06:00', horaFin: '12:00' });
      // …y la ventana del operativo se re-derivó (envolvente 06:00–14:00).
      expect(cuerpoEditado.horaInicio).toBe('06:00');
      expect(cuerpoEditado.horaFin).toBe('14:00');
    });

    it('editar el turno exige las dos horas (media ventana se rechaza)', async () => {
      // Un operativo TECNICO propio, sin cruce con los de arriba (otra área, otra persona).
      const creado = await registrar(INSPECCIONES, {
        cuadroFecha: FECHA_EDITA,
        formularioCodigo: `${PREFIJO}_IAREA`,
        zonalesIds: [zonalA],
        puntoEncuentroId: puntoDeA,
        tipoControlId: tipoControlPorArea,
        institucionesIds: [institucion],
        personal: [
          {
            funcionarioId: inspectorTecnicoA,
            horaInicio: '08:00',
            horaFin: '12:00',
          },
        ],
      }).expect(201);

      const { id } = creado.body as { id: number };
      const respuesta = await request(servidor())
        .patch(`${API}/operativos/${id}/personal/${inspectorTecnicoA}`)
        .set(como(INSPECCIONES))
        .send({ horaInicio: '06:00' });
      // Falta `horaFin`: lo rechaza la validación del DTO.
      expect(respuesta.status).toBe(400);
    });
  });

  describe('prefijo por área (formulario 8)', () => {
    // En OTRA_FECHA para no aparecer en las consultas por `FECHA` de más abajo (este
    // formulario es de INSPECCIONES y ensuciaría el «solo sus filas» del caso 12).
    const registroPorArea = (cambios: Record<string, unknown> = {}) => ({
      cuadroFecha: OTRA_FECHA,
      formularioCodigo: `${PREFIJO}_IAREA`,
      horaInicio: '08:00',
      horaFin: '09:00',
      zonalesIds: [zonalA],
      puntoEncuentroId: puntoDeA,
      tipoControlId: tipoControlPorArea,
      institucionesIds: [institucion],
      ...cambios,
    });

    const adicionalDe = (id: number, personalIds: number[], hora: string) =>
      request(servidor())
        .post(`${API}/operativos/${id}/adicional`)
        .set(como(INSPECCIONES))
        .send({
          horaInicio: hora,
          horaFin: `${(Number(hora.slice(0, 2)) + 1).toString().padStart(2, '0')}:00`,
          zonalesIds: [zonalA],
          puntoEncuentroId: puntoDeA,
          tipoControlId: tipoControlPorArea,
          institucionesIds: [institucion],
          personalIds,
        });

    it('personal de área GENERAL genera el identificador con prefijo IG', async () => {
      const respuesta = await registrar(
        INSPECCIONES,
        registroPorArea({ personalIds: [inspectorGeneralA] }),
      ).expect(201);
      expect((respuesta.body as OperativoRespuesta).identificador).toMatch(
        /^IG-/,
      );
    });

    it('personal de área TECNICO genera el identificador con prefijo IT', async () => {
      const respuesta = await registrar(
        INSPECCIONES,
        registroPorArea({
          personalIds: [inspectorTecnicoA],
          horaInicio: '09:00',
          horaFin: '10:00',
        }),
      ).expect(201);
      expect((respuesta.body as OperativoRespuesta).identificador).toMatch(
        /^IT-/,
      );
    });

    it('mezclar áreas (General y Técnico) se rechaza en lugar de adivinar el prefijo', async () => {
      const respuesta = await registrar(
        INSPECCIONES,
        registroPorArea({
          personalIds: [inspectorGeneralB, inspectorTecnicoB],
          horaInicio: '10:00',
          horaFin: '11:00',
        }),
      ).expect(400);
      expect(JSON.stringify(respuesta.body)).toContain('área');
    });

    it('el adicional toma el prefijo de su área: IGA para General, ITA para Técnico', async () => {
      const general = await registrar(
        INSPECCIONES,
        registroPorArea({
          personalIds: [inspectorGeneralA],
          horaInicio: '11:00',
          horaFin: '12:00',
        }),
      ).expect(201);
      const adicionalG = await adicionalDe(
        (general.body as OperativoRespuesta).id,
        [inspectorGeneralB],
        '12:00',
      ).expect(201);
      expect((adicionalG.body as OperativoRespuesta).identificador).toMatch(
        /^IGA-/,
      );

      const tecnico = await registrar(
        INSPECCIONES,
        registroPorArea({
          personalIds: [inspectorTecnicoA],
          horaInicio: '13:00',
          horaFin: '14:00',
        }),
      ).expect(201);
      const adicionalT = await adicionalDe(
        (tecnico.body as OperativoRespuesta).id,
        [inspectorTecnicoB],
        '14:00',
      ).expect(201);
      expect((adicionalT.body as OperativoRespuesta).identificador).toMatch(
        /^ITA-/,
      );
    });
  });

  describe('registro', () => {
    it('caso 1 · registra en el formulario propio con identificador generado', async () => {
      const respuesta = await registrar(INSPECCIONES, registroValido()).expect(
        201,
      );

      const operativo = respuesta.body as OperativoRespuesta;
      expect(operativo.identificador).toBe('INSP-001-15-SEP-2026');
      expect(operativo.secuencial).toBe(1);
      expect(operativo.cuadroFecha).toBe(FECHA);
      expect(operativo.duracionHoras).toBe(4);
    });

    it('caso 6 · nace PENDIENTE, sin conductor ni vehículo y con alerta activa', async () => {
      const respuesta = await registrar(
        INSPECCIONES,
        registroValido({ horaInicio: '13:00', horaFin: '17:00' }),
      ).expect(201);

      const operativo = respuesta.body as OperativoRespuesta;
      expect(operativo.estadoTransporte).toBe(EstadoTransporte.PENDIENTE);
      expect(operativo.alertaActiva).toBe(true);

      const guardado = await prisma.operativo.findUnique({
        where: { id: operativo.id },
      });
      expect(guardado?.conductorId).toBeNull();
      expect(guardado?.vehiculoId).toBeNull();
    });

    it('el secuencial continúa dentro del mismo formulario y jornada', async () => {
      const respuesta = await registrar(
        INSPECCIONES,
        registroValido({ horaInicio: '06:00', horaFin: '07:00' }),
      ).expect(201);

      expect((respuesta.body as OperativoRespuesta).secuencial).toBe(3);
    });

    it('las observaciones entran como notas independientes, con autor y fecha (2026-09-09)', async () => {
      const respuesta = await registrar(
        INSPECCIONES,
        registroValido({
          horaInicio: '05:00',
          horaFin: '06:00',
          // La del medio en blanco se descarta.
          observaciones: ['Primera nota', '   ', 'Segunda nota'],
        }),
      ).expect(201);

      const operativo = respuesta.body as OperativoRespuesta;
      expect(operativo.observaciones).toHaveLength(2);
      expect(operativo.observaciones.map((nota) => nota.texto)).toEqual([
        'Primera nota',
        'Segunda nota',
      ]);
      // Bitácora: cada nota lleva quién la escribió (el rol del registro) y cuándo.
      expect(operativo.observaciones[0].creadoPorRol).toBe('DMIP_INSPECCIONES');
      expect(operativo.observaciones[0].creadoEn).toEqual(expect.any(String));

      // Y son filas propias en su tabla.
      const enBase = await prisma.operativoObservacion.count({
        where: { operativoId: operativo.id },
      });
      expect(enBase).toBe(2);
    });

    it('caso 4 · otra fecha vuelve a empezar en 001', async () => {
      const respuesta = await registrar(
        INSPECCIONES,
        registroValido({ cuadroFecha: OTRA_FECHA }),
      ).expect(201);

      const operativo = respuesta.body as OperativoRespuesta;
      expect(operativo.secuencial).toBe(1);
      expect(operativo.identificador).toBe('INSP-001-16-SEP-2026');
    });

    it('caso 5 · dos registros concurrentes reciben secuenciales distintos', async () => {
      const [una, otra] = await Promise.all([
        registrar(
          INSPECCIONES,
          registroValido({ horaInicio: '20:00', horaFin: '22:00' }),
        ),
        registrar(
          INSPECCIONES,
          registroValido({ horaInicio: '21:00', horaFin: '23:00' }),
        ),
      ]);

      expect(una.status).toBe(201);
      expect(otra.status).toBe(201);

      const primera = una.body as OperativoRespuesta;
      const segunda = otra.body as OperativoRespuesta;

      expect(primera.secuencial).not.toBe(segunda.secuencial);
      expect(primera.identificador).not.toBe(segunda.identificador);
    });

    it('el horario nocturno se deriva de la franja configurada', async () => {
      const respuesta = await registrar(
        INSPECCIONES,
        registroValido({ horaInicio: '22:00', horaFin: '02:00' }),
      ).expect(201);

      const operativo = respuesta.body as OperativoRespuesta;
      expect(operativo.esNocturno).toBe(true);
      expect(operativo.cruzaMedianoche).toBe(true);
      expect(operativo.duracionHoras).toBe(4);
    });

    it('RN-20 · acepta el tipo adicional cuando el formulario lo ofrece', async () => {
      const respuesta = await registrar(
        INSPECCIONES,
        registroValido({
          horaInicio: '05:00',
          horaFin: '05:30',
          tipoControlId: undefined,
          tipoLibre: 'Control de escombros',
        }),
      ).expect(201);

      const operativo = respuesta.body as OperativoRespuesta;
      expect(operativo.tipoControl).toBeNull();
      expect(operativo.tipoLibre).toBe('Control de escombros');
    });

    it('la respuesta trae los colores del formulario', async () => {
      const respuesta = await registrar(
        INSPECCIONES,
        registroValido({ horaInicio: '04:00', horaFin: '05:00' }),
      ).expect(201);

      expect((respuesta.body as OperativoRespuesta).formulario.colorFondo).toBe(
        '#EEEEEE',
      );
    });
  });

  describe('autorización', () => {
    it('caso 2 · registrar en formulario ajeno responde 403', async () => {
      const respuesta = await registrar(
        INSPECCIONES,
        registroValido({ formularioCodigo: `${PREFIJO}_PMO` }),
      ).expect(403);

      expect((respuesta.body as { codigo: string }).codigo).toBe(
        'FORMULARIO_NO_AUTORIZADO',
      );
    });

    it('caso 11 · el DIRECTOR no registra operativos', async () => {
      const respuesta = await registrar(DIRECTOR, registroValido()).expect(403);

      expect((respuesta.body as { codigo: string }).codigo).toBe(
        'PERMISO_INSUFICIENTE',
      );
    });

    it('PER-03 · la DAF tampoco', async () => {
      await registrar(DAF, registroValido()).expect(403);
    });

    it('sin identidad responde 401', async () => {
      await request(servidor())
        .post(`${API}/operativos`)
        .send(registroValido())
        .expect(401);
    });

    it('el rol COMPARTIDO no es dueño: no puede registrar en el formulario', async () => {
      // El DMIT comparte cupo de personal en el formulario, no la propiedad del
      // operativo. La guarda lo deja pasar —para ella compartir es acceso— y el
      // servicio no: registrar es del dueño. PER-06.
      const respuesta = await registrar(INSTRUCTOR, registroValido()).expect(
        403,
      );

      const cuerpo = respuesta.body as { codigo: string; mensaje: string };
      expect(cuerpo.codigo).toBe('FORMULARIO_NO_AUTORIZADO');
      expect(cuerpo.mensaje).toContain('cupo de personal');
    });
  });

  describe('validación del contrato', () => {
    it('caso 3 · enviar conductorId responde 400 nombrando el campo', async () => {
      const respuesta = await registrar(
        INSPECCIONES,
        registroValido({ conductorId: 7 }),
      ).expect(400);

      const cuerpo = respuesta.body as { codigo: string; mensaje: string };
      expect(cuerpo.codigo).toBe('CAMPOS_NO_PERMITIDOS');
      expect(cuerpo.mensaje).toContain('conductorId');
    });

    it('enviar el identificador o el secuencial también se rechaza', async () => {
      const respuesta = await registrar(
        INSPECCIONES,
        registroValido({ identificador: 'INVENTADO-001', secuencial: 99 }),
      ).expect(400);

      const cuerpo = respuesta.body as { codigo: string; mensaje: string };
      expect(cuerpo.codigo).toBe('CAMPOS_NO_PERMITIDOS');
      expect(cuerpo.mensaje).toContain('identificador');
    });

    it('caso 7 · la hora 08:15 se rechaza', async () => {
      const respuesta = await registrar(
        INSPECCIONES,
        registroValido({ horaInicio: '08:15' }),
      ).expect(400);

      expect((respuesta.body as { mensaje: string }).mensaje).toContain(
        'hora en punto o y media',
      );
    });

    it('caso 8 · sin ninguna zonal se rechaza', async () => {
      const respuesta = await registrar(
        INSPECCIONES,
        registroValido({ zonalesIds: [] }),
      ).expect(400);

      expect((respuesta.body as { mensaje: string }).mensaje).toContain(
        'zonal',
      );
    });

    it('caso 9 · punto del catálogo y punto libre a la vez se rechaza', async () => {
      const respuesta = await registrar(
        INSPECCIONES,
        registroValido({ puntoLibre: 'Frente al mercado' }),
      ).expect(400);

      expect((respuesta.body as { mensaje: string }).mensaje).toContain(
        'no las dos cosas',
      );
    });

    it('sin ninguna institución se rechaza', async () => {
      await registrar(
        INSPECCIONES,
        registroValido({ institucionesIds: [] }),
      ).expect(400);
    });

    it('INV-07 · un punto de otra zonal se rechaza nombrando ambas', async () => {
      const respuesta = await registrar(
        INSPECCIONES,
        registroValido({ zonalesIds: [zonalA], puntoEncuentroId: puntoDeB }),
      ).expect(400);

      expect((respuesta.body as { mensaje: string }).mensaje).toContain(
        'PUNTO B',
      );
    });

    it('RN-20 · el formulario que NO ofrece ADICIONALES rechaza el tipo libre', async () => {
      const respuesta = await registrar(
        OPERATIVOS,
        registroValido({
          formularioCodigo: `${PREFIJO}_PMO`,
          tipoControlId: undefined,
          tipoLibre: 'Lo que sea',
        }),
      ).expect(400);

      expect((respuesta.body as { mensaje: string }).mensaje).toContain(
        'ADICIONALES',
      );
    });

    /**
     * REGLA DEL 2026-08-11 · LA JORNADA SE ABRE SOLA AL REGISTRAR.
     *
     * Hasta esa fecha esta prueba afirmaba lo contrario —«una jornada que nadie abrió no
     * admite registro», con `404`—, porque la apertura era un acto previo del
     * `ADMINISTRADOR`. Se conserva el caso, invertido, para que quede constancia de que
     * el cambio fue deliberado y no una regresión.
     */
    it('registrar abre la jornada que todavía no existe', async () => {
      const fecha = '2030-01-01';
      const orden = `AMC-${fecha}`;

      try {
        const respuesta = await registrar(
          INSPECCIONES,
          registroValido({ cuadroFecha: fecha }),
        ).expect(201);

        expect((respuesta.body as { cuadroFecha: string }).cuadroFecha).toBe(
          fecha,
        );

        const abierta = await prisma.cuadroDiario.findFirst({
          where: { ordenTrabajo: orden },
        });
        expect(abierta?.estado).toBe(EstadoCuadro.BORRADOR);
      } finally {
        // `limpiar()` no la alcanza: la orden de trabajo la compone el servidor a partir
        // de la fecha y no lleva el prefijo de las pruebas. Los operativos van primero
        // porque `fk_operativo_cuadro` no es en cascada.
        await prisma.operativo.deleteMany({
          where: { cuadro: { ordenTrabajo: orden } },
        });
        await prisma.cuadroDiario.deleteMany({
          where: { ordenTrabajo: orden },
        });
      }
    });

    it('no abre una jornada que ya pasó', async () => {
      // El único límite de la apertura automática. Sin él, un error en el selector de
      // fecha dejaría jornadas de días ya ocurridos, con su matriz y todo.
      const respuesta = await registrar(
        INSPECCIONES,
        registroValido({ cuadroFecha: '2020-01-01' }),
      ).expect(400);

      expect((respuesta.body as { mensaje: string }).mensaje).toContain(
        '2020-01-01',
      );
    });
  });

  describe('consulta (PER-02)', () => {
    it('caso 12 · un rol departamental recibe solo sus filas', async () => {
      await registrar(
        OPERATIVOS,
        registroValido({
          formularioCodigo: `${PREFIJO}_PMO`,
          tipoControlId: tipoControlOperativos,
        }),
      ).expect(201);

      const respuesta = await request(servidor())
        .get(`${API}/operativos?fecha=${FECHA}`)
        .set(como(INSPECCIONES))
        .expect(200);

      const cuerpo = respuesta.body as {
        datos: OperativoRespuesta[];
        meta: { total: number };
      };

      expect(cuerpo.datos.length).toBeGreaterThan(0);
      expect(
        cuerpo.datos.every(
          (operativo) => operativo.formulario.codigo === `${PREFIJO}_INSP`,
        ),
      ).toBe(true);
    });

    it('la Dirección ve los dos formularios de la jornada', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/operativos?fecha=${FECHA}&tamanio=200`)
        .set(como(DIRECTOR))
        .expect(200);

      const codigos = new Set(
        (respuesta.body as { datos: OperativoRespuesta[] }).datos.map(
          (operativo) => operativo.formulario.codigo,
        ),
      );

      expect(codigos.has(`${PREFIJO}_INSP`)).toBe(true);
      expect(codigos.has(`${PREFIJO}_PMO`)).toBe(true);
    });

    it('el rol compartido ve los operativos del formulario que comparte, no los demás', async () => {
      // El DMIT tiene cupo de una persona en el formulario de Inspecciones: necesita
      // encontrar esos operativos para asignarla en M-15. Los del formulario de
      // Operativos, en cambio, no le corresponden.
      const respuesta = await request(servidor())
        .get(`${API}/operativos?fecha=${FECHA}&tamanio=200`)
        .set(como(INSTRUCTOR))
        .expect(200);

      const datos = (respuesta.body as { datos: OperativoRespuesta[] }).datos;
      expect(datos.length).toBeGreaterThan(0);
      expect(
        datos.every(
          (operativo) => operativo.formulario.codigo === `${PREFIJO}_INSP`,
        ),
      ).toBe(true);

      // Y el listado no discrepa de la consulta directa.
      await request(servidor())
        .get(`${API}/operativos/${datos[0].id}`)
        .set(como(INSTRUCTOR))
        .expect(200);
    });

    it('un operativo de otro departamento no se abre por su identificador', async () => {
      const ajeno = await prisma.operativo.findFirst({
        where: { formularioId: formularioOperativos, activo: true },
      });

      const respuesta = await request(servidor())
        .get(`${API}/operativos/${ajeno?.id ?? 0}`)
        .set(como(INSPECCIONES))
        .expect(403);

      expect((respuesta.body as { codigo: string }).codigo).toBe(
        'FORMULARIO_NO_AUTORIZADO',
      );
    });

    it('un identificador inexistente responde 404', async () => {
      await request(servidor())
        .get(`${API}/operativos/999999`)
        .set(como(INSPECCIONES))
        .expect(404);
    });
  });

  describe('conteo por formulario (2026-10-16)', () => {
    type Conteo = { formularioId: number; total: number }[];

    it('el «N hoy» coincide con lo que el mismo rol ve en el listado', async () => {
      const [conteo, listado] = await Promise.all([
        request(servidor())
          .get(`${API}/operativos/conteo?fecha=${FECHA}`)
          .set(como(INSPECCIONES))
          .expect(200),
        request(servidor())
          .get(`${API}/operativos?fecha=${FECHA}&tamanio=200`)
          .set(como(INSPECCIONES))
          .expect(200),
      ]);

      const delInsp = (conteo.body as Conteo).find(
        (fila) => fila.formularioId === formularioInspecciones,
      );
      expect(delInsp?.total).toBe(
        (listado.body as { meta: { total: number } }).meta.total,
      );
      // No ve el de Operativos: tampoco lo cuenta.
      expect(
        (conteo.body as Conteo).some(
          (fila) => fila.formularioId === formularioOperativos,
        ),
      ).toBe(false);
    });

    it('una fecha sin cuadro devuelve los formularios con 0', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/operativos/conteo?fecha=2031-01-01`)
        .set(como(INSPECCIONES))
        .expect(200);

      const conteo = respuesta.body as Conteo;
      expect(conteo.length).toBeGreaterThan(0);
      expect(conteo.every((fila) => fila.total === 0)).toBe(true);
    });

    it('una fecha mal escrita responde 400', async () => {
      await request(servidor())
        .get(`${API}/operativos/conteo?fecha=17-10-2026`)
        .set(como(INSPECCIONES))
        .expect(400);
    });
  });

  describe('edición', () => {
    it('modifica el horario y sube la versión, sin tocar el identificador', async () => {
      const creado = await registrar(
        INSPECCIONES,
        registroValido({ horaInicio: '09:00', horaFin: '10:00' }),
      ).expect(201);

      const original = creado.body as OperativoRespuesta;

      const respuesta = await request(servidor())
        .patch(`${API}/operativos/${original.id}`)
        .set(como(INSPECCIONES))
        .send({ version: original.version, horaFin: '14:00' })
        .expect(200);

      const editado = respuesta.body as OperativoRespuesta;
      expect(editado.identificador).toBe(original.identificador);
      expect(editado.horaFin ?? editado).toBeDefined();
      expect(editado.duracionHoras).toBe(5);
      expect(editado.version).toBe(original.version + 1);
    });

    it('caso 10 · una versión desactualizada responde 409', async () => {
      const creado = await registrar(
        INSPECCIONES,
        registroValido({ horaInicio: '03:00', horaFin: '04:00' }),
      ).expect(201);

      const original = creado.body as OperativoRespuesta;

      await request(servidor())
        .patch(`${API}/operativos/${original.id}`)
        .set(como(INSPECCIONES))
        .send({ version: original.version, horaFin: '05:00' })
        .expect(200);

      const respuesta = await request(servidor())
        .patch(`${API}/operativos/${original.id}`)
        .set(como(INSPECCIONES))
        .send({ version: original.version, horaFin: '06:00' })
        .expect(409);

      const cuerpo = respuesta.body as { codigo: string; mensaje: string };
      expect(cuerpo.codigo).toBe('CONFLICTO_CONCURRENCIA');
      expect(cuerpo.mensaje).toContain('otra persona');
    });

    it('sin la versión no se puede editar', async () => {
      const alguno = await prisma.operativo.findFirst({
        where: { formularioId: formularioInspecciones, activo: true },
      });

      await request(servidor())
        .patch(`${API}/operativos/${alguno?.id ?? 0}`)
        .set(como(INSPECCIONES))
        .send({ horaFin: '18:00' })
        .expect(400);
    });

    it('cambiar las zonales reemplaza las filas puente', async () => {
      const creado = await registrar(
        INSPECCIONES,
        registroValido({ horaInicio: '02:00', horaFin: '03:00' }),
      ).expect(201);

      const original = creado.body as OperativoRespuesta;

      const respuesta = await request(servidor())
        .patch(`${API}/operativos/${original.id}`)
        .set(como(INSPECCIONES))
        .send({ version: original.version, zonalesIds: [zonalA, zonalB] })
        .expect(200);

      expect((respuesta.body as OperativoRespuesta).zonales).toHaveLength(2);
    });

    it('un departamento ajeno no puede editar, aunque conozca el identificador', async () => {
      const alguno = await prisma.operativo.findFirst({
        where: { formularioId: formularioInspecciones, activo: true },
      });

      const respuesta = await request(servidor())
        .patch(`${API}/operativos/${alguno?.id ?? 0}`)
        .set(como(OPERATIVOS))
        .send({ version: 1, horaFin: '18:00' })
        .expect(403);

      expect((respuesta.body as { codigo: string }).codigo).toBe(
        'FORMULARIO_NO_AUTORIZADO',
      );
    });
  });

  /**
   * PV-10 cambió el 2026-08-07: la baja BORRA la fila mientras no haya órdenes emitidas.
   * Estas dos pruebas afirmaban lo contrario y se reescribieron con la regla nueva.
   */
  describe('baja (PV-10)', () => {
    it('sin órdenes emitidas, el operativo desaparece de la base', async () => {
      const creado = await registrar(
        INSPECCIONES,
        registroValido({ horaInicio: '01:00', horaFin: '02:00' }),
      ).expect(201);

      const original = creado.body as OperativoRespuesta;

      const baja = await request(servidor())
        .delete(`${API}/operativos/${original.id}?version=${original.version}`)
        .set(como(INSPECCIONES))
        .expect(200);

      expect((baja.body as { eliminado: boolean }).eliminado).toBe(true);

      // No queda fila.
      const guardado = await prisma.operativo.findUnique({
        where: { id: original.id },
      });
      expect(guardado).toBeNull();

      await request(servidor())
        .get(`${API}/operativos/${original.id}`)
        .set(como(INSPECCIONES))
        .expect(404);
    });

    /** Lo que cayó con él: sin `CASCADE` quedarían filas apuntando a un operativo ausente. */
    it('arrastra sus zonales, instituciones y personal', async () => {
      const creado = await registrar(
        INSPECCIONES,
        registroValido({ horaInicio: '03:00', horaFin: '04:00' }),
      ).expect(201);

      const operativo = creado.body as OperativoRespuesta;

      await request(servidor())
        .delete(
          `${API}/operativos/${operativo.id}?version=${operativo.version}`,
        )
        .set(como(INSPECCIONES))
        .expect(200);

      expect(
        await prisma.operativoZonal.count({
          where: { operativoId: operativo.id },
        }),
      ).toBe(0);
      expect(
        await prisma.operativoInstitucion.count({
          where: { operativoId: operativo.id },
        }),
      ).toBe(0);
      expect(
        await prisma.asignacionPersonal.count({
          where: { operativoId: operativo.id },
        }),
      ).toBe(0);
    });

    it('el secuencial del operativo eliminado SÍ se reutiliza', async () => {
      const creado = await registrar(
        INSPECCIONES,
        registroValido({ horaInicio: '00:00', horaFin: '01:00' }),
      ).expect(201);

      const eliminado = creado.body as OperativoRespuesta;

      await request(servidor())
        .delete(
          `${API}/operativos/${eliminado.id}?version=${eliminado.version}`,
        )
        .set(como(INSPECCIONES))
        .expect(200);

      const siguiente = await registrar(
        INSPECCIONES,
        registroValido({ horaInicio: '23:00', horaFin: '23:30' }),
      ).expect(201);

      // Mismo número y mismo identificador: la numeración del día no deja huecos.
      expect((siguiente.body as OperativoRespuesta).secuencial).toBe(
        eliminado.secuencial,
      );
      expect((siguiente.body as OperativoRespuesta).identificador).toBe(
        eliminado.identificador,
      );
    });

    /**
     * La otra mitad de la decisión: con una orden emitida la fila **se conserva**.
     *
     * No es una preferencia sino la base: `fk_orden_operativo` es `RESTRICT`. Si el
     * servicio intentara borrar, la transacción entera fallaría y la baja no ocurriría
     * en absoluto; se comprueba que responde `200` y que la fila queda desactivada.
     */
    it('con una orden emitida, el operativo se conserva desactivado', async () => {
      const creado = await registrar(
        INSPECCIONES,
        registroValido({ horaInicio: '05:00', horaFin: '06:00' }),
      ).expect(201);

      const operativo = creado.body as OperativoRespuesta;

      const funcionario = await prisma.funcionario.create({
        data: {
          cedula: `${Date.now()}`.slice(-10),
          apellidos: 'PRUEBA BAJA',
          nombres: 'ORDEN EMITIDA',
          area: AreaPersonal.OPERATIVOS,
          tipoContrato: TipoContrato.NOMBRAMIENTO,
          direccion: RolDepartamental.DMIP_INSPECCIONES,
        },
      });

      await prisma.ordenServicio.create({
        data: {
          operativoId: operativo.id,
          funcionarioId: funcionario.id,
          codigo: `ORD-BAJA-${operativo.id}`,
          datoAislado: {},
          emitidaPor: 2,
        },
      });

      const baja = await request(servidor())
        .delete(
          `${API}/operativos/${operativo.id}?version=${operativo.version}`,
        )
        .set(como(INSPECCIONES))
        .expect(200);

      const cuerpo = baja.body as {
        eliminado: boolean;
        ordenesEmitidas: number;
      };
      expect(cuerpo.eliminado).toBe(false);
      expect(cuerpo.ordenesEmitidas).toBe(1);

      const guardado = await prisma.operativo.findUnique({
        where: { id: operativo.id },
      });
      expect(guardado?.activo).toBe(false);
      expect(guardado?.identificador).toBe(operativo.identificador);
    });

    it('la baja queda auditada como ELIMINAR', async () => {
      const creado = await registrar(
        INSPECCIONES,
        registroValido({ horaInicio: '15:00', horaFin: '16:00' }),
      ).expect(201);

      const operativo = creado.body as OperativoRespuesta;

      await request(servidor())
        .delete(
          `${API}/operativos/${operativo.id}?version=${operativo.version}`,
        )
        .set(como(INSPECCIONES))
        .expect(200);

      const trazas = await prisma.auditoria.findMany({
        where: { entidad: 't_operativo', entidadId: operativo.id },
        orderBy: { id: 'asc' },
      });

      expect(trazas.map((traza) => traza.accion)).toEqual([
        'CREAR',
        'ELIMINAR',
      ]);
      expect(trazas[1].rol).toBe(RolDepartamental.DMIP_INSPECCIONES);
    });
  });

  describe('caso 13 · atomicidad de la escritura multitabla', () => {
    it('un fallo a mitad no deja ni operativo, ni zonales, ni instituciones', async () => {
      const antes = await prisma.operativo.count({ where: { cuadroId } });

      const fallo = new Error('fallo simulado a mitad de la transacción');

      await expect(
        repositorio.ejecutarEnTransaccion(async (cliente) => {
          await repositorio.crear(
            {
              cuadroId,
              formularioId: formularioInspecciones,
              identificador: 'INSP-900-15-SEP-2026',
              secuencial: 900,
              horaInicio: '08:00',
              horaFin: '09:00',
              esNocturno: false,
              cruzaMedianoche: false,
              duracionHoras: 1,
              puntoEncuentroId: puntoDeA,
              puntoLibre: null,
              tipoControlId: tipoControl,
              // El 3·INSP de esta prueba no admite varios tipos: la lista va vacía.
              tipoControlIds: [],
              tipoLibre: null,
              observaciones: [],
              zonalIds: [zonalA],
              institucionIds: [institucion],
              origenId: null,
              // Un operativo nace sin transporte: los dos campos son de la DAF (RN-40).
              // El adicional también nace sin ellos y luego hereda por tramos (2026-10-14).
              rol: RolDepartamental.DMIP_INSPECCIONES,
              usuarioId: 2,
            },
            cliente,
          );

          // El operativo YA está insertado en esta transacción. Aquí se simula el fallo
          // posterior —la auditoría, por ejemplo— que debe deshacerlo todo.
          throw fallo;
        }),
      ).rejects.toBe(fallo);

      expect(await prisma.operativo.count({ where: { cuadroId } })).toBe(antes);
      expect(
        await prisma.operativo.count({
          where: { identificador: 'INSP-900-15-SEP-2026' },
        }),
      ).toBe(0);
      expect(
        await prisma.operativoZonal.count({
          where: { operativo: { secuencial: 900 } },
        }),
      ).toBe(0);
    });
  });

  describe('varios operativos de una persona (cantidad, 2026-09-09)', () => {
    // Fecha propia para no acoplar el conteo de secuenciales de los demás casos.
    const FECHA_VARIOS = '2026-10-07';
    // Fecha aparte para el rechazo, con las dos personas SIN asignaciones previas (si no, el
    // 409 del personal saltaría antes que el 400 de la regla de cantidad).
    const FECHA_VARIOS2 = '2026-10-09';
    // Fecha aparte para el caso «horario demasiado corto» (sí crea operativos, no debe
    // contaminar el conteo de FECHA_VARIOS2). Día de semana (miércoles): un fin de semana
    // dispararía la restricción de contrato (RN-26) antes de llegar a la división.
    const FECHA_VARIOS3 = '2026-10-14';
    // Fecha aparte para el APORTE a la patrulla (2026-09-17): el DMIP registra la patrulla con un
    // inspector y luego se aporta una persona de otra área, que debe crear su propio operativo en
    // el mismo grupo. Viernes (día de semana), sin cruzar el conteo de los demás casos.
    const FECHA_APORTE = '2026-10-16';
    // Fecha aparte para EDITAR la patrulla y REEMPLAZAR una persona (2026-09-18). Martes.
    const FECHA_PATRULLA_EDIT = '2026-10-20';

    beforeAll(async () => {
      await prisma.cuadroDiario.createMany({
        data: [
          {
            fecha: comoFecha(FECHA_VARIOS),
            ordenTrabajo: `${PREFIJO}-OT-VARIOS`,
            nroSemana: 41,
            anioSemana: 2026,
          },
          {
            fecha: comoFecha(FECHA_APORTE),
            ordenTrabajo: `${PREFIJO}-OT-APORTE`,
            nroSemana: 42,
            anioSemana: 2026,
          },
          {
            fecha: comoFecha(FECHA_PATRULLA_EDIT),
            ordenTrabajo: `${PREFIJO}-OT-PATED`,
            nroSemana: 43,
            anioSemana: 2026,
          },
          {
            fecha: comoFecha(FECHA_VARIOS2),
            ordenTrabajo: `${PREFIJO}-OT-VARIOS2`,
            nroSemana: 41,
            anioSemana: 2026,
          },
          {
            fecha: comoFecha(FECHA_VARIOS3),
            ordenTrabajo: `${PREFIJO}-OT-VARIOS3`,
            nroSemana: 41,
            anioSemana: 2026,
          },
        ],
      });

      // El formulario IAREA habilita el split por persona Y la cantidad por persona (como el 8
      // en producción): cada persona genera sus propios operativos según su cantidad. Los dos
      // flags están desacoplados desde 2026-09-14 (el 5 tiene solo el primero).
      await prisma.formulario.updateMany({
        where: { codigo: `${PREFIJO}_IAREA` },
        data: { variosPorPersona: true, cantidadPorPersona: true },
      });
    });

    it('crea N operativos con la MISMA hora general de la persona (2026-09-14, sin segmentar)', async () => {
      const respuesta = await registrar(INSPECCIONES, {
        cuadroFecha: FECHA_VARIOS,
        formularioCodigo: `${PREFIJO}_IAREA`,
        zonalesIds: [zonalA],
        puntoEncuentroId: puntoDeA,
        tipoControlId: tipoControlPorArea,
        institucionesIds: [institucion],
        // Una persona con cantidad 3 genera 3 operativos, TODOS con su turno completo 08:00–12:00.
        personal: [
          {
            funcionarioId: inspectorGeneralA,
            horaInicio: '08:00',
            horaFin: '12:00',
            cantidad: 3,
          },
        ],
      }).expect(201);

      const cuadro = await prisma.cuadroDiario.findUniqueOrThrow({
        where: { fecha: comoFecha(FECHA_VARIOS) },
      });
      const operativos = await prisma.operativo.findMany({
        where: { cuadroId: cuadro.id },
        orderBy: { secuencial: 'asc' },
        include: { personal: true },
      });

      // Tres operativos con secuenciales consecutivos, todos con la ventana completa 08:00–12:00.
      expect(operativos).toHaveLength(3);
      expect(
        operativos.map((o) => [o.secuencial, o.horaInicio, o.horaFin]),
      ).toEqual([
        [1, '08:00', '12:00'],
        [2, '08:00', '12:00'],
        [3, '08:00', '12:00'],
      ]);
      for (const operativo of operativos) {
        // La MISMA persona en cada uno, con su misma hora general (ya no hay tramos).
        expect(operativo.personal.map((p) => p.funcionarioId)).toEqual([
          inspectorGeneralA,
        ]);
        expect(operativo.personal[0].horaInicio).toBe(operativo.horaInicio);
        expect(operativo.personal[0].horaFin).toBe(operativo.horaFin);
      }
      // La respuesta es el primero (contrato de siempre: un operativo).
      expect((respuesta.body as OperativoRespuesta).secuencial).toBe(1);
    });

    it('la cantidad genera N operativos, todos con la misma ventana general (2026-09-14)', async () => {
      // 08:00–09:00 con cantidad 4 → 4 operativos, todos 08:00–09:00: el horario ya no se segmenta.
      await registrar(INSPECCIONES, {
        cuadroFecha: FECHA_VARIOS3,
        formularioCodigo: `${PREFIJO}_IAREA`,
        zonalesIds: [zonalA],
        puntoEncuentroId: puntoDeA,
        tipoControlId: tipoControlPorArea,
        institucionesIds: [institucion],
        personal: [
          {
            funcionarioId: inspectorTecnicoA,
            horaInicio: '08:00',
            horaFin: '09:00',
            cantidad: 4,
          },
        ],
      }).expect(201);

      const cuadro = await prisma.cuadroDiario.findUniqueOrThrow({
        where: { fecha: comoFecha(FECHA_VARIOS3) },
      });
      const operativos = await prisma.operativo.findMany({
        where: { cuadroId: cuadro.id },
        orderBy: { secuencial: 'asc' },
        include: { personal: true },
      });

      expect(operativos).toHaveLength(4);
      for (const operativo of operativos) {
        expect([operativo.horaInicio, operativo.horaFin]).toEqual([
          '08:00',
          '09:00',
        ]);
        expect(operativo.personal[0].horaInicio).toBe('08:00');
        expect(operativo.personal[0].horaFin).toBe('09:00');
      }
    });

    it('cada persona genera SUS propios operativos, con distinta cantidad', async () => {
      // Dos inspectores en el mismo registro: A (08:00–12:00, cantidad 2) y B (08:00–12:00,
      // cantidad 3), ambos sin asignaciones previas. Cada uno genera sus propios operativos de
      // UNA sola persona: 2 de A + 3 de B = 5 en total.
      await registrar(INSPECCIONES, {
        cuadroFecha: FECHA_VARIOS2,
        formularioCodigo: `${PREFIJO}_IAREA`,
        zonalesIds: [zonalA],
        puntoEncuentroId: puntoDeA,
        tipoControlId: tipoControlPorArea,
        institucionesIds: [institucion],
        personal: [
          {
            funcionarioId: inspectorGeneralA,
            horaInicio: '08:00',
            horaFin: '12:00',
            cantidad: 2,
          },
          {
            funcionarioId: inspectorGeneralB,
            horaInicio: '08:00',
            horaFin: '12:00',
            cantidad: 3,
          },
        ],
      }).expect(201);

      const cuadro = await prisma.cuadroDiario.findUniqueOrThrow({
        where: { fecha: comoFecha(FECHA_VARIOS2) },
      });
      const operativos = await prisma.operativo.findMany({
        where: { cuadroId: cuadro.id },
        include: { personal: true },
      });

      // Cinco operativos, cada uno de UNA sola persona.
      expect(operativos).toHaveLength(5);
      for (const operativo of operativos) {
        expect(operativo.personal).toHaveLength(1);
      }
      const deA = operativos.filter(
        (o) => o.personal[0].funcionarioId === inspectorGeneralA,
      );
      const deB = operativos.filter(
        (o) => o.personal[0].funcionarioId === inspectorGeneralB,
      );
      expect(deA).toHaveLength(2);
      expect(deB).toHaveLength(3);
    });

    it('la patrulla (varios SIN cantidad, personas distintas) enlaza sus operativos con un mismo grupoRegistro', async () => {
      // Como el Form 5/6: split por persona pero SIN cantidad. Dos inspectores de áreas distintas
      // en un mismo registro → dos operativos con códigos distintos (por área), enlazados por
      // `grupoRegistro` para agruparlos como «una sola patrulla». El 8 (cantidad) NO lo lleva, por
      // eso se apaga el flag aquí y se restaura al terminar.
      await prisma.formulario.updateMany({
        where: { codigo: `${PREFIJO}_IAREA` },
        data: { cantidadPorPersona: false },
      });

      try {
        await registrar(INSPECCIONES, {
          cuadroFecha: FECHA_VARIOS,
          formularioCodigo: `${PREFIJO}_IAREA`,
          zonalesIds: [zonalA],
          puntoEncuentroId: puntoDeA,
          tipoControlId: tipoControlPorArea,
          institucionesIds: [institucion],
          personal: [
            {
              funcionarioId: inspectorGeneralB,
              horaInicio: '08:00',
              horaFin: '12:00',
            },
            {
              funcionarioId: inspectorTecnicoA,
              horaInicio: '08:00',
              horaFin: '12:00',
            },
          ],
        }).expect(201);

        const cuadro = await prisma.cuadroDiario.findUniqueOrThrow({
          where: { fecha: comoFecha(FECHA_VARIOS) },
        });
        // Los del split-patrulla llevan grupoRegistro; los del primer caso (cantidad) lo llevan
        // nulo, así que se filtran por «no nulo» para aislar la patrulla de esta prueba.
        const patrulla = await prisma.operativo.findMany({
          where: { cuadroId: cuadro.id, grupoRegistro: { not: null } },
          orderBy: { secuencial: 'asc' },
        });

        expect(patrulla).toHaveLength(2);
        expect(patrulla[0].grupoRegistro).not.toBeNull();
        expect(patrulla[0].grupoRegistro).toBe(patrulla[1].grupoRegistro);
        expect(patrulla[0].identificador).not.toBe(patrulla[1].identificador);
      } finally {
        await prisma.formulario.updateMany({
          where: { codigo: `${PREFIJO}_IAREA` },
          data: { cantidadPorPersona: true },
        });
      }
    });

    it('aportar personal a una patrulla CREA un operativo propio, por área, en el mismo grupo (2026-09-17)', async () => {
      // Como el Form 5/6: el DMIP registra la patrulla con UN inspector (General → IG-001), que ya
      // nace con su grupo aunque sea un solo operativo. Después se AGREGA una persona de otra área
      // (Técnico) con el botón «Agregar personal» (POST /personal): no se suma al operativo del
      // General, sino que se crea un operativo NUEVO (Técnico → IT-001, su serie por prefijo desde
      // 001), enlazado al MISMO grupo. El frontend los reagrupa como una sola patrulla.
      await prisma.formulario.updateMany({
        where: { codigo: `${PREFIJO}_IAREA` },
        data: { cantidadPorPersona: false },
      });

      try {
        const registro = await registrar(INSPECCIONES, {
          cuadroFecha: FECHA_APORTE,
          formularioCodigo: `${PREFIJO}_IAREA`,
          zonalesIds: [zonalA],
          puntoEncuentroId: puntoDeA,
          tipoControlId: tipoControlPorArea,
          institucionesIds: [institucion],
          personal: [
            {
              funcionarioId: inspectorGeneralA,
              horaInicio: '08:00',
              horaFin: '12:00',
            },
          ],
        }).expect(201);

        const patrulla = registro.body as OperativoRespuesta;
        // El registro de un solo inspector ya lleva grupo (para que el aporte lo adopte).
        const registrado = await prisma.operativo.findUniqueOrThrow({
          where: { id: patrulla.id },
        });
        expect(registrado.grupoRegistro).not.toBeNull();

        const aporte = await request(servidor())
          .post(`${API}/operativos/${patrulla.id}/personal`)
          .set(como(INSPECCIONES))
          .send({
            funcionarioId: inspectorTecnicoA,
            horaInicio: '08:00',
            horaFin: '12:00',
          })
          .expect(201);

        const nuevo = aporte.body as OperativoRespuesta;
        // El aporte devolvió un operativo DISTINTO del destino, con su propia persona.
        expect(nuevo.id).not.toBe(patrulla.id);
        expect(nuevo.personal.map((p) => p.funcionarioId)).toEqual([
          inspectorTecnicoA,
        ]);

        const cuadro = await prisma.cuadroDiario.findUniqueOrThrow({
          where: { fecha: comoFecha(FECHA_APORTE) },
        });
        const operativos = await prisma.operativo.findMany({
          where: { cuadroId: cuadro.id },
          orderBy: { id: 'asc' },
          include: { personal: true },
        });

        // Dos operativos de UNA persona cada uno, en el MISMO grupo, con prefijos distintos por
        // área y ambos con secuencial 1 (numeración por prefijo, cada serie desde 001).
        expect(operativos).toHaveLength(2);
        expect(operativos.every((o) => o.personal.length === 1)).toBe(true);
        expect(operativos[0].grupoRegistro).toBe(operativos[1].grupoRegistro);
        expect(operativos[0].grupoRegistro).toBe(registrado.grupoRegistro);
        expect(operativos.map((o) => o.secuencial)).toEqual([1, 1]);
        const general = operativos.find(
          (o) => o.personal[0].funcionarioId === inspectorGeneralA,
        );
        const tecnico = operativos.find(
          (o) => o.personal[0].funcionarioId === inspectorTecnicoA,
        );
        expect(general?.identificador.startsWith('IG-')).toBe(true);
        expect(tecnico?.identificador.startsWith('IT-')).toBe(true);
      } finally {
        await prisma.formulario.updateMany({
          where: { codigo: `${PREFIJO}_IAREA` },
          data: { cantidadPorPersona: true },
        });
      }
    });

    it('editar los generales de la patrulla los aplica a TODOS sus códigos, y reemplazar una persona conserva el código (2026-09-18)', async () => {
      await prisma.formulario.updateMany({
        where: { codigo: `${PREFIJO}_IAREA` },
        data: { cantidadPorPersona: false },
      });

      try {
        // El DMIP registra la patrulla con un General y un Técnico → dos códigos, mismo grupo.
        await registrar(INSPECCIONES, {
          cuadroFecha: FECHA_PATRULLA_EDIT,
          formularioCodigo: `${PREFIJO}_IAREA`,
          zonalesIds: [zonalA],
          puntoEncuentroId: puntoDeA,
          tipoControlId: tipoControlPorArea,
          institucionesIds: [institucion],
          personal: [
            {
              funcionarioId: inspectorGeneralA,
              horaInicio: '08:00',
              horaFin: '12:00',
            },
            {
              funcionarioId: inspectorTecnicoA,
              horaInicio: '08:00',
              horaFin: '12:00',
            },
          ],
        }).expect(201);

        const cuadro = await prisma.cuadroDiario.findUniqueOrThrow({
          where: { fecha: comoFecha(FECHA_PATRULLA_EDIT) },
        });
        const patrulla = await prisma.operativo.findMany({
          where: { cuadroId: cuadro.id, grupoRegistro: { not: null } },
          orderBy: { id: 'asc' },
        });
        expect(patrulla).toHaveLength(2);
        const grupo = patrulla[0].grupoRegistro as string;

        // Editar un campo GENERAL de la patrulla (una nota de coordinación): se aplica a los DOS
        // códigos a la vez, no a uno solo.
        const nota = 'Coordinación general de toda la patrulla';
        await request(servidor())
          .patch(`${API}/operativos/patrulla/${grupo}`)
          .set(como(INSPECCIONES))
          .send({ observacionesNuevas: [nota] })
          .expect(200);

        const despues = await prisma.operativo.findMany({
          where: { cuadroId: cuadro.id, grupoRegistro: { not: null } },
          include: { observaciones: true },
          orderBy: { id: 'asc' },
        });
        expect(
          despues.every((o) => o.observaciones.some((n) => n.texto === nota)),
        ).toBe(true);

        // Reemplazar al Técnico por OTRO Técnico (misma área): el código IT no cambia.
        const codigoTecnico = await prisma.operativo.findFirstOrThrow({
          where: { cuadroId: cuadro.id, identificador: { startsWith: 'IT-' } },
          include: { personal: true },
        });

        await request(servidor())
          .put(`${API}/operativos/${codigoTecnico.id}/personal`)
          .set(como(INSPECCIONES))
          .send({ funcionarioId: inspectorTecnicoB })
          .expect(200);

        const reemplazado = await prisma.operativo.findUniqueOrThrow({
          where: { id: codigoTecnico.id },
          include: { personal: true },
        });
        // Mismo id y mismo identificador; la persona cambió de A a B.
        expect(reemplazado.identificador).toBe(codigoTecnico.identificador);
        expect(reemplazado.personal.map((p) => p.funcionarioId)).toEqual([
          inspectorTecnicoB,
        ]);
      } finally {
        await prisma.formulario.updateMany({
          where: { codigo: `${PREFIJO}_IAREA` },
          data: { cantidadPorPersona: true },
        });
      }
    });
  });
});

function comoFecha(texto: string): Date {
  return new Date(`${texto}T00:00:00.000Z`);
}
