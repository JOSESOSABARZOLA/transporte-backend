/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · guarda del vehículo
 * Archivo: acta-parqueadero.ts
 * Responsabilidad: Decir si un conductor tiene acta de parqueadero vigente en una fecha.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * Art. 8 del Reglamento: un vehículo solo pernocta en el domicilio del conductor si éste tiene
 * parqueadero autorizado Y un acta vigente (número + desde/hasta). Pura: la usan la declaración del
 * destino (que RECHAZA un DOMICILIO sin acta) y la línea de tiempo (que lo muestra).
 */

export interface ConductorConActa {
  parqueaderoAutorizado: boolean;
  actaParqueaderoNumero: string | null;
  actaParqueaderoDesde: Date | null;
  actaParqueaderoHasta: Date | null;
}

export function actaVigente(conductor: ConductorConActa, fecha: Date): boolean {
  if (!conductor.parqueaderoAutorizado || !conductor.actaParqueaderoNumero)
    return false;
  if (!conductor.actaParqueaderoDesde || !conductor.actaParqueaderoHasta)
    return false;
  const dia = fecha.toISOString().slice(0, 10);
  return (
    conductor.actaParqueaderoDesde.toISOString().slice(0, 10) <= dia &&
    conductor.actaParqueaderoHasta.toISOString().slice(0, 10) >= dia
  );
}
