/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Asignación de transporte
 * Archivo: transporte.integracion-spec.ts
 * Responsabilidad: Verificar los once casos del plan contra la base real.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * EXIGE LA BASE LEVANTADA. Se ejecuta con `npm run test:integracion`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LOS CUATRO NIVELES DE LA RESTRICCIÓN DE LA DAF SOLO SE VEN AQUÍ.
 *
 * El primero es la ruta, el segundo el contrato, el tercero `forbidNonWhitelisted` y el
 * cuarto el servicio. Los cuatro son atravesados por una petición HTTP real: con dobles
 * se comprobaría el cuarto y se daría por hechos los tres anteriores, que son
 * precisamente los que dependen de cómo está montada la aplicación.
 *
 * El caso 11 se verifica **leyendo la fila completa antes y después**: ninguna columna
 * distinta de conductor, vehículo, estado y momento puede haber cambiado.
 *
 * Las ventanas de carga se desactivan mientras corre, salvo en el caso 10, que las
 * necesita cerradas para comprobar el 423.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AccesoFormulario,
  AreaPersonal,
  EstadoDisponibilidad,
  EstadoTransporte,
  PoliticaVehiculo,
  RolDepartamental,
  TipoVentana,
  type VentanaCarga,
} from '@prisma/client';
import type { Server } from 'node:http';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { correlacionMiddleware } from '../src/common/interceptors/correlacion.middleware';
import { LoggerService } from '../src/common/logger/logger.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { como } from './identidad-de-prueba';

const PREFIJO = 'PRUEBA_M17';
const API = '/api/v1';

const OPERATIVOS_ROL = '1';
const DAF = '4';
const DIRECTOR = '5';
// La flota (conductores y vehículos) la administra el ADMINISTRADOR_DAF (identidad '9')
// desde el reparto del 2026-09-01; ya no el antiguo ADMINISTRADOR (hoy ADMINISTRADOR_DMIP).
const ADMINISTRADOR = '9';

const FECHA = '2026-12-02';

interface TransporteRespuesta {
  id: number;
  identificador: string;
  estadoTransporte: EstadoTransporte;
  conductor: { id: number; nombreCompleto: string } | null;
  vehiculo: { id: number; placa: string } | null;
  asignadoEn: string | null;
  alertaActiva: boolean;
}

interface PendienteRespuesta {
  id: number;
  identificador: string;
  requiereConductor: boolean;
  personasAsignadas: number;
  estadoTransporte: EstadoTransporte;
}

describe('Asignación de transporte · integración', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ventanasIniciales: VentanaCarga[] = [];

  let formularioNormal = 0;
  let formularioPropiosMedios = 0;
  let conductor = 0;
  let otroConductor = 0;
  let conductorDeVacaciones = 0;
  let vehiculo = 0;
  let segundoVehiculo = 0;
  let vehiculoEnTaller = 0;
  let operativoNormal = 0;
  let operativoSegundo = 0;
  let operativoPropiosMedios = 0;

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

    await limpiar();

    ventanasIniciales = await prisma.ventanaCarga.findMany();
    await prisma.ventanaCarga.updateMany({ data: { activo: false } });

    const institucionales = await prisma.formulario.count({
      where: { codigo: { not: { startsWith: PREFIJO } } },
    });
    if (institucionales > 0) {
      throw new Error(
        't_formulario ya tiene formularios institucionales. Esta prueba crea los suyos con los números 1 y 2 y chocaría con ellos: revise la estrategia de datos de prueba antes de continuar.',
      );
    }

    formularioNormal = await crearFormulario(
      2,
      'PMO',
      PoliticaVehiculo.REQUERIDO,
    );
    formularioPropiosMedios = await crearFormulario(
      1,
      'REACCION',
      PoliticaVehiculo.NO_APLICA,
    );

    const zonal = await prisma.zonal.findFirst({ orderBy: { orden: 'asc' } });
    const punto = await prisma.puntoEncuentro.create({
      data: {
        nombre: `${PREFIJO} PUNTO`,
        zonalId: zonal?.id as number,
        formularios: {
          create: [
            { formularioId: formularioNormal },
            { formularioId: formularioPropiosMedios },
          ],
        },
      },
    });
    // Cada tipo pertenece a UN formulario: uno por cada formulario de la prueba, con el
    // mismo nombre (el unico es (formulario, nombre)).
    const tipoNormal = await prisma.tipoControl.create({
      data: { nombre: `${PREFIJO} CONTROL`, formularioId: formularioNormal },
    });
    const tipoPropios = await prisma.tipoControl.create({
      data: { nombre: `${PREFIJO} CONTROL`, formularioId: formularioPropiosMedios },
    });
    const entidad = await prisma.institucion.create({
      data: {
        sigla: `${PREFIJO}AMT`,
        nombre: 'Agencia de prueba M17',
        formularios: {
          create: [
            { formularioId: formularioNormal },
            { formularioId: formularioPropiosMedios },
          ],
        },
      },
    });

    vehiculo = (
      await prisma.vehiculo.create({
        data: { placa: 'M17A001', descripcion: `${PREFIJO} camioneta` },
      })
    ).id;
    // AGREGADO EL 2026-08-31. Hasta hoy la suite asignaba la MISMA placa a
    // operativoNormal (08H00-12H00) y a operativoSegundo (10H00-16H00), que se cruzan.
    // Nadie lo notaba porque la regla que lo impide no existia: es RN-DAF-01, y al
    // incorporarla estas pruebas empezaron a recibir el 409 que merecian desde el
    // principio. El fixture estaba mal, no la regla.
    segundoVehiculo = (
      await prisma.vehiculo.create({
        data: { placa: 'M17D004', descripcion: `${PREFIJO} segunda` },
      })
    ).id;

    vehiculoEnTaller = (
      await prisma.vehiculo.create({
        data: { placa: 'M17B002', descripcion: `${PREFIJO} en taller` },
      })
    ).id;

    conductor = await crearConductor('0201', 'PRIMERO', vehiculo);
    otroConductor = await crearConductor('0202', 'SEGUNDO', null);
    conductorDeVacaciones = await crearConductor('0203', 'AUSENTE', null);

    await prisma.disponibilidad.create({
      data: {
        conductorId: conductorDeVacaciones,
        estado: EstadoDisponibilidad.VACACIONES,
        desde: new Date(`${FECHA}T00:00:00.000Z`),
        hasta: new Date('2026-12-20T00:00:00.000Z'),
        registradoPor: 6,
      },
    });

    await prisma.disponibilidad.create({
      data: {
        vehiculoId: vehiculoEnTaller,
        estado: EstadoDisponibilidad.MANTENIMIENTO,
        desde: new Date(`${FECHA}T00:00:00.000Z`),
        hasta: new Date('2026-12-15T00:00:00.000Z'),
        registradoPor: 6,
      },
    });

    await prisma.cuadroDiario.create({
      data: {
        fecha: new Date(`${FECHA}T00:00:00.000Z`),
        ordenTrabajo: `${PREFIJO}-OT-001`,
        nroSemana: 49,
        anioSemana: 2026,
      },
    });

    const registrar = (
      formularioCodigo: string,
      horaInicio: string,
      horaFin: string,
    ) =>
      request(servidor())
        .post(`${API}/operativos`)
        .set(como(OPERATIVOS_ROL))
        .send({
          cuadroFecha: FECHA,
          formularioCodigo,
          horaInicio,
          horaFin,
          zonalesIds: [zonal?.id],
          puntoEncuentroId: punto.id,
          tipoControlId:
            formularioCodigo === `${PREFIJO}_PMO` ? tipoNormal.id : tipoPropios.id,
          institucionesIds: [entidad.id],
        })
        .expect(201);

    operativoNormal = (
      (await registrar(`${PREFIJO}_PMO`, '08:00', '12:00')).body as { id: number }
    ).id;
    operativoSegundo = (
      (await registrar(`${PREFIJO}_PMO`, '10:00', '16:00')).body as { id: number }
    ).id;
    operativoPropiosMedios = (
      (await registrar(`${PREFIJO}_REACCION`, '08:00', '12:00')).body as {
        id: number;
      }
    ).id;
  });

  afterAll(async () => {
    await limpiar();

    for (const original of ventanasIniciales) {
      await prisma.ventanaCarga.update({
        where: { rol: original.rol },
        data: { activo: original.activo },
      });
    }
    await app.close();
  });

  const limpiar = async (): Promise<void> => {
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
    await prisma.conductor.deleteMany({
      where: { nombreCompleto: { startsWith: PREFIJO } },
    });
    await prisma.vehiculo.deleteMany({
      where: { placa: { startsWith: 'M17' } },
    });
  };

  const crearFormulario = async (
    numero: number,
    sufijo: string,
    politicaVehiculo: PoliticaVehiculo,
  ): Promise<number> => {
    const formulario = await prisma.formulario.create({
      data: {
        numero,
        codigo: `${PREFIJO}_${sufijo}`,
        nombre: `FORMULARIO ${sufijo}`,
        colorFondo: '#EEEEEE',
        colorAcento: '#000000',
        colorNombre: 'gris',
        rolDueno: RolDepartamental.DMIP_OPERATIVOS,
        politicaVehiculo,
        orden: numero,
        prefijos: { create: [{ prefijo: sufijo.slice(0, 3), esPredeterminado: true }] },
        areas: { create: [{ area: AreaPersonal.GENERAL }] },
        // ═══════════════════════════════════════════════════════════════════════════
        // AÑADIDO EL 2026-08-31, y no es del alcance de la DAF: es una deuda del 25-AGO.
        //
        // La migración `20260825160000_un_formulario_admite_varios_roles` trasladó la
        // autorización de `form_rol_dueno` a la tabla `t_formulario_rol`. Este fixture no
        // se actualizó entonces, así que creaba formularios sin ninguna fila de rol y
        // `FormularioRolGuard` respondía 403 al primer intento de registrar un operativo.
        //
        // Consecuencia: **esta suite llevaba sin poder ejecutarse desde el 25-AGO**, y el
        // fallo aparecía en el `beforeAll`, donde nadie lo leía como lo que era.
        //
        // `rolDueno` se conserva porque cambió de significado, no desapareció: hoy nombra
        // al departamento RESPONSABLE del formulario, y lo usan la matriz consolidada y la
        // cabecera del documento. Quien decide si se puede escribir es la fila de abajo.
        // ═══════════════════════════════════════════════════════════════════════════
        roles: {
          create: [
            {
              rol: RolDepartamental.DMIP_OPERATIVOS,
              acceso: AccesoFormulario.ESCRITURA,
            },
          ],
        },
      },
    });
    return formulario.id;
  };

  const crearConductor = async (
    sufijo: string,
    nombre: string,
    vehiculoHabitualId: number | null,
  ): Promise<number> => {
    const creado = await prisma.conductor.create({
      data: {
        cedula: `888888${sufijo}`,
        nombreCompleto: `${PREFIJO} ${nombre}`,
        licenciaTipo: 'E',
        vehiculoHabitualId,
      },
    });
    return creado.id;
  };

  const servidor = (): Server => app.getHttpServer() as Server;

  const asignar = (
    usuario: string,
    operativoId: number,
    cuerpo: Record<string, unknown>,
  ) =>
    request(servidor())
      .patch(`${API}/transporte/operativos/${operativoId}`)
      .set(como(usuario))
      .send(cuerpo);

  describe('nivel 1 · la ruta', () => {
    it('caso 3 · un rol departamental no entra en el endpoint de transporte', async () => {
      const respuesta = await asignar(OPERATIVOS_ROL, operativoNormal, {
        conductorId: conductor,
        vehiculoId: vehiculo,
      }).expect(403);

      expect((respuesta.body as { codigo: string }).codigo).toBe(
        'PERMISO_INSUFICIENTE',
      );
    });

    it('caso 4 · la DAF no puede crear operativos', async () => {
      const respuesta = await request(servidor())
        .post(`${API}/operativos`)
        .set(como(DAF))
        .send({
          cuadroFecha: FECHA,
          formularioCodigo: `${PREFIJO}_PMO`,
          horaInicio: '08:00',
          horaFin: '12:00',
          zonalesIds: [1],
          puntoEncuentroId: 1,
          tipoControlId: 1,
          institucionesIds: [1],
        })
        .expect(403);

      expect((respuesta.body as { codigo: string }).codigo).toBe(
        'PERMISO_INSUFICIENTE',
      );
    });

    it('ni retirar personal, ni editar el operativo', async () => {
      await request(servidor())
        .patch(`${API}/operativos/${operativoNormal}`)
        .set(como(DAF))
        .send({ version: 1, horaFin: '18:00' })
        .expect(403);

      await request(servidor())
        .delete(`${API}/operativos/${operativoNormal}?version=1`)
        .set(como(DAF))
        .expect(403);
    });

    it('sin identidad responde 401', async () => {
      await request(servidor())
        .patch(`${API}/transporte/operativos/${operativoNormal}`)
        .send({ conductorId: conductor, vehiculoId: vehiculo })
        .expect(401);
    });
  });

  describe('niveles 2 y 3 · el contrato y la validación', () => {
    it('caso 2 · enviar horaInicio además de los dos campos responde 400 con la lista', async () => {
      const respuesta = await asignar(DAF, operativoNormal, {
        conductorId: conductor,
        vehiculoId: vehiculo,
        horaInicio: '06:00',
      }).expect(400);

      const cuerpo = respuesta.body as { codigo: string; mensaje: string };
      expect(cuerpo.codigo).toBe('CAMPOS_NO_PERMITIDOS');
      expect(cuerpo.mensaje).toContain('horaInicio');
    });

    it('cualquier otro campo del operativo se rechaza igual', async () => {
      for (const campo of [
        { observaciones: 'nada' },
        { puntoEncuentroId: 1 },
        { estadoTransporte: EstadoTransporte.ASIGNADO },
        { version: 1 },
      ]) {
        const respuesta = await asignar(DAF, operativoNormal, {
          conductorId: conductor,
          vehiculoId: vehiculo,
          ...campo,
        }).expect(400);

        expect((respuesta.body as { codigo: string }).codigo).toBe(
          'CAMPOS_NO_PERMITIDOS',
        );
      }
    });

    it('faltando uno de los dos campos, tampoco pasa', async () => {
      await asignar(DAF, operativoNormal, { conductorId: conductor }).expect(
        400,
      );
      await asignar(DAF, operativoNormal, { vehiculoId: vehiculo }).expect(400);
    });
  });

  describe('nivel 4 · el servicio', () => {
    it('caso 1 · asigna conductor y vehículo, y la alerta se retira', async () => {
      const respuesta = await asignar(DAF, operativoNormal, {
        conductorId: conductor,
        vehiculoId: vehiculo,
      }).expect(200);

      const resultado = respuesta.body as TransporteRespuesta;

      expect(resultado.estadoTransporte).toBe(EstadoTransporte.ASIGNADO);
      expect(resultado.conductor?.id).toBe(conductor);
      expect(resultado.vehiculo?.placa).toBe('M17A001');
      expect(resultado.asignadoEn).not.toBeNull();
      // ALV-02 y ALV-03 desaparecen; queda ALV-01, que es de personal.
      expect(resultado.alertaActiva).toBe(true);

      const guardado = await prisma.operativo.findUnique({
        where: { id: operativoNormal },
      });
      const alertas = guardado?.alertas as unknown as { codigo: string }[];
      expect(alertas.map((alerta) => alerta.codigo)).not.toContain('ALV-02');
      expect(alertas.map((alerta) => alerta.codigo)).toContain('ALV-01');
    });

    it('caso 11 · NINGUNA otra columna del operativo cambia', async () => {
      const antes = await prisma.operativo.findUniqueOrThrow({
        where: { id: operativoSegundo },
      });

      await asignar(DAF, operativoSegundo, {
        conductorId: otroConductor,
        vehiculoId: segundoVehiculo,
      }).expect(200);

      const despues = await prisma.operativo.findUniqueOrThrow({
        where: { id: operativoSegundo },
      });

      // Se comparan TODAS las columnas: las cuatro que la DAF puede tocar, más las
      // alertas —proyección derivada— y `actualizadoEn`, que Prisma mantiene solo con
      // `@updatedAt` en cualquier escritura. El resto tiene que ser idéntico.
      const permitidas = new Set([
        'conductorId',
        'vehiculoId',
        'estadoTransporte',
        'asignadoEn',
        'alertas',
        'alertaActiva',
        'actualizadoEn',
      ]);

      for (const columna of Object.keys(antes)) {
        if (permitidas.has(columna)) continue;

        expect({ columna, valor: String(despues[columna as keyof typeof despues]) }).toEqual({
          columna,
          valor: String(antes[columna as keyof typeof antes]),
        });
      }

      // Y en particular, la versión NO se toca: la DAF no compite con los departamentos.
      expect(despues.version).toBe(antes.version);
      expect(despues.modificadoPorRol).toBe(antes.modificadoPorRol);
    });

    it('la asignación queda auditada como cambio de tres columnas', async () => {
      const trazas = await prisma.auditoria.findMany({
        where: { operativoId: operativoSegundo, entidad: 't_operativo' },
        orderBy: { id: 'asc' },
      });

      const campos = trazas.map((traza) => traza.campo);
      expect(campos).toContain('cond_id');
      expect(campos).toContain('vehi_id');
      expect(campos).toContain('oper_estado_transporte');
      expect(trazas.at(-1)?.rol).toBe(RolDepartamental.DAF);
    });
  });

  describe('las reglas del conductor', () => {
    it('caso 5 · un conductor de vacaciones responde 409 con la fecha de retorno', async () => {
      const respuesta = await asignar(DAF, operativoPropiosMedios, {
        conductorId: conductorDeVacaciones,
        vehiculoId: vehiculo,
      }).expect(409);

      // El formulario de propios medios responde antes: se usa el normal.
      expect((respuesta.body as { codigo: string }).codigo).toBeDefined();
    });

    it('el conductor de vacaciones tampoco entra en un formulario normal', async () => {
      const tercero = await request(servidor())
        .post(`${API}/operativos`)
        .set(como(OPERATIVOS_ROL))
        .send({
          cuadroFecha: FECHA,
          formularioCodigo: `${PREFIJO}_PMO`,
          horaInicio: '18:00',
          horaFin: '20:00',
          zonalesIds: [
            (await prisma.zonal.findFirstOrThrow({ orderBy: { orden: 'asc' } }))
              .id,
          ],
          puntoEncuentroId: (
            await prisma.puntoEncuentro.findFirstOrThrow({
              where: { nombre: { startsWith: PREFIJO } },
            })
          ).id,
          tipoControlId: (
            await prisma.tipoControl.findFirstOrThrow({
              where: { nombre: { startsWith: PREFIJO }, formularioId: formularioNormal },
            })
          ).id,
          institucionesIds: [
            (
              await prisma.institucion.findFirstOrThrow({
                where: { sigla: { startsWith: PREFIJO } },
              })
            ).id,
          ],
        })
        .expect(201);

      const id = (tercero.body as { id: number }).id;

      const respuesta = await asignar(DAF, id, {
        conductorId: conductorDeVacaciones,
        vehiculoId: vehiculo,
      }).expect(409);

      const cuerpo = respuesta.body as { codigo: string; mensaje: string };
      expect(cuerpo.codigo).toBe('PERSONA_NO_DISPONIBLE');
      expect(cuerpo.mensaje).toContain('vacaciones');
      expect(cuerpo.mensaje).toContain('2026-12-20');
    });

    it('caso 7 · VAL-21 · el conductor comprometido en horario cruzado se rechaza', async () => {
      // `otroConductor` ya conduce el operativo de 10H00 a 16H00.
      const respuesta = await asignar(DAF, operativoNormal, {
        conductorId: otroConductor,
        vehiculoId: vehiculo,
      }).expect(409);

      const cuerpo = respuesta.body as { codigo: string; mensaje: string };
      expect(cuerpo.codigo).toBe('SOLAPAMIENTO_HORARIO');
      expect(cuerpo.mensaje).toContain('PMO-002-02-DIC-2026');
    });

    it('un vehículo en mantenimiento no se asigna', async () => {
      const respuesta = await asignar(DAF, operativoNormal, {
        conductorId: conductor,
        vehiculoId: vehiculoEnTaller,
      }).expect(409);

      expect((respuesta.body as { mensaje: string }).mensaje).toContain(
        'mantenimiento',
      );
    });

    it('un conductor inexistente responde 404', async () => {
      await asignar(DAF, operativoNormal, {
        conductorId: 999999,
        vehiculoId: vehiculo,
      }).expect(404);
    });
  });

  describe('propios medios y política de vehículo', () => {
    it('INV-13 · el formulario que no habilita vehículo rechaza la asignación', async () => {
      const respuesta = await asignar(DAF, operativoPropiosMedios, {
        conductorId: conductor,
        vehiculoId: vehiculo,
      }).expect(409);

      expect((respuesta.body as { mensaje: string }).mensaje).toContain(
        'propios medios',
      );
    });

    it('caso 8 · propios medios deja el operativo sin conductor ni vehículo', async () => {
      const respuesta = await request(servidor())
        .patch(`${API}/transporte/operativos/${operativoPropiosMedios}/propios-medios`)
        .set(como(DAF))
        .expect(200);

      const resultado = respuesta.body as TransporteRespuesta;
      expect(resultado.estadoTransporte).toBe(EstadoTransporte.PROPIOS_MEDIOS);
      expect(resultado.conductor).toBeNull();
      expect(resultado.vehiculo).toBeNull();

      const guardado = await prisma.operativo.findUniqueOrThrow({
        where: { id: operativoPropiosMedios },
      });
      expect(guardado.conductorId).toBeNull();
      expect(guardado.vehiculoId).toBeNull();
      expect(guardado.asignadoEn).toBeNull();

      const alertas = guardado.alertas as unknown as { codigo: string }[];
      expect(alertas.map((alerta) => alerta.codigo)).not.toContain('ALV-02');
    });

    /**
     * ═══════════════════════════════════════════════════════════════════════════════
     * P-07 · 2026-08-31. DESHACER, CONTRA LA BASE DE VERDAD.
     *
     * Esta prueba vive aquí y no en la unitaria por un motivo concreto:
     * `ck_operativo_transporte` exige que `PENDIENTE` lleve conductor Y vehículo nulos, y
     * esa restricción **solo existe en PostgreSQL**. Una unitaria con el repositorio
     * simulado aceptaría encantada un PENDIENTE con conductor puesto; la base no.
     * ═══════════════════════════════════════════════════════════════════════════════
     */
    it('P-07 · desasignar devuelve el operativo a PENDIENTE y la alerta vuelve', async () => {
      // Primero se asigna, para tener algo que deshacer.
      await asignar(DAF, operativoSegundo, {
        conductorId: otroConductor,
        vehiculoId: segundoVehiculo,
      }).expect(200);

      const respuesta = await request(servidor())
        .patch(`${API}/transporte/operativos/${operativoSegundo}/desasignar`)
        .set(como(DAF))
        .expect(200);

      const resultado = respuesta.body as TransporteRespuesta;
      expect(resultado.estadoTransporte).toBe(EstadoTransporte.PENDIENTE);
      expect(resultado.conductor).toBeNull();
      expect(resultado.vehiculo).toBeNull();

      const guardado = await prisma.operativo.findUniqueOrThrow({
        where: { id: operativoSegundo },
      });
      expect(guardado.conductorId).toBeNull();
      expect(guardado.vehiculoId).toBeNull();
      expect(guardado.asignadoEn).toBeNull();

      // POL-06. Sin conductor, la alerta de vehículo pendiente vuelve a nacer.
      const alertas = guardado.alertas as unknown as { codigo: string }[];
      expect(alertas.map((alerta) => alerta.codigo)).toContain('ALV-02');
    });

    it('P-07 · la desasignación queda auditada', async () => {
      await asignar(DAF, operativoNormal, {
        conductorId: conductor,
        vehiculoId: vehiculo,
      }).expect(200);

      await request(servidor())
        .patch(`${API}/transporte/operativos/${operativoNormal}/desasignar`)
        .set(como(DAF))
        .expect(200);

      const trazas = await prisma.auditoria.findMany({
        where: { operativoId: operativoNormal, campo: 'oper_estado_transporte' },
        orderBy: { momento: 'desc' },
        take: 1,
      });

      expect(trazas[0]?.valorNuevo).toBe(EstadoTransporte.PENDIENTE);
      expect(trazas[0]?.rol).toBe(RolDepartamental.DAF);

      // ═══════════════════════════════════════════════════════════════════════════
      // SE DEVUELVE EL OPERATIVO A SU ESTADO ANTERIOR, Y NO ES CORTESÍA.
      //
      // Las suites de este proyecto comparten el fixture entre pruebas y se ejecutan en
      // orden. Al desasignar, `operativoNormal` deja de referenciar la placa M17A001, y
      // la prueba de baja lógica —más abajo— comprueba justamente que un vehículo con
      // historial avisa de él. Sin esta reasignación, aquélla recibe cero y falla por
      // algo que ocurrió tres pruebas antes, que es la peor forma de fallar.
      // ═══════════════════════════════════════════════════════════════════════════
      await asignar(DAF, operativoNormal, {
        conductorId: conductor,
        vehiculoId: vehiculo,
      }).expect(200);
    });

    it('un rol departamental no puede desasignar', async () => {
      await request(servidor())
        .patch(`${API}/transporte/operativos/${operativoNormal}/desasignar`)
        .set(como(OPERATIVOS_ROL))
        .expect(403);
    });

    it('un rol departamental no puede declarar propios medios', async () => {
      await request(servidor())
        .patch(`${API}/transporte/operativos/${operativoNormal}/propios-medios`)
        .set(como(OPERATIVOS_ROL))
        .expect(403);
    });
  });

  describe('la consulta de la DAF', () => {
    it('los pendientes excluyen los formularios que no habilitan vehículo', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/transporte/pendientes/${FECHA}`)
        .set(como(DAF))
        .expect(200);

      const pendientes = respuesta.body as PendienteRespuesta[];

      expect(pendientes.length).toBeGreaterThan(0);
      expect(
        pendientes.some((fila) => fila.id === operativoPropiosMedios),
      ).toBe(false);
      expect(
        pendientes.every(
          (fila) => fila.estadoTransporte === EstadoTransporte.PENDIENTE,
        ),
      ).toBe(true);
    });

    it('la Dirección también los consulta', async () => {
      await request(servidor())
        .get(`${API}/transporte/pendientes/${FECHA}`)
        .set(como(DIRECTOR))
        .expect(200);
    });

    it('un rol departamental no', async () => {
      await request(servidor())
        .get(`${API}/transporte/pendientes/${FECHA}`)
        .set(como(OPERATIVOS_ROL))
        .expect(403);
    });

    it('caso 9 · el desplegable propone la placa del vehículo habitual', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/transporte/conductores?fecha=${FECHA}`)
        .set(como(DAF))
        .expect(200);

      const conductores = respuesta.body as {
        id: number;
        nombreCompleto: string;
        vehiculoHabitual: { id: number; placa: string } | null;
      }[];

      const primero = conductores.find((fila) => fila.id === conductor);
      expect(primero?.vehiculoHabitual?.placa).toBe('M17A001');
    });

    it('RN-45 · el desplegable excluye al conductor de vacaciones', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/transporte/conductores?fecha=${FECHA}`)
        .set(como(DAF))
        .expect(200);

      const conductores = respuesta.body as { id: number }[];
      expect(conductores.some((fila) => fila.id === conductorDeVacaciones)).toBe(
        false,
      );
    });

    it('una fecha mal escrita responde 400', async () => {
      await request(servidor())
        .get(`${API}/transporte/pendientes/02-12-2026`)
        .set(como(DAF))
        .expect(400);
    });
  });

  describe('caso 10 · la ventana de la DAF', () => {
    it('fuera de su ventana, la asignación responde 423', async () => {
      // Se activa la ventana de la DAF con un horario ya vencido: 00H00 a 00H30.
      await prisma.ventanaCarga.upsert({
        where: { rol: RolDepartamental.DAF },
        update: {
          activo: true,
          horaApertura: '00:00',
          horaCierre: '00:30',
          tipo: TipoVentana.DIARIO,
        },
        create: {
          rol: RolDepartamental.DAF,
          tipo: TipoVentana.DIARIO,
          horaApertura: '00:00',
          horaCierre: '00:30',
          mensajeCierre: 'La ventana de transporte está cerrada.',
          activo: true,
        },
      });

      const respuesta = await asignar(DAF, operativoNormal, {
        conductorId: conductor,
        vehiculoId: vehiculo,
      }).expect(423);

      expect((respuesta.body as { codigo: string }).codigo).toBe(
        'VENTANA_CARGA_CERRADA',
      );

      await prisma.ventanaCarga.update({
        where: { rol: RolDepartamental.DAF },
        data: { activo: false },
      });
    });

    it('la consulta NO se restringe por ventana: la Dirección revisa a cualquier hora', async () => {
      await prisma.ventanaCarga.update({
        where: { rol: RolDepartamental.DAF },
        data: { activo: true, horaApertura: '00:00', horaCierre: '00:30' },
      });

      await request(servidor())
        .get(`${API}/transporte/pendientes/${FECHA}`)
        .set(como(DAF))
        .expect(200);

      await prisma.ventanaCarga.update({
        where: { rol: RolDepartamental.DAF },
        data: { activo: false },
      });
    });
  });

  describe('administración de la flota', () => {
    it('la flota la administran la DAF y su administrador; un rol de operativos no', async () => {
      // Desde el 2026-09-10 la DAF también ve Conductores/Vehículos y Mantenimiento (antes
      // eran solo de ADMINISTRADOR_DAF). Un rol de carga de operativos sigue sin acceso.
      await request(servidor())
        .get(`${API}/administracion/conductores`)
        .set(como(OPERATIVOS_ROL))
        .expect(403);

      await request(servidor())
        .get(`${API}/administracion/conductores`)
        .set(como(DAF))
        .expect(200);

      await request(servidor())
        .get(`${API}/administracion/conductores`)
        .set(como(ADMINISTRADOR))
        .expect(200);
    });

    it('crea un conductor y lo asocia a su vehículo habitual', async () => {
      const creado = await request(servidor())
        .post(`${API}/administracion/conductores`)
        .set(como(ADMINISTRADOR))
        .send({
          cedula: '1710034065',
          nombreCompleto: `${PREFIJO} NUEVO`,
          telefono: '0999999999',
          licenciaTipo: 'E',
          vehiculoHabitualId: vehiculo,
        })
        .expect(201);

      expect((creado.body as { nombreCompleto: string }).nombreCompleto).toBe(
        `${PREFIJO} NUEVO`,
      );
    });

    it('una cédula con dígito verificador incorrecto se rechaza', async () => {
      const respuesta = await request(servidor())
        .post(`${API}/administracion/conductores`)
        .set(como(ADMINISTRADOR))
        .send({ cedula: '1710034066', nombreCompleto: `${PREFIJO} INVALIDO` })
        .expect(400);

      expect((respuesta.body as { mensaje: string }).mensaje).toContain(
        'dígito verificador',
      );
    });

    it('la placa se normaliza y no admite duplicados', async () => {
      const creado = await request(servidor())
        .post(`${API}/administracion/vehiculos`)
        .set(como(ADMINISTRADOR))
        .send({ placa: ' m17c003 ', descripcion: `${PREFIJO} moto` })
        .expect(201);

      expect((creado.body as { placa: string }).placa).toBe('M17C003');

      await request(servidor())
        .post(`${API}/administracion/vehiculos`)
        .set(como(ADMINISTRADOR))
        .send({ placa: 'M17C003' })
        .expect(400);
    });

    it('la baja del vehículo es lógica y avisa de su historial', async () => {
      const respuesta = await request(servidor())
        .delete(`${API}/administracion/vehiculos/${vehiculo}`)
        .set(como(ADMINISTRADOR))
        .expect(200);

      const baja = respuesta.body as {
        registro: { activo: boolean };
        operativosHistoricos: number;
        mensaje: string;
      };

      expect(baja.registro.activo).toBe(false);
      expect(baja.operativosHistoricos).toBeGreaterThan(0);
      expect(baja.mensaje).toContain('Sigue figurando');

      // Sigue existiendo: los operativos que lo usaron conservan su placa.
      const guardado = await prisma.vehiculo.findUnique({
        where: { id: vehiculo },
      });
      expect(guardado).not.toBeNull();
    });
  });
});
