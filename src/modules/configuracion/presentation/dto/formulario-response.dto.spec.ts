/**
 * Microservicio: transporte
 * Modulo: Cuadro de Colores
 * Archivo: formulario-response.dto.spec.ts
 * Responsabilidad: Fijar que `GET /formularios/permitidos` lleve el transporte sugerido.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 *
 * El registro (P-01) lee el transporte que el formulario sugiere de ESTA respuesta. Cuando el
 * campo faltaba, el formulario 1 abría en «Completo» aunque la base dijera Propios medios.
 */

import { TipoTransporte } from '@prisma/client';

import type { FormularioConAcceso } from '../../application/formularios.service';
import { aFormularioResponse } from './formulario-response.dto';

/** Lo mínimo que lee el mapeo; el resto del registro no interviene en esta prueba. */
const formularioDePrueba = (
  tipoTransporteDefecto: TipoTransporte,
): FormularioConAcceso['formulario'] =>
  ({
    id: 1,
    numero: 1,
    codigo: 'FIJOS',
    nombre: 'OPERATIVOS DE CONTROL FIJOS',
    colorFondo: '#FFFFFF',
    colorAcento: '#000000',
    colorNombre: '#000000',
    rolDueno: 'DMIP_OPERATIVOS',
    roles: [],
    politicaVehiculo: 'REQUERIDO',
    condicionanteNoct: false,
    esPatrulla: false,
    capturaLibrePunto: false,
    capturaLibreTipo: false,
    tipoTransporteDefecto,
    orden: 1,
    areas: [],
  }) as unknown as FormularioConAcceso['formulario'];

describe('aFormularioResponse · transporte sugerido', () => {
  it.each([TipoTransporte.PROPIOS_MEDIOS, TipoTransporte.INICIO_Y_FIN])(
    'devuelve el transporte que el formulario sugiere (%s)',
    (tipo) => {
      const respuesta = aFormularioResponse({
        formulario: formularioDePrueba(tipo),
        acceso: 'ESCRITURA',
      } as FormularioConAcceso);

      expect(respuesta.tipoTransportePorDefecto).toBe(tipo);
    },
  );
});
