import { describe, expect, it } from 'vitest';
import { completePersonName, membershipPeriodConflict, resolveSourcePerson, sourcePeriod } from '../../src/verification/person-source-plan.js';

describe('identidad conjunta de personas', () => {
  it('no cierra antes del ingreso registrado ni conserva una membresía actual con salida', () => {
    expect(membershipPeriodConflict({from_year:1975,to_year:null,is_current:false},{from_year:null,to_year:1968,is_current:false})).toBe('source_period_inverts_existing_membership');
    expect(membershipPeriodConflict({from_year:2000,to_year:null,is_current:true},{from_year:null,to_year:2005,is_current:false})).toBe('source_period_conflicts_with_current_membership');
    expect(membershipPeriodConflict({from_year:2000,to_year:null,is_current:false},{from_year:null,to_year:2005,is_current:false})).toBeNull();
  });
  const people = [
    {id:1,name:'Henry Augustus Stephen Pierre',aliases:['Henry Stephen'],projects:[10]},
    {id:2,name:'José Pérez',aliases:[],projects:[20]},
    {id:3,name:'José Pérez',aliases:[],projects:[30]},
  ];
  it('usa alias y proyecto para distinguir homónimos; no asigna nombres de una palabra', () => {
    expect(resolveSourcePerson('Henry Stephen',10,people)).toBe(1);
    expect(resolveSourcePerson('José Pérez',30,people)).toBe(3);
    expect(resolveSourcePerson('José Pérez',40,people)).toBeNull();
    expect(resolveSourcePerson('Henry',10,people)).toBeNull();
  });
  it('conserva etapas múltiples y fechas contradictorias para revisión', () => {
    expect(sourcePeriod([{begin:'1997',end:'2000'},{begin:'2003',end:'2007'}])).toBeNull();
    expect(sourcePeriod([{begin:'2000',end:'2005'},{isCurrent:true}])).toBeNull();
    expect(sourcePeriod([{begin:'2001-04'}])).toEqual({from_year:2001,to_year:null,is_current:false});
    expect(sourcePeriod([{periodNeedsReview:true}])).toBeNull();
  });
  it('no autoriza altas de iniciales o nombres compuestos de varias personas', () => {
    expect(completePersonName('José Pérez')).toBe(true);
    expect(completePersonName('José P.')).toBe(false);
    expect(completePersonName('José Pérez / Juan Díaz')).toBe(false);
  });
  it('reconoce altas y vínculos añadidos durante un lote sin reutilizar un índice obsoleto', () => {
    const current = [{id:1,name:'José Pérez',aliases:[],projects:[10]}];
    expect(resolveSourcePerson('José Pérez',20,current)).toBe(1);
    current.push({id:2,name:'José Pérez',aliases:[],projects:[30]});
    expect(resolveSourcePerson('José Pérez',20,current)).toBeNull();
    current[1]!.projects.push(20);
    expect(resolveSourcePerson('José Pérez',20,current)).toBe(2);
  });
});
