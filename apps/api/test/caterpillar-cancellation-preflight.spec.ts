import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {describe,expect,it} from 'vitest';
const dir=resolve(__dirname,'../../../database/migrations/daubert_global');
const pre=readFileSync(resolve(dir,'20261020_013_caterpillar_cancellation.precheck.sql'),'utf8')
  .replace("('daubert_hub_test','daubert_global')","('postgres','daubert_hub_test','daubert_global')");
describe('013 strict preflight (isolated catalog only)',()=>{
  it.each([
    ['compatible','',null],
    ['wrong timestamp',"ALTER TABLE operacion.remisiones ALTER COLUMN updated_at TYPE timestamp without time zone",'incompatible columns'],
    ['missing primary key','ALTER TABLE operacion.remisiones DROP CONSTRAINT remisiones_pkey','primary key'],
    ['orphan sequence','CREATE SEQUENCE operacion.cancelaciones_remisiones_cancelacion_id_seq','objects present'],
    ['partial ledger','CREATE TABLE operacion.cancelaciones_remisiones(id int)','objects present'],
    ['missing trigger','DROP TRIGGER trg_remisiones_updated_at ON operacion.remisiones','trigger missing'],
    ['role privilege drift','GRANT UPDATE(estatus) ON operacion.remisiones TO daubert_hub_test_user','privilege drift']
  ] as const)('%s',async(_name,mutation,error)=>{
    const db=new PGlite();
    try{
      await db.exec(readFileSync(resolve(__dirname,'fixtures/caterpillar-cancellation-schema.sql'),'utf8'));
      if(mutation)await db.exec(mutation);
      if(error)await expect(db.exec(pre)).rejects.toThrow(error);else await db.exec(pre);
      await db.exec('ROLLBACK');
    }finally{await db.close();}
  },30000);
});
