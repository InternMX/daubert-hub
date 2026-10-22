import { describe,expect,it,vi } from 'vitest';
import { assertAtomicAdmissionInput,assertAtomicAdmissionResult,type CaterpillarAtomicAdmissionRow } from '../src/automations/remisiones-caterpillar/caterpillar-atomic-admission';
import { CaterpillarExecutionsRepository } from '../src/automations/remisiones-caterpillar/caterpillar-executions.repository';
const input={documentId:'9007199254740993',workerId:'server-worker',seriesCode:'SYN_P5',quantity:2};
const row:CaterpillarAtomicAdmissionRow={decision:'ADMIT',reason:'ACQUIRED',can_emit:true,worker_id:input.workerId,
  ejecucion_id:'9007199254740994',reserva_id:'9007199254740995',folio_inicial:'1000',folio_final:'1001',cantidad:2,legacy_unverified:17};
describe('atomic admission client contract — no DB',()=>{
  it('uses one parameterized atomic call, never an independent reserver',async()=>{
    const query=vi.fn().mockResolvedValue([row]);
    const repo=new CaterpillarExecutionsRepository({query} as never);
    expect(await repo.claimAdmissionAndReserve(input)).toEqual(row);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual([input.documentId,input.workerId,input.seriesCode,2]);
    expect(query.mock.calls[0]?.[0]).toContain('ops.fn_admitir_reservar_caterpillar_test');
    expect(query.mock.calls[0]?.[0]).not.toContain('operacion.reservar_folios_para_ejecucion');
  });
  it.each([{can_emit:'true'}, {worker_id:'other'}, {decision:'BLOCK'}, {reason:'ALREADY_PROCESSING'},
    {reserva_id:null}, {cantidad:3}, {folio_final:'1005'}])('rejects a fabricated emission right %j',change=>{
    expect(()=>assertAtomicAdmissionResult({...row,...change} as CaterpillarAtomicAdmissionRow,input)).toThrow();
  });
  it('a second worker result remains explicitly non-emitting',()=>{
    expect(assertAtomicAdmissionResult({...row,decision:'BLOCK',reason:'PROGRAM_IN_PROGRESS',can_emit:false,worker_id:'other'},input).can_emit).toBe(false);
  });
  it.each([{documentId:'0'}, {documentId:'9223372036854775808'}, {workerId:''}, {quantity:0}, {quantity:1.2}])('rejects invalid atomic request %j',change=>{
    expect(()=>assertAtomicAdmissionInput({...input,...change})).toThrow();
  });
});
