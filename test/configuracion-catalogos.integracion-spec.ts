/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: configuracion-catalogos.integracion-spec.ts
 * Responsabilidad: Verificar los ocho casos del plan contra la base real.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * EXIGE LA BASE LEVANTADA. Se ejecuta con `npm run test:integracion`, aparte de las
 * unitarias, para que `npm test` siga pasando sin contenedor.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SOBRE LOS FORMULARIOS DE ESTA PRUEBA
 *
 * `t_formulario` está VACÍA y seguirá estándolo: PV-25 y PV-26 son columnas
 * obligatorias sin valor acordado. Esta prueba crea sus propios formularios, con el
 * prefijo `PRUEBA_`, y los borra al terminar.
 *
 * NO ES SEMBRAR DATOS. La diferencia importa:
 *   · viven dentro de la prueba y se eliminan en `afterAll`;
 *   · `esPatrulla` y `colorAcento` llevan valores de relleno declarados como tales, y
 *     NINGUNA aserción depende de ellos;
 *   · el prefijo impide confundirlos con los formularios institucionales.
 * Sembrarlos en la base de desarrollo, en cambio, los convertiría en datos que alguien
 * daría por aprobados. Ver PENDIENTES-VALIDACION.md.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AccesoFormulario,
  PoliticaVehiculo,
  RolDepartamental,
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

/** Identidades de prueba. Ver `test/identidad-de-prueba.ts`. */
const ADMINISTRADOR = '6';
const DIRECTOR = '5';
const OPERATIVOS = '1';
const INSTRUCTOR = '3';

const PREFIJO = 'PRUEBA_';
const API = '/api/v1';

interface FormularioListado {
  codigo: string;
  acceso: string;
  colorFondo: string;
  colorAcento: string;
}

interface CatalogosRespuesta {
  zonales: { id: number; nombre: string }[];
  puntos: { id: number; nombre: string }[];
  tiposControl: { id: number; nombre: string }[];
  instituciones: { id: number; sigla: string }[];
  /**
   * RN-20 · una bandera POR CATÁLOGO, no una por formulario.
   *
   * Sustituyen a `permiteCapturaLibre`, que la migración del 11-AGO retiró (I-15). La
   * columna única aplicaba la misma respuesta a los dos desplegables y ofrecía capturar
   * a mano un punto de encuentro que ningún catálogo del insumo aprobado contempla.
   */
  capturaLibrePunto: boolean;
  capturaLibreTipo: boolean;
  /** Si el formulario admite varios tipos de control a la vez (form 8). */
  tipoControlMultiple: boolean;
}

describe('Formularios y catálogos · integración', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  /** Identificadores creados por la prueba, para limpiarlos al final. */
  const creados = {
    formularios: [] as number[],
    puntos: [] as number[],
    tipos: [] as number[],
    instituciones: [] as number[],
  };

  let zonalConPuntos = 0;
  let zonalSinPuntos = 0;

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

    const zonales = await prisma.zonal.findMany({ orderBy: { orden: 'asc' } });
    zonalConPuntos = zonales[0].id;
    zonalSinPuntos = zonales[1].id;

    // `ck_formulario_numero` acota el número al rango 1 a 9 y `uq_formulario_numero`
    // lo hace único, de modo que la prueba solo puede crear los suyos si la tabla está
    // vacía. Lo está por PV-25 y PV-26. Si algún día deja de estarlo, esto lo dice con
    // claridad en vez de fallar con una violación de unicidad sin contexto.
    const institucionales = await prisma.formulario.count({
      where: { codigo: { not: { startsWith: PREFIJO } } },
    });
    if (institucionales > 0) {
      throw new Error(
        't_formulario ya tiene formularios institucionales. Esta prueba crea los suyos con los números 7, 8 y 9 y chocaría con ellos: revise la estrategia de datos de prueba antes de continuar.',
      );
    }
    await prisma.formulario.deleteMany({
      where: { codigo: { startsWith: PREFIJO } },
    });

    // Tres formularios que reproducen las tres situaciones de propiedad del cuadro.
    const definicion = [
      {
        numero: 7,
        codigo: `${PREFIJO}OPER`,
        rolDueno: RolDepartamental.DMIP_OPERATIVOS,
        rolCompartido: null,
        cupoCompartido: null,
        capturaLibrePunto: false,
        capturaLibreTipo: false,
      },
      {
        numero: 8,
        codigo: `${PREFIJO}INSP`,
        rolDueno: RolDepartamental.DMIP_INSPECCIONES,
        rolCompartido: null,
        cupoCompartido: null,
        // Solo el tipo de control. Es lo que decía el insumo aprobado y lo que la
        // migración del 11-AGO trasladó desde la columna única: `ADICIONALES` figura
        // en `tiposControl` de los formularios 2 y 8, y en ningún `puntosEncuentro`.
        capturaLibrePunto: false,
        capturaLibreTipo: true,
        // Varios tipos de control a la vez, como el formulario 8 real (2026-09-07).
        tipoControlMultiple: true,
      },
      {
        numero: 9,
        codigo: `${PREFIJO}REACN`,
        rolDueno: RolDepartamental.DMIP_INSPECCIONES,
        rolCompartido: RolDepartamental.DMIT_INSTRUCTOR,
        cupoCompartido: 1,
        capturaLibrePunto: false,
        capturaLibreTipo: false,
      },
    ];

    for (const forma of definicion) {
      // La autorización dejó de ser dos columnas del formulario y pasó a filas de
      // t_formulario_rol (2026-08-25): el dueño registra (ESCRITURA) y el invitado aporta
      // personal (APORTA, con cupo). Se apartan del `data` los dos campos ya retirados.
      const { rolCompartido, cupoCompartido, ...datos } = forma;
      const creado = await prisma.formulario.create({
        data: {
          ...datos,
          nombre: `FORMULARIO DE PRUEBA ${forma.numero}`,
          colorFondo: '#EEEEEE',
          // Relleno: PV-25 sin resolver. Ninguna aserción lo usa.
          colorAcento: '#000000',
          colorNombre: 'gris',
          politicaVehiculo: PoliticaVehiculo.CONDICIONAL,
          condicionanteNoct: false,
          // Relleno: PV-26 sin resolver. Ninguna aserción lo usa.
          esPatrulla: false,
          orden: forma.numero,
          roles: {
            create: [
              { rol: forma.rolDueno, acceso: AccesoFormulario.ESCRITURA },
              ...(rolCompartido
                ? [
                    {
                      rol: rolCompartido,
                      acceso: AccesoFormulario.APORTA,
                      cupo: cupoCompartido ?? 1,
                    },
                  ]
                : []),
            ],
          },
        },
      });
      creados.formularios.push(creado.id);
    }

    // Las zonales son DEL FORMULARIO desde el 2026-10-13: INSP tiene las dos zonas de la prueba
    // (una con puntos y otra sin ellos). Caen en cascada con el formulario al terminar.
    const zonasDePrueba = [zonalConPuntos, zonalSinPuntos];
    for (const [indice, zonaId] of zonasDePrueba.entries()) {
      await prisma.zonalFormulario.create({
        data: {
          formularioId: creados.formularios[1],
          zonaId,
          nombre: `${PREFIJO}Zonal ${indice + 1}`,
          orden: indice + 1,
        },
      });
    }
  });

  afterAll(async () => {
    // Las tablas puente caen en cascada con el formulario; los catálogos no.
    // La auditoría NO se limpia: es un registro de evidencia y borrarlo por comodidad
    // contradiría el motivo por el que existe.
    await prisma.formulario.deleteMany({
      where: { codigo: { startsWith: PREFIJO } },
    });
    await prisma.puntoEncuentro.deleteMany({
      where: { id: { in: creados.puntos } },
    });
    await prisma.tipoControl.deleteMany({
      where: { id: { in: creados.tipos } },
    });
    await prisma.institucion.deleteMany({
      where: { id: { in: creados.instituciones } },
    });
    await app.close();
  });

  /** `getHttpServer()` devuelve `any`; se tipa una sola vez y no en cada llamada. */
  const servidor = (): Server => app.getHttpServer() as Server;

  // ─────────────────────────── Consulta ───────────────────────────

  describe('GET /formularios/permitidos', () => {
    it('caso 1 · el rol ve sus formularios y no los ajenos', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/formularios/permitidos`)
        .set(como(OPERATIVOS))
        .expect(200);

      const mios = (respuesta.body as FormularioListado[]).filter((f) =>
        f.codigo.startsWith(PREFIJO),
      );

      expect(mios.map((f) => f.codigo)).toEqual([`${PREFIJO}OPER`]);
      expect(mios[0].acceso).toBe('ESCRITURA');
    });

    it('caso 2 · el rol con cupo ve el formulario compartido, marcado como tal', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/formularios/permitidos`)
        .set(como(INSTRUCTOR))
        .expect(200);

      const compartido = (respuesta.body as FormularioListado[]).find(
        (f) => f.codigo === `${PREFIJO}REACN`,
      );

      expect(compartido?.acceso).toBe('COMPARTIDO');
    });

    it('caso 3 · el Director ve los tres, en lectura', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/formularios/permitidos`)
        .set(como(DIRECTOR))
        .expect(200);

      const mios = (respuesta.body as FormularioListado[]).filter((f) =>
        f.codigo.startsWith(PREFIJO),
      );

      expect(mios).toHaveLength(3);
      expect(mios.every((f) => f.acceso === 'LECTURA')).toBe(true);
    });

    it('caso 8 · la respuesta trae los colores: el frontend no los define', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/formularios/permitidos`)
        .set(como(OPERATIVOS))
        .expect(200);

      const propio = (respuesta.body as FormularioListado[]).find(
        (f) => f.codigo === `${PREFIJO}OPER`,
      );

      expect(propio?.colorFondo).toBe('#EEEEEE');
      expect(propio?.colorAcento).toHaveLength(7);
    });

    it('sin cabecera de identidad responde 401', async () => {
      await request(servidor())
        .get(`${API}/formularios/permitidos`)
        .expect(401);
    });
  });

  describe('GET /zonales', () => {
    it('caso 5 · devuelve las once filas, completas', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/zonales`)
        .set(como(OPERATIVOS))
        .expect(200);

      const zonales = respuesta.body as { esDmq: boolean }[];
      expect(zonales.length).toBe(11);
      expect(zonales.filter((z) => z.esDmq)).toHaveLength(1);
    });
  });

  describe('GET /formularios/:codigo/catalogos', () => {
    it('caso 4 · devuelve lo delimitado a ESE formulario y nada de otro', async () => {
      const punto = await request(servidor())
        .post(`${API}/administracion/catalogos/${PREFIJO}INSP/puntos`)
        .set(como(ADMINISTRADOR))
        .send({
          nombre: `${PREFIJO}Punto delimitado`,
          zonalId: zonalConPuntos,
        })
        .expect(201);
      creados.puntos.push((punto.body as { id: number }).id);

      const propios = await request(servidor())
        .get(`${API}/formularios/${PREFIJO}INSP/catalogos`)
        .set(como(OPERATIVOS))
        .expect(200);
      const ajenos = await request(servidor())
        .get(`${API}/formularios/${PREFIJO}OPER/catalogos`)
        .set(como(OPERATIVOS))
        .expect(200);

      expect(
        (propios.body as CatalogosRespuesta).puntos.map((p) => p.nombre),
      ).toEqual([`${PREFIJO}Punto delimitado`]);
      expect((ajenos.body as CatalogosRespuesta).puntos).toEqual([]);
    });

    it('RN-16 · un formulario sin delimitación no recibe el catálogo completo', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/formularios/${PREFIJO}REACN/catalogos`)
        .set(como(OPERATIVOS))
        .expect(200);

      const catalogos = respuesta.body as CatalogosRespuesta;
      expect(catalogos.tiposControl).toEqual([]);
      expect(catalogos.instituciones).toEqual([]);
    });

    /**
     * RN-20 dice «los CATÁLOGOS que lo prevén»: la captura libre es propiedad de cada
     * catálogo, no del formulario. Es el defecto I-15, corregido el 11-AGO en el modelo
     * y no solo en la pantalla.
     *
     * LA COMPROBACIÓN QUE IMPORTA ES LA TERCERA: que un formulario con captura libre en
     * el tipo de control **no** la ofrezca además en el punto de encuentro. Mientras
     * hubo una sola columna, la interfaz aplicaba la misma respuesta a los dos
     * desplegables y ofrecía capturar a mano un punto que ningún catálogo contempla,
     * justo en los formularios cuyos puntos no están cargados por PV-01.
     */
    it('RN-20 · la captura libre se informa por catálogo, no por formulario', async () => {
      const conCaptura = await request(servidor())
        .get(`${API}/formularios/${PREFIJO}INSP/catalogos`)
        .set(como(OPERATIVOS))
        .expect(200);
      const sinCaptura = await request(servidor())
        .get(`${API}/formularios/${PREFIJO}OPER/catalogos`)
        .set(como(OPERATIVOS))
        .expect(200);

      const con = conCaptura.body as CatalogosRespuesta;
      const sin = sinCaptura.body as CatalogosRespuesta;

      expect(con.capturaLibreTipo).toBe(true);
      expect(sin.capturaLibreTipo).toBe(false);

      // Ninguno de los dos la ofrece en el punto de encuentro: en el insumo aprobado
      // `ADICIONALES` no figura en `puntosEncuentro` de ninguno de los nueve.
      expect(con.capturaLibrePunto).toBe(false);
      expect(sin.capturaLibrePunto).toBe(false);
    });

    /**
     * REGRESIÓN. El servicio calculaba `tipoControlMultiple`, pero el DTO de respuesta lo
     * OMITÍA: no llegaba al navegador y el formulario 8 se quedaba en selección única. Esta
     * prueba mira la RESPUESTA HTTP —no el servicio—, que es donde estaba el hueco.
     */
    it('la respuesta expone tipoControlMultiple del formulario (form 8 lo admite)', async () => {
      const multiple = await request(servidor())
        .get(`${API}/formularios/${PREFIJO}INSP/catalogos`)
        .set(como(OPERATIVOS))
        .expect(200);
      const unico = await request(servidor())
        .get(`${API}/formularios/${PREFIJO}OPER/catalogos`)
        .set(como(OPERATIVOS))
        .expect(200);

      expect((multiple.body as CatalogosRespuesta).tipoControlMultiple).toBe(
        true,
      );
      expect((unico.body as CatalogosRespuesta).tipoControlMultiple).toBe(
        false,
      );
    });

    it('un código inexistente responde 404', async () => {
      await request(servidor())
        .get(`${API}/formularios/NO_EXISTE/catalogos`)
        .set(como(OPERATIVOS))
        .expect(404);
    });
  });

  describe('GET /formularios/:codigo/zonales/:zonalId/puntos', () => {
    it('caso 6 · una zonal sin puntos devuelve lista vacía, pero la zonal existe', async () => {
      const puntos = await request(servidor())
        .get(
          `${API}/formularios/${PREFIJO}INSP/zonales/${zonalSinPuntos}/puntos`,
        )
        .set(como(OPERATIVOS))
        .expect(200);

      const zonales = await request(servidor())
        .get(`${API}/zonales`)
        .set(como(OPERATIVOS))
        .expect(200);

      expect(puntos.body).toEqual([]);
      expect(
        (zonales.body as { id: number }[]).some((z) => z.id === zonalSinPuntos),
      ).toBe(true);
    });

    it('RN-17 · la zonal con el punto delimitado sí lo devuelve', async () => {
      const respuesta = await request(servidor())
        .get(
          `${API}/formularios/${PREFIJO}INSP/zonales/${zonalConPuntos}/puntos`,
        )
        .set(como(OPERATIVOS))
        .expect(200);

      expect(
        (respuesta.body as { nombre: string }[]).map((p) => p.nombre),
      ).toContain(`${PREFIJO}Punto delimitado`);
    });

    it('una zonal inexistente responde 404', async () => {
      await request(servidor())
        .get(`${API}/formularios/${PREFIJO}INSP/zonales/99999/puntos`)
        .set(como(OPERATIVOS))
        .expect(404);
    });
  });

  // ─────────────────────── Administración ───────────────────────

  describe('CRUD /administracion/catalogos', () => {
    it('un rol que no es ADMINISTRADOR recibe 403', async () => {
      await request(servidor())
        .post(`${API}/administracion/catalogos/${PREFIJO}OPER/tipos-control`)
        .set(como(DIRECTOR))
        .send({ nombre: `${PREFIJO}Tipo prohibido` })
        .expect(403);
    });

    it('crea un tipo de control y lo deja disponible', async () => {
      const creado = await request(servidor())
        .post(`${API}/administracion/catalogos/${PREFIJO}OPER/tipos-control`)
        .set(como(ADMINISTRADOR))
        .send({
          nombre: `${PREFIJO}Control de prueba`,
        })
        .expect(201);

      const id = (creado.body as { id: number }).id;
      creados.tipos.push(id);

      const catalogos = await request(servidor())
        .get(`${API}/formularios/${PREFIJO}OPER/catalogos`)
        .set(como(OPERATIVOS))
        .expect(200);

      expect(
        (catalogos.body as CatalogosRespuesta).tiposControl.map((t) => t.id),
      ).toContain(id);
    });

    it('rechaza el duplicado que solo cambia mayúsculas y acentos', async () => {
      const respuesta = await request(servidor())
        .post(`${API}/administracion/catalogos/${PREFIJO}OPER/tipos-control`)
        .set(como(ADMINISTRADOR))
        .send({
          nombre: `${PREFIJO}CONTROL DE PRUEBA`,
        })
        // 409 desde el 2026-10-12: la petición es correcta, choca con el catálogo.
        .expect(409);

      const cuerpo = respuesta.body as { codigo: string; mensaje: string };
      expect(cuerpo.codigo).toBe('CATALOGO_DUPLICADO');
      expect(cuerpo.mensaje).toContain('Ya existe');
    });

    it('rechaza un campo fuera de contrato nombrándolo', async () => {
      const respuesta = await request(servidor())
        .post(`${API}/administracion/catalogos/${PREFIJO}OPER/tipos-control`)
        .set(como(ADMINISTRADOR))
        .send({
          nombre: `${PREFIJO}Otro`,
          activo: true,
        })
        .expect(400);

      const cuerpo = respuesta.body as { codigo: string; mensaje: string };
      expect(cuerpo.codigo).toBe('CAMPOS_NO_PERMITIDOS');
      expect(cuerpo.mensaje).toContain('activo');
    });

    it('exige el nombre con un mensaje que sirve al administrador', async () => {
      const respuesta = await request(servidor())
        .post(`${API}/administracion/catalogos/${PREFIJO}OPER/tipos-control`)
        .set(como(ADMINISTRADOR))
        .send({})
        .expect(400);

      expect((respuesta.body as { mensaje: string }).mensaje).toBe(
        'Indique el nombre del tipo de control.',
      );
    });

    it('caso 7 · DELETE desactiva y explica por qué no elimina', async () => {
      const id = creados.tipos[0];

      const baja = await request(servidor())
        .delete(
          `${API}/administracion/catalogos/${PREFIJO}OPER/tipos-control/${id}`,
        )
        .set(como(ADMINISTRADOR))
        .expect(200);

      const cuerpo = baja.body as { activo: boolean; mensaje: string };
      expect(cuerpo.activo).toBe(false);
      expect(cuerpo.mensaje).toContain('no se eliminan');

      // Sigue existiendo en la base, que es justo lo que exige RF-058.
      const enBase = await prisma.tipoControl.findUnique({ where: { id } });
      expect(enBase).not.toBeNull();
      expect(enBase?.activo).toBe(false);

      // Y ya no se ofrece al registrar.
      const catalogos = await request(servidor())
        .get(`${API}/formularios/${PREFIJO}OPER/catalogos`)
        .set(como(OPERATIVOS))
        .expect(200);
      expect(
        (catalogos.body as CatalogosRespuesta).tiposControl.map((t) => t.id),
      ).not.toContain(id);
    });

    it('la administración queda auditada con el usuario y el rol', async () => {
      const trazas = await prisma.auditoria.findMany({
        where: { entidad: 't_tipo_control', entidadId: creados.tipos[0] },
        orderBy: { id: 'asc' },
      });

      expect(trazas.map((t) => t.accion)).toEqual(['CREAR', 'ELIMINAR']);
      expect(trazas[0].usuario).toBe(6);
      expect(trazas[0].rol).toBe(RolDepartamental.ADMINISTRADOR_DMIP);
      expect(trazas[0].correlacion).not.toBeNull();
      // El campo de la traza es el nombre de la columna, uniforme en todo el módulo.
      expect(trazas[1].campo).toBe('tico_activo');
    });

    it('crear en un formulario inexistente responde 404', async () => {
      await request(servidor())
        .post(`${API}/administracion/catalogos/NO_EXISTE/instituciones`)
        .set(como(ADMINISTRADOR))
        .send({ sigla: `${PREFIJO}XX`, nombre: 'Institución de prueba' })
        .expect(404);
    });

    it('desactivar un tipo indicando OTRO formulario responde 404 (2026-10-13)', async () => {
      await request(servidor())
        .delete(
          `${API}/administracion/catalogos/${PREFIJO}INSP/tipos-control/${creados.tipos[0]}`,
        )
        .set(como(ADMINISTRADOR))
        .expect(404);
    });
  });
});
