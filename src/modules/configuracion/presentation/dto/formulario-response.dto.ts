/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: formulario-response.dto.ts
 * Responsabilidad: Componer la definición de un formulario para la interfaz.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * LOS COLORES VIAJAN EN LA RESPUESTA. Son dato institucional del Excel aprobado y el
 * frontend no los define ni los interpreta: los aplica. Ver FASE5 §10.2 y la regla 3
 * de transporte-frontend/CLAUDE.md.
 *
 * `acceso` acompaña a cada formulario para que la pantalla sepa si ofrece el registro
 * o solo la consulta, sin volver a deducir la propiedad departamental por su cuenta.
 */

import type {
  AccesoFormulario as AccesoEnBase,
  AreaPersonal,
  PoliticaVehiculo,
  RolDepartamental,
  TipoTransporte,
} from '@prisma/client';

import type { AccesoFormulario } from '../../application/reglas-formulario';
import type { FormularioConAcceso } from '../../application/formularios.service';
import type { FormularioConAreas } from '../../infrastructure/formularios.repository';

export interface AreaFormularioDto {
  area: AreaPersonal;
  esCompartida: boolean;
}

/** Qué puede hacer un departamento concreto en el formulario. Desde el 2026-08-25. */
export interface RolDelFormularioDto {
  rol: RolDepartamental;
  /** `ESCRITURA` registra y edita lo suyo; `APORTA` solo asigna personal, con cupo. */
  acceso: AccesoEnBase;
  /** Máximo de personas que puede asignar. Solo en `APORTA`. */
  cupo: number | null;
}

export interface FormularioResponseDto {
  /**
   * EL IDENTIFICADOR VIAJA PORQUE LA ADMINISTRACIÓN DE CATÁLOGOS LO EXIGE. Cada punto,
   * institución y tipo de control PERTENECE a un formulario (columna `form_id` propia,
   * 2026-09-29), así que sus altas envían `formularioId: number`, y esta es la única
   * respuesta que enumera los formularios: sin él, P-08 no sabría a qué formulario crear
   * el catálogo. Es una clave sustituta, no información operativa.
   */
  id: number;
  numero: number;
  codigo: string;
  nombre: string;
  colorFondo: string;
  colorAcento: string;
  colorNombre: string;
  /** Departamento responsable. **No decide la autorización**: eso lo dice `acceso`. */
  rolDueno: RolDepartamental;
  /**
   * Qué puede hacer cada departamento en este formulario. Desde el 2026-08-25.
   *
   * SUSTITUYE A `rolCompartido` Y `cupoCompartido`, que solo daban para un invitado. La
   * patrulla ECU tiene **dos departamentos que registran**, y eso en dos campos no cabía.
   *
   * `acceso`, unas líneas más abajo, sigue siendo lo que la pantalla mira para decidir
   * qué ofrecer: es el veredicto **para quien pregunta**. Esto es el cuadro completo, y
   * sirve para explicarlo —la matriz nombra a los responsables con él—.
   */
  roles: RolDelFormularioDto[];
  politicaVehiculo: PoliticaVehiculo;
  condicionanteNocturno: boolean;
  esPatrulla: boolean;
  /** RN-20, por catálogo. Separadas el 2026-08-11: ver `catalogos-response.dto.ts`. */
  capturaLibrePunto: boolean;
  capturaLibreTipo: boolean;
  /**
   * Transporte que el formulario SUGIERE al registrar (2026-10-07). Lo lee P-01 de esta lista
   * —no de los catálogos— al abrir el formulario y al cambiar de pestaña. Faltaba aquí, y el
   * registro caía siempre en «Completo» aunque el formulario sugiriera Propios medios.
   */
  tipoTransportePorDefecto: TipoTransporte;
  orden: number;
  areas: AreaFormularioDto[];
  acceso: AccesoFormulario;
}

export function aFormularioResponse({
  formulario,
  acceso,
}: FormularioConAcceso): FormularioResponseDto {
  return {
    id: formulario.id,
    numero: formulario.numero,
    codigo: formulario.codigo,
    nombre: formulario.nombre,
    colorFondo: formulario.colorFondo,
    colorAcento: formulario.colorAcento,
    colorNombre: formulario.colorNombre,
    rolDueno: formulario.rolDueno,
    roles: formulario.roles.map((fila) => ({
      rol: fila.rol,
      acceso: fila.acceso,
      cupo: fila.cupo,
    })),
    politicaVehiculo: formulario.politicaVehiculo,
    condicionanteNocturno: formulario.condicionanteNoct,
    esPatrulla: formulario.esPatrulla,
    capturaLibrePunto: formulario.capturaLibrePunto,
    capturaLibreTipo: formulario.capturaLibreTipo,
    tipoTransportePorDefecto: formulario.tipoTransporteDefecto,
    orden: formulario.orden,
    areas: areasDe(formulario),
    acceso,
  };
}

function areasDe(formulario: FormularioConAreas): AreaFormularioDto[] {
  return formulario.areas.map((area) => ({
    area: area.area,
    esCompartida: area.esCompartida,
  }));
}
